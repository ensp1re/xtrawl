# Product specification

**Status:** approved for implementation  
**Owner:** project user  
**Last reviewed:** 2026-08-12

## Product hypothesis

Developers need a maintainable TypeScript client that can collect publicly visible X data through
the web GraphQL surface using authorized browser-session cookies, while limiting account pressure,
persisting progress locally, and exposing predictable typed results.

## Users and outcomes

| User | Problem | Successful outcome |
| --- | --- | --- |
| TypeScript developer | Existing clients are difficult to type, test, and extend | Import a small typed API and receive stable records |
| Data operator | Long reads fail when a session is cooled or a process stops | Pool accounts, retry safely, and resume from checkpoints |
| Maintainer | Transport, persistence, and domain behavior become coupled | Each boundary is replaceable and covered by focused tests |

## Principal journeys

1. Provision one or more accounts from cookies, a JSON file, a dotenv file, or a delimited account file.
2. Search public posts with structured filters, explicit date bounds, a result limit, and optional output persistence.
3. Resolve individual posts and user profiles, fetch profile timelines, and collect followers/following with cursor pagination.
4. Reuse local SQLite state after restart, including account cooldowns, leases, run history, and resume cursors.
5. Run the CLI or library with deterministic typed errors and no mutation of the remote account.
6. Replace SQLite account persistence with a caller-owned store and explicitly export or restore
   reusable session state without restoring stale leases or login-only credentials.
7. Request one search page with an optional caller-owned cursor so an application can persist and
   resume pagination independently of XTrawl checkpoints.

## First-release scope

- Read-only search, single-post lookup, user lookup, profile timelines, followers, following, and verified-followers endpoints.
- Cookie authentication using `auth_token` plus CSRF cookie, with token-only bootstrap when the platform supplies the CSRF cookie.
- Per-page account leases with heartbeat, accurate request/tweet counters, cooldown classification,
  retry/backoff, account switching, and bounded concurrency.
- Default 30-day search bounds, concurrent interval splitting, URL/handle/user-ID normalization, and
  no-progress pagination stops.
- Local SQLite state, resumable cursors, CSV/JSON output, structured CLI, and async library methods.
- Local manifest fallback and optional live manifest refresh for rotating GraphQL identifiers.
- Optional transaction-header generation, HTTP/HTTPS/SOCKS5 proxies with preflight checks, appendable
  descriptive outputs, and redacted local-state maintenance APIs.
- Strict TypeScript interfaces, runtime guards at external boundaries, and test doubles for all network paths.
- A pluggable sync-or-async account-state contract with atomic lease operations; SQLite remains the
  default adapter while run history, checkpoints, and manifest cache remain local.
- A low-level `searchPage()` method that supports the full search-filter vocabulary and returns
  normalized posts plus an opaque `nextCursor`; high-level `search()` remains automatic.

## Explicit exclusions

- Posting, replying, liking, following, messaging, account settings, or any other remote mutation.
- Credential discovery, password guessing, session theft, or bypassing access controls.
- Private/protected content access.
- Cloud storage, hosted queues, telemetry, global agent memory, or an always-on daemon.
- Real credentials in source, tests, fixtures, logs, or harness state.

## Data and trust

- Data classes: public profile/post/relationship records; caller-owned session secrets; local operational metadata.
- Authentication: caller supplies browser-session cookies or a caller-owned credential source.
- Authorization: caller is responsible for account ownership and platform authorization; the client performs read-only requests.
- Tenancy: single local project instance; account rows are isolated by stable username/token fingerprint.
- Destructive actions: no remote destructive actions; local state deletion is explicit and scoped to the configured database.
- Privacy/compliance: minimize collected fields, avoid raw payload persistence unless requested, and follow applicable platform terms and law.

## Runtime and operations

- Surfaces: TypeScript library and command-line interface.
- Platforms: Node.js 22.5+ on macOS, Linux, and Windows where built-in SQLite is available.
- Local/offline/cloud: local-first; network is required only for live collection and optional manifest refresh.
- Scale and latency: bounded by configured concurrency, per-account daily limits, and platform responses.
- Availability/recovery: restart-safe SQLite state, cooldowns, cursor checkpoints, and deterministic output files.
- Cost boundary: no service dependency; caller controls network/proxy costs.
- Integrations: X web GraphQL endpoints, HTTP proxies, filesystem outputs, and environment variables.

## Acceptance criteria

- [x] `npm run build` passes with strict compiler options and no implicit `any`.
- [x] All deterministic behavioral areas are covered: config, loaders, query construction, persistence, pooling, cooldowns, manifest, transport, parsing, runners, outputs, CLI, and client routing.
- [x] The compiled CLI help and package smoke check run without credentials.
- [x] Live tests are opt-in, use caller-supplied secrets only, perform read-only requests, and do not write secrets to the repository.
- [x] A profile lookup, bounded search, profile timeline, single-post lookup, and all relationship operations complete with a valid authorized session in the opt-in live suite.
- [x] Harness structural validation and context-budget evaluation pass.
- [x] A fresh agent can identify the current work and next action from `.harness/state/` without chat history.
- [x] A caller-owned asynchronous account store can provision, lease, complete, export, and restore
  account state through the public API, with deterministic contract tests.
- [x] A caller can pass a search cursor, receive the next cursor, and paginate without creating run
  records or reading and writing the internal checkpoint store.

## Open decisions

- The built-in Node SQLite API is the first-release persistence adapter; a portable driver can be added only if supported-runtime evidence requires it.
- Async methods are the canonical library surface. A blocking synchronous wrapper is intentionally excluded because it would compromise Node event-loop safety.
- Account-state snapshots require an explicit secret acknowledgement, are runtime validated and
  versioned, and exclude active leases plus password, email-password, and two-factor login fields.
- `searchPage()` exposes normalized posts and only the opaque next cursor. Query metadata and
  persistence remain caller-owned; `search()` composes the same page primitive for automatic runs.

## Immediate next action

Add the read-only MCP server for agent-harness operation while keeping credentials out of tool
results and preserving the existing account-pool limits.
