import type { ClientConfig } from "../config/types.js";
import type { FollowRecord, SearchResult, TweetRecord } from "../domain/records.js";
import type { FollowsRequest, ProfileTimelineRequest, TargetInput } from "../domain/requests.js";
import { mapFollow } from "../engine/extractors.js";
import type { ApiEngine } from "../engine/api-engine.js";
import type { AccountPool } from "../pool/account-pool.js";
import { queryHash } from "../query/hash.js";
import type { StorageBundle } from "../storage/index.js";
import { saveRows } from "../output/writer.js";

export interface CollectionContext {
  readonly config: ClientConfig;
  readonly pool: AccountPool;
  readonly engine: ApiEngine;
  readonly storage: StorageBundle;
}

export async function collectProfileTweets(
  context: CollectionContext,
  targets: readonly TargetInput[],
  options: Omit<ProfileTimelineRequest, "targets">,
): Promise<SearchResult> {
  const request: ProfileTimelineRequest = { targets, ...options };
  const tweets = await context.pool.execute("profile-tweets", async ({ session }) => {
    const out: TweetRecord[] = [];
    for (const target of targets) {
      const resolved = await context.engine.resolveTarget(session, target);
      const checkpointHash = queryHash({ operation: "profile_tweets", target, options });
      const saved = options.resume ? context.storage.checkpoints.get(checkpointHash) : undefined;
      let cursor = options.initialCursors?.[targetKey(target, resolved.userId)] ?? saved?.root;
      let empty = 0;
      let pages = 0;
      let profileCount = 0;
      const maxPages = options.maxPagesPerProfile ?? Number.POSITIVE_INFINITY;
      while (pages < maxPages) {
        pages += 1;
        const page = await context.engine.profilePage(session, resolved.userId, request, cursor);
        const globalRemaining =
          options.limit === undefined ? page.tweets.length : Math.max(0, options.limit - out.length);
        const profileRemaining =
          options.perProfileLimit === undefined
            ? page.tweets.length
            : Math.max(0, options.perProfileLimit - profileCount);
        const remaining = page.tweets.slice(0, Math.min(globalRemaining, profileRemaining));
        out.push(...remaining);
        profileCount += remaining.length;
        empty = page.tweets.length === 0 ? empty + 1 : 0;
        if (options.resume && page.cursor)
          context.storage.checkpoints.save(checkpointHash, { root: page.cursor });
        if (stopPaging(options, out.length, profileCount, page.cursor, empty, context.config.maxEmptyPages))
          break;
        cursor = page.cursor;
      }
      context.storage.checkpoints.clear(checkpointHash);
      if (options.limit !== undefined && out.length >= options.limit) break;
    }
    return out;
  });
  await saveCollection(context, "profile_tweets", tweets, options);
  return { tweets, stats: stats(tweets.length, targets.length) };
}

export async function collectFollows(
  context: CollectionContext,
  targets: readonly TargetInput[],
  options: FollowsRequest,
): Promise<readonly FollowRecord[]> {
  const follows = await context.pool.execute(options.followType, async ({ session }) => {
    const out: FollowRecord[] = [];
    for (const target of targets) {
      const resolved = await context.engine.resolveTarget(session, target);
      const checkpointHash = queryHash({ operation: options.followType, target, options });
      const saved = options.resume ? context.storage.checkpoints.get(checkpointHash) : undefined;
      let cursor = options.initialCursors?.[targetKey(target, resolved.userId)] ?? saved?.root;
      let empty = 0;
      let pages = 0;
      let targetCount = 0;
      const seen = new Set<string>();
      const maxPages = options.maxPagesPerProfile ?? Number.POSITIVE_INFINITY;
      while (pages < maxPages) {
        pages += 1;
        const page = await context.engine.followsPage(session, resolved.userId, options.followType, cursor);
        for (const user of page.users) {
          const mapped = mapFollow(user, { ...target, userId: resolved.userId }, options.followType);
          const key = mapped.userId ?? mapped.username;
          if (key && !seen.has(key) && withinProfileLimit(options.perProfileLimit, targetCount)) {
            seen.add(key);
            out.push(mapped);
            targetCount += 1;
          }
        }
        empty = page.users.length === 0 ? empty + 1 : 0;
        if (options.resume && page.cursor)
          context.storage.checkpoints.save(checkpointHash, { root: page.cursor });
        if (stopPaging(options, out.length, targetCount, page.cursor, empty, context.config.maxEmptyPages))
          break;
        cursor = page.cursor;
      }
      context.storage.checkpoints.clear(checkpointHash);
      if (options.limit !== undefined && out.length >= options.limit) break;
    }
    return options.limit === undefined ? out : out.slice(0, options.limit);
  });
  await saveCollection(context, options.followType, follows, options);
  return follows;
}

async function saveCollection(
  context: CollectionContext,
  name: string,
  rows: readonly unknown[],
  options: SaveOptions,
): Promise<void> {
  if (!options.save) return;
  await saveRows(options.saveName ?? name, rows, {
    directory: options.saveDir ?? context.config.saveDir,
    format: options.saveFormat ?? context.config.saveFormat,
  });
}

function stopPaging(
  options: { readonly limit?: number; readonly perProfileLimit?: number },
  total: number,
  profileTotal: number,
  cursor: string | undefined,
  empty: number,
  maxEmptyPages: number,
): boolean {
  return Boolean(
    (options.limit !== undefined && total >= options.limit) ||
    (options.perProfileLimit !== undefined && profileTotal >= options.perProfileLimit) ||
    !cursor ||
    empty >= maxEmptyPages,
  );
}

function withinProfileLimit(limit: number | undefined, count: number): boolean {
  return limit === undefined || count < limit;
}

function targetKey(target: TargetInput, resolvedUserId: string): string {
  return target.username ?? target.userId ?? target.profileUrl ?? target.raw ?? resolvedUserId;
}

function stats(tweetsCount: number, tasksTotal: number): SearchResult["stats"] {
  return { tweetsCount, tasksTotal, tasksDone: tasksTotal, tasksFailed: 0, retries: 0 };
}

type SaveOptions = Pick<ProfileTimelineRequest, "save" | "saveDir" | "saveFormat" | "saveName">;
