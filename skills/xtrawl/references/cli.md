# XTrawl CLI reference (0.1.4)

```text
npx xtrawl@0.1.4 [global options] COMMAND [values] [command options]
```

- **stdout.** Results are printed only with `--pretty`; otherwise nothing goes to stdout. Use
  `--save` for files.
- **Exit codes.** `0` means success, `1` means the run failed (the message is on stderr, with
  secrets redacted), and `2` means a usage error.
- **Help.** Run `npx xtrawl@0.1.4 --help`, or run with no command.

## Commands

| Command | Values | Output |
| --- | --- | --- |
| `search` | optional query string | `{ tweets, stats }` |
| `tweet` | one or more post IDs or `https://x.com/USER/status/ID` URLs | array of post records |
| `profile-tweets` | one or more users | `{ tweets, stats }` |
| `followers` | one or more users | relationship records |
| `following` | one or more users | relationship records |
| `verified-followers` | one or more users | relationship records |
| `user-info` | one or more users | profile records |

A user can be `name`, `@name`, a profile URL, or (for timelines and relationships) a numeric ID.

## Global options (before the command)

| Option | Value | Purpose |
| --- | --- | --- |
| `--auth-token` | token | One account's `auth_token` (prefer the env var; flags show up in shell history) |
| `--csrf-token`, `--ct0` | token | One account's `ct0` |
| `--cookies-file` | path | JSON, Netscape, or delimited account/cookie file |
| `--env-file` | path | Dotenv file with `X_AUTH_TOKEN` and `X_CSRF_TOKEN` |
| `--db-path` | path | SQLite state file (default `xtrawl_state.db`) |
| `--proxy` | URL | Default HTTP(S) or SOCKS5 proxy |
| `--concurrency` | positive integer | Worker count (default 5) |
| `--manifest-scrape-on-init` | flag | Refresh X operation IDs before the first request |
| `--verbose`, `-v` | flag | Pool diagnostics and full stacks on stderr |
| `--help` | flag | Print help |

With no credential flags, the process environment `X_AUTH_TOKEN` / `X_CSRF_TOKEN` is used.

## Search options

| Option | Kind | Maps to |
| --- | --- | --- |
| `--since`, `--until` | value | date bounds (default: last 30 days) |
| `--from`, `--to`, `--mention` | list | `fromUsers`, `toUsers`, `mentioningUsers` |
| `--all-words`, `--any-words`, `--exact-phrases`, `--exclude-words` | list | word filters |
| `--hashtags-any`, `--hashtags-exclude` | list | hashtag filters |
| `--lang`, `--place`, `--geocode`, `--near`, `--within` | value | language and location |
| `--display-type` | `Top` or `Latest` | timeline mode |
| `--tweet-type` | `all`, `originals_only`, `replies_only`, `retweets_only`, `exclude_replies`, `exclude_retweets` | post type |
| `--verified-only`, `--blue-verified-only` | flag | author verification |
| `--has-images`, `--has-videos`, `--has-links`, `--has-mentions`, `--has-hashtags` | flag | content filters |
| `--min-likes`, `--min-replies`, `--min-retweets` | non-negative integer | engagement |
| `--limit`, `--max-empty-pages` | positive integer | stop conditions |
| `--resume`, `--save`, `--save-format`, `--save-dir`, `--save-name` | see below | state and output |

List options accept several values (`--from a b`) or repeats (`--from a --from b`).

## Collection options

These apply to `profile-tweets`, `followers`, `following`, `verified-followers`. `user-info`
accepts the `--save*` options.

| Option | Purpose |
| --- | --- |
| `--limit N` | Cap all returned records |
| `--per-profile-limit N` | Cap records per target |
| `--max-pages-per-profile N` | Cap pages per target |
| `--max-empty-pages N` | Stop a target after N empty pages |
| `--resume` | Continue from the SQLite checkpoint for the same request |
| `--save` | Write output files |
| `--save-format csv\|json\|both\|ndjson` | File format (default `csv`) |
| `--save-dir PATH` | Output directory (default `outputs`) |
| `--save-name NAME` | File name without extension |
| `--raw-json` | Keep raw user payloads in relationship JSON |
| `--pretty` | Print indented JSON to stdout (all commands) |

## Common errors

| Message | Fix |
| --- | --- |
| `Unknown command option: --env-file` (or another global) | Move the global option before the command |
| `node: .env.local: not found` (exit 9) | Node itself reads `--env-file`; create the file or fix the path |
| `Unknown command: ...` | Use one of the seven commands above |
| `tweet requires at least one post ID or status URL` | Pass an ID or status URL |
| `--limit must be a positive integer` | Use an integer ≥ 1 |
| `No eligible account is available.` | Cookies missing, expired, cooling down, or over the daily guard |
