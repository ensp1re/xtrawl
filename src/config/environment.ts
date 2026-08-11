import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { asString } from "../utils/guards.js";
import type { AccountInput } from "../domain/accounts.js";

export async function readDotenv(path: string): Promise<Record<string, string>> {
  const text = await readFile(path, "utf8");
  const values: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    values[key] = rawValue.replace(/^['"]|['"]$/gu, "");
  }
  return values;
}

export async function loadAccountFromEnvironment(path: string): Promise<AccountInput[]> {
  const values = await readDotenv(path);
  return accountFromValues(values);
}

export function loadAccountFromEnvironmentSync(path: string): AccountInput[] {
  return accountFromValues(parseDotenv(readFileSync(path, "utf8")));
}

function accountFromValues(values: Record<string, string>): AccountInput[] {
  const username = asString(values.USERNAME) ?? asString(values.USER);
  const email = asString(values.EMAIL);
  const authToken = asString(values.AUTH_TOKEN) ?? asString(values.X_AUTH_TOKEN);
  const csrfToken = asString(values.CT0) ?? asString(values.CSRF) ?? asString(values.X_CSRF_TOKEN);
  if (!username && !email && !authToken) return [];
  return [
    {
      ...(username ? { username } : {}),
      ...(email ? { email } : {}),
      ...(asString(values.PASSWORD) ? { password: asString(values.PASSWORD) } : {}),
      ...(asString(values.EMAIL_PASSWORD) ? { emailPassword: asString(values.EMAIL_PASSWORD) } : {}),
      ...(asString(values.TWO_FA) ? { twoFactorSecret: asString(values.TWO_FA) } : {}),
      ...(authToken ? { authToken } : {}),
      ...(csrfToken ? { csrfToken } : {}),
    },
  ];
}

function parseDotenv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    values[line.slice(0, separator).trim()] = line
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/gu, "");
  }
  return values;
}
