# Product specification

**Status:** approved for implementation  
**Owner:** project user  
**Last reviewed:** 2026-08-11

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
3. Resolve user profiles, fetch profile timelines, and collect followers/following with cursor pagination.
4. Reuse local SQLite state after restart, including account cooldowns, leases, run history, and resume cursors.
5. Run the CLI or library with deterministic typed errors and no mutation of the remote account.

## First-release scope

- Read-only search, user lookup, profile timelines, followers, following, and verified-followers endpoints.
- Cookie authentication using `auth_token` plus CSRF cookie, with token-only bootstrap when the platform supplies the CSRF cookie.
- Per-account leases, daily request/tweet counters, cooldown classification, retry/backoff, and bounded concurrency.
- Local SQLite state, resumable cursors, CSV/JSON output, structured CLI, and async library methods.
- Local manifest fallback and optional live manifest refresh for rotating GraphQL identifiers.
- Strict TypeScript interfaces, runtime guards at external boundaries, and test doubles for all network paths.

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
- [ ] A profile lookup and bounded search can be completed with a valid authorized session; the live suite remains opt-in and was not run in this verification pass.
- [x] Harness structural validation and context-budget evaluation pass.
- [x] A fresh agent can identify the current work and next action from `.harness/state/` without chat history.

## Open decisions

- The built-in Node SQLite API is the first-release persistence adapter; a portable driver can be added only if supported-runtime evidence requires it.
- Async methods are the canonical library surface. A blocking synchronous wrapper is intentionally excluded because it would compromise Node event-loop safety.

## Immediate next action

Review the standalone project and, when network credentials are intentionally available, run the opt-in live integration suite.
