import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadAccountFromEnvironment,
  loadAccountFromEnvironmentSync,
  readDotenv,
} from "../../src/config/environment.js";
import { loadAccountsFileSync, loadInlineAccounts } from "../../src/auth/loaders.js";
import { deriveUsername, normalizeCookiesPayload } from "../../src/auth/cookies.js";
import { bootstrapCookiesFromAuthToken } from "../../src/auth/bootstrap.js";
import { fetch as undiciFetch, Response as UndiciResponse } from "undici";

function tempFile(name: string, value: string): string {
  const root = mkdtempSync(join(tmpdir(), "graph-config-"));
  const path = join(root, name);
  writeFileSync(path, value, "utf8");
  return path;
}

describe("environment and account source adapters", () => {
  test("reads quoted dotenv values and all supported auth aliases", async () => {
    const path = tempFile(
      ".env",
      "# ignored\nUSERNAME='demo'\nPASSWORD=pass\nEMAIL=demo@example.test\nEMAIL_PASSWORD=mail-pass\nTWO_FA=secret\nX_AUTH_TOKEN=auth\nX_CSRF_TOKEN=csrf\n",
    );
    await expect(readDotenv(path)).resolves.toMatchObject({ USERNAME: "demo", X_AUTH_TOKEN: "auth" });
    await expect(loadAccountFromEnvironment(path)).resolves.toEqual([
      expect.objectContaining({ username: "demo", password: "pass", authToken: "auth", csrfToken: "csrf" }),
    ]);
    expect(loadAccountFromEnvironmentSync(path)[0]).toEqual(
      expect.objectContaining({ emailPassword: "mail-pass", twoFactorSecret: "secret" }),
    );
  });

  test("derives a username from email, token, or cookie material", () => {
    expect(deriveUsername(undefined, "person@example.test", undefined, {})).toBe("person");
    expect(deriveUsername(undefined, undefined, "token", {})).toMatch(/^auth_[a-f0-9]{12}$/u);
    expect(deriveUsername(undefined, undefined, undefined, { ct0: "csrf" })).toMatch(
      /^cookie_[a-f0-9]{12}$/u,
    );
  });

  test("accepts cookie headers, raw tokens, JSON, and Netscape text", () => {
    expect(normalizeCookiesPayload("auth_token=a; ct0=b")).toEqual({ auth_token: "a", ct0: "b" });
    expect(normalizeCookiesPayload('{"auth_token":"a","ct0":"b"}')).toEqual({ auth_token: "a", ct0: "b" });
    expect(normalizeCookiesPayload("raw-auth-token")).toEqual({ auth_token: "raw-auth-token" });
    expect(normalizeCookiesPayload("# Netscape\n.x.com TRUE / TRUE 0 auth_token a")).toEqual({
      auth_token: "a",
    });
  });

  test("preserves the documented delimited account order", () => {
    const path = tempFile("accounts.txt", "user|pass|mail@example.test|mail-pass|otp|auth-token|csrf-token");
    const record = loadAccountsFileSync(path)[0];
    expect(record).toMatchObject({ username: "user", authToken: "auth-token", csrfToken: "csrf-token" });
  });

  test("recognizes a Netscape file even when it has a nonstandard extension", () => {
    const path = tempFile(
      "cookies.data",
      "# Netscape\n.x.com TRUE / TRUE 0 auth_token a\n.x.com TRUE / TRUE 0 ct0 b",
    );
    expect(loadAccountsFileSync(path)[0]?.cookies).toEqual({ auth_token: "a", ct0: "b" });
    expect(loadInlineAccounts({ cookies: [{ name: "auth_token", value: "a" }] })[0]?.authToken).toBe("a");
  });

  test("bootstraps a CSRF cookie without persisting the token", async () => {
    const successFetcher: typeof undiciFetch = async () =>
      new UndiciResponse("", { status: 200, headers: { "set-cookie": "ct0=csrf; Path=/" } });
    const failedFetcher: typeof undiciFetch = async () => new UndiciResponse("", { status: 401 });
    await expect(bootstrapCookiesFromAuthToken("auth", successFetcher)).resolves.toMatchObject({
      auth_token: "auth",
      ct0: "csrf",
    });
    await expect(bootstrapCookiesFromAuthToken("auth", failedFetcher)).resolves.toBeUndefined();
  });
});
