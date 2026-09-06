# Security and data boundary

## Secret handling

- Session tokens, CSRF values, passwords, email passwords, and OTP seeds are caller-owned secrets.
- They may be read from process environment, caller-provided files, or in-memory arguments only.
- They must not appear in Git, test fixtures, logs, CLI output, harness state, or handoffs.
- `client.accounts.exportState({ includeSecrets: true })` is an explicit exception: it returns a
  versioned caller-owned snapshot containing reusable session secrets. The caller must protect it as
  credentials and must not log or commit it.
- Diagnostics may include a stable non-reversible fingerprint and a reason code, never the secret value.

## Network boundary

- The client sends only read-oriented GraphQL query requests over GET or POST and an optional home-page bootstrap request.
- The client does not expose mutation operations.
- HTTP, HTTPS, and SOCKS5 proxies are normalized and passed to the HTTP adapter. Health checks carry
  no session cookies, and proxy credentials are redacted from inspection and diagnostics.
- External payloads are parsed as `unknown` and narrowed before use.
- Remote manifests are untrusted. GraphQL endpoints must be HTTPS on an allowed X origin and a
  read-only GraphQL path before session cookies, CSRF, or bearer tokens are attached. Authenticated
  requests do not follow redirects. Tests may add synthetic origins through `allowedManifestOrigins`.

## Local state

- SQLite is scoped to the configured path and can be deleted by the caller. Applications may move
  account records and lease coordination to a caller-owned `AccountStateStore`; run history,
  checkpoints, and manifest cache remain in SQLite.
- State restore validates unknown input, never restores active lease IDs, and excludes passwords,
  email credentials, and two-factor secrets from the snapshot format.
- Raw response payloads are returned only when the caller requests them; operational state stores compact metadata.
- Output paths are caller-controlled but must remain explicit; no recursive deletion is performed by the package.

## Verification

The harness scans durable project state for common secret patterns. Live tests use process environment
variables and are skipped by default.
