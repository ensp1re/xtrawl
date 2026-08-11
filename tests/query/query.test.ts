import { buildEffectiveQuery, normalizeSearch } from "../../src/query/normalize.js";
import { queryHash } from "../../src/query/hash.js";

describe("query normalization", () => {
  test("maps aliases and formats structured filters", () => {
    const normalized = normalizeSearch({
      query: "typescript",
      words: "agents//harness",
      from_account: ["@one", "one"],
      hashtag: "dev",
      minlikes: "5",
      verified: true,
    }).value;
    expect(normalized.searchQuery).toBe("typescript");
    expect(normalized.anyWords).toEqual(["agents", "harness"]);
    expect(normalized.fromUsers).toEqual(["one"]);
    expect(normalized.hashtagsAny).toEqual(["#dev"]);
    expect(buildEffectiveQuery(normalized)).toContain("min_faves:5");
    expect(buildEffectiveQuery(normalized)).toContain("from:one");
  });

  test("does not duplicate operators already supplied in the raw query", () => {
    const normalized = normalizeSearch({
      searchQuery: "from:one lang:en filter:images min_faves:10",
      fromUsers: ["two"],
      lang: "fr",
      minLikes: 50,
      hasImages: true,
    }).value;
    const query = buildEffectiveQuery(normalized);
    expect(query.match(/from:/giu)).toHaveLength(1);
    expect(query.match(/lang:/giu)).toHaveLength(1);
    expect(query.match(/filter:images/giu)).toHaveLength(1);
    expect(query.match(/min_faves:/giu)).toHaveLength(1);
  });

  test("supports tweet type and date operators", () => {
    const normalized = normalizeSearch({
      since: "2026-01-01_UTC",
      until: "2026-02-01",
      tweetType: "originals_only",
      hasLinks: true,
    }).value;
    const query = buildEffectiveQuery(normalized);
    expect(query).toContain("-filter:replies");
    expect(query).toContain("-filter:retweets");
    expect(query).toContain("filter:links");
    expect(query).toContain("since:2026-01-01");
    expect(query).toContain("until:2026-02-01");
  });

  test("rejects an unknown tweet type without producing an unsafe query", () => {
    const normalized = normalizeSearch({ tweetType: "not-valid" }).value;
    expect(normalized.tweetType).toBe("all");
    expect(normalizeSearch({ tweetType: "not-valid" }).errors).toHaveLength(1);
  });

  test("hashes equivalent object key order identically", () => {
    expect(queryHash({ b: 2, a: 1 })).toBe(queryHash({ a: 1, b: 2 }));
  });
});
