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
  } = { dbPath: "graph_state.db", concurrency: 5, manifestScrapeOnInit: false, verbose: false };
  let index = 0;
  while (index < argv.length && argv[index]?.startsWith("--")) {
    const flag = argv[index];
    if (!flag) break;
    if (flag === "--help") return { ...global, values: [], options: {}, command: undefined };
    if (flag === "--verbose") {
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
    const [key, flagValue] = splitFlag(value, argv[index + 1]);
    if (flagValue === "__flag__") options[key] = true;
    else if (
      key === "from" ||
      key === "to" ||
      key === "mention" ||
      key === "all-words" ||
      key === "any-words" ||
      key === "exact-phrases" ||
      key === "hashtags-any" ||
      key === "hashtags-exclude" ||
      key === "exclude-words"
    ) {
      const existing = Array.isArray(options[key]) ? (options[key] as readonly string[]) : [];
      options[key] = [...existing, flagValue];
    } else options[key] = flagValue;
    index += value.includes("=") || flagValue === "__flag__" ? 1 : 2;
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
