import { fetch as undiciFetch } from "undici";
import { XTrawl } from "../../src/client/client.js";
import { NetworkError } from "../../src/domain/errors.js";
import { sleep } from "../../src/pool/limiter.js";
import { withRetry } from "../../src/runner/retry.js";
import { SessionBuilder } from "../../src/transport/session.js";
import { isAbortError } from "../../src/utils/abort.js";

function material() {
  return {
    authToken: "a",
    csrfToken: "b",
    bearerToken: "bearer",
    cookies: { auth_token: "a", ct0: "b" },
  };
}

function asFetcher(fetcher: (...args: never[]) => Promise<Response>): typeof undiciFetch {
  return fetcher as unknown as typeof undiciFetch;
}

async function expectAborted(work: Promise<unknown>): Promise<void> {
  try {
    await work;
    throw new Error("expected the request to abort");
  } catch (error) {
    expect(isAbortError(error)).toBe(true);
  }
}

function delayedBody(text: string, delayMs: number): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "application/json" } });
}

describe("request lifecycle", () => {
  test("aborts a stalled body while the request timeout is still active", async () => {
    const builder = new SessionBuilder({
      bearerToken: "bearer",
      fetcher: asFetcher(async () => delayedBody('{"ok":true}', 80)),
    });
    const session = builder.fromMaterial(material());
    const started = Date.now();
    await expectAborted(session.get("https://x.test/graphql", { timeoutMs: 15 }));
    expect(Date.now() - started).toBeLessThan(70);
    await session.close();
  });

  test("aborts stalled headers within the request timeout", async () => {
    const builder = new SessionBuilder({
      bearerToken: "bearer",
      fetcher: asFetcher(
        async (_input: never, init?: { signal?: AbortSignal }) =>
          new Promise<Response>((_resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("headers were not aborted")), 200);
            init?.signal?.addEventListener("abort", () => {
              clearTimeout(timer);
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            });
          }),
      ),
    });
    const session = builder.fromMaterial(material());
    const started = Date.now();
    await expectAborted(session.get("https://x.test/graphql", { timeoutMs: 15 }));
    expect(Date.now() - started).toBeLessThan(80);
    await session.close();
  });

  test("rejects an oversized response body", async () => {
    const builder = new SessionBuilder({
      bearerToken: "bearer",
      fetcher: asFetcher(async () => new Response(new Uint8Array(200), { status: 200 })),
    });
    const session = builder.fromMaterial(material());
    await expect(session.get("https://x.test/graphql", { maxBytes: 50 })).rejects.toThrow(
      "Response exceeded the configured size limit.",
    );
    await session.close();
  });

  test("cancels retry backoff when the signal aborts", async () => {
    const controller = new AbortController();
    const started = Date.now();
    setTimeout(() => controller.abort(), 20);
    await expectAborted(
      withRetry(
        async () => {
          throw new NetworkError("temp", { statusCode: 503 });
        },
        { maxAttempts: 5, baseMs: 400, maxMs: 400 },
        undefined,
        controller.signal,
      ),
    );
    expect(Date.now() - started).toBeLessThan(200);
  });

  test("shutdown cancels an in-flight collection and closes storage", async () => {
    const client = await XTrawl.create({
      authToken: "auth",
      csrfToken: "csrf",
      dbPath: ":memory:",
      minDelayMs: 0,
      retryBaseMs: 0,
      retryMaxMs: 0,
      proxyCheckOnLease: false,
      sessionFactory: (options) => ({
        cookies: options.cookies,
        get: async (_url, request) =>
          new Promise((_, reject) => {
            request?.signal?.addEventListener("abort", () => {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            });
          }),
        post: async (_url, request) =>
          new Promise((_, reject) => {
            request?.signal?.addEventListener("abort", () => {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            });
          }),
        close: async () => undefined,
      }),
    });
    const pending = client.searchPage("typescript");
    await sleep(10);
    await client.shutdown();
    await expect(pending).rejects.toBeInstanceOf(NetworkError);
    await expect(client.searchPage("typescript")).rejects.toThrow("shut down");
  });
});
