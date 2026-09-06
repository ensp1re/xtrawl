import { abortError } from "../utils/abort.js";

export const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
export const AUXILIARY_REQUEST_TIMEOUT_MS = 15_000;

export interface ReadableHttpResponse {
  readonly body?: {
    getReader(): ReadableStreamDefaultReader<Uint8Array>;
    cancel?(reason?: unknown): Promise<void>;
  } | null;
  text(): Promise<string>;
}

export async function readResponseText(
  response: ReadableHttpResponse,
  options: { readonly signal?: AbortSignal; readonly maxBytes: number },
): Promise<string> {
  if (options.signal?.aborted) {
    await cancelBody(response);
    throw abortError();
  }
  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text) > options.maxBytes) throw oversizedError();
    return text;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const onAbort = (): void => {
    void reader.cancel("aborted").catch(() => undefined);
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    while (true) {
      if (options.signal?.aborted) throw abortError();
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        if (options.signal?.aborted) throw abortError();
        throw error;
      }
      if (options.signal?.aborted) throw abortError();
      if (chunk.done) break;
      const value = chunk.value;
      if (!value) continue;
      size += value.byteLength;
      if (size > options.maxBytes) {
        await reader.cancel("oversized").catch(() => undefined);
        throw oversizedError();
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
  }
}

export async function cancelBody(response: {
  readonly body?: { cancel?(reason?: unknown): Promise<void> } | null;
}): Promise<void> {
  await response.body?.cancel?.("abandoned")?.catch(() => undefined);
}

export function oversizedError(): Error {
  return new Error("Response exceeded the configured size limit.");
}
