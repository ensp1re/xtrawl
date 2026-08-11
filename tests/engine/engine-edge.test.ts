import { ApiEngine } from "../../src/engine/api-engine.js";
import {
  extractFollows,
  extractProfileTweets,
  extractSearchTweets,
  mapFollow,
  mapProfile,
  normalizeUser,
} from "../../src/engine/extractors.js";
import { validateConfig } from "../../src/config/validation.js";
import { NetworkError } from "../../src/domain/errors.js";
import { GraphqlTransport } from "../../src/transport/graphql.js";
import { TransactionIdProvider } from "../../src/transport/transaction-id.js";
import { ManifestProvider } from "../../src/manifest/provider.js";
import { openStorage } from "../../src/storage/index.js";
import { response, sessionFactory } from "../helpers/fake-http.js";

function engineWith(handler: (url: string) => ReturnType<typeof response>) {
  const storage = openStorage(":memory:");
  const config = validateConfig({ minDelayMs: 0 });
  const provider = new ManifestProvider(config, storage.manifests);
  const session = sessionFactory((request) => handler(request.url))({ cookies: {} });
  const engine = new ApiEngine(config, provider, new GraphqlTransport(new TransactionIdProvider()));
  return { engine, session, close: () => storage.database.close() };
}

describe("defensive response extraction", () => {
  test("returns empty pages for malformed external data", () => {
    expect(extractSearchTweets(null)).toEqual({ tweets: [] });
    expect(extractProfileTweets({ data: {} })).toEqual({ tweets: [] });
    expect(extractFollows({ data: {} })).toEqual({ users: [] });
  });

  test("supports fallback user nodes and profile fields", () => {
    const user = {
      id: "u1",
      core: { screen_name: "core-name", name: "Core" },
      profile_bio: { description: "bio" },
      verification: { verified: true },
    };
    expect(normalizeUser(user, "fallback")).toMatchObject({
      userId: "u1",
      username: "core-name",
      description: "bio",
      verified: true,
    });
    expect(mapProfile(user, { raw: "@fallback", source: "input" })).toMatchObject({
      input: { raw: "@fallback" },
      username: "core-name",
    });
    expect(mapFollow(user, { username: "target", userId: "target-id" }, "verified_followers")).toMatchObject({
      type: "verified_followers",
      target: { userId: "target-id" },
    });
  });
});

describe("engine failure boundaries", () => {
  test("surfaces server failures as typed network errors", async () => {
    const fixture = engineWith(() => response("server", 503));
    await expect(fixture.engine.search(fixture.session, { searchQuery: "hello" })).rejects.toThrow(
      NetworkError,
    );
    fixture.close();
  });

  test("rejects targets without a username or id", async () => {
    const fixture = engineWith(() => response({ data: {} }));
    await expect(fixture.engine.resolveTarget(fixture.session, { raw: "bad" })).rejects.toThrow(NetworkError);
    fixture.close();
  });
});
