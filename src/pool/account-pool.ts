import type { AccountLease } from "../domain/accounts.js";
import {
  AccountPoolExhausted,
  AccountSessionBuildError,
  AuthError,
  XTrawlError,
  NetworkError,
  RateLimitError,
  ProxyError,
} from "../domain/errors.js";
import type { ClientConfig } from "../config/types.js";
import type { HttpSession } from "../domain/http.js";
import type { AccountRepository } from "../storage/account-repository.js";
import { computeCooldown } from "./cooldown.js";
import type { SessionBuilder } from "../transport/session.js";
import { isRecord } from "../utils/guards.js";
import { TokenBucketLimiter, sleep } from "./limiter.js";

export interface PoolExecutionContext {
  readonly account: AccountLease;
  readonly session: HttpSession;
}

export interface PoolExecutionOptions<T> {
  readonly countTweets?: (value: T) => number;
  readonly onRetry?: (error: unknown, attempt: number) => void;
  readonly maxAccountSwitches?: number;
}

export type AccountRepair = (account: AccountLease) => Promise<boolean>;

export class AccountPool {
  private readonly limiters = new Map<string, TokenBucketLimiter>();

  public constructor(
    private readonly repository: AccountRepository,
    private readonly sessions: SessionBuilder,
    private readonly config: ClientConfig,
    private readonly repairAccount?: AccountRepair,
  ) {}

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
      const account = this.repository.lease({ requireAuthMaterial: true });
      if (!account) {
        if (lastError) throw lastError;
        throw new AccountPoolExhausted(`No eligible account for ${label}.`);
      }
      const accountKey = String(account.id ?? account.username);
      seenAccounts.add(accountKey);
      const switchLimit = options.maxAccountSwitches ?? this.config.maxAccountSwitches;
      if (seenAccounts.size > switchLimit + 1) {
        this.repository.release(account.leaseId, { status: "healthy" });
        if (lastError) throw lastError;
        throw new AccountPoolExhausted(`Account-switch limit reached for ${label}.`);
      }
      let session: HttpSession | undefined;
      let operationStarted = false;
      const heartbeat = this.startHeartbeat(account);
      try {
        if (this.config.proxyCheckOnLease)
          await this.sessions.assertProxyHealthy(account, {
            url: this.config.proxyCheckUrl,
            timeoutMs: this.config.proxyCheckTimeoutMs,
          });
        session = this.sessions.forAccount(account);
        await this.limiterFor(account).acquire();
        operationStarted = true;
        const value = await operation({ account, session });
        this.repository.recordUsage(
          account.leaseId,
          1,
          Math.max(0, options.countTweets?.(value) ?? countTweets(value)),
        );
        this.repository.release(account.leaseId, { status: "healthy" });
        return value;
      } catch (error) {
        lastError = error;
        if (operationStarted) this.repository.recordUsage(account.leaseId, 1, 0);
        this.releaseFailure(account, error);
        if (error instanceof AuthError && this.repairAccount && repairs < this.config.maxFallbackAttempts) {
          repairs += 1;
          await this.repairAccount(account).catch(() => false);
        }
        if (attempt >= maxAttempts || !isRetryable(error)) throw error;
        options.onRetry?.(error, attempt);
        await sleep(Math.min(this.config.retryMaxMs, this.config.retryBaseMs * 2 ** (attempt - 1)));
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
    return this.repository.summary();
  }

  private releaseFailure(account: AccountLease, error: unknown): void {
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
    this.repository.release(account.leaseId, decision);
  }

  private startHeartbeat(account: AccountLease): ReturnType<typeof setInterval> | undefined {
    if (this.config.leaseHeartbeatMs <= 0) return undefined;
    const timer = setInterval(
      () => this.repository.heartbeat(account.leaseId, this.config.leaseTtlMs),
      this.config.leaseHeartbeatMs,
    );
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
}

function countTweets(value: unknown): number {
  if (Array.isArray(value)) return value.filter((item) => isRecord(item) && "tweetId" in item).length;
  if (!isRecord(value)) return 0;
  if (Array.isArray(value.tweets)) return value.tweets.length;
  if (isRecord(value.result) && Array.isArray(value.result.tweets)) return value.result.tweets.length;
  return 0;
}

function isRetryable(error: unknown): boolean {
  if (error instanceof AuthError || error instanceof RateLimitError || error instanceof NetworkError)
    return true;
  if (error instanceof ProxyError || error instanceof AccountSessionBuildError) return true;
  return !(error instanceof XTrawlError);
}
