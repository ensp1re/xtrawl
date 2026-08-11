import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";

export type SqlRow = Record<string, unknown>;

export class StateDatabase {
  public readonly path: string;
  private readonly database: DatabaseSync;

  public constructor(path: string) {
    this.path = path;
    this.database = new DatabaseSync(path);
    this.database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  }

  public exec(sql: string): void {
    this.database.exec(sql);
  }

  public prepare(sql: string): StatementSync {
    return this.database.prepare(sql);
  }

  public run(
    sql: string,
    ...params: SQLInputValue[]
  ): { readonly changes: number; readonly lastInsertRowid: number | bigint } {
    const result = this.database.prepare(sql).run(...params);
    return { changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid };
  }

  public get(sql: string, ...params: SQLInputValue[]): SqlRow | undefined {
    return this.database.prepare(sql).get(...params) as SqlRow | undefined;
  }

  public all(sql: string, ...params: SQLInputValue[]): SqlRow[] {
    return this.database.prepare(sql).all(...params) as SqlRow[];
  }

  public transaction<T>(callback: () => T): T {
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const result = callback();
      this.database.exec("COMMIT;");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  public close(): void {
    this.database.close();
  }
}
