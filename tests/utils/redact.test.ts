import { redactText, redactUnknown, redactProxy } from "../../src/utils/redact.js";

describe("secret redaction", () => {
  test("removes planted session secrets from diagnostic text", () => {
    const text = redactText(
      "Cookie: auth_token=planted-auth; ct0=planted-csrf\nAuthorization: Bearer planted-bearer",
    );
    expect(text).not.toContain("planted-auth");
    expect(text).not.toContain("planted-csrf");
    expect(text).not.toContain("planted-bearer");
    expect(text).toContain("[redacted]");
  });

  test("redacts nested proxy credentials and token fields", () => {
    const proxy = String(redactProxy("http://user:secret@127.0.0.1:8080"));
    expect(proxy).not.toContain("secret");
    expect(proxy).toMatch(/redacted/i);
    expect(
      redactUnknown({
        message: "auth_token=planted-auth failed",
        proxy: { username: "user", password: "secret" },
      }),
    ).toEqual({
      message: "auth_token=[redacted] failed",
      proxy: "[redacted]",
    });
  });
});
