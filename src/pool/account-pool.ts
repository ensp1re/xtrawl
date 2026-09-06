import { randomUUID } from "node:crypto";
import { ACCOUNT_HEALTH, ACCOUNT_STATUS_CODE } from "../constants/accounts.js";
import type { AccountLease, AccountRecord, AccountSummary } from "../domain/accounts.js";
import type { AccountLeaseCompletion, AccountStateStore } from "../domain/account-state.js";
import {
  AccountPoolExhausted,
  AccountSessionBuildError,
  AccountStateError,
  AuthError,
  XTrawlError,
  NetworkError,
  RateLimitError,
  ProxyError,
} from "../domain/errors.js";
import type { ClientConfig } from "../config/types.js";
import type { HttpSession } from "../domain/http.js";
import { computeCooldown } from "./cooldown.js";
import type { SessionBuilder } from "../transport/session.js";
import { isRecord } from "../utils/guards.js";
import { combineSignals, isAbortError, throwIfAborted } from "../utils/abort.js";
import type { AccountRepair, PoolExecutionContext, PoolExecutionOptions } from "../domain/pool.js";
import { TokenBucketLimiter, sleep } from "./limiter.js";

export type { AccountRepair, PoolExecutionContext, PoolExecutionOptions } from "../domain/pool.js";

export class AccountPool {
  private readonly limiters = new Map<string, TokenBucketLimiter>();
  private cachedSummary: AccountSummary;

  public constructor(
    private readonly repository: AccountStateStore,
    private readonly sessions: SessionBuilder,
    private readonly config: ClientConfig,
    private readonly repairAccount?: AccountRepair,
    initialAccounts: readonly AccountRecord[] = [],
    private readonly storeLocation = `external:${repository.kind ?? "custom"}`,
    private readonly onAccountsChanged?: (accounts: readonly AccountRecord[]) => void,
  ) {
    this.cachedSummary = summarizeAccounts(initialAccounts, this.config, this.storeLocation);
  }

  public async execute<T>(
    label: string,
    operation: (context: PoolExecutionContext) => Promise<T>,
    options: PoolExecutionOptions<T> = {},
  ): Promise<T> {
    const maxAttempts = this.config.maxTaskAttempts;
    const seenAccounts = new Set<string>();
    let lastError: unknown;
    let repairs = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      throwIfAborted(options.signal);
      const now = Date.now();
      const account = await this.repository.acquireLease({
        now,
        leaseId: randomUUID(),
        leaseExpiresAt: now + this.config.leaseTtlMs,
        utcDate: utcDate(now),
        requireAuthMaterial: true,
        dailyRequestsLimit: this.config.dailyRequestsLimit,
        dailyTweetsLimit: this.config.dailyTweetsLimit,
      });
      if (!account) {
        if (lastError) throw lastError;
        throw new AccountPoolExhausted(`No eligible account for ${label}.`);
      }
      const accountKey = String(account.id ?? account.username);
      seenAccounts.add(accountKey);
      const switchLimit = options.maxAccountSwitches ?? this.config.maxAccountSwitches;
      if (seenAccounts.size > switchLimit + 1) {
        await this.completeLease(account, {
          status: ACCOUNT_HEALTH.HEALTHY,
          availableUntil: 0,
          pages: 0,
          tweets: 0,
        });
        if (lastError) throw lastError;
        throw new AccountPoolExhausted(`Account-switch limit reached for ${label}.`);
      }
      let session: HttpSession | undefined;
      let operationStarted = false;
      let leaseCompleted = false;
      let requests = 0;
      const leaseGuard = new AbortController();
      const signal = combineSignals(options.signal, leaseGuard.signal);
      const heartbeat = this.startHeartbeat(account, () => leaseGuard.abort());
      try {
        if (this.config.proxyCheckOnLease)
          await this.sessions.assertProxyHealthy(account, {
            url: this.config.proxyCheckUrl,
            timeoutMs: this.config.proxyCheckTimeoutMs,
          });
        session = this.sessions.forAccount(account);
        await this.limiterFor(account).acquire(signal);
        operationStarted = true;
        const value = await operation({
          account,
          session,
          ...(signal ? { signal } : {}),
          chargeRequest: () => {
            requests += 1;
          },
        });
        if (leaseGuard.signal.aborted)
          throw new AccountStateError("The account lease was lost.", { account: account.username });
        const quota = readQuota(value);
        const exhausted = quota?.exhausted === true || quota?.remaining === 0;
        await this.completeLease(account, {
          status: exhausted ? ACCOUNT_HEALTH.COOLING_DOWN : ACCOUNT_HEALTH.HEALTHY,
          availableUntil: exhausted ? (quota?.resetAt ?? Date.now() + this.config.cooldownDefaultMs) : 0,
          pages: Math.max(requests, 1),
          tweets: Math.max(0, options.countTweets?.(value) ?? countTweets(value)),
        });
        leaseCompleted = true;
        return value;
      } catch (error) {
        lastError = error;
        if (!leaseCompleted)
          await this.completeLease(account, {
            ...this.failureCompletion(error),
            pages: operationStarted ? Math.max(requests, 1) : 0,
            tweets: 0,
          });
        if (error instanceof AuthError && this.repairAccount && repairs < this.config.maxFallbackAttempts) {
          repairs += 1;
          await this.repairAccount(account).catch(() => false);
        }
        if (attempt >= maxAttempts || !isRetryable(error)) throw error;
        options.onRetry?.(error, attempt);
        await sleep(Math.min(this.config.retryMaxMs, this.config.retryBaseMs * 2 ** (attempt - 1)), signal);
      } finally {
        if (heartbeat) clearInterval(heartbeat);
        await session?.close();
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new AccountPoolExhausted(`No eligible account for ${label}.`);
  }

  public get summary() {
    if (!this.storeLocation.startsWith("external:")) {
      const current = this.repository.list();
      if (Array.isArray(current)) this.updateAccounts(current);
    }
    return this.cachedSummary;
  }

  public updateAccounts(accounts: readonly AccountRecord[]): void {
    this.cachedSummary = summarizeAccounts(accounts, this.config, this.storeLocation);
  }

  private failureCompletion(
    error: unknown,
  ): Pick<AccountLeaseCompletion, "status" | "availableUntil" | "lastErrorCode" | "cooldownReason"> {
    const status =
      error instanceof XTrawlError && typeof error.diagnostics.statusCode === "number"
        ? error.diagnostics.statusCode
        : error instanceof AccountSessionBuildError
          ? error.statusCode
          : 599;
    const category =
      error instanceof AuthError
        ? "auth"
        : error instanceof RateLimitError
          ? "rate_limit"
          : error instanceof ProxyError
            ? "proxy"
            : error instanceof NetworkError
              ? "network"
              : error instanceof AccountSessionBuildError
                ? error.category
                : "transient";
    const decision = computeCooldown(category, status, Date.now(), {
      defaultMs: this.config.cooldownDefaultMs,
      transientMs: this.config.transientCooldownMs,
      authMs: this.config.authCooldownMs,
      ...(error instanceof XTrawlError && typeof error.diagnostics.resetAt === "number"
        ? { resetAt: error.diagnostics.resetAt }
        : {}),
      jitterMs: this.config.cooldownJitterMs,
    });
    return {
      status: decision.status,
      availableUntil: decision.availableUntil,
      ...(decision.lastErrorCode === undefined ? {} : { lastErrorCode: decision.lastErrorCode }),
      ...(decision.reason === undefined ? {} : { cooldownReason: decision.reason }),
    };
  }

  private async completeLease(
    account: AccountLease,
    completion: Omit<AccountLeaseCompletion, "leaseId" | "now" | "utcDate">,
  ): Promise<void> {
    const now = Date.now();
    const completed = await this.repository.completeLease({
      ...completion,
      leaseId: account.leaseId,
      now,
      utcDate: utcDate(now),
    });
    if (!completed)
      throw new AccountStateError("The account lease could not be completed.", {
        account: account.username,
      });
    await this.refreshSummary().catch(() => undefined);
  }

  private startHeartbeat(
    account: AccountLease,
    onLost: () => void,
  ): ReturnType<typeof setInterval> | undefined {
    if (this.config.leaseHeartbeatMs <= 0) return undefined;
    let pending = false;
    const timer = setInterval(() => {
      if (pending) return;
      pending = true;
      void Promise.resolve(this.repository.renewLease(account.leaseId, Date.now() + this.config.leaseTtlMs))
        .then((renewed) => {
          if (!renewed) onLost();
        })
        .catch(() => {
          onLost();
        })
        .finally(() => {
          pending = false;
        });
    }, this.config.leaseHeartbeatMs);
    timer.unref();
    return timer;
  }

  private limiterFor(account: AccountLease): TokenBucketLimiter {
    const key = String(account.id ?? account.username);
    const current = this.limiters.get(key);
    if (current) return current;
    const limiter = new TokenBucketLimiter(this.config.requestsPerMinute, this.config.minDelayMs);
    this.limiters.set(key, limiter);
    return limiter;
  }

  private async refreshSummary(): Promise<void> {
    const accounts = await this.repository.list();
    this.updateAccounts(accounts);
    this.onAccountsChanged?.(accounts);
  }
}

export function summarizeAccounts(
  accounts: readonly AccountRecord[],
  config: Pick<ClientConfig, "dailyRequestsLimit" | "dailyTweetsLimit">,
  location: string,
  now = Date.now(),
): AccountSummary {
  return {
    dbPath: location,
    total: accounts.length,
    eligible: accounts.filter(
      (account) =>
        account.status !== ACCOUNT_STATUS_CODE.UNUSABLE &&
        !(account.status === ACCOUNT_STATUS_CODE.COOLING_DOWN && (account.availableUntil ?? 0) > now) &&
        Boolean(account.authToken && account.csrfToken) &&
        (account.dailyRequests ?? 0) < config.dailyRequestsLimit &&
        (account.dailyTweets ?? 0) < config.dailyTweetsLimit,
    ).length,
    unusable: accounts.filter((account) => account.status === ACCOUNT_STATUS_CODE.UNUSABLE).length,
    coolingDown: accounts.filter(
      (account) => account.status === ACCOUNT_STATUS_CODE.COOLING_DOWN && (account.availableUntil ?? 0) > now,
    ).length,
  };
}

function utcDate(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function countTweets(value: unknown): number {
  if (Array.isArray(value)) return value.filter((item) => isRecord(item) && "tweetId" in item).length;
  if (!isRecord(value)) return 0;
  if (Array.isArray(value.tweets)) return value.tweets.length;
  if (isRecord(value.result) && Array.isArray(value.result.tweets)) return value.result.tweets.length;
  return 0;
}

function readQuota(
  value: unknown,
): { readonly remaining?: number; readonly resetAt?: number; readonly exhausted?: boolean } | undefined {
  if (!isRecord(value) || !isRecord(value.quota)) return undefined;
  const remaining = typeof value.quota.remaining === "number" ? value.quota.remaining : undefined;
  const resetAt = typeof value.quota.resetAt === "number" ? value.quota.resetAt : undefined;
  const exhausted = value.quota.exhausted === true;
  return {
    ...(remaining === undefined ? {} : { remaining }),
    ...(resetAt === undefined ? {} : { resetAt }),
    ...(exhausted ? { exhausted: true } : {}),
  };
}

function isRetryable(error: unknown): boolean {
  if (isAbortError(error)) return false;
  if (error instanceof NetworkError && error.diagnostics.statusCode === 499) return false;
  if (error instanceof AuthError || error instanceof RateLimitError || error instanceof NetworkError)
    return true;
  if (error instanceof ProxyError || error instanceof AccountSessionBuildError) return true;
  return !(error instanceof XTrawlError);
}
