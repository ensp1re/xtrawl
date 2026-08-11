import { openStorage } from "../../src/storage/index.js";
import { accountInputToRecord } from "../../src/auth/records.js";

function account(username: string, token = `${username}-token`) {
  return accountInputToRecord({
    username,
    authToken: token,
    csrfToken: `${username}-csrf`,
    cookies: { auth_token: token, ct0: `${username}-csrf` },
  });
}

describe("SQLite state repositories", () => {
  test("creates schema, upserts, leases, records usage, and releases", () => {
    const storage = openStorage(":memory:");
    storage.accounts.upsert(account("one"));
    const lease = storage.accounts.lease({ requireAuthMaterial: true });
    expect(lease?.username).toBe("one");
    expect(storage.accounts.recordUsage(lease!.leaseId, 2, 4)).toBe(true);
    const updated = storage.accounts.findByUsername("one");
    expect(updated?.dailyRequests).toBe(2);
    expect(updated?.dailyTweets).toBe(4);
    expect(storage.accounts.release(lease!.leaseId, { status: "healthy" })).toBe(true);
    expect(storage.accounts.summary().eligible).toBe(1);
    storage.database.close();
  });

  test("filters missing auth material and applies cooldowns", () => {
    const storage = openStorage(":memory:");
    storage.accounts.upsert(account("ready"));
    storage.accounts.upsert(accountInputToRecord({ username: "missing" }));
    storage.accounts.markUnusable("missing", 401, "missing_auth");
    expect(storage.accounts.lease({ requireAuthMaterial: true })?.username).toBe("ready");
    expect(storage.accounts.resetCooldowns()).toBeGreaterThanOrEqual(0);
    expect(storage.accounts.summary().unusable).toBe(1);
    storage.database.close();
  });

  test("merges partial auth updates without losing cookie keys", () => {
    const storage = openStorage(":memory:");
    storage.accounts.upsert(
      accountInputToRecord({
        username: "one",
        authToken: "token",
        csrfToken: "csrf",
        cookies: { auth_token: "token", ct0: "csrf", extra: "keep" },
      }),
    );
    storage.accounts.upsert(accountInputToRecord({ username: "one", cookies: { extra2: "keep2" } }));
    expect(storage.accounts.findByUsername("one")?.cookies).toEqual({
      auth_token: "token",
      ct0: "csrf",
      extra: "keep",
      extra2: "keep2",
    });
    storage.database.close();
  });

  test("merges duplicate auth tokens and preserves state tables", () => {
    const storage = openStorage(":memory:");
    storage.accounts.upsert(account("one", "same"));
    storage.database.run(
      "INSERT INTO accounts(username,auth_token,csrf_token,cookies_json,last_reset_date) VALUES(?,?,?,?,?)",
      "two",
      "same",
      "two-csrf",
      JSON.stringify({ auth_token: "same", ct0: "two-csrf" }),
      new Date().toISOString().slice(0, 10),
    );
    expect(storage.accounts.list()).toHaveLength(2);
    expect(storage.accounts.collapseDuplicatesByAuthToken()).toEqual({ removed: 1, merged: 1 });
    expect(storage.accounts.list()).toHaveLength(1);
    const run = storage.runs.create("search", "hash");
    expect(storage.runs.finalize(run.id, "complete")).toBe(true);
    storage.checkpoints.save("hash", { root: "cursor" });
    expect(storage.checkpoints.get("hash")).toEqual({ root: "cursor" });
    storage.manifests.set(
      "manifest",
      { version: "v", queryIds: { search_timeline: "id" }, endpoints: { search_timeline: "url" } },
      10_000,
    );
    expect(storage.manifests.get("manifest")?.version).toBe("v");
    storage.database.close();
  });
});
