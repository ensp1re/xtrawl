import {
  collectionOptionsFromCli,
  parseArgs,
  searchRequestFromCli,
  CliUsageError,
  followType,
} from "../../src/cli/parser.js";

describe("CLI parser", () => {
  test("parses global auth and search options", () => {
    const args = parseArgs([
      "--auth-token",
      "a",
      "--csrf-token",
      "b",
      "search",
      "hello",
      "--since",
      "2026-01-01",
      "--from",
      "demo",
      "--from",
      "other",
      "--limit",
      "5",
      "--pretty",
    ]);
    expect(args.authToken).toBe("a");
    expect(args.csrfToken).toBe("b");
    expect(args.command).toBe("search");
    expect(args.values).toEqual(["hello"]);
    expect(searchRequestFromCli(args)).toMatchObject({
      searchQuery: "hello",
      since: "2026-01-01",
      fromUsers: ["demo", "other"],
      limit: 5,
    });
    expect(args.options.pretty).toBe(true);
  });

  test("parses profile, follower, and user-info commands", () => {
    expect(parseArgs(["profile-tweets", "one", "two", "--resume"]).values).toEqual(["one", "two"]);
    expect(parseArgs(["followers", "one", "--raw-json"]).options["raw-json"]).toBe(true);
    expect(parseArgs(["user-info", "one"]).command).toBe("user-info");
  });

  test("supports equals syntax and help", () => {
    expect(parseArgs(["--db-path=state.db", "--concurrency=2", "search"]).dbPath).toBe("state.db");
    expect(parseArgs(["--help"]).command).toBeUndefined();
  });

  test("rejects unknown flags and missing targets", () => {
    expect(() => parseArgs(["--unknown"])).toThrow(CliUsageError);
    expect(() => parseArgs(["followers"])).toThrow(CliUsageError);
  });

  test("maps structured filters, booleans, output, and numeric options", () => {
    const args = parseArgs([
      "search",
      "hello",
      "--any-words",
      "one",
      "--any-words=two",
      "--tweet-type",
      "retweets_only",
      "--verified-only",
      "--has-images",
      "--min-likes",
      "3",
      "--save",
      "--save-format",
      "both",
      "--save-dir",
      "out",
      "--resume",
    ]);
    expect(searchRequestFromCli(args)).toMatchObject({
      anyWords: ["one", "two"],
      tweetType: "retweets_only",
      verifiedOnly: true,
      hasImages: true,
      minLikes: 3,
      save: true,
      saveFormat: "both",
      saveDir: "out",
      resume: true,
    });
  });

  test("accepts global aliases and validates positive numeric values", () => {
    const args = parseArgs([
      "--ct0=csrf",
      "--cookies-file",
      "cookies.txt",
      "--env-file=env",
      "--proxy",
      "proxy:8080",
      "search",
    ]);
    expect(args.csrfToken).toBe("csrf");
    expect(args.cookiesFile).toBe("cookies.txt");
    expect(args.envFile).toBe("env");
    expect(args.proxy).toBe("proxy:8080");
    expect(() => parseArgs(["--concurrency", "0", "search"])).toThrow(CliUsageError);
    expect(() => parseArgs(["unknown"])).toThrow(CliUsageError);
  });

  test("maps relationship command types", () => {
    expect(followType("followers")).toBe("followers");
    expect(followType("following")).toBe("following");
    expect(followType("user-info")).toBeUndefined();
    expect(followType("verified-followers")).toBe("verified_followers");
    expect(parseArgs(["verified-followers", "one"]).command).toBe("verified-followers");
  });

  test("shares bounded collection options across profile and relationship commands", () => {
    const args = parseArgs([
      "profile-tweets",
      "one",
      "--limit",
      "2",
      "--per-profile-limit",
      "1",
      "--max-pages-per-profile",
      "3",
      "--save",
      "--raw-json",
    ]);
    expect(collectionOptionsFromCli(args)).toMatchObject({
      limit: 2,
      perProfileLimit: 1,
      maxPagesPerProfile: 3,
      save: true,
      rawJson: true,
    });
  });
});
