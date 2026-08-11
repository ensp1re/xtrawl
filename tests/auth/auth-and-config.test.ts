import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeCookiesPayload, parseCookieHeader, parseNetscapeCookies } from "../../src/auth/cookies.js";
import { loadAccountsFileSync, loadAccountsPayload } from "../../src/auth/loaders.js";
import { normalizeAccountRecord } from "../../src/auth/records.js";
import { validateConfig } from "../../src/config/validation.js";
import { ConfigError } from "../../src/domain/errors.js";

describe("cookie and account boundaries", () => {
  test("parses cookie headers and JSON cookie lists", () => {
    expect(parseCookieHeader("Cookie: auth_token=a; ct0=b")).toEqual({ auth_token: "a", ct0: "b" });
    expect(normalizeCookiesPayload('[{"name":"auth_token","value":"a"},{"name":"ct0","value":"b"}]')).toEqual(
      { auth_token: "a", ct0: "b" },
    );
  });

  test("parses Netscape cookie exports", () => {
    const value = "# Netscape\n.x.com TRUE / TRUE 0 auth_token abc\n.x.com TRUE / TRUE 0 ct0 def";
    expect(parseNetscapeCookies(value)).toEqual({ auth_token: "abc", ct0: "def" });
    expect(normalizeCookiesPayload(value)).toEqual({ auth_token: "abc", ct0: "def" });
  });

  test("treats a raw token as an auth cookie", () => {
    expect(normalizeCookiesPayload("token-only")).toEqual({ auth_token: "token-only" });
  });

  test("normalizes aliases and derives a stable username", () => {
    const record = normalizeAccountRecord({ email: "demo@example.test", auth_token: "token", ct0: "csrf" });
    expect(record.username).toBe("demo");
    expect(record.authToken).toBe("token");
    expect(record.csrfToken).toBe("csrf");
    expect(record.cookies).toEqual({ auth_token: "token", ct0: "csrf" });
  });

  test("loads JSON, pipe-delimited, and colon-delimited account files", () => {
    const root = mkdtempSync(join(tmpdir(), "graph-auth-"));
    const jsonPath = join(root, "accounts.json");
    const pipePath = join(root, "accounts.txt");
    writeFileSync(
      jsonPath,
      JSON.stringify([{ username: "json-user", cookies: { auth_token: "a", ct0: "b" } }]),
    );
    writeFileSync(
      pipePath,
      "pipe-user|pass|mail@example.test|mail-pass|otp|csrf|auth\n# ignored\ncolon-user:pass:mail2@example.test:mail-pass:otp:csrf2:auth2",
    );
    expect(loadAccountsFileSync(jsonPath)).toHaveLength(1);
    expect(loadAccountsFileSync(pipePath).map((row) => row.username)).toEqual(["pipe-user", "colon-user"]);
  });

  test("loads object and list cookie payloads", () => {
    expect(
      loadAccountsPayload({ username: "one", cookies: { auth_token: "a", ct0: "b" } })[0]?.username,
    ).toBe("one");
    expect(loadAccountsPayload([{ email: "two@example.test", auth_token: "a", ct0: "b" }])[0]?.username).toBe(
      "two",
    );
  });
});

describe("configuration", () => {
  test("normalizes valid proxy and retains strict defaults", () => {
    const config = validateConfig({ proxy: { host: "127.0.0.1", port: 8080 }, apiPageSize: 100 });
    expect(config.proxy).toEqual({ host: "127.0.0.1", port: 8080 });
    expect(config.apiPageSize).toBe(100);
    expect(config.bearerToken).toBeTruthy();
  });

  test("rejects invalid proxy and invalid page size", () => {
    expect(() => validateConfig({ proxy: "127.0.0.1:8080" })).not.toThrow();
    expect(() => validateConfig({ proxy: { host: "" } })).toThrow(ConfigError);
    expect(() => validateConfig({ apiPageSize: 101 })).toThrow(ConfigError);
  });
});
