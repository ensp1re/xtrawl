import type { ProxySettings } from "../domain/accounts.js";

const REDACTED = "[redacted]";

export function redactProxy(proxy: string | ProxySettings): string | ProxySettings {
  if (typeof proxy !== "string")
    return {
      ...proxy,
      ...(proxy.username ? { username: REDACTED } : {}),
      ...(proxy.password ? { password: REDACTED } : {}),
    };
  try {
    const value = new URL(proxy.includes("://") ? proxy : `http://${proxy}`);
    if (value.username) value.username = REDACTED;
    if (value.password) value.password = REDACTED;
    return value.toString();
  } catch {
    return REDACTED;
  }
}

export function redactText(value: string): string {
  return value
    .replace(/auth_token=[^;\s&]+/giu, `auth_token=${REDACTED}`)
    .replace(/\bct0=[^;\s&]+/giu, `ct0=${REDACTED}`)
    .replace(/Bearer\s+[A-Za-z0-9._%~+-]+/giu, `Bearer ${REDACTED}`)
    .replace(/Cookie:\s*[^\n]+/giu, `Cookie: ${REDACTED}`)
    .replace(
      /(?:password|passwd|secret|csrf|ct0|auth_token)\s*[:=]\s*([^\s,;]+)/giu,
      (match, secret: string) => match.replace(secret, REDACTED),
    );
}

export function redactUnknown(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(redactUnknown);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      if (/password|token|cookie|secret|authorization|csrf|proxy/iu.test(key)) return [key, REDACTED];
      return [key, redactUnknown(child)];
    }),
  );
}
