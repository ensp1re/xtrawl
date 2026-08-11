import { randomUUID } from "node:crypto";
import type { AccountLease, AccountRecord, AccountSummary, CookieMap } from "../domain/accounts.js";
import type { AccountStatus } from "../domain/accounts.js";
import { StateDatabase } from "./database.js";
import { rowToAccount } from "./account-row.js";

export { rowToAccount } from "./account-row.js";

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

const DEFAULT_DAILY_REQUESTS_LIMIT = 30;
const DEFAULT_DAILY_TWEETS_LIMIT = 600;
const DEFAULT_LEASE_TTL_MS = 120_000;

export class AccountRepository {
  private readonly dailyRequestsLimit: number;
  private readonly dailyTweetsLimit: number;
  private readonly leaseTtlMs: number;

  public constructor(
    private readonly database: StateDatabase,
    options: AccountRepositoryOptions = {},
  ) {
    this.dailyRequestsLimit = options.dailyRequestsLimit ?? DEFAULT_DAILY_REQUESTS_LIMIT;
    this.dailyTweetsLimit = options.dailyTweetsLimit ?? DEFAULT_DAILY_TWEETS_LIMIT;
    this.leaseTtlMs = options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
  }

  public upsert(account: AccountRecord): AccountRecord {
    const existing =
      this.findByUsername(account.username) ??
      (account.authToken ? this.findByAuthToken(account.authToken) : undefined);
    if (!existing) {
      this.database.run(
        `INSERT INTO accounts (username,password,email,email_password,two_factor_secret,auth_token,csrf_token,cookies_json,bearer_token,proxy_json,status,available_until,daily_requests,daily_tweets,total_tweets,last_reset_date)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        account.username,
        account.password ?? null,
        account.email ?? null,
        account.emailPassword ?? null,
        account.twoFactorSecret ?? null,
        account.authToken ?? null,
        account.csrfToken ?? null,
        JSON.stringify(account.cookies),
        account.bearerToken ?? null,
        account.proxy ? JSON.stringify(account.proxy) : null,
        account.status ?? 1,
        account.availableUntil ?? 0,
        account.dailyRequests ?? 0,
        account.dailyTweets ?? 0,
        account.totalTweets ?? 0,
        account.lastResetDate ?? utcDate(),
      );
      return this.findByUsername(account.username) as AccountRecord;
    }

    const username =
      existing.username.startsWith("auth_") && account.username !== existing.username
        ? account.username
        : existing.username;
    const cookies: CookieMap = { ...existing.cookies, ...account.cookies };
    this.database.run(
      `UPDATE accounts SET username=?, password=?, email=?, email_password=?, two_factor_secret=?, auth_token=?, csrf_token=?, cookies_json=?, bearer_token=?, proxy_json=?, status=?, available_until=?, daily_requests=?, daily_tweets=?, total_tweets=?, last_reset_date=? WHERE id=?`,
      username,
      account.password ?? existing.password ?? null,
      account.email ?? existing.email ?? null,
      account.emailPassword ?? existing.emailPassword ?? null,
      account.twoFactorSecret ?? existing.twoFactorSecret ?? null,
      account.authToken ?? existing.authToken ?? null,
      account.csrfToken ?? existing.csrfToken ?? null,
      JSON.stringify(cookies),
      account.bearerToken ?? existing.bearerToken ?? null,
      account.proxy ? JSON.stringify(account.proxy) : existing.proxy ? JSON.stringify(existing.proxy) : null,
      account.status ?? existing.status ?? 1,
      account.availableUntil ?? existing.availableUntil ?? 0,
      account.dailyRequests ?? existing.dailyRequests ?? 0,
      account.dailyTweets ?? existing.dailyTweets ?? 0,
      account.totalTweets ?? existing.totalTweets ?? 0,
      account.lastResetDate ?? existing.lastResetDate ?? utcDate(),
      existing.id ?? null,
    );
    return this.findByUsername(username) as AccountRecord;
  }

  public findByUsername(username: string): AccountRecord | undefined {
    const row = this.database.get("SELECT * FROM accounts WHERE username=?", username);
    return row ? rowToAccount(row) : undefined;
  }

  public findByAuthToken(authToken: string): AccountRecord | undefined {
    const row = this.database.get("SELECT * FROM accounts WHERE auth_token=? ORDER BY id LIMIT 1", authToken);
    return row ? rowToAccount(row) : undefined;
  }

  public list(): AccountRecord[] {
    return this.database.all("SELECT * FROM accounts ORDER BY id").map(rowToAccount);
  }

  public summary(): AccountSummary {
    const now = Date.now();
    const rows = this.list();
    return {
      dbPath: this.database.path,
      total: rows.length,
      eligible: rows.filter((row) => this.isEligible(row, now, true)).length,
      unusable: rows.filter((row) => row.status === 0).length,
      coolingDown: rows.filter((row) => row.status === 2 && (row.availableUntil ?? 0) > now).length,
    };
  }

  public lease(
    options: { readonly requireAuthMaterial?: boolean; readonly now?: number } = {},
  ): AccountLease | undefined {
    const now = options.now ?? Date.now();
    this.resetExpiredCooldowns(now);
    this.resetDailyCounters();
    const candidates = this.list().filter((row) =>
      this.isEligible(row, now, false, options.requireAuthMaterial ?? true),
    );
    const selected = candidates.sort((a, b) => (a.lastUsed ?? 0) - (b.lastUsed ?? 0))[0];
    if (!selected?.id) return undefined;
    const leaseId = randomUUID();
    const expiresAt = now + this.leaseTtlMs;
    const changed = this.database.run(
      "UPDATE accounts SET lease_id=?, lease_expires_at=?, last_used=? WHERE id=? AND (lease_id IS NULL OR lease_expires_at<?)",
      leaseId,
      expiresAt,
      now,
      selected.id,
      now,
    ).changes;
    if (changed !== 1) return undefined;
    const current = this.findByUsername(selected.username);
    return current ? { ...current, leaseId, leaseExpiresAt: expiresAt } : undefined;
  }

  public heartbeat(leaseId: string, extendByMs: number): boolean {
    return (
      this.database.run(
        "UPDATE accounts SET lease_expires_at=? WHERE lease_id=?",
        Date.now() + extendByMs,
        leaseId,
      ).changes === 1
    );
  }

  public recordUsage(leaseId: string, pages = 1, tweets = 0): boolean {
    this.resetDailyCounters();
    return (
      this.database.run(
        "UPDATE accounts SET daily_requests=daily_requests+?, daily_tweets=daily_tweets+?, total_tweets=total_tweets+?, last_used=? WHERE lease_id=?",
        pages,
        tweets,
        tweets,
        Date.now(),
        leaseId,
      ).changes === 1
    );
  }

  public release(leaseId: string, options: ReleaseOptions = {}): boolean {
    const status = options.status === "unusable" ? 0 : options.status === "cooling_down" ? 2 : 1;
    const availableUntil = options.availableUntil ?? (status === 1 ? 0 : Date.now());
    return (
      this.database.run(
        "UPDATE accounts SET lease_id=NULL, lease_expires_at=NULL, status=?, available_until=?, last_error_code=?, cooldown_reason=? WHERE lease_id=?",
        status,
        availableUntil,
        options.lastErrorCode ?? null,
        options.cooldownReason ?? null,
        leaseId,
      ).changes === 1
    );
  }

  public markUnusable(username: string, code: number, reason: string): boolean {
    return (
      this.database.run(
        "UPDATE accounts SET status=0, last_error_code=?, cooldown_reason=?, lease_id=NULL, lease_expires_at=NULL WHERE username=?",
        code,
        reason,
        username,
      ).changes === 1
    );
  }

  public resetCooldowns(usernames?: readonly string[], includeUnusable = false): number {
    if (!usernames || usernames.length === 0) {
      return this.database.run(
        includeUnusable
          ? "UPDATE accounts SET status=1, available_until=0, cooldown_reason=NULL"
          : "UPDATE accounts SET status=1, available_until=0, cooldown_reason=NULL WHERE status=2",
      ).changes;
    }
    let changed = 0;
    for (const username of usernames) {
      changed += this.database.run(
        includeUnusable
          ? "UPDATE accounts SET status=1, available_until=0, cooldown_reason=NULL WHERE username=?"
          : "UPDATE accounts SET status=1, available_until=0, cooldown_reason=NULL WHERE username=? AND status=2",
        username,
      ).changes;
    }
    return changed;
  }

  public collapseDuplicatesByAuthToken(): { readonly removed: number; readonly merged: number } {
    const rows = this.list().filter((row) => Boolean(row.authToken));
    const seen = new Map<string, AccountRecord>();
    let removed = 0;
    let merged = 0;
    for (const row of rows) {
      const token = row.authToken as string;
      const first = seen.get(token);
      if (!first) {
        seen.set(token, row);
        continue;
      }
      this.upsert({
        ...first,
        ...row,
        username: first.username.startsWith("auth_") ? row.username : first.username,
        cookies: { ...first.cookies, ...row.cookies },
      });
      this.database.run("DELETE FROM accounts WHERE id=?", row.id ?? null);
      removed += 1;
      merged += 1;
    }
    return { removed, merged };
  }

  private resetExpiredCooldowns(now: number): void {
    this.database.run(
      "UPDATE accounts SET status=1, available_until=0, cooldown_reason=NULL WHERE status=2 AND available_until<=?",
      now,
    );
  }

  private resetDailyCounters(): void {
    const today = utcDate();
    this.database.run(
      "UPDATE accounts SET daily_requests=0, daily_tweets=0, last_reset_date=? WHERE last_reset_date IS NULL OR last_reset_date<>?",
      today,
      today,
    );
  }

  private isEligible(
    row: AccountRecord,
    now: number,
    ignoreLease: boolean,
    requireAuthMaterial = false,
  ): boolean {
    if (row.status === 0) return false;
    if (row.status === 2 && (row.availableUntil ?? 0) > now) return false;
    if (!ignoreLease && row.leaseExpiresAt !== undefined && row.leaseExpiresAt > now) return false;
    if (requireAuthMaterial && (!row.authToken || !row.csrfToken)) return false;
    return (
      (row.dailyRequests ?? 0) < this.dailyRequestsLimit && (row.dailyTweets ?? 0) < this.dailyTweetsLimit
    );
  }
}

function utcDate(): string {
  return new Date().toISOString().slice(0, 10);
}
