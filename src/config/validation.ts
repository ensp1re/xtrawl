import { ConfigError } from "../domain/errors.js";
import type { ProxySettings } from "../domain/accounts.js";
import { asBoolean, asInteger, asString, isRecord } from "../utils/guards.js";
import { DEFAULT_CONFIG } from "./defaults.js";
import type { ClientConfig, ConfigInput } from "./types.js";

export type ApiHttpMode = "auto" | "async" | "sync";

export function normalizeProxyPayload(value: unknown): string | ProxySettings | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return undefined;
    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        return normalizeProxyPayload(JSON.parse(text));
      } catch {
        return text;
      }
    }
    return text.includes("://") || text.includes(":") ? text : undefined;
  }
  if (!isRecord(value)) return undefined;
  const proxy: ProxySettings = {
    ...(asString(value.http) ? { http: asString(value.http) } : {}),
    ...(asString(value.https) ? { https: asString(value.https) } : {}),
    ...(asString(value.host) ? { host: asString(value.host) } : {}),
    ...(asInteger(value.port) > 0 ? { port: asInteger(value.port) } : {}),
    ...(value.scheme === "http" || value.scheme === "https" || value.scheme === "socks5"
      ? { scheme: value.scheme }
      : {}),
    ...(asString(value.username) ? { username: asString(value.username) } : {}),
    ...(asString(value.password) ? { password: asString(value.password) } : {}),
  };
  if (proxy.http || proxy.https || proxy.host) return proxy;
  return undefined;
}

export function validateConfig(input: ConfigInput = {}): ClientConfig {
  const merged = { ...DEFAULT_CONFIG, ...input };
  const mode = merged.apiHttpMode ?? DEFAULT_CONFIG.apiHttpMode;
  if (mode !== "auto" && mode !== "async" && mode !== "sync") {
    throw new ConfigError(`Unsupported HTTP mode: ${String(mode)}`);
  }
  const proxy = normalizeProxyPayload(merged.proxy);
  if (merged.proxy !== undefined && proxy === undefined) {
    throw new ConfigError("Invalid proxy. Use a URL or a host/port object.");
  }
  const positiveFields: Array<keyof ClientConfig> = [
    "concurrency",
    "dailyRequestsLimit",
    "dailyTweetsLimit",
    "maxEmptyPages",
    "apiPageSize",
    "leaseTtlMs",
    "manifestTtlMs",
    "requestsPerMinute",
    "maxTaskAttempts",
    "maxFallbackAttempts",
  ];
  for (const field of positiveFields) {
    if (!Number.isInteger(merged[field]) || Number(merged[field]) < 1) {
      throw new ConfigError(`${field} must be a positive integer`);
    }
  }
  if (merged.apiPageSize > 100) throw new ConfigError("apiPageSize must be at most 100");
  if (
    merged.minDelayMs < 0 ||
    merged.leaseHeartbeatMs < 0 ||
    merged.cooldownDefaultMs < 0 ||
    merged.transientCooldownMs < 0 ||
    merged.authCooldownMs < 0 ||
    merged.cooldownJitterMs < 0 ||
    merged.retryBaseMs < 0 ||
    merged.retryMaxMs < 0
  ) {
    throw new ConfigError("delay and cooldown values cannot be negative");
  }
  return {
    ...merged,
    proxy,
    apiHttpMode: mode,
    strict: asBoolean(merged.strict),
    bearerToken: asString(merged.bearerToken) ?? DEFAULT_CONFIG.bearerToken,
  };
}
