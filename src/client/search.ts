import type { ClientConfig } from "../config/types.js";
import { ConfigError, NetworkError, RunFailed, XTrawlError } from "../domain/errors.js";
import { isAbortError } from "../utils/abort.js";
import type { SearchPageResult, SearchResult, TweetRecord } from "../domain/records.js";
import type { SearchPageRequest, SearchRequest } from "../domain/requests.js";
import type { ApiEngine } from "../engine/api-engine.js";
import type { AccountPool } from "../pool/account-pool.js";
import { collectionIdentity } from "../query/collection-id.js";
import { queryHash } from "../query/hash.js";
import { ExecutionRunner } from "../runner/runner.js";
import type { StorageBundle } from "../storage/index.js";
import { saveRows } from "../output/writer.js";
import { searchOutputName } from "../output/names.js";
import { commitAcceptedPage } from "./page-commit.js";
import { isRecord } from "../utils/guards.js";

export interface SearchContext {
  readonly config: ClientConfig;
  readonly pool: AccountPool;
  readonly engine: ApiEngine;
  readonly storage: StorageBundle;
  readonly signal?: AbortSignal;
}

interface SearchTask {
  readonly id: string;
  readonly request: SearchRequest;
}

interface PageExecutionOptions {
  readonly cursor?: string;
  readonly maxAccountSwitches?: number;
  readonly onRetry?: () => void;
}

export async function collectSearchPage(
  context: SearchContext,
  query: string,
  options: SearchPageRequest,
): Promise<SearchPageResult> {
  const { cursor, maxAccountSwitches, ...searchOptions } = options;
  const request = withDefaultBounds({
    ...searchOptions,
    ...(query ? { searchQuery: query } : {}),
  });
  return requestSearchPage(context, request, { cursor, maxAccountSwitches });
}

export async function collectSearch(
  context: SearchContext,
  query: string,
  options: SearchRequest,
): Promise<SearchResult> {
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 0))
    throw new ConfigError("limit must be a non-negative integer");
  const request = withDefaultBounds({ ...options, ...(query ? { searchQuery: query } : {}) });
  const hash = queryHash({ operation: "search", request });
  const run = context.storage.runs.create("search", hash);
  const collectionId = collectionIdentity("search", request, request.resume ? {} : { runId: run.id });
  const usefulSplits =
    request.limit === undefined
      ? context.config.searchSplits
      : Math.min(
          context.config.searchSplits,
          Math.max(1, Math.ceil(request.limit / context.config.apiPageSize)),
        );
  const tasks = splitSearchTasks(request, usefulSplits, context.config.schedulerMinIntervalMs);
  const tweets = new Map<string, TweetRecord>();
  const cursors = new Map<string, string>();
  let poolRetries = 0;
  let limitReached = false;
  try {
    if (request.resume) {
      for (const record of context.storage.progress.accepted(collectionId)) {
        if (isTweetRecord(record.payload)) tweets.set(record.payload.tweetId, record.payload);
      }
      if (request.limit !== undefined && tweets.size >= request.limit) limitReached = true;
    }
    for (const task of tasks) {
      const saved = context.storage.progress.task(collectionId, task.id);
      if (saved?.state === "exhausted") continue;
      const cursor =
        saved?.cursor ?? (request.resume ? context.storage.checkpoints.get(task.id)?.root : undefined);
      if (cursor) cursors.set(task.id, cursor);
    }
    const runner = new ExecutionRunner<SearchTask>({
      concurrency: workerCount(context, tasks.length),
      maxAttempts: 1,
    });
    const outcome = await runner.run(
      tasks.filter((task) => context.storage.progress.task(collectionId, task.id)?.state !== "exhausted"),
      async (task) => {
        let cursor = cursors.get(task.id);
        let emptyPages = 0;
        while (!limitReached) {
          const inputCursor = cursor;
          const page = await requestSearchPage(context, task.request, {
            cursor: inputCursor,
            onRetry: () => {
              poolRetries += 1;
            },
          });
          const batch: Array<{ id: string; payload: TweetRecord }> = [];
          let added = 0;
          let capped = false;
          for (const tweet of page.tweets) {
            if (tweets.has(tweet.tweetId) || context.storage.progress.hasRecord(collectionId, tweet.tweetId))
              continue;
            if (request.limit !== undefined && tweets.size + batch.length >= request.limit) {
              capped = true;
              limitReached = true;
              break;
            }
            batch.push({ id: tweet.tweetId, payload: tweet });
            added += 1;
          }
          for (const item of batch) tweets.set(item.id, item.payload);
          if (request.limit !== undefined && tweets.size >= request.limit) limitReached = true;
          emptyPages = added === 0 && !capped ? emptyPages + 1 : 0;
          const exhausted =
            !capped &&
            !limitReached &&
            (!page.nextCursor || emptyPages >= (request.maxEmptyPages ?? context.config.maxEmptyPages));
          commitAcceptedPage(context.storage, {
            collectionId,
            taskId: task.id,
            state: capped || limitReached ? "capped" : exhausted ? "exhausted" : "active",
            ...(inputCursor === undefined ? {} : { inputCursor }),
            ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
            records: batch,
            persistLegacyCheckpoint: Boolean(request.resume),
          });
          if (capped || limitReached || exhausted) break;
          cursor = page.nextCursor;
        }
      },
    );
    if (outcome.failed.length > 0 && (context.config.strict || tweets.size === 0))
      throw failureFor("Search", outcome.failed);
    const collected =
      request.limit === undefined ? [...tweets.values()] : [...tweets.values()].slice(0, request.limit);
    if (request.save)
      await saveRows(
        request.saveName ??
          searchOutputName(request.searchQuery, request.since, request.until, request.fromUsers),
        collected,
        {
          directory: request.saveDir ?? context.config.saveDir,
          format: request.saveFormat ?? context.config.saveFormat,
          append: true,
        },
      );
    const result: SearchResult = {
      tweets: collected,
      stats: {
        tweetsCount: collected.length,
        tasksTotal: tasks.length,
        tasksDone: outcome.complete.length,
        tasksFailed: outcome.failed.length,
        retries: outcome.retries + poolRetries,
      },
    };
    context.storage.runs.finalize(run.id, outcome.failed.length > 0 ? "partial" : "complete");
    return result;
  } catch (error) {
    const cancelled =
      isAbortError(error) || (error instanceof NetworkError && error.diagnostics.statusCode === 499);
    context.storage.runs.finalize(
      run.id,
      cancelled ? "cancelled" : "failed",
      error instanceof Error ? { name: error.name, message: error.message } : error,
    );
    throw error instanceof XTrawlError
      ? error
      : new RunFailed(error instanceof Error ? error.message : String(error));
  }
}

async function requestSearchPage(
  context: SearchContext,
  request: SearchRequest,
  options: PageExecutionOptions = {},
): Promise<SearchPageResult> {
  const page = await context.pool.execute(
    "search",
    ({ session, signal, chargeRequest }) =>
      context.engine.search(session, request, options.cursor, signal ?? context.signal, chargeRequest),
    {
      countTweets: (value) => value.tweets.length,
      ...(options.onRetry ? { onRetry: options.onRetry } : {}),
      ...(options.maxAccountSwitches === undefined ? {} : { maxAccountSwitches: options.maxAccountSwitches }),
      ...(context.signal ? { signal: context.signal } : {}),
    },
  );
  return { tweets: page.tweets, nextCursor: page.cursor };
}

export function withDefaultBounds(request: SearchRequest, now = new Date()): SearchRequest {
  const until = request.until ?? dateOnly(now);
  const since = request.since ?? dateOnly(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1_000));
  return { ...request, since, until };
}

export function splitSearchTasks(
  request: SearchRequest,
  requestedSplits: number,
  minIntervalMs: number,
): readonly SearchTask[] {
  const start = parseBound(request.since);
  const end = parseBound(request.until);
  if (start === undefined || end === undefined || end <= start)
    return [{ id: queryHash({ operation: "search_task", request }), request }];
  const duration = end - start;
  const count = Math.max(1, Math.min(requestedSplits, Math.floor(duration / minIntervalMs)));
  return Array.from({ length: count }, (_, index) => {
    const since = start + Math.floor((duration * index) / count);
    const until = start + Math.floor((duration * (index + 1)) / count);
    const taskRequest = { ...request, since: searchDate(since), until: searchDate(until) };
    return { id: queryHash({ operation: "search_task", request: taskRequest }), request: taskRequest };
  });
}

function workerCount(context: SearchContext, taskCount: number): number {
  return Math.max(1, Math.min(context.config.concurrency, context.pool.summary.eligible, taskCount));
}

function failureFor(label: string, failed: readonly { readonly error: unknown }[]): Error {
  const first = failed[0]?.error;
  return first instanceof Error
    ? first
    : new RunFailed(`${label} failed for ${failed.length} task(s): ${String(first)}`);
}

function parseBound(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const normalized = value.endsWith("_UTC") ? value.replace("_UTC", "Z").replace("_", "T") : value;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function searchDate(value: number): string {
  return new Date(value)
    .toISOString()
    .replace("T", "_")
    .replace(/\.000Z$/u, "_UTC");
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function isTweetRecord(value: unknown): value is TweetRecord {
  return isRecord(value) && typeof value.tweetId === "string";
}
