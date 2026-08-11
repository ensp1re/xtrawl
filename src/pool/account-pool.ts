import type { AccountLease } from "../domain/accounts.js";
import {
  AccountPoolExhausted,
  AccountSessionBuildError,
  AuthError,
  GraphHarvesterError,
  NetworkError,
  RateLimitError,
} from "../domain/errors.js";
import type { ClientConfig } from "../config/types.js";
import type { HttpSession } from "../domain/http.js";
import type { AccountRepository } from "../storage/account-repository.js";
import { computeCooldown } from "./cooldown.js";
import type { SessionBuilder } from "../transport/session.js";
import { isRecord } from "../utils/guards.js";

export interface PoolExecutionContext {
  readonly account: AccountLease;
  readonly session: HttpSession;
}

export class AccountPool {
  public constructor(
    private readonly repository: AccountRepository,
    private readonly sessions: SessionBuilder,
    private readonly config: ClientConfig,
  ) {}

  public async execute<T>(
    label: string,
    operation: (context: PoolExecutionContext) => Promise<T>,
  ): Promise<T> {
    const account = this.repository.lease({ requireAuthMaterial: true });
    if (!account) throw new AccountPoolExhausted(`No eligible account for ${label}.`);
    let session: HttpSession | undefined;
    try {
      session = this.sessions.forAccount(account);
      const value = await operation({ account, session });
      this.repository.recordUsage(account.leaseId, 1, countTweets(value));
      this.repository.release(account.leaseId, { status: "healthy" });
      return value;
    } catch (error) {
      this.releaseFailure(account, error);
      throw error;
    } finally {
      await session?.close();
    }
  }

  public get summary() {
    return this.repository.summary();
  }

  private releaseFailure(account: AccountLease, error: unknown): void {
    const status =
      error instanceof GraphHarvesterError && typeof error.diagnostics.statusCode === "number"
        ? error.diagnostics.statusCode
        : error instanceof AccountSessionBuildError
          ? error.statusCode
          : 599;
    const category =
      error instanceof AuthError
        ? "auth"
        : error instanceof RateLimitError
          ? "rate_limit"
          : error instanceof NetworkError
            ? "network"
            : error instanceof AccountSessionBuildError
              ? error.category
              : "transient";
    const decision = computeCooldown(category, status, Date.now(), {
      defaultMs: this.config.cooldownDefaultMs,
      transientMs: this.config.transientCooldownMs,
      authMs: this.config.authCooldownMs,
      jitterMs: this.config.cooldownJitterMs,
    });
    this.repository.release(account.leaseId, decision);
  }
}

function countTweets(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (!isRecord(value)) return 0;
  if (Array.isArray(value.tweets)) return value.tweets.length;
  if (isRecord(value.result) && Array.isArray(value.result.tweets)) return value.result.tweets.length;
  return 0;
}
