import { XTrawl } from "../../src/client/client.js";
import type { DiagnosticEvent } from "../../src/domain/diagnostics.js";
import { response, sessionFactory, tweetPayload } from "../helpers/fake-http.js";

describe("diagnostics", () => {
  test("emits redacted operation events without cookies or cursors", async () => {
    const events: DiagnosticEvent[] = [];
    const client = new XTrawl({
      dbPath: ":memory:",
      minDelayMs: 0,
      cooldownJitterMs: 0,
      cookies: { auth_token: "auth", ct0: "csrf" },
      sessionFactory: (options) => sessionFactory(() => response(tweetPayload()))(options),
      onDiagnostic: (event) => events.push(event),
    });
    await client.search("hello", { limit: 1 });
    expect(events.some((event) => event.operation === "search")).toBe(true);
    expect(JSON.stringify(events)).not.toContain("auth");
    expect(JSON.stringify(events)).not.toContain("next-cursor");
    client.close();
  });
});
