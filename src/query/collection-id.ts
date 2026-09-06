import { queryHash } from "./hash.js";

export const COLLECTION_SCHEMA_VERSION = 1;

const NON_SEMANTIC_KEYS = new Set([
  "save",
  "saveDir",
  "saveName",
  "saveFormat",
  "resume",
  "signal",
  "pretty",
]);

export function collectionIdentity(
  operation: string,
  request: object,
  extra: Readonly<Record<string, unknown>> = {},
): string {
  const semantic = Object.fromEntries(Object.entries(request).filter(([key]) => !NON_SEMANTIC_KEYS.has(key)));
  return queryHash({
    schemaVersion: COLLECTION_SCHEMA_VERSION,
    operation,
    request: semantic,
    ...extra,
  });
}
