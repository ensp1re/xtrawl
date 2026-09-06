export interface QueueTask<T> {
  readonly id: string;
  readonly payload: T;
  readonly attempts: number;
  readonly generation: number;
  readonly status: "queued" | "leased" | "complete" | "failed" | "cancelled";
  readonly leasedUntil?: number;
  readonly error?: string;
}

interface MutableTask<T> {
  id: string;
  payload: T;
  attempts: number;
  generation: number;
  status: QueueTask<T>["status"];
  leasedUntil?: number;
  error?: string;
}

export class TaskQueue<T> {
  private readonly tasks = new Map<string, MutableTask<T>>();
  private readonly ready: string[] = [];
  private readyHead = 0;

  public enqueue(id: string, payload: T): QueueTask<T> {
    const existing = this.tasks.get(id);
    if (existing) return snapshot(existing);
    const task: MutableTask<T> = { id, payload, attempts: 0, generation: 0, status: "queued" };
    this.tasks.set(id, task);
    this.ready.push(id);
    return snapshot(task);
  }

  public lease(ttlMs = 120_000): QueueTask<T> | undefined {
    void ttlMs;
    while (this.readyHead < this.ready.length) {
      const id = this.ready[this.readyHead++];
      if (id === undefined) break;
      const task = this.tasks.get(id);
      if (!task || task.status !== "queued") continue;
      task.status = "leased";
      task.attempts += 1;
      task.generation += 1;
      delete task.leasedUntil;
      return snapshot(task);
    }
    this.compactReady();
    return undefined;
  }

  public ack(id: string, generation?: number): boolean {
    const task = this.owned(id, generation);
    if (!task) return false;
    task.status = "complete";
    delete task.leasedUntil;
    return true;
  }

  public retry(id: string, error?: string, generation?: number): boolean {
    const task = this.owned(id, generation);
    if (!task) return false;
    task.status = "queued";
    delete task.leasedUntil;
    if (error !== undefined) task.error = error;
    this.ready.splice(this.readyHead, 0, task.id);
    return true;
  }

  public fail(id: string, error?: string, generation?: number): boolean {
    const task = this.owned(id, generation);
    if (!task) return false;
    task.status = "failed";
    delete task.leasedUntil;
    if (error !== undefined) task.error = error;
    return true;
  }

  public cancel(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task || task.status === "complete" || task.status === "failed") return false;
    task.status = "cancelled";
    delete task.leasedUntil;
    return true;
  }

  public snapshot(): readonly QueueTask<T>[] {
    return [...this.tasks.values()].map(snapshot);
  }

  private owned(id: string, generation?: number): MutableTask<T> | undefined {
    const task = this.tasks.get(id);
    if (!task || task.status !== "leased") return undefined;
    if (generation !== undefined && task.generation !== generation) return undefined;
    return task;
  }

  private compactReady(): void {
    if (this.readyHead === 0) return;
    this.ready.splice(0, this.readyHead);
    this.readyHead = 0;
  }
}

function snapshot<T>(task: MutableTask<T>): QueueTask<T> {
  return {
    id: task.id,
    payload: task.payload,
    attempts: task.attempts,
    generation: task.generation,
    status: task.status,
    ...(task.leasedUntil !== undefined ? { leasedUntil: task.leasedUntil } : {}),
    ...(task.error !== undefined ? { error: task.error } : {}),
  };
}
