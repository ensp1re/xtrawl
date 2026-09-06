import type { QUEUE_TASK_STATUS } from "../constants/runner.js";

export type QueueTaskStatus = (typeof QUEUE_TASK_STATUS)[keyof typeof QUEUE_TASK_STATUS];

export interface QueueTask<T> {
  readonly id: string;
  readonly payload: T;
  readonly attempts: number;
  readonly generation: number;
  readonly status: QueueTaskStatus;
  readonly leasedUntil?: number;
  readonly error?: string;
}

export interface RunnerOptions {
  readonly concurrency: number;
  readonly leaseTtlMs?: number;
  readonly maxAttempts?: number;
}

export interface RunnerResult<T> {
  readonly complete: readonly T[];
  readonly failed: readonly { readonly task: QueueTask<T>; readonly error: unknown }[];
  readonly retries: number;
}

export interface RetryOptions {
  readonly maxAttempts: number;
  readonly baseMs: number;
  readonly maxMs: number;
}
