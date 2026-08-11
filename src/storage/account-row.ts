import type { AccountRecord } from "../domain/accounts.js";
import { asInteger, asNumber, asString, isRecord } from "../utils/guards.js";
import type { SqlRow } from "./database.js";

export function rowToAccount(row: SqlRow): AccountRecord {
  const cookies = parseJsonMap(row.cookies_json);
  const proxy = parseJsonValue(row.proxy_json);
  return {
    id: asInteger(row.id),
    username: asString(row.username) ?? "",
    ...(asString(row.password) ? { password: asString(row.password) } : {}),
    ...(asString(row.email) ? { email: asString(row.email) } : {}),
    ...(asString(row.email_password) ? { emailPassword: asString(row.email_password) } : {}),
    ...(asString(row.two_factor_secret) ? { twoFactorSecret: asString(row.two_factor_secret) } : {}),
    ...(asString(row.auth_token) ? { authToken: asString(row.auth_token) } : {}),
    ...(asString(row.csrf_token) ? { csrfToken: asString(row.csrf_token) } : {}),
    cookies,
    ...(asString(row.bearer_token) ? { bearerToken: asString(row.bearer_token) } : {}),
    ...(isRecord(proxy) || typeof proxy === "string" ? { proxy: proxy as AccountRecord["proxy"] } : {}),
    status: asInteger(row.status, 1),
    availableUntil: asNumber(row.available_until),
    dailyRequests: asInteger(row.daily_requests),
    dailyTweets: asInteger(row.daily_tweets),
    totalTweets: asInteger(row.total_tweets),
    lastResetDate: asString(row.last_reset_date),
    lastUsed: asNumber(row.last_used),
    ...(asString(row.lease_id) ? { leaseId: asString(row.lease_id) } : {}),
    ...(asNumber(row.lease_expires_at) > 0 ? { leaseExpiresAt: asNumber(row.lease_expires_at) } : {}),
    lastErrorCode: asInteger(row.last_error_code) || undefined,
    cooldownReason: asString(row.cooldown_reason),
  };
}

function parseJsonMap(value: unknown): Record<string, string> {
  const parsed = parseJsonValue(value);
  if (!isRecord(parsed)) return {};
  return Object.fromEntries(Object.entries(parsed).map(([key, child]) => [key, String(child ?? "")]));
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== "string" || !value) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}
