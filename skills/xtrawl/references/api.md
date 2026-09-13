# XTrawl TypeScript API reference (0.1.4)

Everything below is exported from `"xtrawl"` (ESM only).

## Create a client

```ts
const client = await XTrawl.create(options); // preferred
const client = new XTrawl(options); // sync; rejects a custom accountStore
```

`ClientOptions` = every `ConfigInput` field below, plus:

| Option | Type | Purpose |
| --- | --- | --- |
| `authToken`, `csrfToken` | `string` | One account's `auth_token` / `ct0`; fall back to `X_AUTH_TOKEN` / `X_CSRF_TOKEN` |
| `envFile` | `string` | Dotenv file: `X_AUTH_TOKEN`/`AUTH_TOKEN`, `X_CSRF_TOKEN`/`CT0`/`CSRF` |
| `cookiesFile`, `accountsFile` | `string` | JSON (object or array), Netscape cookie, or delimited account file |
| `accounts` | `AccountInput[]` | Inline account records |
| `cookies` | `unknown` | Inline cookie object or `"auth_token=...; ct0=..."` string |
| `provision` | `boolean` | `false` = use accounts already in the store; import nothing |
| `accountStore` | `AccountStateStore` | Caller-owned account storage (requires `create`) |
| `onDiagnostic` | `(event) => void` | Redacted operation diagnostics |
| `sessionFactory`, `transactionIdSource` | advanced | Custom transport adapters |

### `ConfigInput` (all optional)

| Field | Default | Purpose |
| --- | --- | --- |
| `dbPath` | `xtrawl_state.db` | SQLite state file |
| `proxy` | none | URL string or `{ scheme, host, port, username?, password? }` |
| `concurrency` | `5` | Worker count |
| `saveDir` / `saveFormat` | `outputs` / `csv` | Output defaults (`csv`, `json`, `both`, `ndjson`) |
| `apiPageSize` | `20` | Records per page (max 100) |
| `searchSplits` | `5` | Max date intervals per search |
| `maxEmptyPages` | `1` | Stop after N empty pages |
| `dailyRequestsLimit` / `dailyTweetsLimit` | `30` / `600` | Per-account local daily guards |
| `requestsPerMinute` / `minDelayMs` | `30` / `2000` | Per-account pacing |
| `maxTaskAttempts` / `maxAccountSwitches` | `3` / `2` | Retries per page |
| `cooldownDefaultMs` / `transientCooldownMs` | `120000` | Cooldowns after failures |
| `proxyCheckOnLease` / `proxyCheckTimeoutMs` | `true` / `10000` | Proxy health check |
| `manifestScrapeOnInit` | `false` | Refresh X operation IDs before the first request |
| `strict` | `false` | Fail a multi-target run if any task fails |

The daily limits are local safeguards, not X's real limits.

## Collection methods

```ts
search(query?: string, options?: SearchRequest): Promise<SearchResult>
searchPage(query?: string, options?: SearchPageRequest): Promise<SearchPageResult>
searchPages(query?: string, options?: SearchPageRequest): AsyncGenerator<SearchPageResult>
getTweet(idOrStatusUrl: string, options?: { signal?: AbortSignal }): Promise<TweetRecord | undefined>
getUserInfo(targets, options?: UserInfoRequest): Promise<readonly ProfileRecord[]>
getProfileTweets(targets, options?): Promise<SearchResult>
getFollowers(targets, options?): Promise<readonly FollowRecord[]>
getFollowing(targets, options?): Promise<readonly FollowRecord[]>
getVerifiedFollowers(targets, options?): Promise<readonly FollowRecord[]>
inspect(): { config; accounts }   // redacted
poolSummary                       // getter: total, eligible, ...
shutdown(): Promise<void>         // abort + wait for in-flight work, then close
close(): void
```

`targets` is `readonly (string | TargetInput)[]`, where `TargetInput` is
`{ username?, userId?, profileUrl?, raw? }`. Every method accepts `signal` to cancel.

### `SearchRequest`

- Query and dates: `searchQuery` (the first argument wins when it is non-empty), and `since`,
  `until` as date strings. Without either date, search covers the last 30 days.
- Words (`string[]`): `allWords`, `anyWords`, `exactPhrases`, `excludeWords`.
- Hashtags (`string[]`): `hashtagsAny`, `hashtagsExclude`.
- People (`string[]`): `fromUsers`, `toUsers`, `mentioningUsers`.
- Post type: `tweetType` is one of `all`, `originals_only`, `replies_only`, `retweets_only`,
  `exclude_replies`, `exclude_retweets`.
- Flags (`boolean`): `verifiedOnly`, `blueVerifiedOnly`, `hasImages`, `hasVideos`, `hasLinks`,
  `hasMentions`, `hasHashtags`.
- Engagement (`number`): `minLikes`, `minReplies`, `minRetweets`.
- Location and language: `lang`, `place`, `geocode`, `near`, `within`.
- `displayType`: `"Top"` or `"Latest"`.
- Stop conditions: `limit`, `maxEmptyPages`.
- State and output: `resume`, `save`, `saveFormat`, `saveDir`, `saveName`.

`SearchPageRequest` has the same filters minus `limit`, `resume`, `save*`, and `maxEmptyPages`,
plus `cursor` and `maxAccountSwitches`.

### Profile timeline and relationship options

- Limits: `limit` (total), `perProfileLimit`, `maxPagesPerProfile`, `maxEmptyPages`.
- State: `resume`, `initialCursors` (a `Record<targetKey, cursor>`), `maxAccountSwitches`.
- Output: `save`, `saveFormat`, `saveDir`, `saveName`.
- Relationship methods only: `rawJson` (keeps raw user payloads in JSON output).

`UserInfoRequest`: `save`, `saveFormat`, `saveDir`, `saveName`.

## Return types

- `SearchResult`: `{ tweets: TweetRecord[]; stats: RunStats }`.
- `RunStats`: `{ tweetsCount, tasksTotal, tasksDone, tasksFailed, retries }`.
- `SearchPageResult`: `{ tweets: TweetRecord[]; nextCursor: string | undefined }`.
- `TweetRecord`: `tweetId`, `user { screenName?, name? }`, `timestamp?`, `text?`,
  `embeddedText?`, `comments`, `likes`, `retweets`, `media { imageLinks }`, `tweetUrl?`, `raw?`.
- `ProfileRecord`:
  - Identity: `userId?`, `username?`, `name?`, `description?`, `location?`, `createdAt?`, `url?`.
  - Counts: `followersCount`, `followingCount`, `statusesCount`, `favouritesCount`, `mediaCount`,
    `listedCount`.
  - Flags: `verified`, `blueVerified`, `protected`.
  - Images: `profileImageUrl?`, `profileBannerUrl?`.
  - Also `input` and `raw?`.
- `FollowRecord`: the profile fields plus `type` (`followers`, `following`, or
  `verified_followers`) and `target`.

## `client.accounts` (async, works with any account store)

- Read: `summary()`, `list({ eligibleOnly?, unusableOnly?, includeCookies?, revealSecrets? })`,
  `get(username)`. Results are redacted unless you pass `revealSecrets`.
- Change: `import({ accountsFile?, cookiesFile?, envFile?, cookies?, accounts?, proxy? })`,
  `setProxy(username, proxy)`, `repair(username, forceRefresh?)`, `delete(username)`.
- Sessions: `exportState({ includeSecrets: true })` returns a snapshot that contains secrets, so
  store it encrypted. `restoreState(snapshot, { mode: "merge" | "replace" })` loads one back.

## `client.db` (sync SQLite maintenance)

- Accounts: `accountsSummary()`, `listAccounts(opts)`, `getAccount(username)`,
  `deleteAccount(username)`, `setAccountProxy(username, proxy?)`,
  `markAccountUnusable(username, reason?)`, `importAccounts(opts)`.
- Recovery: `repairAccount(username, forceRefresh?)` (async),
  `resetAccountCooldowns(usernames?, includeUnusable?)`, `clearLeases(expiredOnly = true)`,
  `resetDailyCounters(usernames?)`.
- Duplicates: `collapseDuplicateAccounts(dryRun = true)`. Pass `false` only on purpose.
- Checkpoints: `getCheckpoint(hash)`, `clearCheckpoint(hash)`, `clearAllCheckpoints()`.
- Runs: `listRuns(limit = 50)`, `lastRun()`, `runsSummary(limit = 500)`.

## Errors

`XTrawlError` is the base class (`code`, `message`, `diagnostics`).

- `ConfigError`, `AccountStateError`, `ManifestError`, `AccountPoolExhausted`, `ResumeError`
  extend `XTrawlError` directly.
- `EngineError` extends `XTrawlError`, and `RunFailed` extends `EngineError`.
- `AuthError`, `RateLimitError`, `NetworkError`, `ProxyError` extend `RunFailed`.

Check subclasses first in `instanceof` chains.

## Custom account store

To keep accounts outside SQLite, implement `AccountStateStore` and pass it through
`XTrawl.create`. It has these methods:

- `list`, `findByUsername`, `upsert`, `delete`, `replaceAll`
- `acquireLease`, `renewLease`, `completeLease`

Methods may be sync or async. Lease operations must be atomic across processes. `dbPath` still
stores runs, checkpoints, and the manifest cache.
