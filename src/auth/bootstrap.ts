import { fetch as undiciFetch } from "undici";
import type { CookieMap } from "../domain/accounts.js";

export async function bootstrapCookiesFromAuthToken(
  authToken: string,
  fetcher: typeof undiciFetch = undiciFetch,
): Promise<CookieMap | undefined> {
  const response = await fetcher("https://x.com/home", {
    headers: { Cookie: `auth_token=${authToken}`, "User-Agent": "Mozilla/5.0" },
    redirect: "follow",
  });
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
}
