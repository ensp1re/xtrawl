import {
  buildFollowsParams,
  buildProfileTimelineParams,
  buildSearchParams,
  buildTweetResultParams,
  buildUserLookupParams,
  endpointFor,
  targetUsername,
  OPERATION,
} from "../../src/query/builder.js";
import { createManifest } from "../../src/manifest/model.js";

const manifest = createManifest({
  version: "test",
  queryIds: {
    search_timeline: "search-id",
    user_lookup_screen_name: "user-id",
    profile_timeline: "profile-id",
    followers: "followers-id",
    following: "following-id",
    verified_followers: "verified-id",
    tweet_result: "tweet-id",
  },
  endpoints: {
    search_timeline: "https://x.test/graphql/{query_id}",
    user_lookup_screen_name: "https://x.test/graphql/{query_id}",
    profile_timeline: "https://x.test/graphql/{query_id}",
    followers: "https://x.test/graphql/{query_id}",
    following: "https://x.test/graphql/{query_id}",
    verified_followers: "https://x.test/graphql/{query_id}",
    tweet_result: "https://x.test/graphql/{query_id}",
  },
  features: { shared: true },
  operationFeatures: { followers: { relationship: true } },
  operationFieldToggles: { user_lookup_screen_name: { withAuxiliaryUserLabels: false } },
});

function jsonValue(value: string | undefined): Record<string, unknown> {
  return JSON.parse(value ?? "{}") as Record<string, unknown>;
}

describe("typed GraphQL request builders", () => {
  test("resolves operation identifiers and request variables", () => {
    expect(endpointFor(manifest, OPERATION.search)).toBe("https://x.test/graphql/search-id");
    expect(
      jsonValue(
        buildSearchParams({ searchQuery: "hello", displayType: "Latest" }, manifest, "cursor", 200).variables,
      ),
    ).toMatchObject({
      rawQuery: "hello",
      count: 100,
      product: "Latest",
      cursor: "cursor",
    });
    expect(
      jsonValue(buildProfileTimelineParams("u1", { targets: [] }, manifest, undefined, 5).variables),
    ).toMatchObject({ userId: "u1", count: 5 });
    expect(
      jsonValue(buildFollowsParams("u1", OPERATION.followers, manifest, "c", 5).variables),
    ).toMatchObject({ userId: "u1", cursor: "c" });
    expect(jsonValue(buildTweetResultParams("123", manifest).variables)).toEqual({
      tweetId: "123",
      withCommunity: false,
      includePromotedContent: false,
      withVoice: false,
    });
  });

  test("includes operation-specific feature and field toggle maps", () => {
    expect(jsonValue(buildFollowsParams("u1", OPERATION.followers, manifest).features)).toMatchObject({
      shared: true,
      relationship: true,
    });
    expect(jsonValue(buildUserLookupParams("demo", manifest).fieldToggles)).toEqual({
      withAuxiliaryUserLabels: false,
    });
  });

  test("extracts usernames from handles and profile URLs", () => {
    expect(targetUsername({ username: "@demo" })).toBe("demo");
    expect(targetUsername({ profileUrl: "x.com/demo" })).toBe("demo");
    expect(targetUsername({ profileUrl: "https://x.com/demo/status/1" })).toBeUndefined();
    expect(targetUsername({ userId: "u1" })).toBeUndefined();
  });
});
