# Security and data boundary

## Secret handling

- Session tokens, CSRF values, passwords, email passwords, and OTP seeds are caller-owned secrets.
- They may be read from process environment, caller-provided files, or in-memory arguments only.
- They must not appear in Git, test fixtures, JSON snapshots, logs, CLI output, harness state, or handoffs.
- Diagnostics may include a stable non-reversible fingerprint and a reason code, never the secret value.

## Network boundary

- The client sends only read-oriented GraphQL GET requests and an optional home-page bootstrap request.
- The client does not expose mutation operations.
- Proxies are normalized and passed to the HTTP adapter; proxy URLs are never emitted in diagnostics.
- External payloads are parsed as `unknown` and narrowed before use.

## Local state

- SQLite is scoped to the configured path and can be deleted by the caller.
- Raw response payloads are returned only when the caller requests them; operational state stores compact metadata.
- Output paths are caller-controlled but must remain explicit; no recursive deletion is performed by the package.

## Verification

The harness scans durable project state for common secret patterns. Live tests use process environment
variables and are skipped by default.
