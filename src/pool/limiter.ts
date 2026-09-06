import { delay } from "../utils/abort.js";

export class TokenBucketLimiter {
  private nextAllowedAt = 0;

  public constructor(
    private readonly requestsPerMinute: number,
    private readonly minDelayMs: number,
    private readonly clock: () => number = Date.now,
    private readonly sleeper: (ms: number, signal?: AbortSignal) => Promise<void> = sleep,
  ) {}

  public async acquire(signal?: AbortSignal): Promise<void> {
    const interval = Math.max(this.minDelayMs, 60_000 / Math.max(1, this.requestsPerMinute));
    const now = this.clock();
    const wait = Math.max(0, this.nextAllowedAt - now);
    if (wait > 0) await this.sleeper(wait, signal);
    this.nextAllowedAt = Math.max(this.nextAllowedAt, this.clock()) + interval;
  }
}

export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  await delay(ms, signal);
}
