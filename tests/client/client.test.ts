import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { XTrawl } from "../../src/client/client.js";
import { AccountPoolExhausted, RunFailed } from "../../src/domain/errors.js";
import { AccountStateError } from "../../src/domain/errors.js";
import type { AccountStateStore } from "../../src/domain/account-state.js";
import type { AccountRepository } from "../../src/storage/account-repository.js";
import { openStorage } from "../../src/storage/index.js";
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

function asynchronousStore(repository: AccountRepository): AccountStateStore {
  return {
    kind: "test-memory",
    list: () => Promise.resolve(repository.list()),
    findByUsername: (username) => Promise.resolve(repository.findByUsername(username)),
    upsert: (account) => Promise.resolve(repository.upsert(account)),
    delete: (username) => Promise.resolve(repository.delete(username)),
    replaceAll: (accounts) => Promise.resolve(repository.replaceAll(accounts)),
    acquireLease: (request) => Promise.resolve(repository.acquireLease(request)),
    renewLease: (leaseId, leaseExpiresAt) => Promise.resolve(repository.renewLease(leaseId, leaseExpiresAt)),
    completeLease: (completion) => Promise.resolve(repository.completeLease(completion)),
  };
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

  test("returns one search page and accepts a caller-owned cursor", async () => {
    const requestBodies: unknown[] = [];
    let pageNumber = 0;
    const client = new XTrawl({
      dbPath: ":memory:",
      requestsPerMinute: 60_000,
      minDelayMs: 0,
      cookies: { auth_token: "auth", ct0: "csrf" },
      sessionFactory: (options) =>
        sessionFactory((request) => {
          requestBodies.push(request.options.body);
          pageNumber += 1;
          return response(tweetPayload(`cursor-${pageNumber}`));
        })(options),
    });

    const first = await client.searchPage("typescript", {
      since: "2026-08-01",
      until: "2026-08-12",
      fromUsers: ["OpenAI"],
      displayType: "Latest",
    });
    const second = await client.searchPage("typescript", {
      since: "2026-08-01",
      until: "2026-08-12",
      fromUsers: ["OpenAI"],
      displayType: "Latest",
      cursor: first.nextCursor,
    });

    expect(first).toMatchObject({ tweets: [{ tweetId: "1" }], nextCursor: "cursor-1" });
    expect(second.nextCursor).toBe("cursor-2");
    expect(requestBodies).toHaveLength(2);
    expect(searchVariables(requestBodies[0])).toMatchObject({
      rawQuery: expect.stringContaining("typescript"),
      product: "Latest",
    });
    expect(searchVariables(requestBodies[1])).toMatchObject({ cursor: "cursor-1" });
    expect(client.storage.runs.list()).toHaveLength(0);
    expect(client.storage.accounts.list()[0]?.dailyRequests).toBe(2);
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

  test("uses a caller-owned async account store", async () => {
    const external = openStorage(":memory:");
    const accountStore = asynchronousStore(external.accounts);
    expect(() => new XTrawl({ dbPath: ":memory:", accountStore })).toThrow("await XTrawl.create");
    const client = await XTrawl.create({
      dbPath: ":memory:",
      minDelayMs: 0,
      cooldownJitterMs: 0,
      accountStore,
      accounts: [
        {
          username: "external",
          password: "not-exported",
          email: "not-exported@example.test",
          emailPassword: "not-exported",
          twoFactorSecret: "not-exported",
          authToken: "external-auth",
          csrfToken: "external-csrf",
          cookies: { auth_token: "external-auth", ct0: "external-csrf" },
        },
      ],
      sessionFactory: (options) => sessionFactory(() => response(tweetPayload("next")))(options),
    });

    await expect(client.search("hello", { limit: 1 })).resolves.toMatchObject({
      tweets: [expect.objectContaining({ tweetId: "1" })],
    });
    expect(external.accounts.findByUsername("external")?.dailyRequests).toBe(1);
    expect(client.poolSummary.dbPath).toBe("external:test-memory");

    const snapshot = await client.accounts.exportState({ includeSecrets: true });
    expect(snapshot.accounts[0]).toMatchObject({
      username: "external",
      authToken: "external-auth",
      csrfToken: "external-csrf",
    });
    expect(snapshot.accounts[0]).not.toHaveProperty("password");
    expect(snapshot.accounts[0]).not.toHaveProperty("email");
    expect(snapshot.accounts[0]).not.toHaveProperty("emailPassword");
    expect(snapshot.accounts[0]).not.toHaveProperty("twoFactorSecret");
    expect(snapshot.accounts[0]).not.toHaveProperty("leaseId");

    const restoredStorage = openStorage(":memory:");
    const restored = await XTrawl.create({
      dbPath: ":memory:",
      provision: false,
      accountStore: asynchronousStore(restoredStorage.accounts),
    });
    await expect(restored.accounts.restoreState(snapshot, { mode: "replace" })).resolves.toEqual({
      restored: 1,
      mode: "replace",
    });
    expect(restoredStorage.accounts.findByUsername("external")?.authToken).toBe("external-auth");
    expect(restoredStorage.accounts.findByUsername("external")?.dailyRequests).toBe(1);
    await expect(restored.accounts.restoreState({ schemaVersion: 2 })).rejects.toThrow(AccountStateError);
    await expect(
      restored.accounts.restoreState({
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        accounts: [{ username: "bad", cookies: { ct0: 123 } }],
      }),
    ).rejects.toThrow("cookie values must be strings");

    restored.close();
    restoredStorage.database.close();
    client.close();
    external.database.close();
  });
});

function searchVariables(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw new Error("Expected a GraphQL request body.");
  const variables = (body as Record<string, unknown>).variables;
  if (typeof variables !== "object" || variables === null || Array.isArray(variables))
    throw new Error("Expected GraphQL search variables.");
  return variables as Record<string, unknown>;
}
