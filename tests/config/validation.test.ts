import { ConfigError } from "../../src/domain/errors.js";
import { normalizeProxyPayload, validateConfig } from "../../src/config/validation.js";

describe("configuration validation", () => {
  test("normalizes URL, JSON, and structured proxy values", () => {
    expect(normalizeProxyPayload("127.0.0.1:8080")).toBe("127.0.0.1:8080");
    expect(normalizeProxyPayload('{"host":"proxy.test","port":8080}')).toEqual({
      host: "proxy.test",
      port: 8080,
    });
    expect(normalizeProxyPayload({ https: "https://proxy.test" })).toEqual({ https: "https://proxy.test" });
    expect(normalizeProxyPayload("localhost")).toBeUndefined();
  });

  test("rejects invalid operational boundaries", () => {
    expect(() => validateConfig({ maxAccountSwitches: -1 })).toThrow("non-negative");
    expect(() => validateConfig({ proxyCheckUrl: "file:///tmp/probe" })).toThrow("HTTP(S)");
  });

  test("does not retain constructor-only values supplied at runtime", () => {
    const config = validateConfig({ authToken: "secret" } as never) as unknown as Record<string, unknown>;
    expect(config.authToken).toBeUndefined();
  });

  test("rejects invalid modes, limits, and negative timing values", () => {
    expect(() => validateConfig({ apiHttpMode: "invalid" as never })).toThrow(ConfigError);
    expect(() => validateConfig({ concurrency: 0 })).toThrow(ConfigError);
    expect(() => validateConfig({ apiPageSize: 101 })).toThrow(ConfigError);
    expect(() => validateConfig({ cooldownDefaultMs: -1 })).toThrow(ConfigError);
  });

  test("retains strict boolean coercion and caller limits", () => {
    const config = validateConfig({ strict: "yes" as never, dailyRequestsLimit: 2, dailyTweetsLimit: 3 });
    expect(config.strict).toBe(true);
    expect(config.dailyRequestsLimit).toBe(2);
    expect(config.dailyTweetsLimit).toBe(3);
  });
});
