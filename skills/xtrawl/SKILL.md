---
name: xtrawl
description: Collect public X (Twitter) data read-only with the xtrawl TypeScript library or CLI - search posts, fetch one post, profile timelines, followers, following, verified followers, and profile info; set up session cookies, account pools, proxies, resume, and CSV/JSON output. Use when the user wants to scrape, collect, export, or analyze X/Twitter posts or profiles, or integrate xtrawl into code.
---

# XTrawl

XTrawl is an authenticated, read-only collector for public X data. It runs as a Node.js CLI
(`xtrawl`) or as an ESM TypeScript library (`import { XTrawl } from "xtrawl"`). It never posts,
likes, follows, or messages, and you must not try to make it do so.

## Runtime

- Node.js 22.5 or newer.
- CLI without installing: `npx xtrawl@0.1.4 <command> ...`. Library: `npm install xtrawl@0.1.4`.
- Pin the version shown here, not the `latest` tag: this skill documents 0.1.4.
- Inside an xtrawl source checkout, use `npm run cli -- <command> ...` instead.

## Safety rules (always)

1. Live requests need the `auth_token` and `ct0` cookies of an X session the user owns or is
   authorized to use. Ask the user to provide them; never invent them.
2. Keep credentials in environment variables (`X_AUTH_TOKEN`, `X_CSRF_TOKEN`), a git-ignored env
   file, or a git-ignored accounts file. Never print them, echo them back, put them in command
   history you show, write them into source code, or commit them.
3. Before the first live run, tell the user once: automated collection can get the account
   restricted or permanently banned; XTrawl is for education and research.
4. Collect only what the task needs. Start with a small `limit` (20–100) and raise it after the
   first run works.
5. Never commit `*.db` state files, `.env*` files, account files, or collected output.

## Pick the operation

| User wants | TypeScript method | CLI command |
| --- | --- | --- |
| Posts matching a query or filters | `client.search(query, options)` | `search "query" --limit N` |
| One page of search results with your own cursor | `client.searchPage(query, { cursor })` | (API only) |
| Iterate search pages | `for await (const page of client.searchPages(query, opts))` | (API only) |
| One post by ID or status URL | `client.getTweet(idOrUrl)` | `tweet ID_OR_URL ...` |
| Posts from profile timelines | `client.getProfileTweets(users, options)` | `profile-tweets USER ...` |
| Followers / following / verified followers | `getFollowers` / `getFollowing` / `getVerifiedFollowers` | `followers` / `following` / `verified-followers USER ...` |
| Profile details | `client.getUserInfo(users, options)` | `user-info USER ...` |

Targets (users) may be `name`, `@name`, `https://x.com/name`, or `{ username }`/`{ userId }`
objects. Timeline and relationship methods also accept numeric user IDs.

Choose the CLI for one-off exports. Choose the library when the user is writing an app, needs
custom storage, or wants to process records in code.

## TypeScript

```ts
import { AuthError, RateLimitError, XTrawl } from "xtrawl";

const client = await XTrawl.create({
  authToken: process.env.X_AUTH_TOKEN,
  csrfToken: process.env.X_CSRF_TOKEN,
  dbPath: "./state/xtrawl.db",
});

try {
  const result = await client.search("typescript", {
    since: "2026-08-01",
    until: "2026-08-15",
    fromUsers: ["github"],
    minLikes: 10,
    displayType: "Latest",
    limit: 100,
    resume: true,
  });
  console.log(result.tweets.length, result.stats);
} catch (error) {
  if (error instanceof AuthError) console.error("Session cookies were rejected; refresh them.");
  else if (error instanceof RateLimitError) console.error("Rate limited; try again later.");
  else throw error;
} finally {
  await client.shutdown();
}
```

- Prefer `await XTrawl.create()` over `new XTrawl()`: it can fetch a missing `ct0` cookie, and it
  is required when passing a custom `accountStore`.
- Always end with `await client.shutdown()` (waits for in-flight work) or `client.close()`.
- If `X_AUTH_TOKEN` / `X_CSRF_TOKEN` are set, `authToken`/`csrfToken` can be omitted.
- Without `since`/`until`, search covers the previous 30 days.
- `searchPage()` does not save files, split dates, or touch checkpoints. Store its `nextCursor`
  as an opaque string and send it back with the same query and filters; stop when it is
  `undefined`.

Full option, return-type, and facade reference: [references/api.md](references/api.md).

## CLI

```text
npx xtrawl@0.1.4 [global options] COMMAND [values] [command options]
```

Rules that cause most failures:

- Global options (`--env-file`, `--cookies-file`, `--auth-token`, `--csrf-token`, `--db-path`,
  `--proxy`, `--concurrency`, `--manifest-scrape-on-init`, `-v`) go **before** the command.
  After the command they fail with `Unknown command option`.
- Without `--pretty` or `--save`, the CLI prints nothing to stdout. Use `--pretty` to read the
  result, `--save` to write files.
- List options take several values or repeat: `--from OpenAI github` or `--from OpenAI --from github`.
- Exit code `2` means a usage error (message plus help on stderr); `1` means the run failed.

```bash
# Credentials from a git-ignored env file (X_AUTH_TOKEN=..., X_CSRF_TOKEN=...)
npx xtrawl@0.1.4 --env-file .env.local user-info OpenAI github --pretty

npx xtrawl@0.1.4 --env-file .env.local search "release" \
  --from OpenAI --since 2026-08-01 --until 2026-08-15 \
  --display-type Latest --limit 100 --save --save-format both --save-dir ./exports

npx xtrawl@0.1.4 --env-file .env.local tweet https://x.com/OpenAI/status/1234567890 --pretty

npx xtrawl@0.1.4 --cookies-file ./accounts.json --db-path ./state/xtrawl.db \
  followers OpenAI --limit 500 --resume --save --save-format json
```

Full flag tables: [references/cli.md](references/cli.md).

## Accounts, proxies, state

- **Account pool.** Put many sessions in a git-ignored JSON file and pass
  `--cookies-file ./accounts.json` or `accountsFile`. The file holds one object or an array of
  `{ "username", "authToken", "csrfToken", "proxy"? }`, or
  `{ "username", "cookies": { "auth_token", "ct0" } }`. XTrawl rotates accounts per page and puts
  rate-limited accounts into cooldown.
- **Proxy.** `--proxy URL` or `proxy` sets one for all accounts. An account's own `proxy` wins.
  HTTP, HTTPS, and SOCKS5 URLs are supported.
- **State.** SQLite at `dbPath` (default `xtrawl_state.db` in the current directory) holds
  accounts, run history, resume checkpoints, and the manifest cache. Reuse the same `dbPath` to
  resume.
- **Resume.** `resume: true` / `--resume` continues from the saved cursor. A completed run clears
  its checkpoint.
- **Output.** `save: true` / `--save` writes files to `outputs/` by default. Formats are `csv`
  (the default), `json`, `both`, and `ndjson`. Existing files are appended to, not replaced.
- **Account health.** Inspect with `await client.accounts.summary()` and
  `await client.accounts.list({ eligibleOnly: true })`; listings are redacted. Repair a session
  with `await client.accounts.repair(username, true)`.

## Errors and what to do

Check the specific classes before their parents. `AuthError`, `RateLimitError`, `NetworkError`,
and `ProxyError` all extend `RunFailed`, which extends `EngineError`. Every error extends
`XTrawlError`, which has `code` and `diagnostics`.

| Error / symptom | Meaning | Action |
| --- | --- | --- |
| `AuthError`, or 401 in the message | Cookies rejected; account marked unusable | Ask the user for fresh `auth_token` + `ct0` from the same browser session |
| `AccountPoolExhausted` | No eligible account: missing cookies, cooling down, unusable, or daily guard reached | Check `client.accounts.summary()`; wait, add accounts, or fix cookies |
| `RateLimitError` | X rate limit | Wait and retry later with a smaller `limit`; do not loop quickly |
| `ProxyError` / `NetworkError` | Proxy or connection failed | Verify the proxy URL; retry once |
| `ManifestError`, or repeated 404/422 | X changed operation IDs | Retry with `--manifest-scrape-on-init` / `manifestScrapeOnInit: true` |
| `ConfigError` | Invalid option, e.g. `apiPageSize` > 100 or a non-numeric tweet ID | Fix the input |
| `ResumeError` | Bad checkpoint state | Rerun without `resume`, or clear it with `client.db.clearAllCheckpoints()` |
| `RunFailed` | Some tasks failed | Read `error.diagnostics`; rerun with `--resume` |
| Empty results | Filters too strict, or the account cannot view the content | Simplify the query, use `displayType: "Latest"`, widen dates |

Retry at most 3 times in total, then stop and report the error message (never the credentials) to
the user.

## Install this skill

```bash
npx skills add ensp1re/xtrawl --skill xtrawl --yes --agent claude-code
npx skills add ensp1re/xtrawl --skill xtrawl --yes --agent cursor
npx skills add ensp1re/xtrawl --skill xtrawl --yes --agent codex
npx skills add ensp1re/xtrawl --skill xtrawl --yes --agent opencode
npx skills add ensp1re/xtrawl --skill xtrawl --yes --agent github-copilot
npx skills add ensp1re/xtrawl --skill xtrawl --yes --agent gemini-cli
npx skills add ensp1re/xtrawl --skill xtrawl --yes --agent grok
npx skills add ensp1re/xtrawl --skill xtrawl --yes --agent windsurf
```

- Add `-g` to install for the user instead of the project.
- Update with `npx skills update xtrawl --yes`. Remove with `npx skills remove xtrawl --yes`.
- Without the installer, copy the folder from a clone of `ensp1re/xtrawl`:
  `cp -R skills/xtrawl .claude/skills/xtrawl` (Claude Code), or `.agents/skills/xtrawl` (Cursor, Codex,
  OpenCode, Copilot, Gemini CLI).
