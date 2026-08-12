# ADR 0003: Caller-owned account state

## Status

Accepted — 2026-08-12

## Decision

Expose an `AccountStateStore` contract whose methods may return direct values or promises. Keep the
SQLite implementation as the default, but allow applications using `await XTrawl.create()` to own
account credentials, health, counters, cooldowns, and leases in another persistence system.

Lease acquisition, renewal, completion, and whole-store replacement are explicit store operations.
Acquisition and completion atomically combine selection, ownership, accounting, and health changes
so concurrent workers cannot intentionally share an account or lose request usage updates.

Expose a versioned session-state snapshot through `client.accounts.exportState()` and
`restoreState()`. Raw export requires `includeSecrets: true`. Snapshots contain reusable cookies and
tokens plus operational state, but omit storage IDs, active leases, passwords, email credentials,
and two-factor secrets.

## Alternatives considered

- Export/import only: portable, but it cannot coordinate live leases across application processes.
- A SQLite-specific callback API: small, but it keeps application state coupled to one database.
- Making every client constructor asynchronous: consistent, but unnecessarily breaks the existing
  synchronous SQLite setup. Custom stores therefore require the existing async factory.

## Consequences

Custom adapters have a small but strict atomicity contract. SQLite continues to hold run history,
pagination checkpoints, and manifest cache even when account state is external. Applications gain
control over secret storage and account lifecycle without changing read-only collection behavior.
