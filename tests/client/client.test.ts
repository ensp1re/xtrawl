import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { XTrawl } from "../../src/client/client.js";
import { AccountPoolExhausted, RunFailed } from "../../src/domain/errors.js";
import {
  sessionFactory,
  response,
  tweetPayload,
  userPayload,
  profilePayload,
  followsPayload,
  tweetResultPayload,
} from "../helpers/fake-http.js";

function createClient() {
  return new XTrawl({
    dbPath: ":memory:",
    requestsPerMinute: 60_000,
    minDelayMs: 0,
    cooldownJitterMs: 0,
    cookies: { auth_token: "auth", ct0: "csrf" },
    sessionFactory: (options) =>
      sessionFactory((request) => {
        if (request.url.includes("UserByScreenName")) return response(userPayload());
        if (request.url.includes("UserTweets")) return response(profilePayload());
        if (request.url.includes("TweetResultByRestId")) return response(tweetResultPayload());
        if (request.url.includes("Followers") || request.url.includes("Following"))
          return response(followsPayload());
        return response(tweetPayload("next"));
      })(options),
  });
}

describe("public client", () => {
  test("provisions cookie accounts and returns profiles", async () => {
    const client = createClient();
    expect(client.inspect().accounts).toHaveLength(1);
    const profiles = await client.getUserInfo(["demo"]);
    expect(profiles[0]).toMatchObject({ username: "demo", userId: "u1", followersCount: 10 });
    client.close();
  });

  test("searches with a hard result limit", async () => {
    const client = createClient();
    const result = await client.search("hello", { limit: 1 });
    expect(result.tweets).toHaveLength(1);
    expect(result.stats.tasksDone).toBe(1);
    client.close();
  });

  test("routes profile timelines and relationships", async () => {
    const client = createClient();
    expect((await client.getProfileTweets(["demo"], { limit: 1 })).tweets).toHaveLength(1);
    expect(await client.getFollowers(["demo"], { limit: 1 })).toHaveLength(1);
    expect(await client.getFollowing(["demo"], { limit: 1 })).toHaveLength(1);
    client.close();
  });

  test("looks up a single tweet by ID or status URL", async () => {
    const client = createClient();
    await expect(client.getTweet("1")).resolves.toMatchObject({ tweetId: "1", text: "hello" });
    await expect(client.getTweet("https://x.com/demo/status/1")).resolves.toMatchObject({
      tweetId: "1",
    });
    await expect(client.getTweet("invalid")).rejects.toThrow("numeric tweet ID");
    await expect(client.getTweet("https://example.com/demo/status/1")).rejects.toThrow("status URL");
    client.close();
  });

  test("supports provision=false with a pre-existing state database", () => {
    const first = createClient();
    first.close();
    const client = new XTrawl({ dbPath: ":memory:", provision: false });
    expect(client.inspect().accounts).toHaveLength(0);
    client.close();
  });

  test("enforces per-profile and page-count limits", async () => {
    const client = createClient();
    const profiles = await client.getProfileTweets(["one", "two"], {
      perProfileLimit: 1,
      maxPagesPerProfile: 1,
    });
    expect(profiles.tweets).toHaveLength(2);
    const follows = await client.getFollowers(["one"], { perProfileLimit: 1, maxPagesPerProfile: 1 });
    expect(follows).toHaveLength(1);
    client.close();
  });

  test("uses numeric user IDs directly and makes no username lookup", async () => {
    const requests: string[] = [];
    const client = new XTrawl({
      dbPath: ":memory:",
      minDelayMs: 0,
      cookies: { auth_token: "auth", ct0: "csrf" },
      sessionFactory: (options) =>
        sessionFactory((request) => {
          requests.push(request.url);
          return response(profilePayload());
        })(options),
    });
    await client.getProfileTweets(["123"], { limit: 1, maxPagesPerProfile: 1 });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain("UserTweets");
    client.close();
  });

  test("includes raw relationship payloads only when requested", async () => {
    const client = createClient();
    expect((await client.getFollowers(["demo"], { limit: 1 }))[0]).not.toHaveProperty("raw");
    expect(await client.getFollowers(["demo"], { limit: 1, rawJson: true })).toEqual([
      expect.objectContaining({ raw: expect.any(Object) }),
    ]);
    client.close();
  });

  test("redacts configuration and account secrets from inspection", () => {
    const client = new XTrawl({
      dbPath: ":memory:",
      authToken: "secret-auth",
      csrfToken: "secret-csrf",
      bearerToken: "secret-bearer",
      proxy: "http://user:password@127.0.0.1:8080",
    });
    const inspection = JSON.stringify(client.inspect());
    expect(inspection).not.toContain("secret-auth");
    expect(inspection).not.toContain("secret-csrf");
    expect(inspection).not.toContain("secret-bearer");
    expect(inspection).not.toContain("password");
    client.close();
  });

  test("saves profile information and appends to descriptive output names", async () => {
    const root = mkdtempSync(join(tmpdir(), "xtrawl-client-"));
    const client = createClient();
    await client.getUserInfo(["demo"], { save: true, saveFormat: "json", saveDir: root });
    await client.getUserInfo(["demo"], { save: true, saveFormat: "json", saveDir: root });
    const rows = JSON.parse(readFileSync(join(root, "user_info_demo.json"), "utf8")) as unknown[];
    expect(rows).toHaveLength(2);
    client.close();
  });

  test("returns a typed pool error when no account is provisioned", async () => {
    const client = new XTrawl({ dbPath: ":memory:", provision: false });
    await expect(client.search("hello")).rejects.toThrow(AccountPoolExhausted);
    client.close();
  });

  test("records remote failures as run failures", async () => {
    const client = new XTrawl({
      dbPath: ":memory:",
      minDelayMs: 0,
      cooldownJitterMs: 0,
      cookies: { auth_token: "auth", ct0: "csrf" },
      sessionFactory: (options) => sessionFactory(() => response("bad", 503))(options),
    });
    await expect(client.search("hello")).rejects.toThrow(RunFailed);
    expect(client.storage.runs.list()[0]?.status).toBe("failed");
    client.close();
  });
});
