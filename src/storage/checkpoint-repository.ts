import type { StateDatabase } from "./database.js";

export class CheckpointRepository {
  public constructor(private readonly database: StateDatabase) {}

  public save(queryHash: string, cursors: Readonly<Record<string, string>>): void {
    this.database.run(
      "INSERT INTO checkpoints(query_hash,cursor_json,updated_at) VALUES(?,?,?) ON CONFLICT(query_hash) DO UPDATE SET cursor_json=excluded.cursor_json, updated_at=excluded.updated_at",
      queryHash,
      JSON.stringify(cursors),
      new Date().toISOString(),
    );
  }

  public get(queryHash: string): Readonly<Record<string, string>> | undefined {
    const row = this.database.get("SELECT cursor_json FROM checkpoints WHERE query_hash=?", queryHash);
    if (!row) return undefined;
    try {
      const value = JSON.parse(String(row.cursor_json)) as unknown;
      if (!value || typeof value !== "object" || Array.isArray(value)) return {};
      return Object.fromEntries(
        Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      );
    } catch {
      return {};
    }
  }

  public clear(queryHash: string): boolean {
    return this.database.run("DELETE FROM checkpoints WHERE query_hash=?", queryHash).changes === 1;
  }

  public clearAll(): number {
    return this.database.run("DELETE FROM checkpoints").changes;
  }
}
