import type { API_HTTP_MODE } from "../constants/config.js";
import type { CookieMap, ProxySettings } from "./accounts.js";

export interface HttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export interface HttpSession {
  readonly cookies: CookieMap;
  get(url: string, options?: HttpRequestOptions): Promise<HttpResponse>;
  post?(url: string, options?: HttpRequestOptions): Promise<HttpResponse>;
  close(): Promise<void>;
}

export interface HttpRequestOptions {
  readonly query?: Readonly<Record<string, string>>;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly maxBytes?: number;
  readonly redirect?: "follow" | "error" | "manual";
}

export interface SessionFactoryOptions {
  readonly cookies: CookieMap;
  readonly proxy?: string | ProxySettings;
  readonly bearerToken?: string;
  readonly userAgent?: string;
  readonly impersonate?: string;
  readonly httpMode?: (typeof API_HTTP_MODE)[keyof typeof API_HTTP_MODE];
}

export type SessionFactory = (options: SessionFactoryOptions) => HttpSession;

export interface GraphqlResponse {
  readonly data: unknown | null;
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly snippet: string;
  readonly remaining?: number;
  readonly resetAt?: number;
  readonly quotaExhausted?: boolean;
}
