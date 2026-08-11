import { accountInputToRecord } from "../../src/auth/records.js";
import { openStorage } from "../../src/storage/index.js";

function account(username: string, overrides: Record<string, unknown> = {}) {
  return accountInputToRecord({
    username,
    authToken: `${username}-auth`,
    csrfToken: `${username}-csrf`,
    cookies: { auth_token: `${username}-auth`, ct0: `${username}-csrf` },
    ...overrides,
  });
}

describe("account repository policy boundaries", () => {
  test("applies configured request and tweet limits", () => {
    const storage = openStorage(":memory:", { dailyRequestsLimit: 2, dailyTweetsLimit: 3 });
    storage.accounts.upsert(account("limited"));
    const first = storage.accounts.lease({ requireAuthMaterial: true });
    expect(first?.username).toBe("limited");
    storage.accounts.recordUsage(first!.leaseId, 2, 3);
    storage.accounts.release(first!.leaseId);
    expect(storage.accounts.lease({ requireAuthMaterial: true })).toBeUndefined();
    storage.database.close();
  });

  test("uses the configured lease TTL and renews active leases", () => {
    const storage = openStorage(":memory:", { leaseTtlMs: 10 });
    storage.accounts.upsert(account("leased"));
    const lease = storage.accounts.lease({ requireAuthMaterial: true, now: 100 });
    expect(lease?.leaseExpiresAt).toBe(110);
    expect(storage.accounts.heartbeat(lease!.leaseId, 1000)).toBe(true);
    expect(storage.accounts.findByUsername("leased")?.leaseExpiresAt).toBeGreaterThan(Date.now());
    storage.database.close();
  });

  test("releases expired cooldowns and optionally revives unusable accounts", () => {
    const storage = openStorage(":memory:");
    storage.accounts.upsert(account("cooling"));
    storage.accounts.upsert(account("bad"));
    storage.accounts.release(storage.accounts.lease({ requireAuthMaterial: true })!.leaseId, {
      status: "cooling_down",
      availableUntil: Date.now() - 1,
    });
    storage.accounts.markUnusable("bad", 401, "auth");
    expect(storage.accounts.resetCooldowns()).toBeGreaterThanOrEqual(1);
    expect(storage.accounts.findByUsername("bad")?.status).toBe(0);
    expect(storage.accounts.resetCooldowns(["bad"], true)).toBe(1);
    expect(storage.accounts.findByUsername("bad")?.status).toBe(1);
    storage.database.close();
  });

  test("round-trips string proxies and preserves operational fields", () => {
    const storage = openStorage(":memory:");
    storage.accounts.upsert(account("proxy", { proxy: "127.0.0.1:8080" }));
    expect(storage.accounts.findByUsername("proxy")?.proxy).toBe("127.0.0.1:8080");
    storage.database.close();
  });
});

describe("state database transactions", () => {
  test("commits successful work and rolls back failures", () => {
    const storage = openStorage(":memory:");
    storage.database.transaction(() => storage.accounts.upsert(account("committed")));
    expect(storage.accounts.findByUsername("committed")).toBeDefined();
    expect(() =>
      storage.database.transaction(() => {
        storage.accounts.upsert(account("rolled-back"));
        throw new Error("abort");
      }),
    ).toThrow("abort");
    expect(storage.accounts.findByUsername("rolled-back")).toBeUndefined();
    storage.database.close();
  });
});
