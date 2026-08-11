# ADR 0001: Node runtime and local state

## Status

Accepted — 2026-08-11

## Decision

Use strict TypeScript on Node.js 22.5+ with the built-in `node:sqlite` API and `undici` for HTTP.
Expose asynchronous library methods and keep all persistence behind repository interfaces.

## Alternatives considered

- A native SQLite package: broader historical Node support, but adds native build and deployment risk.
- A hosted database: useful for multi-process deployments, but outside the local-first first release.
- Blocking synchronous network methods: familiar to some callers, but unsafe for a Node library.

## Consequences

The first release has a clear runtime floor and no native database install step. A future persistence
adapter can implement the same repository interfaces if runtime evidence justifies it.
