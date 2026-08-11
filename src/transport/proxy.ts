import { ProxyAgent, type Dispatcher } from "undici";
import { socksDispatcher } from "fetch-socks";
import type { ProxySettings } from "../domain/accounts.js";
import { ProxyError } from "../domain/errors.js";

export function proxyToUrl(proxy: string | ProxySettings | undefined): string | undefined {
  if (!proxy) return undefined;
  if (typeof proxy === "string") return proxy.includes("://") ? proxy : `http://${proxy}`;
  if (proxy.http || proxy.https) return proxy.https ?? proxy.http;
  if (!proxy.host || !proxy.port) throw new ProxyError("Proxy host and port are required.");
  const scheme = proxy.scheme ?? "http";
  const credentials = proxy.username
    ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password ?? "")}@`
    : "";
  return `${scheme}://${credentials}${proxy.host}:${proxy.port}`;
}

export function proxyDispatcher(proxy: string | ProxySettings | undefined): Dispatcher | undefined {
  const value = proxyToUrl(proxy);
  if (!value) return undefined;
  const url = new URL(value);
  if (url.protocol === "socks5:" || url.protocol === "socks5h:")
    return socksDispatcher({
      type: 5,
      host: url.hostname,
      port: Number(url.port || 1080),
      ...(url.username ? { userId: decodeURIComponent(url.username) } : {}),
      ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    });
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new ProxyError(`Unsupported proxy protocol: ${url.protocol}`);
  return new ProxyAgent(value);
}
