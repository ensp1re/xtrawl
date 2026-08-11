import { createHash } from "node:crypto";
import type { CookieMap } from "../domain/accounts.js";
import { asString, isRecord } from "../utils/guards.js";

export function cookiesToMap(value: unknown): CookieMap {
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, String(child ?? "")]));
  }
  if (Array.isArray(value)) {
    const pairs = value.flatMap((item) => {
      if (!isRecord(item)) return [];
      const name = asString(item.name);
      const child = asString(item.value);
      return name && child !== undefined ? [[name, child] as const] : [];
    });
    return Object.fromEntries(pairs);
  }
  return {};
}

export function parseCookieHeader(value: string): CookieMap {
  const raw = value.trim().replace(/^cookie:\s*/iu, "");
  const entries: Array<readonly [string, string]> = [];
  for (const part of raw.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const cookie = part.slice(separator + 1).trim();
    if (name && cookie) entries.push([name, cookie]);
  }
  return Object.fromEntries(entries);
}

export function parseNetscapeCookies(value: string): CookieMap {
  const out: Record<string, string> = {};
  for (const raw of value.split(/\r?\n/u)) {
    let line = raw.trim();
    if (!line || (line.startsWith("#") && !line.startsWith("#HttpOnly_"))) continue;
    line = line.replace(/^#HttpOnly_/u, "");
    const parts = line.split(/\s+/u);
    if (parts.length < 7) continue;
    const name = parts[5];
    const cookie = parts.slice(6).join(" ");
    if (name && cookie) out[name] = cookie;
  }
  return out;
}

export function normalizeCookiesPayload(value: unknown): CookieMap {
  if (value === undefined || value === null) return {};
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return {};
    if (
      text.includes("\t") ||
      text.includes("#HttpOnly_") ||
      text.startsWith("# Netscape") ||
      text.split(/\r?\n/u).some((line) => line.trim().split(/\s+/u).length >= 7)
    )
      return parseNetscapeCookies(text);
    try {
      return normalizeCookiesPayload(JSON.parse(text) as unknown);
    } catch {
      return text.includes("=") ? parseCookieHeader(text) : { auth_token: text };
    }
  }
  return cookiesToMap(value);
}

export function deriveUsername(
  username: string | undefined,
  email: string | undefined,
  authToken: string | undefined,
  cookies: CookieMap,
): string | undefined {
  if (username?.trim()) return username.trim();
  if (email?.includes("@")) return email.split("@", 1)[0]?.trim() || undefined;
  if (authToken?.trim()) return `auth_${createHash("sha1").update(authToken).digest("hex").slice(0, 12)}`;
  const serialized = JSON.stringify(cookies, Object.keys(cookies).sort());
  return Object.keys(cookies).length > 0
    ? `cookie_${createHash("sha1").update(serialized).digest("hex").slice(0, 12)}`
    : undefined;
}
