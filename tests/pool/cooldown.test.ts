import {
  computeCooldown,
  effectiveStatus,
  parseRateLimitRemaining,
  parseRateLimitReset,
} from "../../src/pool/cooldown.js";
import { TokenBucketLimiter } from "../../src/pool/limiter.js";

describe("cooldown decisions", () => {
  test("parses seconds and millisecond reset values", () => {
    expect(parseRateLimitReset({ "x-rate-limit-reset": "1700000000" })).toBe(1_700_000_000_000);
    expect(parseRateLimitReset({ "X-Rate-Limit-Reset": "1700000000000" })).toBe(1_700_000_000_000);
    expect(parseRateLimitReset({ "x-rate-limit-reset": "bad" })).toBeUndefined();
    expect(parseRateLimitRemaining({ "x-rate-limit-remaining": "2" })).toBe(2);
    expect(parseRateLimitRemaining({ "X-Rate-Limit-Remaining": "bad" })).toBeUndefined();
  });

  test("turns an exhausted successful response into a rate-limit status", () => {
    expect(effectiveStatus(200, { "x-rate-limit-remaining": "0" })).toBe(429);
    expect(effectiveStatus(200, { "x-rate-limit-remaining": "1" })).toBe(200);
    expect(effectiveStatus(500, {})).toBe(500);
  });

  test("classifies authentication, reset, transient, and healthy outcomes", () => {
    const options = { defaultMs: 100, transientMs: 50, authMs: 500, resetAt: 900, jitterMs: 0 };
    expect(computeCooldown("auth", 401, 100, options)).toMatchObject({
      status: "unusable",
      availableUntil: 600,
    });
    expect(computeCooldown("rate_limit", 429, 100, options)).toMatchObject({
      status: "cooling_down",
      availableUntil: 900,
    });
    expect(computeCooldown("transient", 503, 100, { ...options, resetAt: undefined })).toMatchObject({
      availableUntil: 150,
    });
    expect(computeCooldown(undefined, 200, 100, options)).toEqual({ status: "healthy", availableUntil: 0 });
  });
});

describe("token spacing", () => {
  test("uses the larger of configured spacing and refill interval", async () => {
    let now = 0;
    const waits: number[] = [];
    const limiter = new TokenBucketLimiter(
      60,
      50,
      () => now,
      async (ms) => {
        waits.push(ms);
        now += ms;
      },
    );
    await limiter.acquire();
    await limiter.acquire();
    expect(waits).toEqual([1000]);
  });
});
