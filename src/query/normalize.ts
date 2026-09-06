import { SEARCH_DISPLAY, TWEET_TYPE } from "../constants/requests.js";
import type { SearchRequest, TweetType } from "../domain/requests.js";
import { asBoolean, asInteger, asString, asStringList } from "../utils/guards.js";
import type { NormalizedSearch } from "./types.js";

export type { NormalizedSearch } from "./types.js";

const VALID_TWEET_TYPES: ReadonlySet<string> = new Set(Object.values(TWEET_TYPE));

export function normalizeSearch(input: SearchRequest | Record<string, unknown> = {}): {
  readonly value: NormalizedSearch;
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
} {
  const raw = input as Record<string, unknown>;
  const warnings: string[] = [];
  const aliases: Record<string, string> = {
    query: "searchQuery",
    words: "anyWords",
    from_account: "fromUsers",
    to_account: "toUsers",
    mention_account: "mentioningUsers",
    hashtag: "hashtagsAny",
    minlikes: "minLikes",
    minreplies: "minReplies",
    minretweets: "minRetweets",
    verified: "verifiedOnly",
    blue_verified: "blueVerifiedOnly",
    images: "hasImages",
    videos: "hasVideos",
    links: "hasLinks",
  };
  const coerced: Record<string, unknown> = { ...raw };
  for (const [legacy, canonical] of Object.entries(aliases)) {
    if (!(legacy in raw)) continue;
    warnings.push(`Input key '${legacy}' is deprecated; use '${canonical}'.`);
    if (!(canonical in raw)) coerced[canonical] = raw[legacy];
  }
  const normalizedList = (key: string): string[] =>
    unique(
      asStringList(coerced[key]).flatMap((item) =>
        key === "allWords" || key === "anyWords" ? item.split("//") : [item],
      ),
    );
  const handles = (key: string): string[] =>
    unique(
      normalizedList(key)
        .map((item) => item.replace(/^@/u, ""))
        .filter((item) => /^[A-Za-z0-9_]{1,15}$/u.test(item)),
    );
  const hashtags = (key: string): string[] =>
    unique(
      normalizedList(key).map((item) => (item.startsWith("#") || item.startsWith("$") ? item : `#${item}`)),
    );
  const tweetTypeValue = asString(coerced.tweetType) ?? TWEET_TYPE.ALL;
  const tweetType = VALID_TWEET_TYPES.has(tweetTypeValue) ? (tweetTypeValue as TweetType) : TWEET_TYPE.ALL;
  const errors = VALID_TWEET_TYPES.has(tweetTypeValue) ? [] : [`Invalid tweetType: ${tweetTypeValue}`];
  return {
    value: {
      searchQuery: asString(coerced.searchQuery) ?? "",
      allWords: normalizedList("allWords"),
      anyWords: normalizedList("anyWords"),
      exactPhrases: normalizedList("exactPhrases"),
      excludeWords: normalizedList("excludeWords"),
      hashtagsAny: hashtags("hashtagsAny"),
      hashtagsExclude: hashtags("hashtagsExclude"),
      fromUsers: handles("fromUsers"),
      toUsers: handles("toUsers"),
      mentioningUsers: handles("mentioningUsers"),
      tweetType,
      verifiedOnly: asBoolean(coerced.verifiedOnly),
      blueVerifiedOnly: asBoolean(coerced.blueVerifiedOnly),
      hasImages: asBoolean(coerced.hasImages),
      hasVideos: asBoolean(coerced.hasVideos),
      hasLinks: asBoolean(coerced.hasLinks),
      hasMentions: asBoolean(coerced.hasMentions),
      hasHashtags: asBoolean(coerced.hasHashtags),
      minLikes: Math.max(0, asInteger(coerced.minLikes)),
      minReplies: Math.max(0, asInteger(coerced.minReplies)),
      minRetweets: Math.max(0, asInteger(coerced.minRetweets)),
      place: asString(coerced.place) ?? "",
      geocode: asString(coerced.geocode) ?? "",
      near: asString(coerced.near) ?? "",
      within: asString(coerced.within) ?? "",
      lang: asString(coerced.lang) ?? "",
      since: asString(coerced.since) ?? "",
      until: asString(coerced.until) ?? "",
      displayType:
        asString(coerced.displayType) === SEARCH_DISPLAY.LATEST ? SEARCH_DISPLAY.LATEST : SEARCH_DISPLAY.TOP,
    },
    warnings,
    errors,
  };
}

export function buildEffectiveQuery(value: NormalizedSearch): string {
  const parts: string[] = [];
  if (value.searchQuery) parts.push(value.searchQuery);
  if (value.allWords.length) parts.push(`(${value.allWords.map(formatTerm).join(" AND ")})`);
  if (value.anyWords.length) parts.push(`(${value.anyWords.map(formatTerm).join(" OR ")})`);
  if (value.exactPhrases.length) parts.push(`(${value.exactPhrases.map(formatTerm).join(" AND ")})`);
  for (const term of value.excludeWords) parts.push(`-${formatTerm(term)}`);
  if (value.hashtagsAny.length) parts.push(`(${value.hashtagsAny.join(" OR ")})`);
  for (const tag of value.hashtagsExclude) parts.push(`-${tag}`);
  if (!hasOperator(value.searchQuery, "from") && value.fromUsers.length)
    parts.push(operatorGroup("from", value.fromUsers));
  if (!hasOperator(value.searchQuery, "to") && value.toUsers.length)
    parts.push(operatorGroup("to", value.toUsers));
  if (value.mentioningUsers.length)
    parts.push(
      value.mentioningUsers.length === 1
        ? `@${value.mentioningUsers[0]}`
        : `(${value.mentioningUsers.map((user) => `@${user}`).join(" OR ")})`,
    );
  if (value.lang && !hasOperator(value.searchQuery, "lang")) parts.push(`lang:${value.lang}`);
  if (!hasFilterOperator(value.searchQuery)) {
    const filters: Partial<Record<TweetType, readonly string[]>> = {
      [TWEET_TYPE.ORIGINALS_ONLY]: ["-filter:replies", "-filter:retweets"],
      [TWEET_TYPE.REPLIES_ONLY]: ["filter:replies"],
      [TWEET_TYPE.RETWEETS_ONLY]: ["filter:retweets"],
      [TWEET_TYPE.EXCLUDE_REPLIES]: ["-filter:replies"],
      [TWEET_TYPE.EXCLUDE_RETWEETS]: ["-filter:retweets"],
    };
    parts.push(...(filters[value.tweetType] ?? []));
    for (const [field, filter] of [
      ["verifiedOnly", "verified"],
      ["blueVerifiedOnly", "blue_verified"],
      ["hasImages", "images"],
      ["hasVideos", "videos"],
      ["hasLinks", "links"],
      ["hasMentions", "mentions"],
      ["hasHashtags", "hashtags"],
    ] as const)
      if (value[field]) parts.push(`filter:${filter}`);
  }
  if (!hasMinOperator(value.searchQuery)) {
    if (value.minLikes > 0) parts.push(`min_faves:${value.minLikes}`);
    if (value.minReplies > 0) parts.push(`min_replies:${value.minReplies}`);
    if (value.minRetweets > 0) parts.push(`min_retweets:${value.minRetweets}`);
  }
  if (value.since && !hasOperator(value.searchQuery, "since")) parts.push(`since:${stripUtc(value.since)}`);
  if (value.until && !hasOperator(value.searchQuery, "until")) parts.push(`until:${stripUtc(value.until)}`);
  if (
    !(["place", "geocode", "near", "within"] as const).some((operator) =>
      hasOperator(value.searchQuery, operator),
    )
  ) {
    if (value.place) parts.push(`place:${value.place}`);
    else if (value.geocode) parts.push(`geocode:${value.geocode}`);
    else if (value.near)
      parts.push(`near:${value.near}`, ...(value.within ? [`within:${value.within}`] : []));
    else if (value.within) parts.push(`within:${value.within}`);
  }
  return parts.filter(Boolean).join(" ").trim();
}

function formatTerm(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) return value;
  return /\s/u.test(value) ? `"${value}"` : value;
}

function operatorGroup(name: string, values: readonly string[]): string {
  const items = values.map((value) => `${name}:${value}`);
  return items.length === 1 ? items[0]! : `(${items.join(" OR ")})`;
}

function hasOperator(query: string, name: string): boolean {
  return new RegExp(`(?<![A-Za-z0-9_])${name}:`, "iu").test(query);
}

function hasFilterOperator(query: string): boolean {
  return /(?<![A-Za-z0-9_])-?filter:[a-z_]+\b/iu.test(query);
}

function hasMinOperator(query: string): boolean {
  return /(?<![A-Za-z0-9_])min_[a-z_]+:/iu.test(query);
}

function stripUtc(value: string): string {
  return value.endsWith("_UTC") ? value.slice(0, -4) : value;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
