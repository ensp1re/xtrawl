import type { ManifestPayload } from "../domain/manifest.js";
import { asString } from "../utils/guards.js";

const OPERATION_NAMES: Record<string, string> = {
  SearchTimeline: "search_timeline",
  UserByScreenName: "user_lookup_screen_name",
  UserTweets: "profile_timeline",
  Followers: "followers",
  Following: "following",
  BlueVerifiedFollowers: "verified_followers",
  TweetResultByRestId: "tweet_result",
};

export interface ManifestScrapeOptions {
  readonly authToken?: string;
  readonly fetcher?: typeof fetch;
  readonly maxScripts?: number;
}

export function extractManifestFromJavascript(source: string, fallback: ManifestPayload): ManifestPayload {
  const operationFeatures = extractOperationFeaturesFromJavascript(source);
  return {
    ...fallback,
    queryIds: {
      ...fallback.queryIds,
      ...extractOperationQueryIdsFromJavascript(source),
    },
    operationFeatures: mergeOperationFeatures(fallback.operationFeatures, operationFeatures),
    version: asString(fallback.version) ?? "live",
  };
}

export function extractOperationQueryIdsFromJavascript(source: string): Record<string, string> {
  const queryIds: Record<string, string> = {};
  for (const [operationName, key] of Object.entries(OPERATION_NAMES)) {
    const queryFirst = new RegExp(
      `queryId\\s*:\\s*["']([^"']+)["']\\s*,\\s*operationName\\s*:\\s*["']${operationName}["']`,
      "u",
    );
    const operationFirst = new RegExp(
      `operationName\\s*:\\s*["']${operationName}["']\\s*,\\s*queryId\\s*:\\s*["']([^"']+)["']`,
      "u",
    );
    const id = source.match(queryFirst)?.[1] ?? source.match(operationFirst)?.[1];
    if (id) queryIds[key] = id;
  }
  return queryIds;
}

export function extractOperationFeaturesFromJavascript(
  source: string,
): Record<string, Record<string, boolean>> {
  const out: Record<string, Record<string, boolean>> = {};
  for (const [operationName, key] of Object.entries(OPERATION_NAMES)) {
    const marker = new RegExp(`operationName\\s*:\\s*["']${operationName}["']`, "gu");
    const match = marker.exec(source);
    if (!match) continue;
    const start = match.index;
    const next = source.indexOf("operationName:", start + match[0].length);
    const window = source.slice(start, next > start ? Math.min(next, start + 50_000) : start + 50_000);
    const featureStart = window.indexOf("featureSwitches:[");
    if (featureStart < 0) continue;
    const featureEnd = window.indexOf("]", featureStart);
    if (featureEnd < 0) continue;
    const names = [...window.slice(featureStart, featureEnd).matchAll(/["']([^"']+)["']/gu)]
      .map((item) => item[1])
      .filter((item): item is string => Boolean(item));
    if (names.length > 0) out[key] = Object.fromEntries(names.map((name) => [name, false]));
  }
  return out;
}

export async function scrapeManifestFromWeb(
  base: ManifestPayload,
  options: ManifestScrapeOptions = {},
): Promise<ManifestPayload> {
  const fetcher = options.fetcher ?? fetch;
  const scriptHeaders = {
    "User-Agent": "Mozilla/5.0",
  };
  const pageHeaders = {
    ...scriptHeaders,
    ...(options.authToken ? { Cookie: `auth_token=${options.authToken}` } : {}),
  };
  const response = await fetcher("https://x.com/home", { headers: pageHeaders, redirect: "follow" });
  if (!response.ok) throw new Error(`Manifest page failed with status ${response.status}`);
  const html = await response.text();
  const scripts = [...new Set([...html.matchAll(/<script[^>]+src=["']([^"']+)["']/giu)])]
    .map((match) => match[1])
    .filter((item): item is string => Boolean(item))
    .map((source) => safeScriptUrl(source))
    .filter((source): source is string => Boolean(source))
    .sort((left, right) => scriptPriority(left) - scriptPriority(right))
    .slice(0, options.maxScripts ?? 20);
  const discovered: Record<string, string> = {};
  const discoveredFeatures: Record<string, Record<string, boolean>> = {};
  for (const url of scripts) {
    const bundle = await fetcher(url, { headers: scriptHeaders, redirect: "follow" });
    if (!bundle.ok) continue;
    const source = await bundle.text();
    Object.assign(discovered, extractOperationQueryIdsFromJavascript(source));
    Object.assign(discoveredFeatures, extractOperationFeaturesFromJavascript(source));
    if (Object.keys(discovered).length === Object.keys(OPERATION_NAMES).length) break;
  }
  if (Object.keys(discovered).length === 0) {
    throw new Error("Manifest bundles did not contain any supported operation identifiers");
  }
  return {
    ...base,
    version: "web-live",
    queryIds: { ...base.queryIds, ...discovered },
    operationFeatures: mergeOperationFeatures(base.operationFeatures, discoveredFeatures),
  };
}

function mergeOperationFeatures(
  base: ManifestPayload["operationFeatures"],
  discovered: Readonly<Record<string, Readonly<Record<string, boolean>>>>,
): Record<string, Record<string, boolean>> {
  const out: Record<string, Record<string, boolean>> = {};
  if (base)
    for (const [operation, features] of Object.entries(base))
      out[operation] = { ...(features as Record<string, boolean>) };
  for (const [operation, features] of Object.entries(discovered))
    out[operation] = { ...(out[operation] ?? {}), ...features };
  return out;
}

function safeScriptUrl(source: string): string | undefined {
  try {
    const url = new URL(source, "https://x.com");
    if (url.protocol !== "https:") return undefined;
    if (url.hostname !== "x.com" && url.hostname !== "abs.twimg.com") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function scriptPriority(source: string): number {
  const path = new URL(source).pathname;
  if (/\/responsive-web\/client-web\/main\.[^/]+\.js$/u.test(path)) return 0;
  if (/\/main\.[^/]+\.js$/u.test(path)) return 1;
  return 2;
}
