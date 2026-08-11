export interface QueueTask<T> {
  readonly id: string;
  readonly payload: T;
  readonly attempts: number;
  readonly status: "queued" | "leased" | "complete" | "failed" | "cancelled";
  readonly leasedUntil?: number;
  readonly error?: string;
}

export class TaskQueue<T> {
  private readonly tasks = new Map<string, QueueTask<T>>();

  public enqueue(id: string, payload: T): QueueTask<T> {
    const task: QueueTask<T> = { id, payload, attempts: 0, status: "queued" };
    this.tasks.set(id, task);
    return task;
  }

  public lease(ttlMs = 120_000): QueueTask<T> | undefined {
    const now = Date.now();
    for (const task of this.tasks.values()) {
      if (task.status === "leased" && (task.leasedUntil ?? 0) <= now)
        this.tasks.set(task.id, { ...task, status: "queued", leasedUntil: undefined });
    }
    const next = [...this.tasks.values()].find((task) => task.status === "queued");
    if (!next) return undefined;
    const leased: QueueTask<T> = {
      ...next,
      status: "leased",
      attempts: next.attempts + 1,
      leasedUntil: now + ttlMs,
    };
    this.tasks.set(next.id, leased);
    return leased;
  }

  public ack(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task || task.status !== "leased") return false;
    this.tasks.set(id, { ...task, status: "complete", leasedUntil: undefined });
    return true;
  }

  public retry(id: string, error?: string): boolean {
    const task = this.tasks.get(id);
    if (!task || task.status !== "leased") return false;
    this.tasks.set(id, { ...task, status: "queued", leasedUntil: undefined, ...(error ? { error } : {}) });
    return true;
  }

  public fail(id: string, error?: string): boolean {
    const task = this.tasks.get(id);
    if (!task || task.status !== "leased") return false;
    this.tasks.set(id, { ...task, status: "failed", leasedUntil: undefined, ...(error ? { error } : {}) });
    return true;
  }

  public cancel(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task || task.status === "complete" || task.status === "failed") return false;
    this.tasks.set(id, { ...task, status: "cancelled", leasedUntil: undefined });
    return true;
  }

  public snapshot(): readonly QueueTask<T>[] {
    return [...this.tasks.values()];
  }
}
