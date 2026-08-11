import type { ManifestPayload } from "../domain/manifest.js";
import type { StateDatabase } from "./database.js";

export class ManifestRepository {
  public constructor(private readonly database: StateDatabase) {}

  public set(key: string, manifest: ManifestPayload, ttlMs: number): void {
    const now = Date.now();
    this.database.run(
      "INSERT INTO manifest_cache(cache_key,manifest_json,fetched_at,expires_at) VALUES(?,?,?,?) ON CONFLICT(cache_key) DO UPDATE SET manifest_json=excluded.manifest_json, fetched_at=excluded.fetched_at, expires_at=excluded.expires_at",
      key,
      JSON.stringify(manifest),
      now,
      now + ttlMs,
    );
  }

  public get(key: string, allowExpired = false): ManifestPayload | undefined {
    const row = this.database.get(
      "SELECT manifest_json,expires_at FROM manifest_cache WHERE cache_key=?",
      key,
    );
    if (!row || (!allowExpired && Number(row.expires_at) < Date.now())) return undefined;
    try {
      return JSON.parse(String(row.manifest_json)) as ManifestPayload;
    } catch {
      return undefined;
    }
  }
}
