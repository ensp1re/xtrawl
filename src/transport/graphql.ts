import type { GraphqlResponse, HttpSession } from "../domain/http.js";
import { AuthError, NetworkError, RateLimitError } from "../domain/errors.js";
import { isRecord } from "../utils/guards.js";
import type { TransactionIdProvider } from "./transaction-id.js";

export class GraphqlTransport {
  public constructor(private readonly transactions: TransactionIdProvider) {}

  public async get(
    session: HttpSession,
    url: string,
    params: Readonly<Record<string, string>>,
    timeoutMs: number,
  ): Promise<GraphqlResponse> {
    try {
      const transactionId = await this.transactions.get("GET", url);
      const response = await session.get(url, {
        query: params,
        timeoutMs,
        ...(transactionId ? { headers: { "X-Client-Transaction-Id": transactionId } } : {}),
      });
      const body = await response.text();
      const snippet = body.slice(0, 240);
      let data: unknown = null;
      if (response.status === 200) {
        try {
          data = JSON.parse(body) as unknown;
        } catch {
          data = null;
        }
      }
      if (response.status === 401 || response.status === 403) {
        throw new AuthError("Remote session was rejected.", { statusCode: response.status, endpoint: url });
      }
      if (response.status === 429) {
        throw new RateLimitError("Remote rate limit was returned.", {
          statusCode: response.status,
          endpoint: url,
        });
      }
      if (response.status >= 400) {
        throw new NetworkError(`GraphQL request failed with status ${response.status}.`, {
          statusCode: response.status,
          endpoint: url,
        });
      }
      const mapped = mapGraphqlErrors(data);
      if (mapped === 401 || mapped === 403)
        throw new AuthError("Remote session was rejected.", { statusCode: mapped, endpoint: url });
      if (mapped === 429)
        throw new RateLimitError("Remote rate limit was returned.", { statusCode: mapped, endpoint: url });
      return { data, status: mapped ?? response.status, headers: response.headers, snippet };
    } catch (error) {
      if (error instanceof AuthError || error instanceof RateLimitError) throw error;
      if (error instanceof Error && error.name === "AbortError")
        throw new NetworkError("GraphQL request timed out.", { endpoint: url });
      if (error instanceof NetworkError) throw error;
      throw new NetworkError(error instanceof Error ? error.message : String(error), { endpoint: url });
    }
  }
}

function mapGraphqlErrors(value: unknown): number | undefined {
  if (!isRecord(value) || !Array.isArray(value.errors)) return undefined;
  for (const item of value.errors) {
    if (!isRecord(item)) continue;
    const message = String(item.message ?? "").toLowerCase();
    const extensions = isRecord(item.extensions) ? item.extensions : {};
    const code = String(extensions.code ?? extensions.errorType ?? "").toUpperCase();
    if (
      message.includes("rate limit") ||
      message.includes("too many requests") ||
      code === "RATE_LIMITED" ||
      code === "RATE_LIMIT"
    )
      return 429;
    if (
      message.includes("unauthorized") ||
      message.includes("authorization") ||
      code === "UNAUTHORIZED" ||
      code === "AUTHENTICATION_ERROR"
    )
      return 401;
    if (message.includes("forbidden") || code === "FORBIDDEN") return 403;
  }
  return undefined;
}
