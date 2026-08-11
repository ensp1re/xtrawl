# XTrawl documentation

This guide explains how to install, authenticate, configure, and operate XTrawl from TypeScript or
the command line. XTrawl is an authenticated, read-only collector for public X data.

## Contents

- [Install](#install)
- [Authenticate](#authenticate)
- [Use multiple accounts](#use-multiple-accounts)
- [Use a proxy](#use-a-proxy)
- [Use the TypeScript API](#use-the-typescript-api)
- [Search filters](#search-filters)
- [Use the CLI](#use-the-cli)
- [Control pagination and resume runs](#control-pagination-and-resume-runs)
- [Save output](#save-output)
- [Configure XTrawl](#configure-xtrawl)
- [Understand return types](#understand-return-types)
- [Handle errors](#handle-errors)
- [Refresh operation identifiers](#refresh-operation-identifiers)
- [Understand storage and account health](#understand-storage-and-account-health)
- [Manage local state](#manage-local-state)
- [Protect credentials and collected data](#protect-credentials-and-collected-data)
- [Troubleshoot common problems](#troubleshoot-common-problems)
- [Know the limitations](#know-the-limitations)

## Install

Requirements:

- Node.js 22.5 or newer
- npm
- An X browser session that you own or are authorized to use

Install the package:

```bash
npm install xtrawl
```

To contribute or run the source checkout:

```bash
git clone https://github.com/ensp1re/xtrawl.git
cd xtrawl
npm install
npm run build
```

The source build writes ESM output to `dist/`. In source-checkout commands, replace `xtrawl` with
`npm run cli --`.

Verify the checkout:

```bash
npm run check
```

## Authenticate

Live requests require the `auth_token` and `ct0` cookies from an authenticated X browser session.
XTrawl calls these values `authToken` and `csrfToken` in TypeScript and reads them from
`X_AUTH_TOKEN` and `X_CSRF_TOKEN` in the process environment.

### Use environment variables

```bash
export X_AUTH_TOKEN="your-auth-token"
export X_CSRF_TOKEN="your-ct0-token"

xtrawl user-info OpenAI --pretty
```

This is the smallest setup for a single account.

### Use an environment file

Create a local file that is not committed, for example `.env.local`:

```dotenv
X_AUTH_TOKEN=your-auth-token
X_CSRF_TOKEN=your-ct0-token
```

Pass global options before the command:

```bash
xtrawl --env-file .env.local user-info OpenAI --pretty
```

Environment files also recognize `AUTH_TOKEN` for the auth cookie and `CT0` or `CSRF` for the CSRF
cookie. Prefer the `X_AUTH_TOKEN` and `X_CSRF_TOKEN` names for clarity.

### Bootstrap a missing CSRF cookie

`XTrawl.create()` checks provisioned accounts that have an auth token but no CSRF token. It attempts
to obtain the missing `ct0` cookie before returning the client:

```ts
const client = await XTrawl.create({
  authToken: process.env.X_AUTH_TOKEN,
});
```

Supplying both cookies is more deterministic. A session without usable authentication is not
eligible for live requests.

## Use multiple accounts

XTrawl can load account records from inline objects or a file and keep account health in SQLite.
For JSON files, use one object or an array of objects:

```json
[
  {
    "username": "collector-one",
    "authToken": "replace-me",
    "csrfToken": "replace-me"
  },
  {
    "username": "collector-two",
    "cookies": {
      "auth_token": "replace-me",
      "ct0": "replace-me"
    },
    "proxy": "http://127.0.0.1:8080"
  }
]
```

Never commit this file. Load it from the CLI:

```bash
xtrawl --cookies-file ./accounts.json search "typescript" --limit 100
```

Or from TypeScript:

```ts
const client = await XTrawl.create({
  accountsFile: "./accounts.json",
  dbPath: "./state/xtrawl.db",
});
```

Supported account sources are:

| Source | CLI or library option | Notes |
| --- | --- | --- |
| Process environment | No option required | Reads `X_AUTH_TOKEN` and `X_CSRF_TOKEN` |
| Environment file | `--env-file` / `envFile` | Reads dotenv-style values |
| JSON account file | `--cookies-file` / `cookiesFile` or `accountsFile` | Accepts one account or an array |
| Netscape cookie file | `--cookies-file` / `cookiesFile` | Extracts browser cookie records |
| Delimited account file | `--cookies-file` / `cookiesFile` | Accepts pipe- or colon-separated records |
| Inline account records | `accounts` | TypeScript API only |
| Inline cookie payload | `cookies` | TypeScript API only; accepts an object or cookie string |

Delimited files are accepted for account import compatibility, but live sessions still require
usable `auth_token` and `ct0` values. XTrawl does not perform interactive username/password login.

If you want to reuse accounts already stored in the configured SQLite database without provisioning
new input, create the client with `provision: false`.

## Use a proxy

Set one proxy for all accounts:

```bash
xtrawl --proxy http://127.0.0.1:8080 search "typescript" --limit 20
```

The TypeScript API accepts a URL or structured proxy settings:

```ts
const client = await XTrawl.create({
  authToken: process.env.X_AUTH_TOKEN,
  csrfToken: process.env.X_CSRF_TOKEN,
  proxy: {
    scheme: "http",
    host: "127.0.0.1",
    port: 8080,
  },
});
```

An account record may define its own `proxy`; that account-level value takes precedence for its
session. HTTP, HTTPS, and SOCKS5 URLs are supported. Before leasing a proxied account, XTrawl performs
a short unauthenticated health request through that proxy and caches a successful result for one
minute. Keep proxy credentials in secret storage, not in committed configuration.

## Use the TypeScript API

The package is ESM:

```ts
import {
  AuthError,
  RateLimitError,
  XTrawl,
  type SearchResult,
} from "xtrawl";
```

### Create and close a client

```ts
const client = await XTrawl.create({
  authToken: process.env.X_AUTH_TOKEN,
  csrfToken: process.env.X_CSRF_TOKEN,
  dbPath: "xtrawl.db",
  saveDir: "outputs",
});

try {
  // Run operations here.
} finally {
  client.close();
}
```

Always close the client when the process no longer needs it so the SQLite connection is released.

The synchronous constructor is also public:

```ts
const client = new XTrawl({
  authToken: process.env.X_AUTH_TOKEN,
  csrfToken: process.env.X_CSRF_TOKEN,
});
```

Prefer `XTrawl.create()` because it can bootstrap a missing CSRF cookie.

### Search posts

```ts
const result: SearchResult = await client.search("typescript", {
  since: "2026-01-01",
  until: "2026-02-01",
  fromUsers: ["OpenAI", "github"],
  exactPhrases: ["open source"],
  excludeWords: ["hiring"],
  lang: "en",
  minLikes: 10,
  hasLinks: true,
  tweetType: "originals_only",
  displayType: "Latest",
  limit: 200,
  resume: true,
});

console.log(result.tweets);
console.log(result.stats);
```

The first argument is the free-form search query. Typed options are normalized into X search
operators and combined with that query. If neither date bound is supplied, XTrawl searches the
previous 30 days. A bounded interval is split into up to `searchSplits` tasks and processed with the
available account concurrency.

### Read profile information

```ts
const profiles = await client.getUserInfo([
  "OpenAI",
  "@github",
  { profileUrl: "https://x.com/typescript" },
]);
```

Each resolvable public target returns a normalized `ProfileRecord`.

Profile information can also be saved:

```ts
await client.getUserInfo(["OpenAI", "github"], {
  save: true,
  saveFormat: "both",
});
```

### Read one post

Pass a numeric post ID or an X status URL:

```ts
const tweet = await client.getTweet("https://x.com/OpenAI/status/1234567890");
```

The method returns a normalized `TweetRecord`, or `undefined` when the response has no post result.

### Collect profile posts

```ts
const result = await client.getProfileTweets(["OpenAI", "github"], {
  limit: 500,
  perProfileLimit: 200,
  maxPagesPerProfile: 20,
  maxEmptyPages: 2,
  resume: true,
  save: true,
  saveFormat: "both",
  saveName: "profile-posts",
});
```

`limit` caps all returned posts. `perProfileLimit` caps each target independently.

### Collect followers and following

```ts
const followers = await client.getFollowers(["OpenAI"], {
  limit: 500,
  resume: true,
});

const following = await client.getFollowing(["OpenAI"], {
  perProfileLimit: 250,
});

const verifiedFollowers = await client.getVerifiedFollowers(["OpenAI"], {
  maxPagesPerProfile: 10,
});
```

These methods return normalized `FollowRecord` arrays. Records are deduplicated within each target.

### Inspect local state

```ts
const inspection = client.inspect();

console.log(inspection.config);
console.log(inspection.accounts);
```

`inspect()` reports the validated configuration and redacted account projections. Tokens, cookie
values, passwords, email addresses, bearer overrides, and proxy credentials are not returned.

## Search filters

`SearchRequest` supports these canonical options:

| Option | Type | Effect |
| --- | --- | --- |
| `searchQuery` | `string` | Free-form query; the first `search()` argument overrides it when non-empty |
| `since`, `until` | `string` | Lower and upper date bounds |
| `allWords` | `string[]` | Require every supplied term |
| `anyWords` | `string[]` | Require at least one supplied term |
| `exactPhrases` | `string[]` | Match quoted phrases |
| `excludeWords` | `string[]` | Exclude supplied terms |
| `hashtagsAny` | `string[]` | Match any supplied hashtag |
| `hashtagsExclude` | `string[]` | Exclude supplied hashtags |
| `fromUsers` | `string[]` | Match posts from these accounts |
| `toUsers` | `string[]` | Match posts addressed to these accounts |
| `mentioningUsers` | `string[]` | Match posts mentioning these accounts |
| `tweetType` | `TweetType` | Select or exclude originals, replies, or reposts |
| `verifiedOnly` | `boolean` | Require verified authors |
| `blueVerifiedOnly` | `boolean` | Require blue-verified authors |
| `hasImages` | `boolean` | Require images |
| `hasVideos` | `boolean` | Require videos |
| `hasLinks` | `boolean` | Require links |
| `hasMentions` | `boolean` | Require mentions |
| `hasHashtags` | `boolean` | Require hashtags |
| `minLikes` | `number` | Minimum like count |
| `minReplies` | `number` | Minimum reply count |
| `minRetweets` | `number` | Minimum repost count |
| `place` | `string` | Match an X place operator |
| `geocode` | `string` | Match a geocode expression |
| `near`, `within` | `string` | Match a named location and radius |
| `lang` | `string` | Match a language code |
| `displayType` | `"Top" \| "Latest"` | Select the search timeline mode |
| `limit` | `number` | Cap the number of returned posts |
| `maxEmptyPages` | `number` | Stop after this many consecutive empty pages |

`TweetType` accepts `all`, `originals_only`, `replies_only`, `retweets_only`, `exclude_replies`, or
`exclude_retweets`.

## Use the CLI

Syntax:

```text
xtrawl [global options] COMMAND [values] [command options]
```

Use `npx xtrawl` if you installed XTrawl locally rather than globally. From a source checkout,
replace `xtrawl` with `npm run cli --`.

### Commands

| Command | Values | Result |
| --- | --- | --- |
| `search` | Optional query | Matching public posts and run statistics |
| `tweet` | One or more post IDs or status URLs | Individual public post records |
| `profile-tweets` | One or more users | Posts from public profile timelines |
| `followers` | One or more users | Public follower relationships |
| `following` | One or more users | Public following relationships |
| `verified-followers` | One or more users | Public verified-follower relationships |
| `user-info` | One or more users | Public profile records |

### Global options

Put these before the command:

| Option | Value | Purpose |
| --- | --- | --- |
| `--auth-token` | token | Supply one account's `auth_token` value |
| `--csrf-token`, `--ct0` | token | Supply one account's `ct0` value |
| `--cookies-file` | path | Load accounts or cookies from a file |
| `--env-file` | path | Load account values from a dotenv file |
| `--db-path` | path | Choose the SQLite state file |
| `--proxy` | URL | Set the default HTTP(S) or SOCKS5 proxy |
| `--concurrency` | positive integer | Set the configured worker count |
| `--manifest-scrape-on-init` | flag | Enable live operation-identifier refresh with local fallback |
| `--verbose`, `-v` | flag | Print redacted pool diagnostics and full error stacks |
| `--help` | flag | Print CLI help |

Example:

```bash
xtrawl \
  --env-file .env.local \
  --db-path ./state/xtrawl.db \
  search "typescript" \
  --limit 100
```

### Search options

| CLI option | API option |
| --- | --- |
| `--since`, `--until` | `since`, `until` |
| `--from`, `--to`, `--mention` | `fromUsers`, `toUsers`, `mentioningUsers` |
| `--all-words`, `--any-words`, `--exact-phrases` | `allWords`, `anyWords`, `exactPhrases` |
| `--exclude-words` | `excludeWords` |
| `--hashtags-any`, `--hashtags-exclude` | `hashtagsAny`, `hashtagsExclude` |
| `--lang`, `--place`, `--geocode`, `--near`, `--within` | Location and language filters |
| `--display-type` | `displayType` |
| `--tweet-type` | `tweetType` |
| `--verified-only`, `--blue-verified-only` | Verification filters |
| `--has-images`, `--has-videos`, `--has-links` | Media and link filters |
| `--has-mentions`, `--has-hashtags` | Entity filters |
| `--min-likes`, `--min-replies`, `--min-retweets` | Engagement thresholds |
| `--limit`, `--max-empty-pages` | Pagination stop conditions |

Repeat list options or place multiple values after one list option:

```bash
xtrawl search "release" \
  --from OpenAI \
  --from github \
  --exact-phrases "open source" \
  --lang en \
  --limit 100
```

### Collection options

`profile-tweets`, `followers`, `following`, and `verified-followers` accept:

| Option | Purpose |
| --- | --- |
| `--limit` | Cap all returned records |
| `--per-profile-limit` | Cap records for each target |
| `--max-pages-per-profile` | Cap pages for each target |
| `--max-empty-pages` | Stop a target after consecutive empty pages |
| `--resume` | Read and update SQLite checkpoints |
| `--save` | Write output files |
| `--save-format csv\|json\|both` | Select output formats |
| `--save-dir` | Select the output directory |
| `--save-name` | Select the output filename without an extension |
| `--raw-json` | Include raw user payloads in relationship JSON output |

All commands accept `--pretty` after the command to print indented JSON to stdout. Without
`--pretty`, use `--save` when you need file output.

## Control pagination and resume runs

XTrawl follows each response cursor until one of these conditions is met:

- The requested global or per-profile record limit is reached.
- The target reaches `maxPagesPerProfile`.
- The response has no next cursor.
- Consecutive empty pages reach `maxEmptyPages`.
- The operation fails.

With `resume: true` or `--resume`, XTrawl reads a matching cursor from SQLite before the run and
updates it as pagination advances. Checkpoint identity includes the operation and normalized request,
so a materially different request starts from its own checkpoint. A successfully completed operation
clears its checkpoint.

For profile and relationship methods, `initialCursors` can provide an explicit cursor keyed by the
target identity. An explicit initial cursor takes precedence over a stored checkpoint.

## Save output

Enable file output per operation:

```ts
const result = await client.search("typescript", {
  limit: 100,
  save: true,
  saveFormat: "both",
  saveDir: "./exports",
  saveName: "typescript-posts",
});
```

This writes:

```text
exports/typescript-posts.csv
exports/typescript-posts.json
```

Without overrides, the directory is `outputs`, the format is `csv`, and the base name reflects the
query/date range or operation targets. Existing CSV and JSON files are appended instead of replaced.

JSON preserves the normalized records. Tweet CSV output flattens the common post fields, including
the post ID, timestamp, author, text, engagement counts, URL, and media links.

## Configure XTrawl

Pass configuration fields to `XTrawl.create()` or the constructor. Common defaults are:

| Option | Default | Purpose |
| --- | --- | --- |
| `dbPath` | `xtrawl_state.db` | SQLite account and run state |
| `concurrency` | `5` | Configured worker count |
| `saveDir` | `outputs` | File output directory |
| `saveFormat` | `csv` | File output format |
| `apiPageSize` | `20` | Requested records per API page |
| `searchSplits` | `5` | Maximum date intervals per search |
| `schedulerMinIntervalMs` | `300000` | Smallest search interval |
| `maxEmptyPages` | `1` | Consecutive empty-page stop threshold |
| `dailyRequestsLimit` | `30` | Per-account daily operation guard |
| `dailyTweetsLimit` | `600` | Per-account daily collected-post guard |
| `cooldownDefaultMs` | `120000` | Default rate-limit cooldown |
| `transientCooldownMs` | `120000` | Network and transient cooldown |
| `leaseTtlMs` | `120000` | Account lease lifetime |
| `leaseHeartbeatMs` | `30000` | Active lease renewal interval |
| `requestsPerMinute` | `30` | Per-account token-bucket rate |
| `minDelayMs` | `2000` | Minimum spacing between account requests |
| `maxTaskAttempts` | `3` | Attempts for a failed page request |
| `maxAccountSwitches` | `2` | Account changes allowed within one page request |
| `proxyCheckOnLease` | `true` | Check a configured proxy before use |
| `proxyCheckTimeoutMs` | `10000` | Proxy health-check timeout |
| `manifestTtlMs` | `3600000` | Cached remote manifest lifetime |
| `manifestUpdateOnInit` | `false` | Force configured manifest URL refresh on first use |
| `manifestScrapeOnInit` | `false` | Enable live operation-identifier refresh |
| `transactionIdEnabled` | `true` | Generate current web transaction headers when possible |
| `transactionIdTtlMs` | `21600000` | Reuse transaction bootstrap material for six hours |
| `strict` | `false` | Fail a multi-target run when any task fails |

Limits are local safeguards, not statements about the platform's actual limits. XTrawl validates
configuration before opening a live operation; positive fields must be valid positive numbers and
`apiPageSize` cannot exceed 100.

## Understand return types

### `SearchResult`

Search and profile timeline methods return:

```ts
interface SearchResult {
  readonly tweets: readonly TweetRecord[];
  readonly stats: RunStats;
}
```

`TweetRecord` includes the post ID, author, timestamp, text, engagement counts, image links, post URL,
and optional raw source data when available. `RunStats` reports collected count, task counts,
failures, and retries.

### `ProfileRecord`

Profile lookup returns normalized identity, biography, location, account creation time, public
counts, verification flags, protection status, profile images, banner, URL, and optional raw data.

### `FollowRecord`

Relationship methods return profile fields plus the relationship type and the original target. The
type is `followers`, `following`, or `verified_followers`.

All response shapes are exported from the package entry point as TypeScript types.

## Handle errors

Public failures extend `XTrawlError` and expose a `code` plus structured diagnostics:

```ts
import {
  AuthError,
  RateLimitError,
  XTrawlError,
} from "xtrawl";

try {
  await client.search("typescript", { limit: 100 });
} catch (error) {
  if (error instanceof RateLimitError) {
    console.error("The active account was rate limited.");
  } else if (error instanceof AuthError) {
    console.error("Refresh the account cookies.");
  } else if (error instanceof XTrawlError) {
    console.error(error.code, error.message, error.diagnostics);
  } else {
    throw error;
  }
}
```

Exported error classes include:

- `ConfigError` for invalid configuration
- `ManifestError` for invalid or unavailable operation manifests
- `AccountPoolExhausted` when no account is eligible
- `AuthError` for rejected authentication
- `RateLimitError` for platform rate limits
- `NetworkError` and `ProxyError` for transport failures
- `EngineError` and `RunFailed` for operation-level failures
- `ResumeError` for invalid checkpoint state

Do not add raw tokens or cookie values to application logs when handling an error.

## Refresh operation identifiers

X's web operation identifiers can change. XTrawl automatically refreshes the authenticated web
manifest and retries once when X rejects an outdated operation ID with HTTP 404 or 422. You can also
refresh before the first operation:

```bash
xtrawl --manifest-scrape-on-init search "typescript" --limit 20
```

Or in TypeScript:

```ts
const client = await XTrawl.create({
  authToken: process.env.X_AUTH_TOKEN,
  csrfToken: process.env.X_CSRF_TOKEN,
  manifestScrapeOnInit: true,
});
```

Refresh reads the authenticated responsive-web main bundle, accepts only supported X script hosts,
and requires at least one real operation match. If an optional startup refresh fails, XTrawl falls
back to the bundled manifest. A configured `manifestUrl` can also provide a remote JSON manifest;
XTrawl caches it in SQLite and can use a stale cached value when a refresh fails.

## Understand storage and account health

XTrawl uses SQLite for operational state:

- Provisioned accounts and their health status
- Exclusive account leases and lease expiry
- Daily request and collected-post counters
- Cooldown and last-error information
- Run status and failure summaries
- Pagination checkpoints
- Cached operation manifests

Before a request, the account pool selects an account that has authentication material, is not
leased, is not cooling down, and remains within configured local limits. After the operation:

- A successful account returns to the eligible pool.
- A rate-limit, network, proxy, or transient failure applies the corresponding cooldown.
- An authentication rejection marks the account unusable so it is not selected again.

SQLite coordinates account leases so separate work does not intentionally use the same stored
account at the same time.

## Manage local state

`client.db` provides scoped operational maintenance without exposing the storage implementation:

```ts
console.log(client.db.accountsSummary());
console.log(client.db.listAccounts({ eligibleOnly: true }));

client.db.setAccountProxy("collector-one", "socks5://127.0.0.1:1080");
await client.db.repairAccount("collector-one", true);
client.db.resetAccountCooldowns(["collector-one"], true);
client.db.clearLeases(true);
client.db.resetDailyCounters();

console.log(client.db.lastRun());
console.log(client.db.runsSummary());
client.db.clearAllCheckpoints();
```

Account listings are redacted by default. `importAccounts()` accepts the same inline and file inputs
as client provisioning. `deleteAccount(username)` deletes only the named row.
`collapseDuplicateAccounts()` reports what it would remove; pass `false` only when you explicitly
want to merge and delete duplicate token rows.

## Protect credentials and collected data

Treat the following as sensitive:

- `auth_token`, `ct0`, bearer overrides, and complete cookie jars
- SQLite state files containing provisioned account records
- Proxy URLs containing usernames or passwords
- Collected output that may contain personal data

Follow these rules:

1. Keep secrets in environment variables or a caller-owned secret store.
2. Never commit `.env` files, account files, SQLite databases, or real response fixtures.
3. Use dedicated accounts that you own or are explicitly authorized to operate.
4. Restrict filesystem permissions and retention for state and output files.
5. Keep even redacted diagnostics and `inspect()` output within trusted operational tooling.
6. Collect only what you need and follow platform terms and applicable law.

XTrawl sends read-only HTTP requests. Its transport does not implement posting, replying, liking,
following, messaging, or account-administration operations.

## Troubleshoot common problems

### No eligible account is available

Check that at least one account has both usable `auth_token` and `ct0` values. The account may also be
leased, cooling down, marked unusable, or over a configured daily guard. Use `client.inspect()` in a
trusted local process to review account status.

### Authentication fails

Refresh both browser session cookies and use a fresh state database or deliberately reset the stored
account state before provisioning them again. Confirm they came from the same authorized session.
Authentication failures mark the stored account unusable.

### Search returns no posts

Start with a simpler query, remove restrictive filters, and use `displayType: "Latest"`. An empty page
can also mean the active account cannot view the requested content.

### A run stops early

Review `limit`, `perProfileLimit`, `maxPagesPerProfile`, and `maxEmptyPages`. The endpoint may also
have returned no next cursor. Enable `resume` before long runs so interrupted pagination can continue.

### An endpoint suddenly fails

XTrawl retries once with an authenticated manifest refresh after HTTP 404 or 422. If the retry also
fails, the endpoint path, variables, or response shape may have changed and code changes may be
required.

### The CLI treats a global option as a command option

Move global options before the command:

```bash
# Correct
xtrawl --db-path ./state/xtrawl.db search "typescript" --limit 20
```

## Know the limitations

- XTrawl collects only content visible to the authenticated session. It does not bypass protected or
  private accounts.
- The project depends on undocumented X web GraphQL endpoints, response shapes, and query IDs. They
  can change without notice.
- Browser cookies expire and may be invalidated by account security events.
- Local cooldowns, delays, and usage guards cannot guarantee account availability or uninterrupted
  collection.
- Pagination completeness depends on the cursors and records returned by the platform.
- Live integration tests require caller-supplied credentials and do not run in the default test gate.

For the behavioral contract, architecture boundaries, and security decisions, read the
[product specification](docs/product/specification.md),
[architecture overview](docs/architecture/overview.md), and
[security and data boundary](docs/security/data-boundary.md).
