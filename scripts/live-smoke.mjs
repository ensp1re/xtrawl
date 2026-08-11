import { XTrawl } from "../dist/index.js";

const HELP = `Run every XTrawl read endpoint against production and print complete responses.

Required environment variables:
  X_AUTH_TOKEN             authenticated X auth_token cookie
  X_CSRF_TOKEN             matching X ct0 cookie

Optional environment variables:
  XTRAWL_SMOKE_TARGET      public username or profile URL (default: OpenAI)
  XTRAWL_SMOKE_QUERY       search query (default: typescript)
  XTRAWL_SMOKE_TWEET_ID    tweet ID used if timeline/search returns no tweet
  XTRAWL_PROXY or X_PROXY  HTTP(S) or SOCKS5 proxy URL
  XTRAWL_REFRESH_MANIFEST  set to 1 to refresh operation IDs before requests

Usage:
  npm run smoke:live
`;

if (process.argv.includes("--help")) {
  console.log(HELP);
  process.exit(0);
}

const authToken = process.env.X_AUTH_TOKEN;
const csrfToken = process.env.X_CSRF_TOKEN;
if (!authToken || !csrfToken) {
  console.error("Missing X_AUTH_TOKEN or X_CSRF_TOKEN.\n");
  console.error(HELP);
  process.exit(2);
}

const target = process.env.XTRAWL_SMOKE_TARGET?.trim() || "OpenAI";
const query = process.env.XTRAWL_SMOKE_QUERY?.trim() || "typescript";
const configuredTweetId = process.env.XTRAWL_SMOKE_TWEET_ID?.trim();
const proxy = process.env.XTRAWL_PROXY ?? process.env.X_PROXY;
const failures = [];
const results = new Map();

const client = await XTrawl.create({
  dbPath: ":memory:",
  authToken,
  csrfToken,
  strict: true,
  ...(proxy ? { proxy } : {}),
  manifestScrapeOnInit: process.env.XTRAWL_REFRESH_MANIFEST === "1",
});

try {
  await run("user-info", () => client.getUserInfo([target]));
  await run("search", () =>
    client.search(query, {
      displayType: "Latest",
      limit: 2,
      maxEmptyPages: 1,
    }),
  );
  await run("profile-tweets", () =>
    client.getProfileTweets([target], {
      limit: 2,
      perProfileLimit: 2,
      maxPagesPerProfile: 1,
      maxEmptyPages: 1,
    }),
  );

  const tweetId =
    configuredTweetId ??
    results.get("profile-tweets")?.tweets?.[0]?.tweetId ??
    results.get("search")?.tweets?.[0]?.tweetId;
  await run("tweet", async () => {
    if (!tweetId)
      throw new Error("No tweet ID was returned by profile-tweets or search. Set XTRAWL_SMOKE_TWEET_ID.");
    return client.getTweet(tweetId);
  });

  const relationshipOptions = {
    limit: 2,
    perProfileLimit: 2,
    maxPagesPerProfile: 1,
    maxEmptyPages: 1,
    rawJson: true,
  };
  await run("followers", () => client.getFollowers([target], relationshipOptions));
  await run("following", () => client.getFollowing([target], relationshipOptions));
  await run("verified-followers", () => client.getVerifiedFollowers([target], relationshipOptions));

  print("summary", {
    ok: failures.length === 0,
    target,
    query,
    endpointsPassed: results.size,
    endpointsFailed: failures.length,
    failures,
    accountPool: client.poolSummary,
  });
} finally {
  client.close();
}

if (failures.length > 0) process.exitCode = 1;

async function run(endpoint, operation) {
  const startedAt = Date.now();
  try {
    const data = await operation();
    results.set(endpoint, data);
    print(endpoint, { ok: true, durationMs: Date.now() - startedAt, data });
  } catch (error) {
    const failure = {
      endpoint,
      durationMs: Date.now() - startedAt,
      error: serializeError(error),
    };
    failures.push(failure);
    print(endpoint, { ok: false, ...failure });
  }
}

function print(section, value) {
  console.log(`\n===== ${section} =====`);
  console.log(JSON.stringify(value, null, 2));
}

function serializeError(error) {
  if (!(error instanceof Error)) return { message: String(error) };
  return {
    name: error.name,
    message: error.message,
    ...(typeof error.code === "string" ? { code: error.code } : {}),
    ...(error.diagnostics && typeof error.diagnostics === "object" ? { diagnostics: error.diagnostics } : {}),
    ...(error.stack ? { stack: error.stack } : {}),
  };
}
