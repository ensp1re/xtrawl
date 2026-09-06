import type { API_HTTP_MODE } from "../constants/config.js";
import type { ProxySettings } from "../domain/accounts.js";
import type { OutputFormat } from "../domain/output.js";

export type ApiHttpMode = (typeof API_HTTP_MODE)[keyof typeof API_HTTP_MODE];

export interface ClientConfig {
  readonly dbPath: string;
  readonly proxy?: string | ProxySettings;
  readonly concurrency: number;
  readonly saveDir: string;
  readonly saveFormat: OutputFormat;
  readonly apiHttpMode: ApiHttpMode;
  readonly apiHttpImpersonate?: string;
  readonly apiUserAgent?: string;
  readonly dailyRequestsLimit: number;
  readonly dailyTweetsLimit: number;
  readonly maxEmptyPages: number;
  readonly apiPageSize: number;
  readonly searchSplits: number;
  readonly schedulerMinIntervalMs: number;
  readonly minDelayMs: number;
  readonly leaseTtlMs: number;
  readonly leaseHeartbeatMs: number;
  readonly cooldownDefaultMs: number;
  readonly transientCooldownMs: number;
  readonly authCooldownMs: number;
  readonly cooldownJitterMs: number;
  readonly requestsPerMinute: number;
  readonly retryBaseMs: number;
  readonly retryMaxMs: number;
  readonly maxTaskAttempts: number;
  readonly maxFallbackAttempts: number;
  readonly maxAccountSwitches: number;
  readonly proxyCheckOnLease: boolean;
  readonly proxyCheckUrl: string;
  readonly proxyCheckTimeoutMs: number;
  readonly profileTimelineAllowAnonymous: boolean;
  readonly manifestUrl?: string;
  readonly allowedManifestOrigins: readonly string[];
  readonly manifestTtlMs: number;
  readonly manifestUpdateOnInit: boolean;
  readonly manifestScrapeOnInit: boolean;
  readonly transactionIdEnabled: boolean;
  readonly transactionIdTtlMs: number;
  readonly strict: boolean;
  readonly bearerToken: string;
}

export type ConfigInput = Partial<Omit<ClientConfig, "proxy">> & {
  readonly proxy?: string | ProxySettings;
};
