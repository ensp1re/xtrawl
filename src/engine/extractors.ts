import type { FollowRecord, ProfileRecord, TweetRecord } from "../domain/records.js";
import { asInteger, asString, isRecord } from "../utils/guards.js";

export interface TweetPage {
  readonly tweets: readonly TweetRecord[];
  readonly cursor?: string;
}

export interface FollowPage {
  readonly users: readonly Record<string, unknown>[];
  readonly cursor?: string;
}

export function extractUserResult(payload: unknown): Record<string, unknown> | undefined {
  const root = isRecord(payload) ? payload : {};
  const data = isRecord(root.data) ? root.data : {};
  const user = isRecord(data.user) ? data.user : {};
  return isRecord(user.result) ? user.result : undefined;
}

export function mapProfile(
  user: Record<string, unknown>,
  target: { readonly raw?: string; readonly source?: string },
  fallbackUsername?: string,
): ProfileRecord {
  const fields = normalizeUser(user, fallbackUsername);
  return {
    input: {
      ...(target.raw ? { raw: target.raw } : {}),
      ...(target.source ? { source: target.source } : {}),
    },
    ...fields,
    raw: user,
  };
}

export function mapFollow(
  user: Record<string, unknown>,
  target: {
    readonly raw?: string;
    readonly source?: string;
    readonly userId?: string;
    readonly username?: string;
    readonly profileUrl?: string;
  },
  type: FollowRecord["type"],
): FollowRecord {
  return {
    ...normalizeUser(user),
    type,
    target: {
      ...(target.raw ? { raw: target.raw } : {}),
      ...(target.source ? { source: target.source } : {}),
      ...(target.userId ? { userId: target.userId } : {}),
      ...(target.username ? { username: target.username } : {}),
      ...(target.profileUrl ? { profileUrl: target.profileUrl } : {}),
    },
    raw: user,
  };
}

export function extractSearchTweets(payload: unknown): TweetPage {
  const root = isRecord(payload) ? payload : {};
  const data = isRecord(root.data) ? root.data : {};
  const search = isRecord(data.search_by_raw_query) ? data.search_by_raw_query : {};
  const timeline = isRecord(search.search_timeline) ? search.search_timeline : {};
  const nested = isRecord(timeline.timeline) ? timeline.timeline : {};
  return extractTweetsFromInstructions(nested.instructions);
}

export function extractProfileTweets(payload: unknown): TweetPage {
  const root = isRecord(payload) ? payload : {};
  const data = isRecord(root.data) ? root.data : {};
  const user = isRecord(data.user) ? data.user : {};
  const result = isRecord(user.result) ? user.result : {};
  const timeline = isRecord(result.timeline) ? result.timeline : {};
  const nested = isRecord(timeline.timeline) ? timeline.timeline : {};
  return extractTweetsFromInstructions(nested.instructions);
}

export function extractFollows(payload: unknown): FollowPage {
  const instructions = profileInstructions(payload);
  const users: Record<string, unknown>[] = [];
  let cursor: string | undefined;
  for (const instruction of instructions) {
    const entries = entriesFromInstruction(instruction);
    for (const entry of entries) {
      const content = isRecord(entry.content) ? entry.content : {};
      const candidateCursor = asString(content.value);
      const cursorType = asString(content.cursorType)?.toLowerCase();
      if (
        candidateCursor &&
        (String(entry.entryId ?? "").startsWith("cursor-bottom-") || cursorType === "bottom" || !cursor)
      )
        cursor = candidateCursor;
      for (const node of followUsersFromContent(content)) users.push(node);
    }
  }
  return { users, ...(cursor ? { cursor } : {}) };
}

export function normalizeUser(
  user: Record<string, unknown>,
  fallbackUsername?: string,
): Omit<ProfileRecord, "input" | "raw"> {
  const legacy = isRecord(user.legacy) ? user.legacy : {};
  const core = isRecord(user.core) ? user.core : {};
  const verification = isRecord(user.verification) ? user.verification : {};
  const privacy = isRecord(user.privacy) ? user.privacy : {};
  const avatar = isRecord(user.avatar) ? user.avatar : {};
  const location = isRecord(user.location) ? user.location : {};
  const bio = isRecord(user.profile_bio) ? user.profile_bio : {};
  const entities = isRecord(legacy.entities) ? legacy.entities : {};
  const url = firstString(legacy.url) ?? extractUrl(entities);
  return {
    ...(firstString(user.rest_id, user.id, legacy.id_str)
      ? { userId: firstString(user.rest_id, user.id, legacy.id_str) }
      : {}),
    ...(firstString(legacy.screen_name, core.screen_name, fallbackUsername)
      ? { username: firstString(legacy.screen_name, core.screen_name, fallbackUsername) }
      : {}),
    ...(firstString(legacy.name, core.name) ? { name: firstString(legacy.name, core.name) } : {}),
    ...(firstString(legacy.description, bio.description)
      ? { description: firstString(legacy.description, bio.description) }
      : {}),
    ...(firstString(legacy.location, location.location)
      ? { location: firstString(legacy.location, location.location) }
      : {}),
    ...(firstString(legacy.created_at, core.created_at)
      ? { createdAt: firstString(legacy.created_at, core.created_at) }
      : {}),
    followersCount: asInteger(legacy.followers_count),
    followingCount: asInteger(legacy.friends_count),
    statusesCount: asInteger(legacy.statuses_count),
    favouritesCount: asInteger(legacy.favourites_count),
    mediaCount: asInteger(legacy.media_count),
    listedCount: asInteger(legacy.listed_count),
    verified: Boolean(legacy.verified) || Boolean(verification.verified),
    blueVerified: Boolean(user.is_blue_verified) || Boolean(verification.is_blue_verified),
    protected: Boolean(legacy.protected) || Boolean(privacy.protected),
    ...(firstString(legacy.profile_image_url_https, legacy.profile_image_url, avatar.image_url)
      ? {
          profileImageUrl: firstString(
            legacy.profile_image_url_https,
            legacy.profile_image_url,
            avatar.image_url,
          ),
        }
      : {}),
    ...(firstString(legacy.profile_banner_url, avatar.banner_image_url)
      ? { profileBannerUrl: firstString(legacy.profile_banner_url, avatar.banner_image_url) }
      : {}),
    ...(url ? { url } : {}),
  };
}

function extractTweetsFromInstructions(value: unknown): TweetPage {
  const instructions = Array.isArray(value) ? value.filter(isRecord) : [];
  const tweets: TweetRecord[] = [];
  let cursor: string | undefined;
  for (const instruction of instructions) {
    for (const entry of entriesFromInstruction(instruction)) {
      const entryId = String(entry.entryId ?? "");
      const content = isRecord(entry.content) ? entry.content : {};
      const valueText = asString(content.value);
      const cursorType = asString(content.cursorType)?.toLowerCase();
      if (
        valueText &&
        (entryId.includes("cursor-bottom") || cursorType === "bottom" || entryId.startsWith("cursor-"))
      )
        cursor = valueText;
      if (!entryId.startsWith("tweet-")) continue;
      const itemContent = isRecord(content.itemContent) ? content.itemContent : {};
      const tweetResults = isRecord(itemContent.tweet_results) ? itemContent.tweet_results : {};
      const raw = isRecord(tweetResults.result) ? tweetResults.result : undefined;
      if (raw) tweets.push(mapTweet(raw, entryId));
    }
  }
  return { tweets, ...(cursor ? { cursor } : {}) };
}

function mapTweet(rawResult: Record<string, unknown>, entryId: string): TweetRecord {
  const tweet = isRecord(rawResult.tweet) ? rawResult.tweet : rawResult;
  const legacy = isRecord(tweet.legacy) ? tweet.legacy : {};
  const core = isRecord(tweet.core) ? tweet.core : {};
  const userResults = isRecord(core.user_results) ? core.user_results : {};
  const user = isRecord(userResults.result) ? userResults.result : {};
  const userLegacy = isRecord(user.legacy) ? user.legacy : {};
  const userCore = isRecord(user.core) ? user.core : {};
  const screenName = firstString(userLegacy.screen_name, userCore.screen_name);
  const tweetId = firstString(legacy.id_str, tweet.rest_id, entryId.replace(/^tweet-/u, "")) ?? entryId;
  const note =
    isRecord(tweet.note_tweet) &&
    isRecord(tweet.note_tweet.note_tweet_results) &&
    isRecord(tweet.note_tweet.note_tweet_results.result)
      ? tweet.note_tweet.note_tweet_results.result
      : {};
  const text = firstString(note.text, legacy.full_text) ?? "";
  const media =
    isRecord(legacy.extended_entities) && Array.isArray(legacy.extended_entities.media)
      ? legacy.extended_entities.media
      : [];
  const imageLinks = media.flatMap((item) =>
    isRecord(item) && asString(item.media_url_https) ? [asString(item.media_url_https)!] : [],
  );
  const embeddedText = extractEmbeddedText(tweet, legacy);
  return {
    tweetId,
    user: {
      ...(screenName ? { screenName } : {}),
      ...(firstString(userLegacy.name, userCore.name)
        ? { name: firstString(userLegacy.name, userCore.name) }
        : {}),
    },
    ...(firstString(legacy.created_at) ? { timestamp: firstString(legacy.created_at) } : {}),
    text,
    ...(embeddedText ? { embeddedText } : {}),
    comments: asInteger(legacy.reply_count),
    likes: asInteger(legacy.favorite_count),
    retweets: asInteger(legacy.retweet_count),
    media: { imageLinks },
    ...(screenName ? { tweetUrl: `https://x.com/${screenName}/status/${tweetId}` } : {}),
    raw: rawResult,
  };
}

function extractEmbeddedText(
  tweet: Record<string, unknown>,
  legacy: Record<string, unknown>,
): string | undefined {
  const quoted = isRecord(tweet.quoted_status_result) ? tweet.quoted_status_result : {};
  const quotedResult = isRecord(quoted.result) ? quoted.result : {};
  const quotedLegacy = isRecord(quotedResult.legacy) ? quotedResult.legacy : {};
  if (asString(quotedLegacy.full_text)) return asString(quotedLegacy.full_text);
  const retweeted = isRecord(legacy.retweeted_status_result) ? legacy.retweeted_status_result : {};
  const retweetedResult = isRecord(retweeted.result) ? retweeted.result : {};
  const retweetedLegacy = isRecord(retweetedResult.legacy) ? retweetedResult.legacy : {};
  return asString(retweetedLegacy.full_text);
}

function profileInstructions(payload: unknown): Record<string, unknown>[] {
  const root = isRecord(payload) ? payload : {};
  const data = isRecord(root.data) ? root.data : {};
  const user = isRecord(data.user) ? data.user : {};
  const result = isRecord(user.result) ? user.result : {};
  const timeline = isRecord(result.timeline) ? result.timeline : {};
  const nested = isRecord(timeline.timeline) ? timeline.timeline : {};
  return Array.isArray(nested.instructions) ? nested.instructions.filter(isRecord) : [];
}

function entriesFromInstruction(instruction: Record<string, unknown>): Record<string, unknown>[] {
  const entries = Array.isArray(instruction.entries) ? instruction.entries.filter(isRecord) : [];
  return isRecord(instruction.entry) ? [...entries, instruction.entry] : entries;
}

function followUsersFromContent(content: Record<string, unknown>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const add = (value: unknown): void => {
    const item = isRecord(value) ? value : {};
    const itemContent = isRecord(item.itemContent) ? item.itemContent : item;
    const userResults = isRecord(itemContent.user_results) ? itemContent.user_results : {};
    if (isRecord(userResults.result)) out.push(userResults.result);
  };
  add(content.itemContent);
  if (isRecord(content.item)) add(content.item.itemContent);
  if (Array.isArray(content.items))
    for (const item of content.items)
      if (isRecord(item)) add(isRecord(item.item) ? item.item.itemContent : item.itemContent);
  return out;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = asString(value);
    if (text) return text;
  }
  return undefined;
}

function extractUrl(entities: Record<string, unknown>): string | undefined {
  const urlNode = isRecord(entities.url) ? entities.url : {};
  const urls = Array.isArray(urlNode.urls) ? urlNode.urls : [];
  for (const item of urls)
    if (isRecord(item)) {
      const value = firstString(item.expanded_url, item.url, item.display_url);
      if (value) return value;
    }
  return undefined;
}
