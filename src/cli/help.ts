export const HELP = `x-graph-harvester — read-only public graph client

Usage:
  x-graph-harvester [global options] search [query] [options]
  x-graph-harvester [global options] profile-tweets USER [USER ...] [options]
  x-graph-harvester [global options] followers USER [USER ...] [options]
  x-graph-harvester [global options] following USER [USER ...] [options]
  x-graph-harvester [global options] verified-followers USER [USER ...] [options]
  x-graph-harvester [global options] user-info USER [USER ...] [options]

Global options:
  --auth-token TOKEN       session auth cookie
  --csrf-token TOKEN       session CSRF cookie
  --cookies-file PATH      JSON or delimited account source
  --env-file PATH          dotenv account source
  --db-path PATH           SQLite state path
  --proxy URL              HTTP proxy
  --concurrency N          configured worker count
  --manifest-scrape-on-init refresh live operation identifiers
  --verbose                enable verbose diagnostics

Common options:
  --limit N                cap returned records
  --since DATE             lower search bound
  --until DATE             upper search bound
  --save --save-format csv|json|both --save-dir PATH
  --pretty                 print indented JSON
`;
