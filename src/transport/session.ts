import { fetch as undiciFetch, type Dispatcher } from "undici";
import type { AccountRecord, AuthMaterial, CookieMap, ProxySettings } from "../domain/accounts.js";
import type { HttpRequestOptions, HttpResponse, HttpSession } from "../domain/http.js";
import { AccountSessionRuntimeError } from "../domain/errors.js";
import { ProxyError } from "../domain/errors.js";
import { prepareAuthMaterial } from "../auth/material.js";
import { combineSignals, isAbortError } from "../utils/abort.js";
import { cancelBody, DEFAULT_MAX_RESPONSE_BYTES, readResponseText } from "./body.js";
import { DispatcherPool } from "./dispatcher-pool.js";
import { proxyToUrl } from "./proxy.js";
import type { SessionBuilderOptions } from "./types.js";

export type { SessionBuilderOptions } from "./types.js";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36";

export class SessionBuilder {
  private readonly healthyProxies = new Map<string, number>();
  private readonly preflights = new Map<string, Promise<void>>();
  private readonly dispatchers = new DispatcherPool();

  public constructor(private readonly options: SessionBuilderOptions) {}

  public forAccount(account: AccountRecord): HttpSession {
    const material = prepareAuthMaterial(account, this.options.bearerToken);
    return this.fromMaterial(material, account.proxy ?? this.options.defaultProxy);
  }

  public fromMaterial(material: AuthMaterial, proxy?: string | ProxySettings): HttpSession {
    if (this.options.factory)
      return this.options.factory({
        cookies: material.cookies,
        proxy,
        bearerToken: material.bearerToken,
        ...(this.options.userAgent ? { userAgent: this.options.userAgent } : {}),
        ...(this.options.impersonate ? { impersonate: this.options.impersonate } : {}),
        ...(this.options.httpMode ? { httpMode: this.options.httpMode } : {}),
      });
    return new FetchSession(
      material,
      this.dispatchers.acquire(proxy),
      this.options.fetcher ?? undiciFetch,
      this.options.userAgent ?? DEFAULT_USER_AGENT,
    );
  }

  public async assertProxyHealthy(
    account: AccountRecord,
    options: { readonly url: string; readonly timeoutMs: number },
  ): Promise<void> {
    const proxyUrl = proxyToUrl(account.proxy ?? this.options.defaultProxy);
    if (!proxyUrl) return;
    if ((this.healthyProxies.get(proxyUrl) ?? 0) > Date.now() - 60_000) return;
    const pending = this.preflights.get(proxyUrl);
    if (pending) return pending;
    const work = this.runProxyPreflight(account, proxyUrl, options).finally(() => {
      this.preflights.delete(proxyUrl);
    });
    this.preflights.set(proxyUrl, work);
    return work;
  }

  public async close(): Promise<void> {
    await this.dispatchers.close();
  }

  public dispatcherCount(): number {
    return this.dispatchers.size();
  }

  private async runProxyPreflight(
    account: AccountRecord,
    proxyUrl: string,
    options: { readonly url: string; readonly timeoutMs: number },
  ): Promise<void> {
    const acquired = this.dispatchers.acquire(account.proxy ?? this.options.defaultProxy);
    const dispatcher = acquired.dispatcher;
    if (!dispatcher) {
      acquired.release();
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await (this.options.fetcher ?? undiciFetch)(options.url, {
        method: "GET",
        headers: { "User-Agent": this.options.userAgent ?? DEFAULT_USER_AGENT },
        redirect: "follow",
        signal: controller.signal,
        dispatcher,
      });
      try {
        if (response.status === 407)
          throw new ProxyError("Proxy authentication was rejected.", { statusCode: 407 });
        this.healthyProxies.set(proxyUrl, Date.now());
      } finally {
        await cancelBody(response);
      }
    } catch (error) {
      if (error instanceof ProxyError) throw error;
      throw new ProxyError(error instanceof Error ? error.message : String(error), { statusCode: 599 });
    } finally {
      clearTimeout(timeout);
      acquired.release();
    }
  }
}

class FetchSession implements HttpSession {
  public readonly cookies: CookieMap;
  private readonly dispatcher?: Dispatcher;
  private readonly releaseDispatcher: () => void;

  public constructor(
    private readonly material: AuthMaterial,
    acquired: { readonly dispatcher?: Dispatcher; release(): void },
    private readonly fetcher: typeof undiciFetch,
    private readonly userAgent: string,
  ) {
    this.cookies = material.cookies;
    this.dispatcher = acquired.dispatcher;
    this.releaseDispatcher = () => acquired.release();
  }

  public async get(url: string, options: HttpRequestOptions = {}): Promise<HttpResponse> {
    return this.request("GET", url, options);
  }

  public async post(url: string, options: HttpRequestOptions = {}): Promise<HttpResponse> {
    return this.request("POST", url, options);
  }

  private async request(
    method: "GET" | "POST",
    url: string,
    options: HttpRequestOptions,
  ): Promise<HttpResponse> {
    const target = new URL(url);
    for (const [key, value] of Object.entries(options.query ?? {})) target.searchParams.set(key, value);
    const timeout = new AbortController();
    const timer = options.timeoutMs ? setTimeout(() => timeout.abort(), options.timeoutMs) : undefined;
    const signal = combineSignals(options.signal, options.timeoutMs ? timeout.signal : undefined);
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.material.bearerToken}`,
        "X-Csrf-Token": this.material.csrfToken,
        "X-Twitter-Auth-Type": "OAuth2Session",
        "X-Twitter-Active-User": "yes",
        "X-Twitter-Client-Language": "en",
        Referer: "https://x.com/",
        "User-Agent": this.userAgent,
        Cookie: cookieHeader(this.cookies),
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
        ...(options.headers ?? {}),
      };
      const init = {
        method,
        headers,
        ...(method === "POST" && options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        redirect: options.redirect ?? "manual",
        ...(signal ? { signal } : {}),
        ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
      } as Parameters<typeof this.fetcher>[1];
      const response = await this.fetcher(target, init);
      const headersMap = Object.fromEntries(response.headers.entries());
      if (response.status >= 300 && response.status < 400) {
        await cancelBody(response);
        throw new AccountSessionRuntimeError(
          method === "GET" ? "http_get_failed" : "http_post_failed",
          "Authenticated redirects are not followed.",
        );
      }
      try {
        const text = await readResponseText(response, {
          ...(signal ? { signal } : {}),
          maxBytes: options.maxBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
        });
        return {
          status: response.status,
          headers: headersMap,
          text: async () => text,
          json: async () => (text ? (JSON.parse(text) as unknown) : null),
        };
      } catch (error) {
        await cancelBody(response);
        throw error;
      }
    } catch (error) {
      if (isAbortError(error) || error instanceof AccountSessionRuntimeError) throw error;
      throw new AccountSessionRuntimeError(
        method === "GET" ? "http_get_failed" : "http_post_failed",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  public async close(): Promise<void> {
    this.releaseDispatcher();
  }
}

export function cookieHeader(cookies: CookieMap): string {
  return Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}
