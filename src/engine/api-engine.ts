import type { ClientConfig } from "../config/types.js";
import type { GraphqlResponse, HttpSession } from "../domain/http.js";
import type { Manifest } from "../domain/manifest.js";
import type { FollowType, ProfileTimelineRequest, SearchRequest, TargetInput } from "../domain/requests.js";
import type { TweetRecord } from "../domain/records.js";
import type { FollowPage, RequestQuota, TweetPage } from "../domain/pages.js";
import { EMPTY_REASON } from "../constants/pages.js";
import { FOLLOW_TYPE } from "../constants/requests.js";
import {
  extractFollows,
  extractProfileTweets,
  extractSearchTweets,
  extractTweetResult,
  extractUserResult,
} from "./extractors.js";
import type { ManifestProvider } from "../manifest/provider.js";
import type { GraphqlTransport } from "../transport/graphql.js";
import {
  buildFollowsParams,
  buildProfileTimelineParams,
  buildSearchParams,
  buildTweetResultParams,
  buildUserLookupParams,
  endpointFor,
  OPERATION,
} from "../query/builder.js";
import { NetworkError } from "../domain/errors.js";

export class ApiEngine {
  public constructor(
    private readonly config: ClientConfig,
    private readonly manifests: ManifestProvider,
    private readonly transport: GraphqlTransport,
  ) {}

  public async search(
    session: HttpSession,
    request: SearchRequest,
    cursor?: string,
    signal?: AbortSignal,
    onAttempt?: () => void,
  ): Promise<TweetPage> {
    const response = await this.graphql(
      session,
      OPERATION.search,
      (manifest) => buildSearchParams(request, manifest, cursor, this.config.apiPageSize),
      signal,
      onAttempt,
    );
    if (response.status !== 200 || !response.data)
      throw new NetworkError(`Search request returned status ${response.status}.`, {
        statusCode: response.status,
      });
    const page = extractSearchTweets(response.data);
    if (page.emptyReason === EMPTY_REASON.MALFORMED)
      throw new NetworkError("Search response was malformed.", { statusCode: 502 });
    return attachQuota(page, response);
  }

  public async lookupUser(
    session: HttpSession,
    username: string,
    signal?: AbortSignal,
    onAttempt?: () => void,
  ): Promise<Record<string, unknown>> {
    const response = await this.graphql(
      session,
      OPERATION.userLookup,
      (manifest) => buildUserLookupParams(username, manifest),
      signal,
      onAttempt,
    );
    if (response.status !== 200 || !response.data)
      throw new NetworkError(`User lookup returned status ${response.status}.`, {
        statusCode: response.status,
      });
    const user = extractUserResult(response.data);
    if (!user) throw new NetworkError(`User ${username} was not found.`, { statusCode: 404 });
    return user;
  }

  public async profilePage(
    session: HttpSession,
    userId: string,
    request: ProfileTimelineRequest,
    cursor?: string,
    signal?: AbortSignal,
    onAttempt?: () => void,
  ): Promise<TweetPage> {
    const response = await this.graphql(
      session,
      OPERATION.profileTimeline,
      (manifest) => buildProfileTimelineParams(userId, request, manifest, cursor, this.config.apiPageSize),
      signal,
      onAttempt,
    );
    if (response.status !== 200 || !response.data)
      throw new NetworkError(`Profile timeline returned status ${response.status}.`, {
        statusCode: response.status,
      });
    const page = extractProfileTweets(response.data);
    if (page.emptyReason === EMPTY_REASON.MALFORMED)
      throw new NetworkError("Profile timeline response was malformed.", { statusCode: 502 });
    return attachQuota(page, response);
  }

  public async followsPage(
    session: HttpSession,
    userId: string,
    type: FollowType,
    cursor?: string,
    signal?: AbortSignal,
    onAttempt?: () => void,
  ): Promise<FollowPage> {
    const operation =
      type === FOLLOW_TYPE.FOLLOWERS
        ? OPERATION.followers
        : type === FOLLOW_TYPE.VERIFIED_FOLLOWERS
          ? OPERATION.verifiedFollowers
          : OPERATION.following;
    const response = await this.graphql(
      session,
      operation,
      (manifest) => buildFollowsParams(userId, operation, manifest, cursor, this.config.apiPageSize),
      signal,
      onAttempt,
    );
    if (response.status !== 200 || !response.data)
      throw new NetworkError(`Relationship request returned status ${response.status}.`, {
        statusCode: response.status,
      });
    return attachQuota(extractFollows(response.data), response);
  }

  public async tweetResult(
    session: HttpSession,
    tweetId: string,
    signal?: AbortSignal,
    onAttempt?: () => void,
  ): Promise<TweetRecord | undefined> {
    const response = await this.graphql(
      session,
      OPERATION.tweetResult,
      (manifest) => buildTweetResultParams(tweetId, manifest),
      signal,
      onAttempt,
    );
    if (response.status !== 200 || !response.data)
      throw new NetworkError(`Tweet lookup returned status ${response.status}.`, {
        statusCode: response.status,
      });
    return extractTweetResult(response.data);
  }

  private async graphql(
    session: HttpSession,
    operation: string,
    buildParams: (manifest: Manifest) => Record<string, string>,
    signal?: AbortSignal,
    onAttempt?: () => void,
  ): Promise<GraphqlResponse> {
    const send = (manifest: Manifest): Promise<GraphqlResponse> => {
      onAttempt?.();
      return this.transport.get(
        session,
        endpointFor(manifest, operation, this.config.allowedManifestOrigins),
        buildParams(manifest),
        manifest.timeoutSeconds * 1_000,
        signal,
      );
    };
    const manifest = await this.manifests.getManifest();
    try {
      return await send(manifest);
    } catch (error) {
      if (!isOperationMismatch(error)) throw error;
      let refreshed: Manifest;
      try {
        refreshed = await this.manifests.refreshLive(session.cookies.auth_token);
      } catch {
        throw error;
      }
      return send(refreshed);
    }
  }

  public async resolveTarget(
    session: HttpSession,
    target: TargetInput,
    signal?: AbortSignal,
    onAttempt?: () => void,
  ): Promise<{ readonly username: string; readonly userId: string; readonly raw: Record<string, unknown> }> {
    const username =
      target.username?.replace(/^@/u, "") ?? target.profileUrl?.split("/").filter(Boolean).pop();
    if (target.userId && !username) return { username: target.userId, userId: target.userId, raw: {} };
    if (!username)
      throw new NetworkError("Target has no resolvable username or user ID.", { statusCode: 400 });
    const raw = target.userId ? {} : await this.lookupUser(session, username, signal, onAttempt);
    const userId = target.userId ?? String(raw.rest_id ?? raw.id ?? "");
    if (!userId) throw new NetworkError(`Target ${username} has no user id.`, { statusCode: 404 });
    return { username, userId, raw };
  }
}

function isOperationMismatch(error: unknown): boolean {
  if (!(error instanceof NetworkError)) return false;
  return error.diagnostics.statusCode === 404 || error.diagnostics.statusCode === 422;
}

function attachQuota<T extends { readonly quota?: RequestQuota }>(value: T, response: GraphqlResponse): T {
  if (response.remaining === undefined && response.resetAt === undefined && !response.quotaExhausted)
    return value;
  return {
    ...value,
    quota: {
      ...(response.remaining === undefined ? {} : { remaining: response.remaining }),
      ...(response.resetAt === undefined ? {} : { resetAt: response.resetAt }),
      ...(response.quotaExhausted ? { exhausted: true } : {}),
    },
  };
}
