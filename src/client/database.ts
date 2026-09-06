import { bootstrapCookiesFromAuthToken } from "../auth/bootstrap.js";
import { loadAccountsFileSync, loadInlineAccounts } from "../auth/loaders.js";
import { accountInputToRecord } from "../auth/records.js";
import { loadAccountFromEnvironmentSync } from "../config/environment.js";
import type { AccountInput, AccountRecord, ProxySettings } from "../domain/accounts.js";
import type { StorageBundle } from "../storage/index.js";
import { tokenFingerprint } from "../utils/fingerprint.js";
import { redactProxy } from "../utils/redact.js";

export interface AccountListOptions {
  readonly eligibleOnly?: boolean;
  readonly unusableOnly?: boolean;
  readonly includeCookies?: boolean;
  readonly revealSecrets?: boolean;
}

export interface AccountImportOptions {
  readonly accountsFile?: string;
  readonly cookiesFile?: string;
  readonly envFile?: string;
  readonly cookies?: unknown;
  readonly accounts?: readonly AccountInput[];
  readonly proxy?: string | ProxySettings;
}

export class XTrawlDatabase {
  public constructor(private readonly storage: StorageBundle) {}

  public accountsSummary() {
    return this.storage.accounts.summary();
  }

  public listAccounts(options: AccountListOptions = {}): readonly Record<string, unknown>[] {
    return this.storage.accounts
      .list()
      .filter((account) => !options.eligibleOnly || this.storage.accounts.eligible(account))
      .filter((account) => !options.unusableOnly || account.status === 0)
      .map((account) => redactAccount(account, options));
  }

  public getAccount(
    username: string,
    options: Pick<AccountListOptions, "includeCookies" | "revealSecrets"> = {},
  ): Record<string, unknown> | undefined {
    const account = this.storage.accounts.findByUsername(username);
    return account ? redactAccount(account, options) : undefined;
  }

  public deleteAccount(username: string): boolean {
    return this.storage.accounts.delete(username);
  }

  public setAccountProxy(username: string, proxy?: string | ProxySettings): boolean {
    return this.storage.accounts.setProxy(username, proxy);
  }

  public markAccountUnusable(username: string, reason = "manual"): boolean {
    return this.storage.accounts.markUnusable(username, 401, `unusable:${reason}`);
  }

  public async repairAccount(username: string, forceRefresh = false): Promise<boolean> {
    const account = this.storage.accounts.findByUsername(username);
    if (!account?.authToken) return false;
    if (!forceRefresh && account.csrfToken) {
      this.storage.accounts.resetCooldowns([username], true);
      return true;
    }
    const cookies = await bootstrapCookiesFromAuthToken(account.authToken, undefined, account.proxy);
    if (!cookies?.ct0) return false;
    this.storage.accounts.upsert({
      ...account,
      status: 1,
      availableUntil: 0,
      csrfToken: cookies.ct0,
      cookies: { ...account.cookies, ...cookies },
    });
    return true;
  }

  public resetAccountCooldowns(usernames?: readonly string[], includeUnusable = false): number {
    return this.storage.accounts.resetCooldowns(usernames, includeUnusable);
  }

  public clearLeases(expiredOnly = true): number {
    return this.storage.accounts.clearLeases(expiredOnly);
  }

  public resetDailyCounters(usernames?: readonly string[]): number {
    return this.storage.accounts.resetDailyUsage(usernames);
  }

  public importAccounts(options: AccountImportOptions): {
    readonly processed: number;
    readonly eligible: number;
  } {
    const accounts: AccountRecord[] = [];
    if (options.accounts) accounts.push(...options.accounts.map(accountInputToRecord));
    if (options.cookies !== undefined) accounts.push(...loadInlineAccounts(options.cookies));
    if (options.accountsFile) accounts.push(...loadAccountsFileSync(options.accountsFile));
    if (options.cookiesFile) accounts.push(...loadAccountsFileSync(options.cookiesFile));
    if (options.envFile)
      accounts.push(...loadAccountFromEnvironmentSync(options.envFile).map(accountInputToRecord));
    for (const account of accounts)
      this.storage.accounts.upsert({ ...account, proxy: account.proxy ?? options.proxy });
    return { processed: accounts.length, eligible: this.storage.accounts.summary().eligible };
  }

  public collapseDuplicateAccounts(dryRun = true) {
    if (!dryRun) return { dryRun, ...this.storage.accounts.collapseDuplicatesByAuthToken() };
    const tokens = this.storage.accounts
      .list()
      .flatMap((account) => (account.authToken ? [account.authToken] : []));
    const duplicates = tokens.length - new Set(tokens).size;
    return { dryRun, removed: 0, merged: 0, wouldRemove: duplicates };
  }

  public getCheckpoint(queryHash: string) {
    return this.storage.checkpoints.get(queryHash);
  }

  public clearCheckpoint(queryHash: string): boolean {
    return this.storage.checkpoints.clear(queryHash);
  }

  public clearAllCheckpoints(): number {
    return this.storage.checkpoints.clearAll();
  }

  public listRuns(limit = 50) {
    return this.storage.runs.list(limit);
  }

  public lastRun() {
    return this.storage.runs.last();
  }

  public runsSummary(limit = 500) {
    return this.storage.runs.summary(limit);
  }
}

export function redactAccount(
  account: AccountRecord,
  options: Pick<AccountListOptions, "includeCookies" | "revealSecrets">,
): Record<string, unknown> {
  const safe: Record<string, unknown> = {
    ...account,
    authToken: account.authToken ? tokenFingerprint(account.authToken) : undefined,
    csrfToken: account.csrfToken ? "[redacted]" : undefined,
    bearerToken: account.bearerToken ? "[redacted]" : undefined,
    password: account.password ? "[redacted]" : undefined,
    email: account.email ? "[redacted]" : undefined,
    emailPassword: account.emailPassword ? "[redacted]" : undefined,
    twoFactorSecret: account.twoFactorSecret ? "[redacted]" : undefined,
    proxy: account.proxy ? redactProxy(account.proxy) : undefined,
    cookies: options.includeCookies ? redactCookies(account.cookies) : undefined,
  };
  if (options.revealSecrets)
    return { ...account, cookies: options.includeCookies ? account.cookies : undefined };
  return safe;
}

function redactCookies(cookies: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.keys(cookies).map((name) => [name, "[redacted]"]));
}
