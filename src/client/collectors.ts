import type { ClientConfig } from "../config/types.js";
import type { FollowRecord, SearchResult, TweetRecord } from "../domain/records.js";
import type { FollowsRequest, ProfileTimelineRequest, TargetInput } from "../domain/requests.js";
import { mapFollow } from "../engine/extractors.js";
import type { ApiEngine } from "../engine/api-engine.js";
import type { AccountPool } from "../pool/account-pool.js";
import { RunFailed } from "../domain/errors.js";
import { queryHash } from "../query/hash.js";
import { ExecutionRunner } from "../runner/runner.js";
import type { StorageBundle } from "../storage/index.js";
import { saveRows } from "../output/writer.js";
import { targetOutputName } from "../output/names.js";

export interface CollectionContext {
  readonly config: ClientConfig;
  readonly pool: AccountPool;
  readonly engine: ApiEngine;
  readonly storage: StorageBundle;
  readonly signal?: AbortSignal;
}

export async function collectProfileTweets(
  context: CollectionContext,
  targets: readonly TargetInput[],
  options: Omit<ProfileTimelineRequest, "targets">,
): Promise<SearchResult> {
  const request: ProfileTimelineRequest = { targets, ...options };
  const out: TweetRecord[] = [];
  const seenByTarget = new Map<string, Set<string>>();
  const cursors = new Map<string, string>();
  const counts = new Map<string, number>();
  let limitReached = false;
  let poolRetries = 0;
  const runner = new ExecutionRunner<TargetInput>({
    concurrency: workerCount(context, targets.length),
    maxAttempts: 1,
  });
  const outcome = await runner.run(targets, async (target) => {
    const resolved = await resolveTarget(
      context,
      target,
      () => {
        poolRetries += 1;
      },
      options.maxAccountSwitches,
    );
    const checkpointHash = queryHash({ operation: "profile_tweets", target, options });
    const seen = seenByTarget.get(checkpointHash) ?? new Set<string>();
    seenByTarget.set(checkpointHash, seen);
    const saved = options.resume ? context.storage.checkpoints.get(checkpointHash) : undefined;
    let cursor =
      cursors.get(checkpointHash) ??
      options.initialCursors?.[targetKey(target, resolved.userId)] ??
      saved?.root;
    let empty = 0;
    let pages = 0;
    let profileCount = counts.get(checkpointHash) ?? 0;
    const maxPages = options.maxPagesPerProfile ?? Number.POSITIVE_INFINITY;
    while (pages < maxPages && !limitReached) {
      pages += 1;
      const page = await context.pool.execute(
        "profile-tweets",
        ({ session, signal, chargeRequest }) =>
          context.engine.profilePage(
            session,
            resolved.userId,
            request,
            cursor,
            signal ?? context.signal,
            chargeRequest,
          ),
        {
          countTweets: (value) => value.tweets.length,
          onRetry: () => {
            poolRetries += 1;
          },
          maxAccountSwitches: options.maxAccountSwitches,
          ...(context.signal ? { signal: context.signal } : {}),
        },
      );
      const globalRemaining =
        options.limit === undefined ? page.tweets.length : Math.max(0, options.limit - out.length);
      const profileRemaining =
        options.perProfileLimit === undefined
          ? page.tweets.length
          : Math.max(0, options.perProfileLimit - profileCount);
      const remaining = page.tweets.slice(0, Math.min(globalRemaining, profileRemaining));
      let added = 0;
      for (const tweet of remaining) {
        if (seen.has(tweet.tweetId)) continue;
        seen.add(tweet.tweetId);
        out.push(tweet);
        added += 1;
        profileCount += 1;
        counts.set(checkpointHash, profileCount);
        if (options.limit !== undefined && out.length >= options.limit) {
          limitReached = true;
          break;
        }
      }
      empty = added === 0 ? empty + 1 : 0;
      if (options.resume && page.cursor)
        context.storage.checkpoints.save(checkpointHash, { root: page.cursor });
      if (page.cursor) cursors.set(checkpointHash, page.cursor);
      if (
        stopPaging(
          options,
          out.length,
          profileCount,
          page.cursor,
          empty,
          options.maxEmptyPages ?? context.config.maxEmptyPages,
        )
      )
        break;
      cursor = page.cursor;
    }
    if (!limitReached) context.storage.checkpoints.clear(checkpointHash);
  });
  if (outcome.failed.length > 0 && (context.config.strict || out.length === 0))
    throw failureFor("Profile timeline", outcome.failed);
  const tweets = options.limit === undefined ? out : out.slice(0, options.limit);
  await saveCollection(context, "profile_tweets", tweets, options, targets);
  return {
    tweets,
    stats: {
      tweetsCount: tweets.length,
      tasksTotal: targets.length,
      tasksDone: outcome.complete.length,
      tasksFailed: outcome.failed.length,
      retries: outcome.retries + poolRetries,
    },
  };
}

export async function collectFollows(
  context: CollectionContext,
  targets: readonly TargetInput[],
  options: FollowsRequest,
): Promise<readonly FollowRecord[]> {
  const out: FollowRecord[] = [];
  const seenByTarget = new Map<string, Set<string>>();
  const cursors = new Map<string, string>();
  let limitReached = false;
  const runner = new ExecutionRunner<TargetInput>({
    concurrency: workerCount(context, targets.length),
    maxAttempts: 1,
  });
  const outcome = await runner.run(targets, async (target) => {
    const resolved = await resolveTarget(context, target, undefined, options.maxAccountSwitches);
    const checkpointHash = queryHash({ operation: options.followType, target, options });
    const saved = options.resume ? context.storage.checkpoints.get(checkpointHash) : undefined;
    let cursor =
      cursors.get(checkpointHash) ??
      options.initialCursors?.[targetKey(target, resolved.userId)] ??
      saved?.root;
    let empty = 0;
    let pages = 0;
    const seen = seenByTarget.get(checkpointHash) ?? new Set<string>();
    seenByTarget.set(checkpointHash, seen);
    let targetCount = seen.size;
    const maxPages = options.maxPagesPerProfile ?? Number.POSITIVE_INFINITY;
    while (pages < maxPages && !limitReached) {
      pages += 1;
      const page = await context.pool.execute(
        options.followType,
        ({ session, signal, chargeRequest }) =>
          context.engine.followsPage(
            session,
            resolved.userId,
            options.followType,
            cursor,
            signal ?? context.signal,
            chargeRequest,
          ),
        {
          maxAccountSwitches: options.maxAccountSwitches,
          ...(context.signal ? { signal: context.signal } : {}),
        },
      );
      let added = 0;
      for (const user of page.users) {
        const mapped = mapFollow(
          user,
          { ...target, userId: resolved.userId },
          options.followType,
          options.rawJson,
        );
        const key = mapped.userId ?? mapped.username;
        if (key && !seen.has(key) && withinProfileLimit(options.perProfileLimit, targetCount)) {
          seen.add(key);
          out.push(mapped);
          added += 1;
          targetCount += 1;
          if (options.limit !== undefined && out.length >= options.limit) {
            limitReached = true;
            break;
          }
        }
      }
      empty = added === 0 ? empty + 1 : 0;
      if (options.resume && page.cursor)
        context.storage.checkpoints.save(checkpointHash, { root: page.cursor });
      if (page.cursor) cursors.set(checkpointHash, page.cursor);
      if (
        stopPaging(
          options,
          out.length,
          targetCount,
          page.cursor,
          empty,
          options.maxEmptyPages ?? context.config.maxEmptyPages,
        )
      )
        break;
      cursor = page.cursor;
    }
    if (!limitReached) context.storage.checkpoints.clear(checkpointHash);
  });
  if (outcome.failed.length > 0 && (context.config.strict || out.length === 0))
    throw failureFor("Relationship collection", outcome.failed);
  const follows = options.limit === undefined ? out : out.slice(0, options.limit);
  await saveCollection(context, options.followType, follows, options, targets);
  return follows;
}

async function saveCollection(
  context: CollectionContext,
  name: string,
  rows: readonly unknown[],
  options: SaveOptions,
  targets: readonly TargetInput[],
): Promise<void> {
  if (!options.save) return;
  await saveRows(options.saveName ?? targetOutputName(name, targets), rows, {
    directory: options.saveDir ?? context.config.saveDir,
    format: options.saveFormat ?? context.config.saveFormat,
    append: true,
  });
}

async function resolveTarget(
  context: CollectionContext,
  target: TargetInput,
  onRetry?: () => void,
  maxAccountSwitches?: number,
): Promise<{ readonly username: string; readonly userId: string; readonly raw: Record<string, unknown> }> {
  if (target.userId && !target.username) return { username: target.userId, userId: target.userId, raw: {} };
  return context.pool.execute(
    "user-lookup",
    ({ session, signal, chargeRequest }) =>
      context.engine.resolveTarget(session, target, signal ?? context.signal, chargeRequest),
    {
      onRetry,
      maxAccountSwitches,
      ...(context.signal ? { signal: context.signal } : {}),
    },
  );
}

function workerCount(context: CollectionContext, tasks: number): number {
  return Math.max(1, Math.min(context.config.concurrency, context.pool.summary.eligible, tasks));
}

function failureFor(label: string, failed: readonly { readonly error: unknown }[]): Error {
  const first = failed[0]?.error;
  return first instanceof Error
    ? first
    : new RunFailed(`${label} failed for ${failed.length} target(s): ${String(first)}`);
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

type SaveOptions = Pick<ProfileTimelineRequest, "save" | "saveDir" | "saveFormat" | "saveName">;
