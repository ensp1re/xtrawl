import { normalizeTargets, targetFromString } from "../../src/query/targets.js";

describe("target normalization", () => {
  test("accepts handles, IDs, and supported profile URL forms", () => {
    expect(targetFromString("@Demo_User")).toMatchObject({ username: "Demo_User" });
    expect(targetFromString("123456")).toMatchObject({ userId: "123456" });
    expect(targetFromString("https://mobile.twitter.com/demo/?ref=home")).toMatchObject({
      username: "demo",
      profileUrl: "https://x.com/demo",
    });
    expect(targetFromString("x.com/i/user/987")).toMatchObject({ userId: "987" });
  });

  test("rejects non-profile URLs and de-duplicates equivalent handles", () => {
    const result = normalizeTargets(["demo", "@DEMO", "https://example.com/demo", "https://x.com/home"]);
    expect(result.targets).toHaveLength(1);
    expect(result.skipped.map((item) => item.reason)).toEqual([
      "duplicate",
      "invalid_target",
      "invalid_target",
    ]);
  });
});
