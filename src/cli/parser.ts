import type {
  FollowType,
  FollowsRequest,
  ProfileTimelineRequest,
  SearchRequest,
} from "../domain/requests.js";

export interface CliArgs {
  readonly authToken?: string;
  readonly csrfToken?: string;
  readonly cookiesFile?: string;
  readonly envFile?: string;
  readonly dbPath: string;
  readonly proxy?: string;
  readonly concurrency: number;
  readonly manifestScrapeOnInit: boolean;
  readonly verbose: boolean;
  readonly command?:
    "search" | "tweet" | "profile-tweets" | "followers" | "following" | "verified-followers" | "user-info";
  readonly values: readonly string[];
  readonly options: Readonly<Record<string, string | boolean | readonly string[]>>;
}

export class CliUsageError extends Error {}

export function parseArgs(argv: readonly string[]): CliArgs {
  const global: {
    authToken?: string;
    csrfToken?: string;
    cookiesFile?: string;
    envFile?: string;
    dbPath: string;
    proxy?: string;
    concurrency: number;
    manifestScrapeOnInit: boolean;
    verbose: boolean;
  } = { dbPath: "xtrawl_state.db", concurrency: 5, manifestScrapeOnInit: false, verbose: false };
  let index = 0;
  while (index < argv.length && (argv[index]?.startsWith("--") || argv[index] === "-v")) {
    const flag = argv[index];
    if (!flag) break;
    if (flag === "--help") return { ...global, values: [], options: {}, command: undefined };
    if (flag === "--verbose" || flag === "-v") {
      global.verbose = true;
      index += 1;
      continue;
    }
    if (flag === "--manifest-scrape-on-init") {
      global.manifestScrapeOnInit = true;
      index += 1;
      continue;
    }
    const [key, value] = splitFlag(flag, argv[index + 1]);
    if (key === "auth-token") global.authToken = value;
    else if (key === "csrf-token" || key === "ct0") global.csrfToken = value;
    else if (key === "cookies-file") global.cookiesFile = value;
    else if (key === "env-file") global.envFile = value;
    else if (key === "db-path") global.dbPath = value;
    else if (key === "proxy") global.proxy = value;
    else if (key === "concurrency") global.concurrency = positiveNumber(value, "concurrency");
    else throw new CliUsageError(`Unknown option: --${key}`);
    index += flag.includes("=") ? 1 : 2;
  }
  const command = argv[index] as CliArgs["command"] | undefined;
  if (!command) return { ...global, values: [], options: {}, command: undefined };
  if (
    ![
      "search",
      "tweet",
      "profile-tweets",
      "followers",
      "following",
      "verified-followers",
      "user-info",
    ].includes(command)
  )
    throw new CliUsageError(`Unknown command: ${command}`);
  index += 1;
  const values: string[] = [];
  const options: Record<string, string | boolean | readonly string[]> = {};
  while (index < argv.length) {
    const value = argv[index]!;
    if (!value.startsWith("--")) {
      values.push(value);
      index += 1;
      continue;
    }
    const equals = value.indexOf("=");
    const key = equals > 2 ? value.slice(2, equals) : value.slice(2);
    if (!KNOWN_OPTIONS.has(key)) throw new CliUsageError(`Unknown command option: --${key}`);
    if (BOOLEAN_OPTIONS.has(key)) {
      if (equals > 2) throw new CliUsageError(`--${key} does not accept a value`);
      options[key] = true;
      index += 1;
      continue;
    }
    if (LIST_OPTIONS.has(key)) {
      const items = equals > 2 ? [value.slice(equals + 1)] : followingValues(argv, index + 1);
      if (items.length === 0) throw new CliUsageError(`--${key} requires at least one value`);
      const existing = Array.isArray(options[key]) ? (options[key] as readonly string[]) : [];
      options[key] = [...existing, ...items];
      index += equals > 2 ? 1 : items.length + 1;
      continue;
    }
    const flagValue = equals > 2 ? value.slice(equals + 1) : argv[index + 1];
    if (!flagValue || flagValue.startsWith("--")) throw new CliUsageError(`--${key} requires a value`);
    validateCommandValue(key, flagValue);
    options[key] = flagValue;
    index += equals > 2 ? 1 : 2;
  }
  if (
    ["tweet", "profile-tweets", "followers", "following", "verified-followers", "user-info"].includes(
      command,
    ) &&
    values.length === 0
  )
    throw new CliUsageError(
      command === "tweet"
        ? "tweet requires at least one post ID or status URL"
        : `${command} requires at least one user`,
    );
  return { ...global, command, values, options };
}

const LIST_OPTIONS = new Set([
  "from",
  "to",
  "mention",
  "all-words",
  "any-words",
  "exact-phrases",
  "hashtags-any",
  "hashtags-exclude",
  "exclude-words",
]);

const BOOLEAN_OPTIONS = new Set([
  "save",
  "pretty",
  "resume",
  "raw-json",
  "has-images",
  "has-videos",
  "has-links",
  "has-mentions",
  "has-hashtags",
  "verified-only",
  "blue-verified-only",
]);

const VALUE_OPTIONS = new Set([
  "limit",
  "max-empty-pages",
  "per-profile-limit",
  "max-pages-per-profile",
  "save-format",
  "save-dir",
  "save-name",
  "since",
  "until",
  "lang",
  "display-type",
  "tweet-type",
  "min-likes",
  "min-replies",
  "min-retweets",
  "place",
  "geocode",
  "near",
  "within",
]);

const KNOWN_OPTIONS = new Set([...LIST_OPTIONS, ...BOOLEAN_OPTIONS, ...VALUE_OPTIONS]);

const POSITIVE_OPTIONS = new Set(["limit", "max-empty-pages", "per-profile-limit", "max-pages-per-profile"]);

const NON_NEGATIVE_OPTIONS = new Set(["min-likes", "min-replies", "min-retweets"]);

function validateCommandValue(key: string, value: string): void {
  if (POSITIVE_OPTIONS.has(key)) positiveNumber(value, key);
  if (NON_NEGATIVE_OPTIONS.has(key)) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0)
      throw new CliUsageError(`--${key} must be a non-negative integer`);
  }
  if (key === "save-format" && !["csv", "json", "both"].includes(value))
    throw new CliUsageError("--save-format must be csv, json, or both");
  if (key === "display-type" && value !== "Top" && value !== "Latest")
    throw new CliUsageError("--display-type must be Top or Latest");
  if (
    key === "tweet-type" &&
    ![
      "all",
      "originals_only",
      "replies_only",
      "retweets_only",
      "exclude_replies",
      "exclude_retweets",
    ].includes(value)
  )
    throw new CliUsageError(`Unsupported --tweet-type value: ${value}`);
}

function followingValues(argv: readonly string[], start: number): string[] {
  const values: string[] = [];
  for (let index = start; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value || value.startsWith("--")) break;
    values.push(value);
  }
  return values;
}

export function searchRequestFromCli(args: CliArgs): SearchRequest {
  const option = args.options;
  const list = (key: string): readonly string[] | undefined =>
    Array.isArray(option[key]) ? option[key] : option[key] ? [String(option[key])] : undefined;
  const boolean = (key: string): boolean | undefined =>
    option[key] === undefined ? undefined : Boolean(option[key]);
  const number = (key: string): number | undefined =>
    option[key] === undefined ? undefined : Number(option[key]);
  return {
    ...(args.values[0] ? { searchQuery: args.values[0] } : {}),
    ...(option.since ? { since: String(option.since) } : {}),
    ...(option.until ? { until: String(option.until) } : {}),
    ...(list("from") ? { fromUsers: list("from") } : {}),
    ...(list("to") ? { toUsers: list("to") } : {}),
    ...(list("mention") ? { mentioningUsers: list("mention") } : {}),
    ...(list("all-words") ? { allWords: list("all-words") } : {}),
    ...(list("any-words") ? { anyWords: list("any-words") } : {}),
    ...(list("exact-phrases") ? { exactPhrases: list("exact-phrases") } : {}),
    ...(list("hashtags-any") ? { hashtagsAny: list("hashtags-any") } : {}),
    ...(list("hashtags-exclude") ? { hashtagsExclude: list("hashtags-exclude") } : {}),
    ...(list("exclude-words") ? { excludeWords: list("exclude-words") } : {}),
    ...(option.lang ? { lang: String(option.lang) } : {}),
    ...(option.place ? { place: String(option.place) } : {}),
    ...(option.geocode ? { geocode: String(option.geocode) } : {}),
    ...(option.near ? { near: String(option.near) } : {}),
    ...(option.within ? { within: String(option.within) } : {}),
    ...(option["display-type"] ? { displayType: String(option["display-type"]) as "Top" | "Latest" } : {}),
    ...(option["tweet-type"]
      ? { tweetType: String(option["tweet-type"]) as SearchRequest["tweetType"] }
      : {}),
    ...(number("limit") !== undefined ? { limit: number("limit") } : {}),
    ...(number("max-empty-pages") !== undefined ? { maxEmptyPages: number("max-empty-pages") } : {}),
    ...(number("min-likes") !== undefined ? { minLikes: number("min-likes") } : {}),
    ...(number("min-replies") !== undefined ? { minReplies: number("min-replies") } : {}),
    ...(number("min-retweets") !== undefined ? { minRetweets: number("min-retweets") } : {}),
    ...(boolean("verified-only") !== undefined ? { verifiedOnly: boolean("verified-only") } : {}),
    ...(boolean("blue-verified-only") !== undefined
      ? { blueVerifiedOnly: boolean("blue-verified-only") }
      : {}),
    ...(boolean("has-images") !== undefined ? { hasImages: boolean("has-images") } : {}),
    ...(boolean("has-videos") !== undefined ? { hasVideos: boolean("has-videos") } : {}),
    ...(boolean("has-links") !== undefined ? { hasLinks: boolean("has-links") } : {}),
    ...(boolean("has-mentions") !== undefined ? { hasMentions: boolean("has-mentions") } : {}),
    ...(boolean("has-hashtags") !== undefined ? { hasHashtags: boolean("has-hashtags") } : {}),
    ...(option.save ? { save: true } : {}),
    ...(option["save-format"]
      ? { saveFormat: String(option["save-format"]) as SearchRequest["saveFormat"] }
      : {}),
    ...(option["save-dir"] ? { saveDir: String(option["save-dir"]) } : {}),
    ...(option["save-name"] ? { saveName: String(option["save-name"]) } : {}),
    ...(option.resume ? { resume: true } : {}),
  };
}

export function collectionOptionsFromCli(
  args: CliArgs,
): Omit<ProfileTimelineRequest, "targets"> & Omit<FollowsRequest, "targets" | "followType"> {
  const option = args.options;
  const number = (key: string): number | undefined => {
    const value = option[key];
    return value === undefined || typeof value === "boolean" ? undefined : Number(value);
  };
  return {
    ...(number("limit") !== undefined ? { limit: number("limit") } : {}),
    ...(number("per-profile-limit") !== undefined ? { perProfileLimit: number("per-profile-limit") } : {}),
    ...(number("max-pages-per-profile") !== undefined
      ? { maxPagesPerProfile: number("max-pages-per-profile") }
      : {}),
    ...(number("max-empty-pages") !== undefined ? { maxEmptyPages: number("max-empty-pages") } : {}),
    ...(option.resume === true ? { resume: true } : {}),
    ...(option.save === true ? { save: true } : {}),
    ...(option["save-format"]
      ? { saveFormat: String(option["save-format"]) as "csv" | "json" | "both" }
      : {}),
    ...(option["save-dir"] ? { saveDir: String(option["save-dir"]) } : {}),
    ...(option["save-name"] ? { saveName: String(option["save-name"]) } : {}),
    ...(option["raw-json"] === true ? { rawJson: true } : {}),
  };
}

export function followType(command: CliArgs["command"]): FollowType | undefined {
  return command === "followers"
    ? "followers"
    : command === "following"
      ? "following"
      : command === "verified-followers"
        ? "verified_followers"
        : undefined;
}

function splitFlag(flag: string, next: string | undefined): [string, string] {
  const equals = flag.indexOf("=");
  if (equals > 2) return [flag.slice(2, equals), flag.slice(equals + 1)];
  if (!next || next.startsWith("--")) return [flag.slice(2), "__flag__"];
  return [flag.slice(2), next];
}

function positiveNumber(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new CliUsageError(`${name} must be a positive integer`);
  return parsed;
}
