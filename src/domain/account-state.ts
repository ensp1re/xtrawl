import type { AccountLease, AccountRecord, AccountStatus } from "./accounts.js";

export type Awaitable<T> = T | Promise<T>;

export interface AccountLeaseRequest {
  readonly now: number;
  readonly leaseId: string;
  readonly leaseExpiresAt: number;
  readonly utcDate: string;
  readonly requireAuthMaterial: boolean;
  readonly dailyRequestsLimit: number;
  readonly dailyTweetsLimit: number;
}

export interface AccountLeaseCompletion {
  readonly leaseId: string;
  readonly now: number;
  readonly utcDate: string;
  readonly pages: number;
  readonly tweets: number;
  readonly status: AccountStatus;
  readonly availableUntil: number;
  readonly lastErrorCode?: number;
  readonly cooldownReason?: string;
}

/**
 * Caller-implementable persistence contract for account credentials and operational state.
 * Lease acquisition and completion must be atomic in the backing store.
 */
export interface AccountStateStore {
  readonly kind?: string;
  list(): Awaitable<readonly AccountRecord[]>;
  findByUsername(username: string): Awaitable<AccountRecord | undefined>;
  /** Merge supplied fields and cookie keys into an existing username; preserve omitted fields. */
  upsert(account: AccountRecord): Awaitable<AccountRecord>;
  delete(username: string): Awaitable<boolean>;
  /** Atomically replace the complete account set with exactly these records. */
  replaceAll(accounts: readonly AccountRecord[]): Awaitable<void>;
  acquireLease(request: AccountLeaseRequest): Awaitable<AccountLease | undefined>;
  renewLease(leaseId: string, leaseExpiresAt: number): Awaitable<boolean>;
  completeLease(completion: AccountLeaseCompletion): Awaitable<boolean>;
}

export interface AccountStateSnapshotRecord {
  readonly username: string;
  readonly authToken?: string;
  readonly csrfToken?: string;
  readonly cookies: Readonly<Record<string, string>>;
  readonly bearerToken?: string;
  readonly proxy?: AccountRecord["proxy"];
  readonly status?: 0 | 1 | 2;
  readonly availableUntil?: number;
  readonly dailyRequests?: number;
  readonly dailyTweets?: number;
  readonly totalTweets?: number;
  readonly lastResetDate?: string;
  readonly lastUsed?: number;
  readonly lastErrorCode?: number;
  readonly cooldownReason?: string;
}

export interface AccountStateSnapshot {
  readonly schemaVersion: 1;
  readonly exportedAt: string;
  readonly accounts: readonly AccountStateSnapshotRecord[];
}

export interface AccountStateExportOptions {
  readonly includeSecrets: true;
}

export interface AccountStateRestoreOptions {
  readonly mode?: "merge" | "replace";
}
