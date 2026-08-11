import { ProxyAgent, fetch as undiciFetch, type Dispatcher } from "undici";
import type { AccountRecord, AuthMaterial, CookieMap, ProxySettings } from "../domain/accounts.js";
import type { HttpRequestOptions, HttpResponse, HttpSession, SessionFactory } from "../domain/http.js";
import { AccountSessionRuntimeError } from "../domain/errors.js";
import { prepareAuthMaterial } from "../auth/material.js";
import { proxyToUrl } from "./proxy.js";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36";

export interface SessionBuilderOptions {
  readonly bearerToken: string;
  readonly defaultProxy?: string | ProxySettings;
  readonly userAgent?: string;
  readonly fetcher?: typeof undiciFetch;
  readonly factory?: SessionFactory;
}

export class SessionBuilder {
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
      });
    return new FetchSession(
      material,
      proxy,
      this.options.fetcher ?? undiciFetch,
      this.options.userAgent ?? DEFAULT_USER_AGENT,
    );
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
    const proxyUrl = proxyToUrl(proxy);
    if (proxyUrl) this.dispatcher = new ProxyAgent(proxyUrl);
  }

  public async get(url: string, options: HttpRequestOptions = {}): Promise<HttpResponse> {
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
        ...(options.headers ?? {}),
      };
      const init = {
        method: "GET",
        headers,
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
        "http_get_failed",
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
