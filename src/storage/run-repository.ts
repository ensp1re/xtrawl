import { randomUUID } from "node:crypto";
import { RUN_STATUS } from "../constants/runs.js";
import type { RunRecord, RunStatus } from "../domain/runs.js";
import { redactUnknown } from "../utils/redact.js";
import type { StateDatabase } from "./database.js";

export type { RunRecord, RunStatus } from "../domain/runs.js";

export class RunRepository {
  public constructor(private readonly database: StateDatabase) {}

  public create(operation: string, queryHash?: string): RunRecord {
    const record: RunRecord = {
      id: randomUUID(),
      operation,
      ...(queryHash ? { queryHash } : {}),
      startedAt: new Date().toISOString(),
      status: RUN_STATUS.RUNNING,
    };
    this.database.run(
      "INSERT INTO runs(id,operation,query_hash,started_at,status) VALUES(?,?,?,?,?)",
      record.id,
      record.operation,
      record.queryHash ?? null,
      record.startedAt,
      record.status,
    );
    return record;
  }

  public finalize(
    id: string,
    status: Exclude<RunStatus, typeof RUN_STATUS.RUNNING>,
    error?: unknown,
  ): boolean {
    return (
      this.database.run(
        "UPDATE runs SET finished_at=?, status=?, error_json=? WHERE id=?",
        new Date().toISOString(),
        status,
        error ? JSON.stringify(redactUnknown(error)) : null,
        id,
      ).changes === 1
    );
  }

  public list(limit = 50): RunRecord[] {
    return this.database.all("SELECT * FROM runs ORDER BY started_at DESC LIMIT ?", limit).map((row) => ({
      id: String(row.id),
      operation: String(row.operation),
      ...(row.query_hash ? { queryHash: String(row.query_hash) } : {}),
      startedAt: String(row.started_at),
      ...(row.finished_at ? { finishedAt: String(row.finished_at) } : {}),
      status: row.status as RunRecord["status"],
      ...(row.error_json ? { error: parseJson(row.error_json) } : {}),
    }));
  }

  public last(): RunRecord | undefined {
    return this.list(1)[0];
  }

  public summary(limit = 500): {
    readonly totalRuns: number;
    readonly byStatus: Readonly<Record<string, number>>;
    readonly lastRun?: RunRecord;
  } {
    const runs = this.list(limit);
    const byStatus: Record<string, number> = {};
    for (const run of runs) byStatus[run.status] = (byStatus[run.status] ?? 0) + 1;
    return { totalRuns: runs.length, byStatus, ...(runs[0] ? { lastRun: runs[0] } : {}) };
  }
}

function parseJson(value: unknown): unknown {
  try {
    return JSON.parse(String(value)) as unknown;
  } catch {
    return value;
  }
}
