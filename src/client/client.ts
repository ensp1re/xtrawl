import type { ClientConfig } from "../config/types.js";
import { loadAccountFromEnvironmentSync } from "../config/environment.js";
import { validateConfig } from "../config/validation.js";
import type { AccountRecord } from "../domain/accounts.js";
import type { AccountStateStore } from "../domain/account-state.js";
import type {
  FollowRecord,
  ProfileRecord,
  SearchPageResult,
  SearchResult,
  TweetRecord,
} from "../domain/records.js";
import type {
  FollowsRequest,
  ProfileTimelineRequest,
  SearchPageRequest,
  SearchRequest,
  TargetInput,
  UserInfoRequest,
} from "../domain/requests.js";
import { ConfigError } from "../domain/errors.js";
import { combineSignals } from "../utils/abort.js";
import { redactProxy } from "../utils/redact.js";
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
import { collectSearch, collectSearchPage } from "./search.js";
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
  private sessions?: SessionBuilder;
  private readonly shutdownController = new AbortController();
  private readonly inflight = new Set<Promise<unknown>>();
  private closed = false;

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
    this.sessions = new SessionBuilder({
      bearerToken: this.config.bearerToken,
      ...(this.config.proxy ? { defaultProxy: this.config.proxy } : {}),
      ...(this.config.apiUserAgent ? { userAgent: this.config.apiUserAgent } : {}),
      httpMode: this.config.apiHttpMode,
      ...(this.config.apiHttpImpersonate ? { impersonate: this.config.apiHttpImpersonate } : {}),
      ...(options.sessionFactory ? { factory: options.sessionFactory } : {}),
    });
    this.pool = new AccountPool(
      this.accountStore,
      this.sessions,
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
    return this.track(collectSearch(this.collectionContext(options.signal), query, options));
  }

  public async searchPage(query = "", options: SearchPageRequest = {}): Promise<SearchPageResult> {
    return this.track(collectSearchPage(this.collectionContext(options.signal), query, options));
  }

  public async *searchPages(
    query = "",
    options: SearchPageRequest = {},
  ): AsyncGenerator<SearchPageResult, void, void> {
    let cursor = options.cursor;
    do {
      const page = await this.searchPage(query, { ...options, ...(cursor === undefined ? {} : { cursor }) });
      yield page;
      cursor = page.nextCursor;
    } while (cursor);
  }

  public async getUserInfo(
    targets: readonly (string | TargetInput)[],
    options: UserInfoRequest = {},
  ): Promise<readonly ProfileRecord[]> {
    const normalized = normalizeTargets(targets).targets;
    return this.track(collectProfiles(this.collectionContext(options.signal), normalized, options));
  }

  public async getTweet(
    target: string,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<TweetRecord | undefined> {
    const tweetId = tweetIdFromTarget(target);
    if (!tweetId) throw new ConfigError("Tweet lookup requires a numeric tweet ID or status URL.");
    const signal = this.operationSignal(options.signal);
    return this.track(
      this.pool.execute(
        "tweet",
        ({ session, signal: leaseSignal, chargeRequest }) =>
          this.engine.tweetResult(session, tweetId, leaseSignal ?? signal, chargeRequest),
        signal ? { signal } : {},
      ),
    );
  }

  public async getProfileTweets(
    targets: readonly (string | TargetInput)[],
    options: Omit<ProfileTimelineRequest, "targets"> = {},
  ): Promise<SearchResult> {
    return this.track(
      collectProfileTweets(
        this.collectionContext(options.signal),
        normalizeTargets(targets).targets,
        options,
      ),
    );
  }

  public async getFollowers(
    targets: readonly (string | TargetInput)[],
    options: Omit<FollowsRequest, "targets" | "followType"> = {},
  ): Promise<readonly FollowRecord[]> {
    const normalized = normalizeTargets(targets).targets;
    return this.track(
      collectFollows(this.collectionContext(options.signal), normalized, {
        targets: normalized,
        ...options,
        followType: "followers",
      }),
    );
  }

  public async getFollowing(
    targets: readonly (string | TargetInput)[],
    options: Omit<FollowsRequest, "targets" | "followType"> = {},
  ): Promise<readonly FollowRecord[]> {
    const normalized = normalizeTargets(targets).targets;
    return this.track(
      collectFollows(this.collectionContext(options.signal), normalized, {
        targets: normalized,
        ...options,
        followType: "following",
      }),
    );
  }

  public async getVerifiedFollowers(
    targets: readonly (string | TargetInput)[],
    options: Omit<FollowsRequest, "targets" | "followType"> = {},
  ): Promise<readonly FollowRecord[]> {
    const normalized = normalizeTargets(targets).targets;
    return this.track(
      collectFollows(this.collectionContext(options.signal), normalized, {
        targets: normalized,
        ...options,
        followType: "verified_followers",
      }),
    );
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

  public async shutdown(): Promise<void> {
    this.shutdownController.abort();
    await Promise.allSettled([...this.inflight]);
    await this.sessions?.close();
    this.close();
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    if (!this.shutdownController.signal.aborted) this.shutdownController.abort();
    void this.sessions?.close();
    this.storage.database.close();
  }

  private collectionContext(signal?: AbortSignal): CollectionContext {
    if (this.closed) throw new ConfigError("XTrawl has been shut down.");
    const combined = this.operationSignal(signal);
    return {
      config: this.config,
      pool: this.pool,
      engine: this.engine,
      storage: this.storage,
      ...(combined ? { signal: combined } : {}),
    };
  }

  private operationSignal(signal?: AbortSignal): AbortSignal | undefined {
    return combineSignals(this.shutdownController.signal, signal);
  }

  private track<T>(work: Promise<T>): Promise<T> {
    this.inflight.add(work);
    return work.finally(() => {
      this.inflight.delete(work);
    });
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

function tweetIdFromTarget(value: string): string | undefined {
  const target = value.trim();
  if (/^\d+$/u.test(target)) return target;
  const match = target.match(
    /^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[^/]+\/status\/(\d+)(?:[/?#].*)?$/u,
  );
  return match?.[1];
}
