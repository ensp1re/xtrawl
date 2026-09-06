import { TaskQueue, type QueueTask } from "./task-queue.js";

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

export class ExecutionRunner<T> {
  public constructor(private readonly options: RunnerOptions) {}

  public async run(tasks: readonly T[], worker: (task: T) => Promise<void>): Promise<RunnerResult<T>> {
    const queue = new TaskQueue<T>();
    tasks.forEach((task, index) => queue.enqueue(String(index), task));
    const failures: Array<{ readonly task: QueueTask<T>; readonly error: unknown }> = [];
    const complete: T[] = [];
    const process = async (): Promise<void> => {
      while (true) {
        const task = queue.lease(this.options.leaseTtlMs);
        if (!task) return;
        try {
          await worker(task.payload);
          if (queue.ack(task.id, task.generation)) complete.push(task.payload);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (task.attempts < (this.options.maxAttempts ?? 3)) {
            queue.retry(task.id, message, task.generation);
          } else if (queue.fail(task.id, message, task.generation)) {
            failures.push({
              task: queue.snapshot().find((item) => item.id === task.id) ?? task,
              error,
            });
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, this.options.concurrency) }, () => process()));
    const retries = queue.snapshot().reduce((total, task) => total + Math.max(0, task.attempts - 1), 0);
    return { complete, failed: failures, retries };
  }
}
