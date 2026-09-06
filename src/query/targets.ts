import type { TargetInput } from "../domain/requests.js";

const HANDLE = /^[A-Za-z0-9_]{1,15}$/u;
const USER_ID = /^\d+$/u;
const PROFILE_HOSTS = new Set([
  "x.com",
  "www.x.com",
  "m.x.com",
  "mobile.x.com",
  "twitter.com",
  "www.twitter.com",
  "m.twitter.com",
  "mobile.twitter.com",
]);
const RESERVED_PATHS = new Set([
  "home",
  "explore",
  "search",
  "notifications",
  "messages",
  "compose",
  "settings",
  "i",
  "login",
  "signup",
]);

import type { NormalizedTargets } from "./types.js";

export type { NormalizedTargets } from "./types.js";

export function normalizeTargets(values: readonly (string | TargetInput)[]): NormalizedTargets {
  const targets: TargetInput[] = [];
  const skipped: Array<{ readonly raw: string; readonly reason: string }> = [];
  const seen = new Set<string>();
  for (const value of values) {
    const parsed = typeof value === "string" ? targetFromString(value) : normalizeObjectTarget(value);
    if (!parsed) {
      skipped.push({ raw: typeof value === "string" ? value : (value.raw ?? ""), reason: "invalid_target" });
      continue;
    }
    const key = parsed.userId ? `id:${parsed.userId}` : `username:${parsed.username?.toLowerCase()}`;
    if (seen.has(key)) {
      skipped.push({ raw: parsed.raw ?? "", reason: "duplicate" });
      continue;
    }
    seen.add(key);
    targets.push(parsed);
  }
  return { targets, skipped };
}

export function targetFromString(value: string): TargetInput | undefined {
  const raw = value.trim();
  if (!raw) return undefined;
  if (USER_ID.test(raw)) return { raw, source: "input", userId: raw };
  const handle = raw.replace(/^@/u, "");
  if (HANDLE.test(handle) && !RESERVED_PATHS.has(handle.toLowerCase()))
    return { raw, source: "input", username: handle };
  return targetFromProfileUrl(raw);
}

function normalizeObjectTarget(value: TargetInput): TargetInput | undefined {
  if (value.userId?.trim() && USER_ID.test(value.userId.trim()))
    return { ...value, userId: value.userId.trim() };
  if (value.username?.trim()) {
    const username = value.username.trim().replace(/^@/u, "");
    return HANDLE.test(username) && !RESERVED_PATHS.has(username.toLowerCase())
      ? { ...value, username }
      : undefined;
  }
  if (value.profileUrl?.trim()) {
    const parsed = targetFromProfileUrl(value.profileUrl);
    return parsed ? { ...parsed, ...value, username: parsed.username, userId: parsed.userId } : undefined;
  }
  if (value.raw?.trim()) return targetFromString(value.raw);
  return undefined;
}

function targetFromProfileUrl(value: string): TargetInput | undefined {
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    if (!PROFILE_HOSTS.has(url.hostname.toLowerCase())) return undefined;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length === 3 && parts[0]?.toLowerCase() === "i" && parts[1]?.toLowerCase() === "user") {
      const userId = parts[2];
      return userId && USER_ID.test(userId)
        ? { raw: value, source: "profile_url", userId, profileUrl: `https://x.com/i/user/${userId}` }
        : undefined;
    }
    if (parts.length !== 1) return undefined;
    const username = parts[0]?.replace(/^@/u, "");
    if (!username || !HANDLE.test(username) || RESERVED_PATHS.has(username.toLowerCase())) return undefined;
    return { raw: value, source: "profile_url", username, profileUrl: `https://x.com/${username}` };
  } catch {
    return undefined;
  }
}
