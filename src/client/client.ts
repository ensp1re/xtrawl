import type { ClientConfig } from "../config/types.js";
import { loadAccountFromEnvironmentSync } from "../config/environment.js";
import { validateConfig } from "../config/validation.js";
import type { AccountRecord } from "../domain/accounts.js";
import type { FollowRecord, ProfileRecord, SearchResult, TweetRecord } from "../domain/records.js";
import type {
  FollowsRequest,
  ProfileTimelineRequest,
  SearchRequest,
  TargetInput,
} from "../domain/requests.js";
import { AccountPoolExhausted, RunFailed } from "../domain/errors.js";
import { mapProfile } from "../engine/extractors.js";
import { ApiEngine } from "../engine/api-engine.js";
import { loadAccountsFileSync, loadInlineAccounts } from "../auth/loaders.js";
import { accountInputToRecord } from "../auth/records.js";
import { bootstrapCookiesFromAuthToken } from "../auth/bootstrap.js";
import { ManifestProvider } from "../manifest/provider.js";
import { queryHash } from "../query/hash.js";
import { AccountPool } from "../pool/account-pool.js";
import { saveRows } from "../output/writer.js";
import { openStorage, type StorageBundle } from "../storage/index.js";
import { GraphqlTransport } from "../transport/graphql.js";
import { SessionBuilder } from "../transport/session.js";
import { TransactionIdProvider } from "../transport/transaction-id.js";
import { targetUsername } from "../query/builder.js";
import { collectFollows, collectProfileTweets, type CollectionContext } from "./collectors.js";
import type { ClientInspection, ClientOptions } from "./types.js";

export class GraphHarvester {
  public readonly config: ClientConfig;
  public readonly storage: StorageBundle;
  private readonly pool: AccountPool;
  private readonly engine: ApiEngine;

  public constructor(options: ClientOptions = {}) {
    this.config = validateConfig(options);
    this.storage = openStorage(this.config.dbPath, {
      dailyRequestsLimit: this.config.dailyRequestsLimit,
      dailyTweetsLimit: this.config.dailyTweetsLimit,
      leaseTtlMs: this.config.leaseTtlMs,
    });
    this.provision(options);
    const manifests = new ManifestProvider(this.config, this.storage.manifests);
    const transactions = new TransactionIdProvider(options.transactionIdSource);
    const sessions = new SessionBuilder({
      bearerToken: this.config.bearerToken,
      ...(this.config.proxy ? { defaultProxy: this.config.proxy } : {}),
      ...(this.config.apiUserAgent ? { userAgent: this.config.apiUserAgent } : {}),
      ...(options.sessionFactory ? { factory: options.sessionFactory } : {}),
    });
    this.pool = new AccountPool(this.storage.accounts, sessions, this.config);
    this.engine = new ApiEngine(this.config, manifests, new GraphqlTransport(transactions));
  }

  public static async create(options: ClientOptions = {}): Promise<GraphHarvester> {
    const client = new GraphHarvester(options);
    await client.bootstrapMissingAccounts();
    return client;
  }

  public async search(query = "", options: SearchRequest = {}): Promise<SearchResult> {
    const request: SearchRequest = { ...options, ...(query ? { searchQuery: query } : {}) };
    const hash = queryHash({ operation: "search", request });
    const run = this.storage.runs.create("search", hash);
    try {
      const saved = request.resume ? this.storage.checkpoints.get(hash) : undefined;
      const tweets = await this.pool.execute("search", async ({ session }) => {
        const collected: TweetRecord[] = [];
        let cursor = saved?.root;
        let emptyPages = 0;
        while (true) {
          const page = await this.engine.search(session, request, cursor);
          const remaining =
            request.limit === undefined
              ? page.tweets
              : page.tweets.slice(0, Math.max(0, request.limit - collected.length));
          collected.push(...remaining);
          emptyPages = page.tweets.length === 0 ? emptyPages + 1 : 0;
          if (
            shouldStop(
              request.limit,
              collected.length,
              page.cursor,
              emptyPages,
              request.maxEmptyPages ?? this.config.maxEmptyPages,
            )
          )
            break;
          if (!page.cursor) break;
          cursor = page.cursor;
          this.storage.checkpoints.save(hash, { root: page.cursor });
        }
        return collected;
      });
      const result: SearchResult = { tweets, stats: stats(tweets.length, 1) };
      await this.saveIfRequested("search", result.tweets, request);
      this.storage.checkpoints.clear(hash);
      this.storage.runs.finalize(run.id, "complete");
      return result;
    } catch (error) {
      this.storage.runs.finalize(
        run.id,
        "failed",
        error instanceof Error ? { name: error.name, message: error.message } : error,
      );
      if (error instanceof AccountPoolExhausted) throw error;
      throw error instanceof RunFailed
        ? error
        : new RunFailed(error instanceof Error ? error.message : String(error));
    }
  }

  public async getUserInfo(targets: readonly (string | TargetInput)[]): Promise<readonly ProfileRecord[]> {
    const normalized = targets.map(toTarget);
    return this.pool.execute("user-info", async ({ session }) => {
      const records: ProfileRecord[] = [];
      for (const target of normalized) {
        const username = targetUsername(target);
        if (!username) continue;
        const user = await this.engine.lookupUser(session, username);
        records.push(mapProfile(user, target, username));
      }
      return records;
    });
  }

  public async getProfileTweets(
    targets: readonly (string | TargetInput)[],
    options: Omit<ProfileTimelineRequest, "targets"> = {},
  ): Promise<SearchResult> {
    return collectProfileTweets(this.collectionContext(), targets.map(toTarget), options);
  }

  public async getFollowers(
    targets: readonly (string | TargetInput)[],
    options: Omit<FollowsRequest, "targets" | "followType"> = {},
  ): Promise<readonly FollowRecord[]> {
    return collectFollows(this.collectionContext(), targets.map(toTarget), {
      targets: targets.map(toTarget),
      ...options,
      followType: "followers",
    });
  }

  public async getFollowing(
    targets: readonly (string | TargetInput)[],
    options: Omit<FollowsRequest, "targets" | "followType"> = {},
  ): Promise<readonly FollowRecord[]> {
    return collectFollows(this.collectionContext(), targets.map(toTarget), {
      targets: targets.map(toTarget),
      ...options,
      followType: "following",
    });
  }

  public async getVerifiedFollowers(
    targets: readonly (string | TargetInput)[],
    options: Omit<FollowsRequest, "targets" | "followType"> = {},
  ): Promise<readonly FollowRecord[]> {
    return collectFollows(this.collectionContext(), targets.map(toTarget), {
      targets: targets.map(toTarget),
      ...options,
      followType: "verified_followers",
    });
  }

  public inspect(): ClientInspection {
    return { config: this.config, accounts: this.storage.accounts.list() };
  }

  public close(): void {
    this.storage.database.close();
  }

  private collectionContext(): CollectionContext {
    return { config: this.config, pool: this.pool, engine: this.engine, storage: this.storage };
  }

  private async saveIfRequested(name: string, rows: readonly unknown[], options: SaveOptions): Promise<void> {
    if (!options.save) return;
    await saveRows(options.saveName ?? name, rows, {
      directory: options.saveDir ?? this.config.saveDir,
      format: options.saveFormat ?? this.config.saveFormat,
    });
  }

  private provision(options: ClientOptions): void {
    if (options.provision === false) return;
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
    for (const record of records) this.storage.accounts.upsert(record);
  }

  private async bootstrapMissingAccounts(): Promise<void> {
    for (const account of this.storage.accounts.list()) {
      if (!account.authToken || account.csrfToken) continue;
      const cookies = await bootstrapCookiesFromAuthToken(account.authToken);
      if (cookies?.ct0)
        this.storage.accounts.upsert({
          ...account,
          csrfToken: cookies.ct0,
          cookies: { ...account.cookies, ...cookies },
        });
    }
  }
}

function toTarget(value: string | TargetInput): TargetInput {
  return typeof value === "string"
    ? { raw: value, username: value.replace(/^@/u, ""), source: "input" }
    : value;
}

function shouldStop(
  limit: number | undefined,
  total: number,
  cursor: string | undefined,
  empty: number,
  maxEmpty: number,
): boolean {
  return Boolean((limit !== undefined && total >= limit) || !cursor || empty >= maxEmpty);
}

function stats(tweetsCount: number, tasksTotal: number): SearchResult["stats"] {
  return { tweetsCount, tasksTotal, tasksDone: tasksTotal, tasksFailed: 0, retries: 0 };
}

type SaveOptions = Pick<SearchRequest, "save" | "saveDir" | "saveFormat" | "saveName">;
