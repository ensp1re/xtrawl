import type { AccountStatus } from "../domain/accounts.js";

export type SqlRow = Record<string, unknown>;

export interface ReleaseOptions {
  readonly status?: AccountStatus;
  readonly availableUntil?: number;
  readonly lastErrorCode?: number;
  readonly cooldownReason?: string;
  readonly dailyRequests?: number;
}

export interface AccountRepositoryOptions {
  readonly dailyRequestsLimit?: number;
  readonly dailyTweetsLimit?: number;
  readonly leaseTtlMs?: number;
}
