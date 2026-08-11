import type { StateDatabase } from "./database.js";

export function initializeSchema(database: StateDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password TEXT,
      email TEXT,
      email_password TEXT,
      two_factor_secret TEXT,
      auth_token TEXT,
      csrf_token TEXT,
      cookies_json TEXT NOT NULL DEFAULT '{}',
      bearer_token TEXT,
      proxy_json TEXT,
      status INTEGER NOT NULL DEFAULT 1,
      available_until REAL NOT NULL DEFAULT 0,
      daily_requests INTEGER NOT NULL DEFAULT 0,
      daily_tweets INTEGER NOT NULL DEFAULT 0,
      total_tweets INTEGER NOT NULL DEFAULT 0,
      last_reset_date TEXT,
      lease_id TEXT,
      lease_expires_at REAL,
      last_used REAL NOT NULL DEFAULT 0,
      last_error_code INTEGER,
      cooldown_reason TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_accounts_eligibility
      ON accounts(status, available_until, lease_expires_at, last_used);
    CREATE INDEX IF NOT EXISTS idx_accounts_auth_token
      ON accounts(auth_token);
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      operation TEXT NOT NULL,
      query_hash TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      error_json TEXT
    );
    CREATE TABLE IF NOT EXISTS checkpoints (
      query_hash TEXT PRIMARY KEY,
      cursor_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS manifest_cache (
      cache_key TEXT PRIMARY KEY,
      manifest_json TEXT NOT NULL,
      fetched_at REAL NOT NULL,
      expires_at REAL NOT NULL
    );
  `);
}
