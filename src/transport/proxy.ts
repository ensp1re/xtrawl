import type { ProxySettings } from "../domain/accounts.js";
import { ProxyError } from "../domain/errors.js";

export function proxyToUrl(proxy: string | ProxySettings | undefined): string | undefined {
  if (!proxy) return undefined;
  if (typeof proxy === "string") return proxy.includes("://") ? proxy : `http://${proxy}`;
  if (proxy.http || proxy.https) return proxy.https ?? proxy.http;
  if (!proxy.host || !proxy.port) throw new ProxyError("Proxy host and port are required.");
  const scheme = proxy.scheme ?? "http";
  if (scheme === "socks5") throw new ProxyError("SOCKS5 requires a caller-provided dispatcher.");
  const credentials = proxy.username
    ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password ?? "")}@`
    : "";
  return `${scheme}://${credentials}${proxy.host}:${proxy.port}`;
}
