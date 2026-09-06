import type { fetch as UndiciFetch } from "undici";
import type { ProxySettings } from "../domain/accounts.js";
import type { ApiHttpMode } from "../config/types.js";
import type { SessionFactory } from "../domain/http.js";

export interface SessionBuilderOptions {
  readonly bearerToken: string;
  readonly defaultProxy?: string | ProxySettings;
  readonly userAgent?: string;
  readonly httpMode?: ApiHttpMode;
  readonly impersonate?: string;
  readonly fetcher?: typeof UndiciFetch;
  readonly factory?: SessionFactory;
}

export interface ReadableHttpResponse {
  readonly body?: {
    getReader(): ReadableStreamDefaultReader<Uint8Array>;
    cancel?(reason?: unknown): Promise<void>;
  } | null;
  text(): Promise<string>;
}

export interface TransactionIdSource {
  readonly create?: (method: string, url: string) => Promise<string | undefined>;
}

export interface TransactionIdOptions {
  readonly enabled?: boolean;
  readonly ttlMs?: number;
}
