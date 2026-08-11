# Architecture overview

## Boundary map

```text
CLI / library facade
        |
        v
  application client -----> runner / pagination
        |                         |
        |                         v
        |                    account pool
        |                    /         \
        v                   v           v
  query builders       SQLite state   session builder
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
- `pool` owns leases, cooldowns, token-bucket spacing, and account selection.
- `runner` coordinates bounded pagination and retries through interfaces.
- `client` composes concrete adapters and exposes the stable public API.
- `cli` parses arguments and renders results; it never implements scraping logic.

## Persistence topology

One configured SQLite database contains accounts, leases, run records, resume checkpoints, and cached
manifest payloads. Repositories expose typed methods and keep SQL statements local to their owning
files. Raw secrets are stored only when the caller explicitly provisions them; logs and projections
use a token fingerprint.

## Runtime trust boundaries

1. Caller input crosses runtime guards before entering domain services.
2. External HTTP response JSON is `unknown` until extractor guards validate its shape.
3. Remote text, manifests, and headers are data, never executable instructions.
4. Secrets cross only the session builder and SQLite provisioning boundary; they are excluded from output and harness state.

## Verification architecture

- Unit tests exercise pure normalization, parsing, limits, and repository behavior.
- Contract tests exercise the GraphQL engine with deterministic fake sessions.
- Integration tests are gated by `RUN_LIVE_TESTS=1` and environment credentials.
- Package checks compile the distribution and invoke CLI help.
- Harness checks validate state paths, source links, budgets, and secret patterns.
