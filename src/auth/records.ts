import type { AccountInput, AccountRecord, CookieMap } from "../domain/accounts.js";
import { asString, isRecord } from "../utils/guards.js";
import { deriveUsername, normalizeCookiesPayload } from "./cookies.js";

export function normalizeAccountRecord(input: Record<string, unknown> | AccountInput): AccountRecord {
  const value = input as Record<string, unknown>;
  const cookies = normalizeCookiesPayload(value.cookies ?? value.cookiesJson ?? value.cookieJar);
  const authToken =
    asString(value.authToken ?? value.auth_token ?? value.token) ?? asString(cookies.auth_token);
  const csrfToken = asString(value.csrfToken ?? value.csrf ?? value.ct0) ?? asString(cookies.ct0);
  const username = deriveUsername(
    asString(value.username ?? value.user ?? value.handle),
    asString(value.email),
    authToken,
    cookies,
  );
  if (!username) throw new Error("Account requires username, email, auth token, or cookies.");
  const mergedCookies: CookieMap = {
    ...cookies,
    ...(authToken ? { auth_token: authToken } : {}),
    ...(csrfToken ? { ct0: csrfToken } : {}),
  };
  return {
    username,
    ...(asString(value.password) ? { password: asString(value.password) } : {}),
    ...(asString(value.email) ? { email: asString(value.email) } : {}),
    ...(asString(value.emailPassword ?? value.email_password)
      ? { emailPassword: asString(value.emailPassword ?? value.email_password) }
      : {}),
    ...(asString(value.twoFactorSecret ?? value.two_fa ?? value.otp)
      ? { twoFactorSecret: asString(value.twoFactorSecret ?? value.two_fa ?? value.otp) }
      : {}),
    ...(authToken ? { authToken } : {}),
    ...(csrfToken ? { csrfToken } : {}),
    cookies: mergedCookies,
    ...(isRecord(value.proxy) || typeof value.proxy === "string"
      ? { proxy: value.proxy as AccountRecord["proxy"] }
      : {}),
    ...(asString(value.bearer) ? { bearerToken: asString(value.bearer) } : {}),
  };
}

export function accountInputToRecord(input: AccountInput): AccountRecord {
  return normalizeAccountRecord(input as unknown as Record<string, unknown>);
}
