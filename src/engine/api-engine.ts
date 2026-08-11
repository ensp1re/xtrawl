import type { ClientConfig } from "../config/types.js";
import type { FollowType, ProfileTimelineRequest, SearchRequest, TargetInput } from "../domain/requests.js";
import type { FollowPage, TweetPage } from "./extractors.js";
import {
  extractFollows,
  extractProfileTweets,
  extractSearchTweets,
  extractUserResult,
} from "./extractors.js";
import type { ManifestProvider } from "../manifest/provider.js";
import type { HttpSession } from "../domain/http.js";
import type { GraphqlTransport } from "../transport/graphql.js";
import {
  buildFollowsParams,
  buildProfileTimelineParams,
  buildSearchParams,
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

  public async search(session: HttpSession, request: SearchRequest, cursor?: string): Promise<TweetPage> {
    const manifest = await this.manifests.getManifest();
    const response = await this.transport.get(
      session,
      endpointFor(manifest, OPERATION.search),
      buildSearchParams(request, manifest, cursor, this.config.apiPageSize),
      manifest.timeoutSeconds * 1_000,
    );
    if (response.status !== 200 || !response.data)
      throw new NetworkError(`Search request returned status ${response.status}.`, {
        statusCode: response.status,
      });
    return extractSearchTweets(response.data);
  }

  public async lookupUser(session: HttpSession, username: string): Promise<Record<string, unknown>> {
    const manifest = await this.manifests.getManifest();
    const response = await this.transport.get(
      session,
      endpointFor(manifest, OPERATION.userLookup),
      buildUserLookupParams(username, manifest),
      manifest.timeoutSeconds * 1_000,
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
  ): Promise<TweetPage> {
    const manifest = await this.manifests.getManifest();
    const response = await this.transport.get(
      session,
      endpointFor(manifest, OPERATION.profileTimeline),
      buildProfileTimelineParams(userId, request, manifest, cursor, this.config.apiPageSize),
      manifest.timeoutSeconds * 1_000,
    );
    if (response.status !== 200 || !response.data)
      throw new NetworkError(`Profile timeline returned status ${response.status}.`, {
        statusCode: response.status,
      });
    return extractProfileTweets(response.data);
  }

  public async followsPage(
    session: HttpSession,
    userId: string,
    type: FollowType,
    cursor?: string,
  ): Promise<FollowPage> {
    const manifest = await this.manifests.getManifest();
    const operation =
      type === "followers"
        ? OPERATION.followers
        : type === "verified_followers"
          ? OPERATION.verifiedFollowers
          : OPERATION.following;
    const response = await this.transport.get(
      session,
      endpointFor(manifest, operation),
      buildFollowsParams(userId, operation, manifest, cursor, this.config.apiPageSize),
      manifest.timeoutSeconds * 1_000,
    );
    if (response.status !== 200 || !response.data)
      throw new NetworkError(`Relationship request returned status ${response.status}.`, {
        statusCode: response.status,
      });
    return extractFollows(response.data);
  }

  public async resolveTarget(
    session: HttpSession,
    target: TargetInput,
  ): Promise<{ readonly username: string; readonly userId: string; readonly raw: Record<string, unknown> }> {
    const username =
      target.username?.replace(/^@/u, "") ?? target.profileUrl?.split("/").filter(Boolean).pop();
    if (!username) throw new NetworkError("Target has no resolvable username.", { statusCode: 400 });
    const raw = target.userId ? {} : await this.lookupUser(session, username);
    const userId = target.userId ?? String(raw.rest_id ?? raw.id ?? "");
    if (!userId) throw new NetworkError(`Target ${username} has no user id.`, { statusCode: 404 });
    return { username, userId, raw };
  }
}
