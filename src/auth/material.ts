import type { AccountRecord, AuthMaterial } from "../domain/accounts.js";
import { AccountSessionAuthError } from "../domain/errors.js";
import { asString } from "../utils/guards.js";

export function prepareAuthMaterial(account: AccountRecord, defaultBearerToken: string): AuthMaterial {
  const authToken = asString(account.authToken) ?? asString(account.cookies.auth_token);
  const csrfToken = asString(account.csrfToken) ?? asString(account.cookies.ct0);
  const bearerToken = asString(account.bearerToken) ?? defaultBearerToken;
  if (!authToken) throw new AccountSessionAuthError("missing_auth_token", "auth token is missing");
  if (!csrfToken) throw new AccountSessionAuthError("missing_csrf", "CSRF cookie is missing");
  if (!bearerToken) throw new AccountSessionAuthError("missing_bearer", "web bearer token is missing");
  return {
    authToken,
    csrfToken,
    bearerToken: bearerToken.replace(/^Bearer\s+/iu, ""),
    cookies: { ...account.cookies, auth_token: authToken, ct0: csrfToken },
  };
}
