import { bootstrapCookiesFromAuthToken } from "../auth/bootstrap.js";
import { parseAccountStateSnapshot } from "../auth/account-state.js";
import { loadAccountsFileSync, loadInlineAccounts } from "../auth/loaders.js";
import { accountInputToRecord } from "../auth/records.js";
import { loadAccountFromEnvironmentSync } from "../config/environment.js";
import type { ClientConfig } from "../config/types.js";
import type {
  AccountStateExportOptions,
  AccountStateRestoreOptions,
  AccountStateSnapshot,
  AccountStateSnapshotRecord,
  AccountStateStore,
} from "../domain/account-state.js";
import { ACCOUNT_STATUS_CODE } from "../constants/accounts.js";
import type { AccountRecord, AccountSummary, ProxySettings } from "../domain/accounts.js";
import { AccountStateError } from "../domain/errors.js";
import { summarizeAccounts } from "../pool/account-pool.js";
import { redactAccount, type AccountImportOptions, type AccountListOptions } from "./database.js";

export class XTrawlAccounts {
  private cachedAccounts: readonly AccountRecord[] = [];

  public constructor(
    private readonly store: AccountStateStore,
    private readonly config: ClientConfig,
    private readonly location: string,
    private readonly onAccountsChanged?: (accounts: readonly AccountRecord[]) => void,
  ) {}

  public async refresh(): Promise<void> {
    this.cachedAccounts = await this.store.list();
    this.onAccountsChanged?.(this.cachedAccounts);
  }

  public initialize(accounts: readonly AccountRecord[]): void {
    this.cachedAccounts = accounts;
  }

  public inspectCached(): readonly Record<string, unknown>[] {
    return this.cachedAccounts.map((account) => redactAccount(account, {}));
  }

  public async summary(): Promise<AccountSummary> {
    await this.refresh();
    return summarizeAccounts(this.cachedAccounts, this.config, this.location);
  }

  public async list(options: AccountListOptions = {}): Promise<readonly Record<string, unknown>[]> {
    await this.refresh();
    const now = Date.now();
    return this.cachedAccounts
      .filter((account) => !options.eligibleOnly || isEligible(account, this.config, now))
      .filter((account) => !options.unusableOnly || account.status === ACCOUNT_STATUS_CODE.UNUSABLE)
      .map((account) => redactAccount(account, options));
  }

  public async get(
    username: string,
    options: Pick<AccountListOptions, "includeCookies" | "revealSecrets"> = {},
  ): Promise<Record<string, unknown> | undefined> {
    const account = await this.store.findByUsername(username);
    return account ? redactAccount(account, options) : undefined;
  }

  public async import(options: AccountImportOptions): Promise<{
    readonly processed: number;
    readonly eligible: number;
  }> {
    const accounts = loadImportAccounts(options);
    for (const account of accounts)
      await this.store.upsert({ ...account, proxy: account.proxy ?? options.proxy });
    return { processed: accounts.length, eligible: (await this.summary()).eligible };
  }

  public async delete(username: string): Promise<boolean> {
    const deleted = await this.store.delete(username);
    await this.refresh();
    return deleted;
  }

  public async setProxy(username: string, proxy: string | ProxySettings): Promise<boolean> {
    const account = await this.store.findByUsername(username);
    if (!account) return false;
    await this.store.upsert({ ...account, proxy });
    await this.refresh();
    return true;
  }

  public async repair(username: string, forceRefresh = false): Promise<boolean> {
    const account = await this.store.findByUsername(username);
    if (!account?.authToken) return false;
    if (!forceRefresh && account.csrfToken) {
      await this.store.upsert({
        ...account,
        status: ACCOUNT_STATUS_CODE.HEALTHY,
        availableUntil: 0,
      });
      await this.refresh();
      return true;
    }
    const cookies = await bootstrapCookiesFromAuthToken(account.authToken, undefined, account.proxy);
    if (!cookies?.ct0) return false;
    await this.store.upsert({
      ...account,
      status: ACCOUNT_STATUS_CODE.HEALTHY,
      availableUntil: 0,
      csrfToken: cookies.ct0,
      cookies: { ...account.cookies, ...cookies },
    });
    await this.refresh();
    return true;
  }

  public async exportState(options: AccountStateExportOptions): Promise<AccountStateSnapshot> {
    if (!options || options.includeSecrets !== true)
      throw new AccountStateError("exportState requires includeSecrets: true.");
    const accounts = await this.store.list();
    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      accounts: accounts.map(toSnapshotRecord),
    };
  }

  public async restoreState(
    state: unknown,
    options: AccountStateRestoreOptions = {},
  ): Promise<{ readonly restored: number; readonly mode: "merge" | "replace" }> {
    const snapshot = parseAccountStateSnapshot(state);
    const accounts = snapshot.accounts.map(fromSnapshotRecord);
    const mode = options.mode ?? "merge";
    if (mode !== "merge" && mode !== "replace")
      throw new AccountStateError("restoreState mode must be merge or replace.");
    if (mode === "replace") await this.store.replaceAll(accounts);
    else for (const account of accounts) await this.store.upsert(account);
    await this.refresh();
    return { restored: accounts.length, mode };
  }
}

function loadImportAccounts(options: AccountImportOptions): AccountRecord[] {
  const accounts: AccountRecord[] = [];
  if (options.accounts) accounts.push(...options.accounts.map(accountInputToRecord));
  if (options.cookies !== undefined) accounts.push(...loadInlineAccounts(options.cookies));
  if (options.accountsFile) accounts.push(...loadAccountsFileSync(options.accountsFile));
  if (options.cookiesFile) accounts.push(...loadAccountsFileSync(options.cookiesFile));
  if (options.envFile)
    accounts.push(...loadAccountFromEnvironmentSync(options.envFile).map(accountInputToRecord));
  return accounts;
}

function toSnapshotRecord(account: AccountRecord): AccountStateSnapshotRecord {
  return {
    username: account.username,
    ...(account.authToken ? { authToken: account.authToken } : {}),
    ...(account.csrfToken ? { csrfToken: account.csrfToken } : {}),
    cookies: account.cookies,
    ...(account.bearerToken ? { bearerToken: account.bearerToken } : {}),
    ...(account.proxy ? { proxy: account.proxy } : {}),
    ...(account.status === ACCOUNT_STATUS_CODE.UNUSABLE ||
    account.status === ACCOUNT_STATUS_CODE.HEALTHY ||
    account.status === ACCOUNT_STATUS_CODE.COOLING_DOWN
      ? { status: account.status }
      : {}),
    ...copyOperationalState(account),
  };
}

function fromSnapshotRecord(account: AccountStateSnapshotRecord): AccountRecord {
  return { ...account, cookies: account.cookies };
}

function copyOperationalState(
  account: AccountRecord,
): Omit<
  AccountStateSnapshotRecord,
  "username" | "authToken" | "csrfToken" | "cookies" | "bearerToken" | "proxy" | "status"
> {
  return {
    ...(account.availableUntil === undefined ? {} : { availableUntil: account.availableUntil }),
    ...(account.dailyRequests === undefined ? {} : { dailyRequests: account.dailyRequests }),
    ...(account.dailyTweets === undefined ? {} : { dailyTweets: account.dailyTweets }),
    ...(account.totalTweets === undefined ? {} : { totalTweets: account.totalTweets }),
    ...(account.lastResetDate === undefined ? {} : { lastResetDate: account.lastResetDate }),
    ...(account.lastUsed === undefined ? {} : { lastUsed: account.lastUsed }),
    ...(account.lastErrorCode === undefined ? {} : { lastErrorCode: account.lastErrorCode }),
    ...(account.cooldownReason === undefined ? {} : { cooldownReason: account.cooldownReason }),
  };
}

function isEligible(account: AccountRecord, config: ClientConfig, now: number): boolean {
  return (
    account.status !== ACCOUNT_STATUS_CODE.UNUSABLE &&
    !(account.status === ACCOUNT_STATUS_CODE.COOLING_DOWN && (account.availableUntil ?? 0) > now) &&
    Boolean(account.authToken && account.csrfToken) &&
    (account.dailyRequests ?? 0) < config.dailyRequestsLimit &&
    (account.dailyTweets ?? 0) < config.dailyTweetsLimit
  );
}
