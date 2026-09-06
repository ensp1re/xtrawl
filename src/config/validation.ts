import { API_HTTP_MODE } from "../constants/config.js";
import { PROXY_SCHEME } from "../constants/accounts.js";
import { ConfigError } from "../domain/errors.js";
import type { ProxySettings } from "../domain/accounts.js";
import { asBoolean, asInteger, asString, isRecord } from "../utils/guards.js";
import { DEFAULT_CONFIG } from "./defaults.js";
import type { ClientConfig, ConfigInput } from "./types.js";

export type { ApiHttpMode } from "./types.js";

const CONFIG_KEYS = [
  "dbPath",
  "proxy",
  "concurrency",
  "saveDir",
  "saveFormat",
  "apiHttpMode",
  "apiHttpImpersonate",
  "apiUserAgent",
  "dailyRequestsLimit",
  "dailyTweetsLimit",
  "maxEmptyPages",
  "apiPageSize",
  "searchSplits",
  "schedulerMinIntervalMs",
  "minDelayMs",
  "leaseTtlMs",
  "leaseHeartbeatMs",
  "cooldownDefaultMs",
  "transientCooldownMs",
  "authCooldownMs",
  "cooldownJitterMs",
  "requestsPerMinute",
  "retryBaseMs",
  "retryMaxMs",
  "maxTaskAttempts",
  "maxFallbackAttempts",
  "maxAccountSwitches",
  "proxyCheckOnLease",
  "proxyCheckUrl",
  "proxyCheckTimeoutMs",
  "profileTimelineAllowAnonymous",
  "manifestUrl",
  "allowedManifestOrigins",
  "manifestTtlMs",
  "manifestUpdateOnInit",
  "manifestScrapeOnInit",
  "transactionIdEnabled",
  "transactionIdTtlMs",
  "strict",
  "bearerToken",
] as const satisfies readonly (keyof ClientConfig)[];

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
    ...(value.scheme === PROXY_SCHEME.HTTP ||
    value.scheme === PROXY_SCHEME.HTTPS ||
    value.scheme === PROXY_SCHEME.SOCKS5
      ? { scheme: value.scheme }
      : {}),
    ...(asString(value.username) ? { username: asString(value.username) } : {}),
    ...(asString(value.password) ? { password: asString(value.password) } : {}),
  };
  if (proxy.http || proxy.https || proxy.host) return proxy;
  return undefined;
}

export function validateConfig(input: ConfigInput = {}): ClientConfig {
  const merged = { ...DEFAULT_CONFIG, ...configOverrides(input) };
  const mode = merged.apiHttpMode ?? DEFAULT_CONFIG.apiHttpMode;
  if (mode !== API_HTTP_MODE.AUTO && mode !== API_HTTP_MODE.ASYNC && mode !== API_HTTP_MODE.SYNC) {
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
    "searchSplits",
    "schedulerMinIntervalMs",
    "leaseTtlMs",
    "manifestTtlMs",
    "requestsPerMinute",
    "maxTaskAttempts",
    "maxFallbackAttempts",
    "proxyCheckTimeoutMs",
    "transactionIdTtlMs",
  ];
  for (const field of positiveFields) {
    if (!Number.isInteger(merged[field]) || Number(merged[field]) < 1) {
      throw new ConfigError(`${field} must be a positive integer`);
    }
  }
  if (!Number.isInteger(merged.maxAccountSwitches) || merged.maxAccountSwitches < 0) {
    throw new ConfigError("maxAccountSwitches must be a non-negative integer");
  }
  if (merged.apiPageSize > 100) throw new ConfigError("apiPageSize must be at most 100");
  try {
    const proxyCheckUrl = new URL(merged.proxyCheckUrl);
    if (proxyCheckUrl.protocol !== "http:" && proxyCheckUrl.protocol !== "https:") throw new Error();
  } catch {
    throw new ConfigError("proxyCheckUrl must be an HTTP(S) URL");
  }
  const delayFields: Array<keyof ClientConfig> = [
    "minDelayMs",
    "leaseHeartbeatMs",
    "cooldownDefaultMs",
    "transientCooldownMs",
    "authCooldownMs",
    "cooldownJitterMs",
    "retryBaseMs",
    "retryMaxMs",
  ];
  for (const field of delayFields) {
    const value = Number(merged[field]);
    if (!Number.isFinite(value) || value < 0)
      throw new ConfigError("delay and cooldown values cannot be negative");
  }
  if (merged.leaseHeartbeatMs > 0 && merged.leaseHeartbeatMs * 2 >= merged.leaseTtlMs) {
    throw new ConfigError("leaseHeartbeatMs must leave a margin below leaseTtlMs");
  }
  return {
    ...merged,
    proxy,
    apiHttpMode: mode,
    proxyCheckOnLease: asBoolean(merged.proxyCheckOnLease),
    transactionIdEnabled: asBoolean(merged.transactionIdEnabled),
    strict: asBoolean(merged.strict),
    bearerToken: asString(merged.bearerToken) ?? DEFAULT_CONFIG.bearerToken,
    allowedManifestOrigins: Array.isArray(merged.allowedManifestOrigins)
      ? merged.allowedManifestOrigins.map((item) => String(item).trim()).filter(Boolean)
      : [],
  };
}

function configOverrides(input: ConfigInput): ConfigInput {
  const entries = CONFIG_KEYS.flatMap((key) =>
    input[key] === undefined ? [] : ([[key, input[key]]] as const),
  );
  return Object.fromEntries(entries) as ConfigInput;
}
