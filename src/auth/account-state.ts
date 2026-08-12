import { normalizeProxyPayload } from "../config/validation.js";
import type { AccountStateSnapshot, AccountStateSnapshotRecord } from "../domain/account-state.js";
import { AccountStateError } from "../domain/errors.js";
import { isRecord } from "../utils/guards.js";

export function parseAccountStateSnapshot(value: unknown): AccountStateSnapshot {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.accounts))
    throw new AccountStateError("Account state must use schemaVersion 1 and contain accounts.");
  if (
    typeof value.exportedAt !== "string" ||
    !Number.isFinite(Date.parse(value.exportedAt)) ||
    new Date(value.exportedAt).toISOString() !== value.exportedAt
  )
    throw new AccountStateError("Account state exportedAt must be an ISO date string.");
  const accounts = value.accounts.map((account, index) => parseSnapshotAccount(account, index));
  const usernames = new Set<string>();
  for (const account of accounts) {
    if (usernames.has(account.username))
      throw new AccountStateError(`Account state contains duplicate username: ${account.username}.`);
    usernames.add(account.username);
  }
  return {
    schemaVersion: 1,
    exportedAt: value.exportedAt,
    accounts,
  };
}

function parseSnapshotAccount(value: unknown, index: number): AccountStateSnapshotRecord {
  if (!isRecord(value) || typeof value.username !== "string" || !value.username.trim())
    throw invalidAccount(index, "username must be a non-empty string");
  if (!isRecord(value.cookies)) throw invalidAccount(index, "cookies must be an object");
  const cookies = parseCookies(value.cookies, index);
  const proxy = normalizeProxyPayload(value.proxy);
  if (value.proxy !== undefined && proxy === undefined)
    throw invalidAccount(index, "proxy must be a URL or host/port object");
  const status = optionalStatus(value.status, index);
  return {
    username: value.username.trim(),
    ...optionalString("authToken", value.authToken, index),
    ...optionalString("csrfToken", value.csrfToken, index),
    cookies,
    ...optionalString("bearerToken", value.bearerToken, index),
    ...(proxy === undefined ? {} : { proxy }),
    ...(status === undefined ? {} : { status }),
    ...optionalNonNegativeNumber("availableUntil", value.availableUntil, index),
    ...optionalNonNegativeNumber("dailyRequests", value.dailyRequests, index),
    ...optionalNonNegativeNumber("dailyTweets", value.dailyTweets, index),
    ...optionalNonNegativeNumber("totalTweets", value.totalTweets, index),
    ...optionalString("lastResetDate", value.lastResetDate, index),
    ...optionalNonNegativeNumber("lastUsed", value.lastUsed, index),
    ...optionalNonNegativeNumber("lastErrorCode", value.lastErrorCode, index),
    ...optionalString("cooldownReason", value.cooldownReason, index),
  };
}

function parseCookies(value: Record<string, unknown>, index: number): Readonly<Record<string, string>> {
  const cookies: Record<string, string> = {};
  for (const [name, cookie] of Object.entries(value)) {
    if (typeof cookie !== "string") throw invalidAccount(index, "cookie values must be strings");
    cookies[name] = cookie;
  }
  return cookies;
}

function optionalString<K extends string>(key: K, value: unknown, index: number): Partial<Record<K, string>> {
  if (value === undefined) return {};
  if (typeof value !== "string") throw invalidAccount(index, `${key} must be a string`);
  return { [key]: value } as Partial<Record<K, string>>;
}

function optionalNonNegativeNumber<K extends string>(
  key: K,
  value: unknown,
  index: number,
): Partial<Record<K, number>> {
  if (value === undefined) return {};
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw invalidAccount(index, `${key} must be a non-negative number`);
  return { [key]: value } as Partial<Record<K, number>>;
}

function optionalStatus(value: unknown, index: number): 0 | 1 | 2 | undefined {
  if (value === undefined) return undefined;
  if (value !== 0 && value !== 1 && value !== 2) throw invalidAccount(index, "status must be 0, 1, or 2");
  return value;
}

function invalidAccount(index: number, reason: string): AccountStateError {
  return new AccountStateError(`Invalid account state at accounts[${index}]: ${reason}.`);
}
