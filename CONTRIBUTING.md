# Contributing to XTrawl

Thanks for helping improve XTrawl. Contributions should keep the project focused on authenticated,
read-only collection of public X data.

## Before you start

- Search existing issues and pull requests before opening a duplicate.
- Open an issue before making a large architectural or public API change.
- Do not add posting, liking, following, messaging, account administration, or other mutation
  capabilities.
- Never commit real cookies, tokens, passwords, account lists, proxy credentials, databases, output
  files, or captured responses containing private data.
- Use only accounts and systems you own or are authorized to test.

## Development setup

XTrawl requires Node.js 22.5 or newer and npm.

```bash
git clone https://github.com/ensp1re/xtrawl.git
cd xtrawl
npm ci
npm run check
```

The pre-commit hook runs linting and a TypeScript build. Before opening a pull request, run the full
gate:

```bash
npm run verify
```

Live integration tests are disabled by default and are not required for ordinary contributions. If
you run them, provide credentials through environment variables and never paste their values into an
issue, pull request, test fixture, log, or screenshot.

## Making a change

1. Create a focused branch from `main`.
2. Keep each file and pull request focused on one responsibility.
3. Add or update deterministic tests for behavior changes.
4. Update public documentation when commands, options, return types, or limitations change.
5. Run `npm run verify` and review the full diff for credentials and generated artifacts.

Use Conventional Commit subjects such as `feat: add profile filter`, `fix: stop empty-page loops`, or
`docs: explain account loading`.

## Pull requests

Explain the problem, the chosen solution, and the exact verification you ran. Include compatibility
or security implications when relevant. Maintainers may ask to split unrelated changes or revise an
API before merging.

By submitting a contribution, you agree that it is licensed under the repository's
[MIT License](LICENSE).
