import { randomUUID } from "node:crypto";
import type { ClientConfig } from "../config/types.js";
import type { FollowRecord, SearchResult, TweetRecord } from "../domain/records.js";
import type { FollowsRequest, ProfileTimelineRequest, TargetInput } from "../domain/requests.js";
import { mapFollow } from "../engine/extractors.js";
import type { ApiEngine } from "../engine/api-engine.js";
import type { AccountPool } from "../pool/account-pool.js";
import { RunFailed } from "../domain/errors.js";
import { collectionIdentity } from "../query/collection-id.js";
import { ExecutionRunner } from "../runner/runner.js";
import type { StorageBundle } from "../storage/index.js";
import { saveRows } from "../output/writer.js";
import { targetOutputName } from "../output/names.js";
import { commitAcceptedPage } from "./page-commit.js";
import { isRecord } from "../utils/guards.js";

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
  const runScope = options.resume ? {} : { runId: randomUUID() };
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
    const collectionId = collectionIdentity("profile_tweets", { target, ...options }, runScope);
    const seen = seenByTarget.get(collectionId) ?? new Set<string>();
    seenByTarget.set(collectionId, seen);
    if (options.resume) {
      for (const record of context.storage.progress.accepted(collectionId)) {
        if (typeof record.id === "string") seen.add(record.id);
        if (isTweetRecord(record.payload)) {
          out.push(record.payload);
          counts.set(collectionId, (counts.get(collectionId) ?? 0) + 1);
        }
      }
    }
    const saved = context.storage.progress.task(collectionId, collectionId);
    let cursor =
      cursors.get(collectionId) ??
      options.initialCursors?.[targetKey(target, resolved.userId)] ??
      saved?.cursor ??
      (options.resume ? context.storage.checkpoints.get(collectionId)?.root : undefined);
    let empty = 0;
    let pages = 0;
    let profileCount = counts.get(collectionId) ?? 0;
    const maxPages = options.maxPagesPerProfile ?? Number.POSITIVE_INFINITY;
    while (pages < maxPages && !limitReached && saved?.state !== "exhausted") {
      pages += 1;
      const inputCursor = cursor;
      const page = await context.pool.execute(
        "profile-tweets",
        ({ session, signal, chargeRequest }) =>
          context.engine.profilePage(
            session,
            resolved.userId,
            request,
            inputCursor,
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
      const batch: Array<{ id: string; payload: TweetRecord }> = [];
      let added = 0;
      let capped = false;
      for (const tweet of page.tweets) {
        if (seen.has(tweet.tweetId)) continue;
        if (
          (options.limit !== undefined && out.length + batch.length >= options.limit) ||
          (options.perProfileLimit !== undefined && profileCount + batch.length >= options.perProfileLimit)
        ) {
          capped = true;
          if (options.limit !== undefined && out.length + batch.length >= options.limit) limitReached = true;
          break;
        }
        batch.push({ id: tweet.tweetId, payload: tweet });
        added += 1;
      }
      for (const item of batch) {
        seen.add(item.id);
        out.push(item.payload);
        profileCount += 1;
      }
      counts.set(collectionId, profileCount);
      if (options.limit !== undefined && out.length >= options.limit) limitReached = true;
      empty = added === 0 && !capped ? empty + 1 : 0;
      const exhausted =
        !capped &&
        stopPaging(
          options,
          out.length,
          profileCount,
          page.cursor,
          empty,
          options.maxEmptyPages ?? context.config.maxEmptyPages,
        );
      commitAcceptedPage(context.storage, {
        collectionId,
        taskId: collectionId,
        state: capped ? "capped" : exhausted ? "exhausted" : "active",
        ...(inputCursor === undefined ? {} : { inputCursor }),
        ...(page.cursor === undefined ? {} : { nextCursor: page.cursor }),
        records: batch,
        persistLegacyCheckpoint: Boolean(options.resume),
      });
      if (capped || limitReached || exhausted) break;
      cursor = page.cursor;
    }
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
  const runScope = options.resume ? {} : { runId: randomUUID() };
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
    const collectionId = collectionIdentity(options.followType, { target, ...options }, runScope);
    const seen = seenByTarget.get(collectionId) ?? new Set<string>();
    seenByTarget.set(collectionId, seen);
    if (options.resume) {
      for (const record of context.storage.progress.accepted(collectionId)) {
        seen.add(record.id);
        if (isFollowRecord(record.payload)) out.push(record.payload);
      }
    }
    const saved = context.storage.progress.task(collectionId, collectionId);
    let cursor =
      cursors.get(collectionId) ??
      options.initialCursors?.[targetKey(target, resolved.userId)] ??
      saved?.cursor ??
      (options.resume ? context.storage.checkpoints.get(collectionId)?.root : undefined);
    let empty = 0;
    let pages = 0;
    let targetCount = seen.size;
    const maxPages = options.maxPagesPerProfile ?? Number.POSITIVE_INFINITY;
    while (pages < maxPages && !limitReached && saved?.state !== "exhausted") {
      pages += 1;
      const inputCursor = cursor;
      const page = await context.pool.execute(
        options.followType,
        ({ session, signal, chargeRequest }) =>
          context.engine.followsPage(
            session,
            resolved.userId,
            options.followType,
            inputCursor,
            signal ?? context.signal,
            chargeRequest,
          ),
        {
          maxAccountSwitches: options.maxAccountSwitches,
          ...(context.signal ? { signal: context.signal } : {}),
        },
      );
      const batch: Array<{ id: string; payload: FollowRecord }> = [];
      let added = 0;
      let capped = false;
      for (const user of page.users) {
        const mapped = mapFollow(
          user,
          { ...target, userId: resolved.userId },
          options.followType,
          options.rawJson,
        );
        const key = mapped.userId ?? mapped.username;
        if (!key || seen.has(key) || batch.some((item) => item.id === key)) continue;
        if (!withinProfileLimit(options.perProfileLimit, targetCount + batch.length)) {
          capped = true;
          break;
        }
        if (options.limit !== undefined && out.length + batch.length >= options.limit) {
          capped = true;
          limitReached = true;
          break;
        }
        batch.push({ id: key, payload: mapped });
        added += 1;
      }
      for (const item of batch) {
        seen.add(item.id);
        out.push(item.payload);
        targetCount += 1;
      }
      if (options.limit !== undefined && out.length >= options.limit) limitReached = true;
      empty = added === 0 && !capped ? empty + 1 : 0;
      const exhausted =
        !capped &&
        stopPaging(
          options,
          out.length,
          targetCount,
          page.cursor,
          empty,
          options.maxEmptyPages ?? context.config.maxEmptyPages,
        );
      commitAcceptedPage(context.storage, {
        collectionId,
        taskId: collectionId,
        state: capped ? "capped" : exhausted ? "exhausted" : "active",
        ...(inputCursor === undefined ? {} : { inputCursor }),
        ...(page.cursor === undefined ? {} : { nextCursor: page.cursor }),
        records: batch,
        persistLegacyCheckpoint: Boolean(options.resume),
      });
      if (capped || limitReached || exhausted) break;
      cursor = page.cursor;
    }
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

function isTweetRecord(value: unknown): value is TweetRecord {
  return isRecord(value) && typeof value.tweetId === "string";
}

function isFollowRecord(value: unknown): value is FollowRecord {
  return isRecord(value) && typeof value.type === "string";
}
