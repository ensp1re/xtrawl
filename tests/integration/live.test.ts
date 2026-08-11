import { XTrawl } from "../../src/client/client.js";

const enabled =
  process.env.RUN_LIVE_TESTS === "1" &&
  Boolean(process.env.X_AUTH_TOKEN) &&
  Boolean(process.env.X_CSRF_TOKEN);
const suite = enabled ? describe : describe.skip;

suite("live read-only checks", () => {
  test("resolves a public profile", async () => {
    const client = await XTrawl.create({
      dbPath: ":memory:",
      authToken: process.env.X_AUTH_TOKEN,
      csrfToken: process.env.X_CSRF_TOKEN,
    });
    try {
      const profiles = await client.getUserInfo(["OpenAI"]);
      expect(profiles.length).toBeGreaterThan(0);
      expect(profiles[0]?.userId).toBeTruthy();
    } finally {
      client.close();
    }
  }, 60_000);

  test("runs a bounded search", async () => {
    const client = await XTrawl.create({
      dbPath: ":memory:",
      authToken: process.env.X_AUTH_TOKEN,
      csrfToken: process.env.X_CSRF_TOKEN,
    });
    try {
      const result = await client.search("typescript", {
        limit: 1,
        since: "2026-01-01",
        until: "2026-12-31",
      });
      expect(result.tweets.length).toBeLessThanOrEqual(1);
    } finally {
      client.close();
    }
  }, 60_000);
});
