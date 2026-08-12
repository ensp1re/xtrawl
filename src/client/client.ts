import type { ClientConfig } from "../config/types.js";
import { loadAccountFromEnvironmentSync } from "../config/environment.js";
import { validateConfig } from "../config/validation.js";
import type { AccountRecord, ProxySettings } from "../domain/accounts.js";
import type { AccountStateStore } from "../domain/account-state.js";
import type { FollowRecord, ProfileRecord, SearchResult, TweetRecord } from "../domain/records.js";
import type {
  FollowsRequest,
  ProfileTimelineRequest,
  SearchRequest,
  TargetInput,
  UserInfoRequest,
} from "../domain/requests.js";
import { ConfigError } from "../domain/errors.js";
import { ApiEngine } from "../engine/api-engine.js";
import { loadAccountsFileSync, loadInlineAccounts } from "../auth/loaders.js";
import { accountInputToRecord } from "../auth/records.js";
import { bootstrapCookiesFromAuthToken } from "../auth/bootstrap.js";
import { ManifestProvider } from "../manifest/provider.js";
import { AccountPool } from "../pool/account-pool.js";
import { openStorage, type StorageBundle } from "../storage/index.js";
import { GraphqlTransport } from "../transport/graphql.js";
import { SessionBuilder } from "../transport/session.js";
import { TransactionIdProvider } from "../transport/transaction-id.js";
import { normalizeTargets } from "../query/targets.js";
import { collectFollows, collectProfileTweets, type CollectionContext } from "./collectors.js";
import { collectSearch } from "./search.js";
import { collectProfiles } from "./profiles.js";
import type { ClientInspection, ClientOptions } from "./types.js";
import { XTrawlDatabase } from "./database.js";
import { XTrawlAccounts } from "./accounts.js";

const ASYNC_ACCOUNT_STORE_INITIALIZATION = Symbol("async-account-store-initialization");

export class XTrawl {
  public readonly config: ClientConfig;
  public readonly storage: StorageBundle;
  public readonly db: XTrawlDatabase;
  public readonly accounts: XTrawlAccounts;
  private readonly accountStore: AccountStateStore;
  private readonly usesExternalAccountStore: boolean;
  private pool!: AccountPool;
  private engine!: ApiEngine;

  public constructor(options?: ClientOptions);
  public constructor(options: ClientOptions, initialization: typeof ASYNC_ACCOUNT_STORE_INITIALIZATION);
  public constructor(
    options: ClientOptions = {},
    initialization?: typeof ASYNC_ACCOUNT_STORE_INITIALIZATION,
  ) {
    if (options.accountStore && initialization !== ASYNC_ACCOUNT_STORE_INITIALIZATION)
      throw new ConfigError("Custom accountStore instances require await XTrawl.create(options).");
    this.config = validateConfig(options);
    this.storage = openStorage(this.config.dbPath, {
      dailyRequestsLimit: this.config.dailyRequestsLimit,
      dailyTweetsLimit: this.config.dailyTweetsLimit,
      leaseTtlMs: this.config.leaseTtlMs,
    });
    this.db = new XTrawlDatabase(this.storage);
    this.usesExternalAccountStore = Boolean(options.accountStore);
    this.accountStore = options.accountStore ?? this.storage.accounts;
    this.accounts = new XTrawlAccounts(
      this.accountStore,
      this.config,
      options.accountStore ? `external:${options.accountStore.kind ?? "custom"}` : this.config.dbPath,
      (current) => this.pool.updateAccounts(current),
    );
    if (!options.accountStore) {
      this.provisionSqlite(options);
      const initialAccounts = this.storage.accounts.list();
      this.accounts.initialize(initialAccounts);
      this.initializeRuntime(options, initialAccounts);
    }
  }

  public static async create(options: ClientOptions = {}): Promise<XTrawl> {
    const client = new XTrawl(options, ASYNC_ACCOUNT_STORE_INITIALIZATION);
    try {
      if (options.accountStore) await client.provisionExternal(options);
      await client.bootstrapMissingAccounts();
      const accounts = await client.accountStore.list();
      client.accounts.initialize(accounts);
      if (options.accountStore) client.initializeRuntime(options, accounts);
      return client;
    } catch (error) {
      client.close();
      throw error;
    }
  }

  private initializeRuntime(options: ClientOptions, accounts: readonly AccountRecord[]): void {
    const manifestAccount = accounts.find((account) => Boolean(account.authToken));
    const manifests = new ManifestProvider(
      this.config,
      this.storage.manifests,
      undefined,
      manifestAccount?.authToken,
    );
    const transactions = new TransactionIdProvider(options.transactionIdSource, {
      enabled:
        this.config.transactionIdEnabled && (!options.sessionFactory || Boolean(options.transactionIdSource)),
      ttlMs: this.config.transactionIdTtlMs,
    });
    const sessions = new SessionBuilder({
      bearerToken: this.config.bearerToken,
      ...(this.config.proxy ? { defaultProxy: this.config.proxy } : {}),
      ...(this.config.apiUserAgent ? { userAgent: this.config.apiUserAgent } : {}),
      httpMode: this.config.apiHttpMode,
      ...(this.config.apiHttpImpersonate ? { impersonate: this.config.apiHttpImpersonate } : {}),
      ...(options.sessionFactory ? { factory: options.sessionFactory } : {}),
    });
    this.pool = new AccountPool(
      this.accountStore,
      sessions,
      this.config,
      async (account) => {
        if (!account.authToken) return false;
        const cookies = await bootstrapCookiesFromAuthToken(account.authToken, undefined, account.proxy);
        if (!cookies?.ct0) return false;
        await this.accountStore.upsert({
          ...account,
          status: 1,
          availableUntil: 0,
          csrfToken: cookies.ct0,
          cookies: { ...account.cookies, ...cookies },
        });
        return true;
      },
      accounts,
      options.accountStore ? `external:${options.accountStore.kind ?? "custom"}` : this.config.dbPath,
      (current) => this.accounts.initialize(current),
    );
    this.engine = new ApiEngine(this.config, manifests, new GraphqlTransport(transactions));
  }

  public async search(query = "", options: SearchRequest = {}): Promise<SearchResult> {
    return collectSearch(this.collectionContext(), query, options);
  }

  public async getUserInfo(
    targets: readonly (string | TargetInput)[],
    options: UserInfoRequest = {},
  ): Promise<readonly ProfileRecord[]> {
    const normalized = normalizeTargets(targets).targets;
    return collectProfiles(this.collectionContext(), normalized, options);
  }

  public async getTweet(target: string): Promise<TweetRecord | undefined> {
    const tweetId = tweetIdFromTarget(target);
    if (!tweetId) throw new ConfigError("Tweet lookup requires a numeric tweet ID or status URL.");
    return this.pool.execute("tweet", ({ session }) => this.engine.tweetResult(session, tweetId));
  }

  public async getProfileTweets(
    targets: readonly (string | TargetInput)[],
    options: Omit<ProfileTimelineRequest, "targets"> = {},
  ): Promise<SearchResult> {
    return collectProfileTweets(this.collectionContext(), normalizeTargets(targets).targets, options);
  }

  public async getFollowers(
    targets: readonly (string | TargetInput)[],
    options: Omit<FollowsRequest, "targets" | "followType"> = {},
  ): Promise<readonly FollowRecord[]> {
    const normalized = normalizeTargets(targets).targets;
    return collectFollows(this.collectionContext(), normalized, {
      targets: normalized,
      ...options,
      followType: "followers",
    });
  }

  public async getFollowing(
    targets: readonly (string | TargetInput)[],
    options: Omit<FollowsRequest, "targets" | "followType"> = {},
  ): Promise<readonly FollowRecord[]> {
    const normalized = normalizeTargets(targets).targets;
    return collectFollows(this.collectionContext(), normalized, {
      targets: normalized,
      ...options,
      followType: "following",
    });
  }

  public async getVerifiedFollowers(
    targets: readonly (string | TargetInput)[],
    options: Omit<FollowsRequest, "targets" | "followType"> = {},
  ): Promise<readonly FollowRecord[]> {
    const normalized = normalizeTargets(targets).targets;
    return collectFollows(this.collectionContext(), normalized, {
      targets: normalized,
      ...options,
      followType: "verified_followers",
    });
  }

  public inspect(): ClientInspection {
    return {
      config: {
        ...this.config,
        bearerToken: "[redacted]",
        ...(this.config.proxy ? { proxy: redactProxy(this.config.proxy) } : {}),
      },
      accounts: this.usesExternalAccountStore ? this.accounts.inspectCached() : this.db.listAccounts(),
    };
  }

  public get poolSummary() {
    return this.pool.summary;
  }

  public close(): void {
    this.storage.database.close();
  }

  private collectionContext(): CollectionContext {
    return { config: this.config, pool: this.pool, engine: this.engine, storage: this.storage };
  }

  private provisionSqlite(options: ClientOptions): void {
    for (const record of this.provisionRecords(options)) this.storage.accounts.upsert(record);
  }

  private async provisionExternal(options: ClientOptions): Promise<void> {
    for (const record of this.provisionRecords(options)) await this.accountStore.upsert(record);
  }

  private provisionRecords(options: ClientOptions): AccountRecord[] {
    if (options.provision === false) return [];
    const records: AccountRecord[] = [];
    if (options.accounts) records.push(...options.accounts.map(accountInputToRecord));
    if (options.cookies !== undefined) records.push(...loadInlineAccounts(options.cookies));
    const authToken = options.authToken ?? process.env.X_AUTH_TOKEN;
    const csrfToken = options.csrfToken ?? process.env.X_CSRF_TOKEN;
    if (authToken)
      records.push(
        accountInputToRecord({
          authToken,
          ...(csrfToken ? { csrfToken } : {}),
        }),
      );
    if (options.cookiesFile) records.push(...loadAccountsFileSync(options.cookiesFile));
    if (options.accountsFile) records.push(...loadAccountsFileSync(options.accountsFile));
    if (options.envFile)
      records.push(...loadAccountFromEnvironmentSync(options.envFile).map(accountInputToRecord));
    return records;
  }

  private async bootstrapMissingAccounts(): Promise<void> {
    for (const account of await this.accountStore.list()) {
      if (!account.authToken || account.csrfToken) continue;
      const cookies = await bootstrapCookiesFromAuthToken(account.authToken, undefined, account.proxy);
      if (cookies?.ct0)
        await this.accountStore.upsert({
          ...account,
          csrfToken: cookies.ct0,
          cookies: { ...account.cookies, ...cookies },
        });
    }
  }
}

function redactProxy(proxy: string | ProxySettings): string | ProxySettings {
  if (typeof proxy !== "string")
    return {
      ...proxy,
      ...(proxy.password ? { password: "[redacted]" } : {}),
    };
  try {
    const value = new URL(proxy.includes("://") ? proxy : `http://${proxy}`);
    if (value.username) value.username = "[redacted]";
    if (value.password) value.password = "[redacted]";
    return value.toString();
  } catch {
    return "[redacted]";
  }
}

function tweetIdFromTarget(value: string): string | undefined {
  const target = value.trim();
  if (/^\d+$/u.test(target)) return target;
  const match = target.match(
    /^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[^/]+\/status\/(\d+)(?:[/?#].*)?$/u,
  );
  return match?.[1];
}
