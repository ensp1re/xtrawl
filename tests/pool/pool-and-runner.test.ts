import { accountInputToRecord } from "../../src/auth/records.js";
import { validateConfig } from "../../src/config/validation.js";
import { AuthError, RateLimitError } from "../../src/domain/errors.js";
import { AccountPool } from "../../src/pool/account-pool.js";
import { TokenBucketLimiter } from "../../src/pool/limiter.js";
import { ExecutionRunner, TaskQueue } from "../../src/runner/index.js";
import { openStorage } from "../../src/storage/index.js";
import { SessionBuilder } from "../../src/transport/session.js";
import { sessionFactory, response } from "../helpers/fake-http.js";

function readyAccount() {
  return accountInputToRecord({
    username: "one",
    authToken: "auth",
    csrfToken: "csrf",
    cookies: { auth_token: "auth", ct0: "csrf" },
  });
}

describe("account pool and limits", () => {
  test("leases an account, executes, and releases it", async () => {
    const storage = openStorage(":memory:");
    storage.accounts.upsert(readyAccount());
    const config = validateConfig({ cooldownJitterMs: 0, minDelayMs: 0 });
    const sessions = new SessionBuilder({
      bearerToken: "bearer",
      factory: (options) => sessionFactory(() => response({}))(options),
    });
    const pool = new AccountPool(storage.accounts, sessions, config);
    await expect(
      pool.execute("test", async ({ account }) => ({ tweets: [{ id: account.username }] })),
    ).resolves.toEqual({ tweets: [{ id: "one" }] });
    expect(storage.accounts.findByUsername("one")?.leaseId).toBeUndefined();
    expect(storage.accounts.findByUsername("one")?.dailyRequests).toBe(1);
    storage.database.close();
  });

  test("cools an account after a rate-limit failure", async () => {
    const storage = openStorage(":memory:");
    storage.accounts.upsert(readyAccount());
    const config = validateConfig({ cooldownJitterMs: 0, minDelayMs: 0 });
    const sessions = new SessionBuilder({
      bearerToken: "bearer",
      factory: (options) => sessionFactory(() => response({}))(options),
    });
    const pool = new AccountPool(storage.accounts, sessions, config);
    await expect(
      pool.execute("test", async () => {
        throw new RateLimitError("limited", { statusCode: 429 });
      }),
    ).rejects.toThrow(RateLimitError);
    expect(storage.accounts.findByUsername("one")?.status).toBe(2);
    storage.database.close();
  });

  test("counts failed requests and switches accounts for a retry", async () => {
    const storage = openStorage(":memory:");
    storage.accounts.upsert(readyAccount());
    storage.accounts.upsert(
      accountInputToRecord({
        username: "two",
        authToken: "auth-two",
        csrfToken: "csrf-two",
        cookies: { auth_token: "auth-two", ct0: "csrf-two" },
      }),
    );
    const config = validateConfig({
      cooldownJitterMs: 0,
      minDelayMs: 0,
      retryBaseMs: 0,
      retryMaxMs: 0,
      maxTaskAttempts: 2,
    });
    const pool = new AccountPool(
      storage.accounts,
      new SessionBuilder({
        bearerToken: "bearer",
        factory: (options) => sessionFactory(() => response({}))(options),
      }),
      config,
    );
    const attempts: string[] = [];
    const result = await pool.execute("retry", async ({ account }) => {
      attempts.push(account.username);
      if (attempts.length === 1) throw new RateLimitError("limited", { statusCode: 429 });
      return { tweets: [{ tweetId: "1" }] };
    });
    expect(result.tweets).toHaveLength(1);
    expect(attempts).toEqual(["one", "two"]);
    expect(storage.accounts.findByUsername("one")?.dailyRequests).toBe(1);
    expect(storage.accounts.findByUsername("two")?.dailyRequests).toBe(1);
    storage.database.close();
  });

  test("repairs an authenticated session before retrying", async () => {
    const storage = openStorage(":memory:");
    storage.accounts.upsert(readyAccount());
    const config = validateConfig({
      cooldownJitterMs: 0,
      minDelayMs: 0,
      retryBaseMs: 0,
      retryMaxMs: 0,
      maxTaskAttempts: 2,
    });
    let repairs = 0;
    let attempts = 0;
    const pool = new AccountPool(
      storage.accounts,
      new SessionBuilder({
        bearerToken: "bearer",
        factory: (options) => sessionFactory(() => response({}))(options),
      }),
      config,
      async (account) => {
        repairs += 1;
        storage.accounts.upsert({ ...account, status: 1, availableUntil: 0 });
        return true;
      },
    );
    await expect(
      pool.execute("repair", async () => {
        attempts += 1;
        if (attempts === 1) throw new AuthError("expired", { statusCode: 401 });
        return true;
      }),
    ).resolves.toBe(true);
    expect(repairs).toBe(1);
    expect(attempts).toBe(2);
    storage.database.close();
  });

  test("enforces minimum spacing through an injectable clock", async () => {
    let now = 0;
    const waits: number[] = [];
    const limiter = new TokenBucketLimiter(
      600,
      100,
      () => now,
      async (ms) => {
        waits.push(ms);
        now += ms;
      },
    );
    await limiter.acquire();
    await limiter.acquire();
    expect(waits).toEqual([100]);
  });
});

describe("task execution", () => {
  test("supports lease, ack, retry, fail, and cancel", () => {
    const queue = new TaskQueue<string>();
    queue.enqueue("a", "A");
    queue.enqueue("b", "B");
    queue.enqueue("c", "C");
    const first = queue.lease();
    expect(first?.payload).toBe("A");
    expect(queue.ack("a")).toBe(true);
    const second = queue.lease();
    expect(second?.payload).toBe("B");
    expect(queue.retry("b", "retry")).toBe(true);
    const retry = queue.lease();
    expect(retry?.payload).toBe("B");
    expect(queue.fail("b", "failed")).toBe(true);
    expect(queue.cancel("c")).toBe(true);
    expect(queue.snapshot().map((task) => task.status)).toEqual(["complete", "failed", "cancelled"]);
  });

  test("retries failed workers up to the configured attempt count", async () => {
    let attempts = 0;
    const runner = new ExecutionRunner<number>({ concurrency: 2, maxAttempts: 2 });
    const result = await runner.run([1, 2], async (value) => {
      attempts += 1;
      if (value === 1) throw new Error("no");
    });
    expect(attempts).toBe(3);
    expect(result.complete).toEqual([2]);
    expect(result.failed).toHaveLength(1);
  });
});
