import { fetch as undiciFetch } from "undici";
import type { CookieMap, ProxySettings } from "../domain/accounts.js";
import { AUXILIARY_REQUEST_TIMEOUT_MS, cancelBody } from "../transport/body.js";
import { proxyDispatcher } from "../transport/proxy.js";

export async function bootstrapCookiesFromAuthToken(
  authToken: string,
  fetcher: typeof undiciFetch = undiciFetch,
  proxy?: string | ProxySettings,
  signal?: AbortSignal,
): Promise<CookieMap | undefined> {
  const dispatcher = proxyDispatcher(proxy);
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), AUXILIARY_REQUEST_TIMEOUT_MS);
  const combined = signal && !signal.aborted ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
  try {
    const response = await fetcher("https://x.com/home", {
      headers: { Cookie: `auth_token=${authToken}`, "User-Agent": "Mozilla/5.0" },
      redirect: "manual",
      signal: combined,
      ...(dispatcher ? { dispatcher } : {}),
    });
    try {
      if (response.status >= 300 && response.status < 400) return undefined;
      if (response.status >= 400) return undefined;
      const cookies: Record<string, string> = { auth_token: authToken };
      const setCookies =
        typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
      for (const header of setCookies) {
        const first = header.split(";", 1)[0];
        if (!first) continue;
        const separator = first.indexOf("=");
        if (separator > 0) cookies[first.slice(0, separator)] = first.slice(separator + 1);
      }
      return cookies.ct0 ? cookies : undefined;
    } finally {
      await cancelBody(response);
    }
  } finally {
    clearTimeout(timer);
    await dispatcher?.close();
  }
}
