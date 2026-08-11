import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import type { AccountInput } from "../domain/accounts.js";
import { isRecord } from "../utils/guards.js";
import { normalizeCookiesPayload } from "./cookies.js";
import { accountInputToRecord } from "./records.js";
import type { AccountRecord } from "../domain/accounts.js";

export async function loadAccountsFile(path: string): Promise<AccountRecord[]> {
  const text = await readFile(path, "utf8");
  return parseAccountsFileText(path, text);
}

export function loadAccountsFileSync(path: string): AccountRecord[] {
  return parseAccountsFileText(path, readFileSync(path, "utf8"));
}

function parseAccountsFileText(path: string, text: string): AccountRecord[] {
  if (path.toLowerCase().endsWith(".json")) {
    return loadAccountsPayload(JSON.parse(text) as unknown);
  }
  if (looksLikeCookieFile(text)) {
    const cookies = normalizeCookiesPayload(text);
    return Object.keys(cookies).length > 0 ? [accountInputToRecord({ cookies })] : [];
  }
  const records: AccountRecord[] = [];
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.includes("|") ? line.split("|").map((item) => item.trim()) : line.split(":");
    if (parts.length < 2) continue;
    const [username, password, email, emailPassword, twoFactorSecret, authToken, csrfToken] = parts;
    records.push(
      accountInputToRecord({
        username,
        password,
        email,
        emailPassword,
        twoFactorSecret,
        csrfToken,
        authToken,
      }),
    );
  }
  return records;
}

function looksLikeCookieFile(text: string): boolean {
  if (text.includes("\t") || text.includes("#HttpOnly_") || /^#\s*Netscape/imu.test(text)) return true;
  return text.split(/\r?\n/u).some((line) => line.trim().split(/\s+/u).length >= 7);
}

export function loadAccountsPayload(payload: unknown): AccountRecord[] {
  const rows: unknown[] = Array.isArray(payload) ? payload : [payload];
  return rows.flatMap((row) => {
    if (!isRecord(row)) return [];
    const cookieValue = row.cookies ?? row.cookies_json ?? row.cookieJar;
    if (cookieValue !== undefined) {
      return [
        accountInputToRecord({
          ...(row as AccountInput),
          cookies: normalizeCookiesPayload(cookieValue),
        }),
      ];
    }
    return [accountInputToRecord(row as AccountInput)];
  });
}

export function loadInlineAccounts(payload: unknown): AccountRecord[] {
  if (typeof payload === "string")
    return [accountInputToRecord({ cookies: normalizeCookiesPayload(payload) })];
  return loadAccountsPayload(payload);
}
