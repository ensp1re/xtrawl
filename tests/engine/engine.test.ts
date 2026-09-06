import { ApiEngine } from "../../src/engine/api-engine.js";
import {
  extractFollows,
  extractProfileTweets,
  extractSearchTweets,
  extractTweetResult,
  extractUserResult,
  mapProfile,
} from "../../src/engine/extractors.js";
import { ManifestProvider } from "../../src/manifest/provider.js";
import { validateConfig } from "../../src/config/validation.js";
import { openStorage } from "../../src/storage/index.js";
import { GraphqlTransport } from "../../src/transport/graphql.js";
import { TransactionIdProvider } from "../../src/transport/transaction-id.js";
import { DEFAULT_MANIFEST } from "../../src/manifest/default-manifest.js";
import {
  response,
  sessionFactory,
  tweetPayload,
  userPayload,
  profilePayload,
  followsPayload,
  tweetResultPayload,
} from "../helpers/fake-http.js";

describe("GraphQL extraction", () => {
  test("maps tweets, media, user, URL, and cursor", () => {
    const page = extractSearchTweets(tweetPayload());
    expect(page.tweets).toHaveLength(1);
    expect(page.tweets[0]).toMatchObject({
      tweetId: "1",
      text: "hello",
      likes: 3,
      retweets: 2,
      comments: 1,
      tweetUrl: "https://x.com/demo/status/1",
    });
    expect(page.tweets[0]?.media.imageLinks).toEqual(["https://img.test/a.jpg"]);
    expect(page.cursor).toBe("next-cursor");
  });

  test("maps profile and relationship pages", () => {
    const profile = extractProfileTweets(profilePayload());
    expect(profile.tweets).toHaveLength(1);
    expect(extractFollows(followsPayload()).users).toHaveLength(1);
    const user = extractUserResult(userPayload("demo", "u1"));
    expect(user?.rest_id).toBe("u1");
    expect(mapProfile(user!, { raw: "demo", source: "test" }, "demo").followersCount).toBe(10);
  });

  test("maps a single tweet result", () => {
    expect(extractTweetResult(tweetResultPayload())).toMatchObject({
      tweetId: "1",
      text: "hello",
      user: { screenName: "demo" },
    });
  });
});

describe("API engine and transport", () => {
  test("adds transaction ID and builds query requests", async () => {
    const storage = openStorage(":memory:");
    const config = validateConfig({ apiPageSize: 5 });
    const provider = new ManifestProvider(config, storage.manifests);
    const requests: Array<{
      readonly url: string;
      readonly options: { readonly headers?: Record<string, string> };
    }> = [];
    const session = sessionFactory((request) => {
      requests.push({ url: request.url, options: request.options });
      return response(tweetPayload());
    })({ cookies: { auth_token: "a", ct0: "b" } });
    const transport = new GraphqlTransport(new TransactionIdProvider({ create: async () => "tx-id" }));
    const engine = new ApiEngine(config, provider, transport);
    const page = await engine.search(session, { searchQuery: "hello", limit: 1 });
    expect(page.tweets).toHaveLength(1);
    expect(requests[0]?.options.headers?.["X-Client-Transaction-Id"]).toBe("tx-id");
    expect(requests[0]?.url).toContain("SearchTimeline");
    storage.database.close();
  });

  test("resolves user IDs for profile and follow operations", async () => {
    const storage = openStorage(":memory:");
    const config = validateConfig();
    const provider = new ManifestProvider(config, storage.manifests);
    const session = sessionFactory((request) =>
      request.url.includes("UserByScreenName") ? response(userPayload()) : response(profilePayload()),
    )({ cookies: { auth_token: "a", ct0: "b" } });
    const engine = new ApiEngine(config, provider, new GraphqlTransport(new TransactionIdProvider()));
    expect((await engine.resolveTarget(session, { username: "demo" })).userId).toBe("u1");
    storage.database.close();
  });

  test("refreshes the operation manifest after a missing or rejected query ID", async () => {
    const storage = openStorage(":memory:");
    const config = validateConfig();
    const provider = new ManifestProvider(config, storage.manifests, undefined, undefined, async () => ({
      ...DEFAULT_MANIFEST,
      queryIds: { ...DEFAULT_MANIFEST.queryIds, search_timeline: "refreshed-search" },
    }));
    const requests: string[] = [];
    const session = sessionFactory((request) => {
      requests.push(request.url);
      return request.url.includes("refreshed-search") ? response(tweetPayload()) : response("missing", 404);
    })({ cookies: { auth_token: "a", ct0: "b" } });
    const engine = new ApiEngine(config, provider, new GraphqlTransport(new TransactionIdProvider()));
    await expect(engine.search(session, { searchQuery: "hello", limit: 1 })).resolves.toMatchObject({
      tweets: [{ tweetId: "1" }],
    });
    expect(requests).toHaveLength(2);
    storage.database.close();
  });

  test("shares one live refresh across concurrent operation mismatches", async () => {
    const storage = openStorage(":memory:");
    const config = validateConfig();
    let scrapes = 0;
    const provider = new ManifestProvider(config, storage.manifests, undefined, undefined, async () => {
      scrapes += 1;
      await Promise.resolve();
      return {
        ...DEFAULT_MANIFEST,
        queryIds: { ...DEFAULT_MANIFEST.queryIds, search_timeline: "refreshed-search" },
      };
    });
    const session = sessionFactory((request) =>
      request.url.includes("refreshed-search") ? response(tweetPayload()) : response("missing", 404),
    )({ cookies: { auth_token: "a", ct0: "b" } });
    const engine = new ApiEngine(config, provider, new GraphqlTransport(new TransactionIdProvider()));
    await Promise.all(
      Array.from({ length: 10 }, () => engine.search(session, { searchQuery: "hello", limit: 1 })),
    );
    expect(scrapes).toBe(1);
    storage.database.close();
  });
});
