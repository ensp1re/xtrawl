# ADR 0002: Domain-sized modules

## Status

Accepted — 2026-08-11

## Decision

Keep authentication, storage, transport, manifest, query, engine, pooling, runner, output, client,
and CLI as separate domains. Files should hold one cohesive responsibility and be split before they
become broad service objects.

## Consequences

Behavioral tests can replace one boundary at a time. The project has more small files than a single
script, but changes remain discoverable and strict interfaces prevent accidental cross-layer coupling.
