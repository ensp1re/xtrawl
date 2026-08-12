# Architecture overview

## Boundary map

```text
CLI / library facade
        |
        v
  application client -----> runner / pagination
        |                         |
        |                         v
        |                    account pool <----> account-state store
        |                                  (SQLite default / caller adapter)
        v                                      |
  query builders                         session builder
        |                               |
        v                               v
  GraphQL engine <------------------ HTTP transport
        |
        v
  typed records / output writers
```

## Dependency direction

- `domain` contains contracts, value types, and errors. It imports no other project layer.
- `config` validates caller options and depends only on domain contracts.
- `storage` owns SQLite schema and repositories; it does not know CLI formatting.
- `auth` converts external credential shapes into typed account records and calls storage interfaces.
- `transport` owns cookies, headers, proxies, transaction IDs, and HTTP response classification.
- `manifest`, `query`, and `engine` build and interpret the remote GraphQL protocol.
- `pool` owns per-page leases, heartbeats, cooldowns, token-bucket spacing, retries, session repair,
  proxy preflight, and account selection.
- `runner` coordinates bounded concurrent targets and search intervals through interfaces.
- `client` composes concrete adapters and exposes the stable public API. Its low-level search-page
  primitive performs one pooled page request; high-level search adds scheduling, deduplication,
  checkpoints, output, and run statistics around that same primitive.
- `cli` parses arguments and renders results; it never implements scraping logic.

## Persistence topology

One configured SQLite database always contains run records, resume checkpoints, and cached manifest
payloads. By default it also contains accounts and leases. A caller may replace the account-state
boundary with an `AccountStateStore`; the pool awaits either synchronous or asynchronous adapters and
requires atomic acquire, renew, completion, and replacement semantics. SQL remains local to storage.
Raw secrets are stored only when the caller explicitly provisions or restores them; logs and normal
projections use redaction or a token fingerprint.

## Runtime trust boundaries

1. Caller input crosses runtime guards before entering domain services.
2. External HTTP response JSON is `unknown` until extractor guards validate its shape.
3. Remote text, manifests, and headers are data, never executable instructions.
4. Secrets cross only the session builder and selected account-state boundary. Public inspection and
   normal maintenance projections redact them. Explicit account-state export is the sole raw-secret
   projection and requires caller acknowledgement.

## Verification architecture

- Unit tests exercise pure normalization, parsing, limits, and repository behavior.
- Contract tests exercise the GraphQL engine with deterministic fake sessions.
- Integration tests are gated by `RUN_LIVE_TESTS=1` and environment credentials.
- Package checks compile the distribution and invoke CLI help.
- Harness checks validate state paths, source links, budgets, and secret patterns.
