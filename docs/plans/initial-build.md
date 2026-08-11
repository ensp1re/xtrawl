# Initial build plan

## Work items

1. Establish strict contracts and runtime validation.
2. Implement local state schema and typed repositories.
3. Implement credential loaders and session construction.
4. Implement manifest, transaction, query, GraphQL transport, and extractors.
5. Implement account leasing, cooldowns, retry runner, and cursor checkpoints.
6. Implement outputs, public client, and CLI.
7. Port deterministic behavioral coverage by domain and add opt-in live checks.
8. Run the full delivery gate, inspect the tree, and update the harness handoff. **Complete.**

## Completion evidence

- Build, lint, formatting, unit tests, package smoke test, harness validator, and budget report pass.
- The test suite has no external project names or real credentials.
- The work state records the verification commands and remaining live-test status.
