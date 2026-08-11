import { fetch as undiciFetch, type Dispatcher } from "undici";
import type { AccountRecord, AuthMaterial, CookieMap, ProxySettings } from "../domain/accounts.js";
import type { HttpRequestOptions, HttpResponse, HttpSession, SessionFactory } from "../domain/http.js";
import { AccountSessionRuntimeError } from "../domain/errors.js";
import { ProxyError } from "../domain/errors.js";
import { prepareAuthMaterial } from "../auth/material.js";
import { proxyDispatcher, proxyToUrl } from "./proxy.js";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36";

export interface SessionBuilderOptions {
  readonly bearerToken: string;
  readonly defaultProxy?: string | ProxySettings;
  readonly userAgent?: string;
  readonly httpMode?: "auto" | "async" | "sync";
  readonly impersonate?: string;
  readonly fetcher?: typeof undiciFetch;
  readonly factory?: SessionFactory;
}

export class SessionBuilder {
  private readonly healthyProxies = new Map<string, number>();

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
      proxy,
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
    const dispatcher = proxyDispatcher(proxyUrl);
    if (!dispatcher) return;
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
      if (response.status === 407)
        throw new ProxyError("Proxy authentication was rejected.", { statusCode: 407 });
      this.healthyProxies.set(proxyUrl, Date.now());
      await response.body?.cancel();
    } catch (error) {
      if (error instanceof ProxyError) throw error;
      throw new ProxyError(error instanceof Error ? error.message : String(error), { statusCode: 599 });
    } finally {
      clearTimeout(timeout);
      await dispatcher.close();
    }
  }
}

class FetchSession implements HttpSession {
  public readonly cookies: CookieMap;
  private readonly dispatcher?: Dispatcher;

  public constructor(
    private readonly material: AuthMaterial,
    proxy: string | ProxySettings | undefined,
    private readonly fetcher: typeof undiciFetch,
    private readonly userAgent: string,
  ) {
    this.cookies = material.cookies;
    this.dispatcher = proxyDispatcher(proxy);
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
    const controller = new AbortController();
    const timeout = options.timeoutMs ? setTimeout(() => controller.abort(), options.timeoutMs) : undefined;
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
        redirect: options.redirect ?? "follow",
        signal: controller.signal,
        ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
      } as Parameters<typeof this.fetcher>[1];
      const response = await this.fetcher(target, init);
      const headersMap = Object.fromEntries(response.headers.entries());
      return {
        status: response.status,
        headers: headersMap,
        text: () => response.text(),
        json: () => response.json() as Promise<unknown>,
      };
    } catch (error) {
      throw new AccountSessionRuntimeError(
        method === "GET" ? "http_get_failed" : "http_post_failed",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  public async close(): Promise<void> {
    const close = this.dispatcher && "close" in this.dispatcher ? this.dispatcher.close : undefined;
    if (typeof close === "function") await close.call(this.dispatcher);
  }
}

export function cookieHeader(cookies: CookieMap): string {
  return Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}
