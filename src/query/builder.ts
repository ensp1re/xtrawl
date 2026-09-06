import { SEARCH_DISPLAY } from "../constants/requests.js";
import type { Manifest } from "../domain/manifest.js";
import { ManifestError } from "../domain/errors.js";
import type { ProfileTimelineRequest, SearchRequest, TargetInput } from "../domain/requests.js";
import { assertCredentialDestination } from "../manifest/destinations.js";
import { buildEffectiveQuery, normalizeSearch } from "./normalize.js";

export const OPERATION = {
  search: "search_timeline",
  userLookup: "user_lookup_screen_name",
  profileTimeline: "profile_timeline",
  followers: "followers",
  following: "following",
  verifiedFollowers: "verified_followers",
  tweetResult: "tweet_result",
} as const;

export function endpointFor(
  manifest: Manifest,
  operation: string,
  extraOrigins: readonly string[] = [],
): string {
  const id = manifest.queryIds[operation];
  const endpoint = manifest.endpoints[operation];
  if (!id || !endpoint) throw new ManifestError(`Manifest does not define operation ${operation}`);
  const url = endpoint.includes("{query_id}") ? endpoint.replace("{query_id}", id) : endpoint;
  return assertCredentialDestination(url, extraOrigins);
}

export function buildSearchParams(
  request: SearchRequest,
  manifest: Manifest,
  cursor?: string,
  pageSize = 20,
): Record<string, string> {
  const normalized = normalizeSearch(request).value;
  const rawQuery = buildEffectiveQuery(normalized) || "from:elonmusk";
  const variables: Record<string, unknown> = {
    rawQuery,
    count: Math.max(1, Math.min(pageSize, 100)),
    querySource: "typed_query",
    product:
      (request.displayType ?? SEARCH_DISPLAY.TOP).toLowerCase() === SEARCH_DISPLAY.LATEST.toLowerCase()
        ? SEARCH_DISPLAY.LATEST
        : SEARCH_DISPLAY.TOP,
    withGrokTranslatedBio: false,
    ...(cursor ? { cursor } : {}),
  };
  return {
    variables: JSON.stringify(variables),
    features: JSON.stringify(manifest.featuresFor(OPERATION.search)),
  };
}

export function buildUserLookupParams(username: string, manifest: Manifest): Record<string, string> {
  return {
    variables: JSON.stringify({ screen_name: username, withGrokTranslatedBio: false }),
    features: JSON.stringify(manifest.featuresFor(OPERATION.userLookup)),
    ...(Object.keys(manifest.fieldTogglesFor(OPERATION.userLookup)).length > 0
      ? { fieldToggles: JSON.stringify(manifest.fieldTogglesFor(OPERATION.userLookup)) }
      : {}),
  };
}

export function buildProfileTimelineParams(
  userId: string,
  _request: ProfileTimelineRequest,
  manifest: Manifest,
  cursor?: string,
  pageSize = 20,
): Record<string, string> {
  return {
    variables: JSON.stringify({
      userId,
      count: Math.max(1, Math.min(pageSize, 100)),
      includePromotedContent: true,
      withQuickPromoteEligibilityTweetFields: true,
      withVoice: true,
      ...(cursor ? { cursor } : {}),
    }),
    features: JSON.stringify(manifest.featuresFor(OPERATION.profileTimeline)),
    ...(Object.keys(manifest.fieldTogglesFor(OPERATION.profileTimeline)).length > 0
      ? { fieldToggles: JSON.stringify(manifest.fieldTogglesFor(OPERATION.profileTimeline)) }
      : {}),
  };
}

export function buildFollowsParams(
  userId: string,
  operation: string,
  manifest: Manifest,
  cursor?: string,
  pageSize = 20,
): Record<string, string> {
  const features = {
    ...manifest.featuresFor(operation),
    tweetypie_unmention_optimization_enabled: true,
    responsive_web_twitter_blue_verified_badge_is_enabled: true,
    vibe_api_enabled: false,
    responsive_web_graphql_exclude_directive_enabled: true,
  };
  return {
    variables: JSON.stringify({
      userId,
      count: Math.max(1, Math.min(pageSize, 100)),
      includePromotedContent: false,
      withGrokTranslatedBio: false,
      ...(cursor ? { cursor } : {}),
    }),
    features: JSON.stringify(features),
    ...(Object.keys(manifest.fieldTogglesFor(operation)).length > 0
      ? { fieldToggles: JSON.stringify(manifest.fieldTogglesFor(operation)) }
      : {}),
  };
}

export function buildTweetResultParams(tweetId: string, manifest: Manifest): Record<string, string> {
  return {
    variables: JSON.stringify({
      tweetId,
      withCommunity: false,
      includePromotedContent: false,
      withVoice: false,
    }),
    features: JSON.stringify(manifest.featuresFor(OPERATION.tweetResult)),
    ...(Object.keys(manifest.fieldTogglesFor(OPERATION.tweetResult)).length > 0
      ? { fieldToggles: JSON.stringify(manifest.fieldTogglesFor(OPERATION.tweetResult)) }
      : {}),
  };
}

export function targetUsername(target: TargetInput): string | undefined {
  if (target.username?.trim()) return target.username.trim().replace(/^@/u, "");
  if (target.profileUrl?.trim()) {
    try {
      const url = new URL(
        target.profileUrl.includes("://") ? target.profileUrl : `https://${target.profileUrl}`,
      );
      const parts = url.pathname.split("/").filter(Boolean);
      return parts.length === 1 ? parts[0] : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}
