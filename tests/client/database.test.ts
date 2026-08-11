import { XTrawl } from "../../src/client/client.js";

describe("public database facade", () => {
  test("projects accounts safely and exposes scoped maintenance", () => {
    const client = new XTrawl({
      dbPath: ":memory:",
      accounts: [
        {
          username: "collector",
          email: "private@example.test",
          authToken: "private-auth",
          csrfToken: "private-csrf",
          cookies: { auth_token: "private-auth", ct0: "private-csrf" },
          proxy: "http://user:password@127.0.0.1:8080",
        },
      ],
    });
    const safe = JSON.stringify(client.db.listAccounts({ includeCookies: true }));
    expect(safe).not.toContain("private-auth");
    expect(safe).not.toContain("private-csrf");
    expect(safe).not.toContain("private@example.test");
    expect(safe).not.toContain("password");
    expect(client.db.accountsSummary()).toMatchObject({ total: 1, eligible: 1 });

    expect(client.db.markAccountUnusable("collector", "test")).toBe(true);
    expect(client.db.listAccounts({ unusableOnly: true })).toHaveLength(1);
    expect(client.db.resetAccountCooldowns(["collector"], true)).toBe(1);
    expect(client.db.resetDailyCounters(["collector"])).toBe(1);
    expect(client.db.setAccountProxy("collector", "socks5://127.0.0.1:1080")).toBe(true);
    expect(client.db.deleteAccount("collector")).toBe(true);
    expect(client.db.accountsSummary().total).toBe(0);
    client.close();
  });

  test("manages checkpoints and run summaries", () => {
    const client = new XTrawl({ dbPath: ":memory:", provision: false });
    client.storage.checkpoints.save("query", { root: "cursor" });
    expect(client.db.getCheckpoint("query")).toEqual({ root: "cursor" });
    expect(client.db.clearAllCheckpoints()).toBe(1);
    const run = client.storage.runs.create("search", "hash");
    client.storage.runs.finalize(run.id, "complete");
    expect(client.db.lastRun()).toMatchObject({ operation: "search", status: "complete" });
    expect(client.db.runsSummary()).toMatchObject({ totalRuns: 1, byStatus: { complete: 1 } });
    client.close();
  });
});
