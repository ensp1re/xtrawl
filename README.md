# XTrawl

Strictly typed TypeScript scraper and crawler for read-only collection of public X data through the
web GraphQL surface. It supports authenticated cookie sessions, account pooling, cooldowns,
resumable cursors, profile and relationship collection, search filters, and CSV/JSON output.

## Requirements

- Node.js 22.5 or newer (the local state layer uses the built-in `node:sqlite` module)
- npm

## Install and verify

```bash
npm install
npm run verify
```

## Library example

```ts
import { XTrawl } from "xtrawl";

const client = new XTrawl({
  cookies: { authToken: process.env.X_AUTH_TOKEN!, csrfToken: process.env.X_CSRF_TOKEN! },
});

const profiles = await client.getUserInfo(["OpenAI"]);
console.log(profiles);
```

## CLI example

```bash
X_AUTH_TOKEN=... X_CSRF_TOKEN=... \
  npm run cli -- user-info OpenAI --pretty
```

The client only performs read operations. It does not post, follow, like, message, or alter account
settings. Use dedicated, authorized accounts and obey the platform's terms and applicable law.

## Project map

| Area | Location |
| --- | --- |
| Public API | `src/client/`, `src/index.ts` |
| Typed domain contracts | `src/domain/` |
| Cookie/account loading | `src/auth/` |
| SQLite state | `src/storage/` |
| HTTP and sessions | `src/transport/` |
| GraphQL parsing | `src/engine/` |
| Query construction | `src/query/` |
| Account leases and limits | `src/pool/` |
| CLI | `src/cli/` |
| Harness state | `.harness/` |

## Configuration

See `src/config/types.ts` and `docs/product/specification.md` for the supported options. Never put
real credentials in source, fixtures, handoffs, or documentation.
