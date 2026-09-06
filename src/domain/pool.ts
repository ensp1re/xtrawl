import type { AccountLease, AccountStatus } from "./accounts.js";
import type { HttpSession } from "./http.js";

export interface PoolExecutionContext {
  readonly account: AccountLease;
  readonly session: HttpSession;
  readonly signal?: AbortSignal;
  chargeRequest(): void;
}

export interface PoolExecutionOptions<T> {
  readonly countTweets?: (value: T) => number;
  readonly onRetry?: (error: unknown, attempt: number) => void;
  readonly maxAccountSwitches?: number;
  readonly signal?: AbortSignal;
}

export type AccountRepair = (account: AccountLease) => Promise<boolean>;

export interface CooldownDecision {
  readonly status: AccountStatus;
  readonly availableUntil: number;
  readonly lastErrorCode?: number;
  readonly reason?: string;
}
