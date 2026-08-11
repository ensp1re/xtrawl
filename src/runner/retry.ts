import type { XTrawlError } from "../domain/errors.js";
import { sleep } from "../pool/limiter.js";

export interface RetryOptions {
  readonly maxAttempts: number;
  readonly baseMs: number;
  readonly maxMs: number;
}

export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions,
  shouldRetry: (error: unknown) => boolean = isRetryable,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= options.maxAttempts || !shouldRetry(error)) throw error;
      await sleep(Math.min(options.maxMs, options.baseMs * 2 ** (attempt - 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function isRetryable(error: unknown): boolean {
  if (!error || typeof error !== "object") return true;
  const candidate = error as Partial<XTrawlError>;
  const status =
    candidate.diagnostics && typeof candidate.diagnostics.statusCode === "number"
      ? candidate.diagnostics.statusCode
      : undefined;
  return status === undefined || status === 408 || status === 429 || status >= 500;
}
