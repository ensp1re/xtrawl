import type { ManifestPayload } from "../domain/manifest.js";
import { asString } from "../utils/guards.js";

const OPERATION_NAMES: Record<string, string> = {
  SearchTimeline: "search_timeline",
  UserByScreenName: "user_lookup_screen_name",
  UserTweets: "profile_timeline",
  Followers: "followers",
  Following: "following",
  BlueVerifiedFollowers: "verified_followers",
};

export function extractManifestFromJavascript(source: string, fallback: ManifestPayload): ManifestPayload {
  const queryIds: Record<string, string> = { ...fallback.queryIds };
  for (const [operationName, key] of Object.entries(OPERATION_NAMES)) {
    const expression = new RegExp(
      `queryId\\s*:\\s*["']([^"']+)["']\\s*,\\s*operationName\\s*:\\s*["']${operationName}["']`,
      "u",
    );
    const id = source.match(expression)?.[1];
    if (id) queryIds[key] = id;
  }
  return { ...fallback, queryIds, version: asString(fallback.version) ?? "live" };
}

export async function scrapeManifestFromWeb(base: ManifestPayload): Promise<ManifestPayload> {
  const response = await fetch("https://x.com/home", { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!response.ok) throw new Error(`Manifest page failed with status ${response.status}`);
  const html = await response.text();
  const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/giu)]
    .map((match) => match[1])
    .filter((item): item is string => Boolean(item));
  for (const src of scripts) {
    const url = src.startsWith("http") ? src : new URL(src, "https://x.com").toString();
    const bundle = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!bundle.ok) continue;
    const candidate = extractManifestFromJavascript(await bundle.text(), base);
    if (Object.keys(candidate.queryIds).length >= Object.keys(base.queryIds).length) return candidate;
  }
  return base;
}
