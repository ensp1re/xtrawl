import type { FeatureFlags, FieldToggles, Manifest, ManifestPayload } from "../domain/manifest.js";
import { ManifestError } from "../domain/errors.js";
import { asInteger, asString, isRecord } from "../utils/guards.js";

export function createManifest(payload: ManifestPayload): Manifest {
  if (!payload || !isRecord(payload.queryIds) || !isRecord(payload.endpoints)) {
    throw new ManifestError("Manifest requires queryIds and endpoints objects.");
  }
  const queryIds = mapStrings(payload.queryIds);
  const endpoints = mapStrings(payload.endpoints);
  if (!queryIds.search_timeline || !endpoints.search_timeline)
    throw new ManifestError("Manifest requires a search endpoint.");
  const features = mapBooleans(payload.features);
  const operationFeatures = mapBooleanMap(payload.operationFeatures);
  const operationFieldToggles = mapBooleanMap(payload.operationFieldToggles);
  return {
    version: asString(payload.version) ?? "unknown",
    queryIds,
    endpoints,
    features,
    operationFeatures,
    operationFieldToggles,
    timeoutSeconds: Math.max(1, asInteger(payload.timeoutSeconds, 25)),
    featuresFor(operation: string): FeatureFlags {
      return { ...features, ...(operationFeatures[operation] ?? {}) };
    },
    fieldTogglesFor(operation: string): FieldToggles {
      return operationFieldToggles[operation] ?? {};
    },
  };
}

function mapStrings(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) => {
      const text = asString(child);
      return text ? [[key, text] as const] : [];
    }),
  );
}

function mapBooleans(value: unknown): Record<string, boolean> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"),
  );
}

function mapBooleanMap(value: unknown): Record<string, Record<string, boolean>> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, mapBooleans(child)]));
}
