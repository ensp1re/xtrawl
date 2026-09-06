import { PROGRESS_STATE } from "../constants/collection.js";
import type { AcceptedRecord, PageCommit, ProgressState, TaskProgress } from "../domain/collection.js";
import { COLLECTION_SCHEMA_VERSION } from "../query/collection-id.js";
import type { StateDatabase } from "./database.js";

export type { AcceptedRecord, PageCommit, ProgressState, TaskProgress } from "../domain/collection.js";

export class ProgressRepository {
  public constructor(private readonly database: StateDatabase) {}

  public commitPage(commit: PageCommit): void {
    this.database.transaction(() => {
      const now = new Date().toISOString();
      for (const record of commit.records) {
        this.database.run(
          `INSERT OR IGNORE INTO accepted_records(collection_id,record_id,task_id,payload_json,created_at)
           VALUES(?,?,?,?,?)`,
          commit.collectionId,
          record.id,
          commit.taskId,
          JSON.stringify(record.payload),
          now,
        );
      }
      const existing = this.task(commit.collectionId, commit.taskId);
      const acceptedIds = [
        ...new Set([...(existing?.acceptedIds ?? []), ...commit.records.map((record) => record.id)]),
      ];
      const storedCursor = commit.state === PROGRESS_STATE.CAPPED ? commit.inputCursor : commit.nextCursor;
      this.database.run(
        `INSERT INTO collection_progress(
           collection_id,task_id,schema_version,state,cursor,input_cursor,accepted_json,updated_at
         ) VALUES(?,?,?,?,?,?,?,?)
         ON CONFLICT(collection_id,task_id) DO UPDATE SET
           state=excluded.state,
           cursor=excluded.cursor,
           input_cursor=excluded.input_cursor,
           accepted_json=excluded.accepted_json,
           updated_at=excluded.updated_at`,
        commit.collectionId,
        commit.taskId,
        COLLECTION_SCHEMA_VERSION,
        commit.state,
        storedCursor ?? null,
        commit.inputCursor ?? null,
        JSON.stringify(acceptedIds),
        now,
      );
    });
  }

  public task(collectionId: string, taskId: string): TaskProgress | undefined {
    const row = this.database.get(
      "SELECT * FROM collection_progress WHERE collection_id=? AND task_id=?",
      collectionId,
      taskId,
    );
    if (!row) return undefined;
    return {
      collectionId,
      taskId,
      state: String(row.state) as ProgressState,
      ...(typeof row.cursor === "string" && row.cursor ? { cursor: row.cursor } : {}),
      ...(typeof row.input_cursor === "string" && row.input_cursor ? { inputCursor: row.input_cursor } : {}),
      acceptedIds: parseStringArray(row.accepted_json),
    };
  }

  public accepted(collectionId: string): readonly AcceptedRecord[] {
    return this.database
      .all(
        "SELECT record_id,task_id,payload_json FROM accepted_records WHERE collection_id=? ORDER BY created_at, record_id",
        collectionId,
      )
      .map((row) => ({
        id: String(row.record_id),
        taskId: String(row.task_id),
        payload: parseJson(row.payload_json),
      }));
  }

  public hasRecord(collectionId: string, recordId: string): boolean {
    return Boolean(
      this.database.get(
        "SELECT 1 FROM accepted_records WHERE collection_id=? AND record_id=?",
        collectionId,
        recordId,
      ),
    );
  }
}

function parseStringArray(value: unknown): readonly string[] {
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function parseJson(value: unknown): unknown {
  try {
    return JSON.parse(String(value)) as unknown;
  } catch {
    return value;
  }
}
