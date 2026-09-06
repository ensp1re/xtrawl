import { ExecutionRunner, TaskQueue } from "../../src/runner/index.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("task queue ownership", () => {
  test("does not requeue an active task after a lease TTL elapses", async () => {
    const queue = new TaskQueue<string>();
    queue.enqueue("slow", "slow");
    const first = queue.lease(10);
    expect(first?.generation).toBe(1);
    await delay(25);
    expect(queue.lease(10)).toBeUndefined();
    expect(queue.ack("slow", first?.generation)).toBe(true);
    expect(queue.snapshot().map((task) => task.status)).toEqual(["complete"]);
  });

  test("rejects acknowledgement from a stale generation after retry", () => {
    const queue = new TaskQueue<string>();
    queue.enqueue("a", "A");
    const first = queue.lease();
    expect(first?.generation).toBe(1);
    expect(queue.retry("a", "retry", first?.generation)).toBe(true);
    const second = queue.lease();
    expect(second?.generation).toBe(2);
    expect(queue.ack("a", first?.generation)).toBe(false);
    expect(queue.ack("a", second?.generation)).toBe(true);
    expect(queue.snapshot()[0]?.status).toBe("complete");
  });

  test("skips cancelled ready tasks instead of leasing them", () => {
    const queue = new TaskQueue<string>();
    queue.enqueue("a", "A");
    queue.enqueue("b", "B");
    expect(queue.cancel("a")).toBe(true);
    const next = queue.lease();
    expect(next?.payload).toBe("B");
    expect(queue.snapshot().map((task) => task.status)).toEqual(["cancelled", "leased"]);
  });
});

describe("execution runner", () => {
  test("does not execute the same task twice when a worker outlives the lease TTL", async () => {
    const started: number[] = [];
    const runner = new ExecutionRunner<number>({ concurrency: 2, leaseTtlMs: 10, maxAttempts: 1 });
    const result = await runner.run([1, 2], async (value) => {
      started.push(value);
      await delay(value === 1 ? 60 : 25);
    });
    expect(started).toEqual([1, 2]);
    expect(result.complete).toHaveLength(2);
    expect(result.failed).toHaveLength(0);
    expect(result.retries).toBe(0);
  });

  test("does not record completion when acknowledgement is rejected", async () => {
    const queue = new TaskQueue<string>();
    queue.enqueue("a", "A");
    const leased = queue.lease();
    expect(leased).toBeDefined();
    expect(queue.fail("a", "lost", leased?.generation)).toBe(true);
    expect(queue.ack("a", leased?.generation)).toBe(false);
  });

  test("dispatches ten thousand tasks once with accurate completion counts", async () => {
    const count = 10_000;
    const seen = new Map<number, number>();
    const runner = new ExecutionRunner<number>({ concurrency: 8, maxAttempts: 1 });
    const tasks = Array.from({ length: count }, (_, index) => index);
    const result = await runner.run(tasks, async (value) => {
      seen.set(value, (seen.get(value) ?? 0) + 1);
    });
    expect(result.complete).toHaveLength(count);
    expect(result.failed).toHaveLength(0);
    expect(seen.size).toBe(count);
    expect([...seen.values()].every((runs) => runs === 1)).toBe(true);
  });
});
