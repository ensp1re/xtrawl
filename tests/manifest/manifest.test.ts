import { validateConfig } from "../../src/config/validation.js";
import { DEFAULT_MANIFEST } from "../../src/manifest/default-manifest.js";
import { createManifest } from "../../src/manifest/model.js";
import {
  extractManifestFromJavascript,
  extractOperationQueryIdsFromJavascript,
  scrapeManifestFromWeb,
} from "../../src/manifest/scraper.js";
import { ManifestProvider } from "../../src/manifest/provider.js";
import { openStorage } from "../../src/storage/index.js";

describe("manifest management", () => {
  test("creates an immutable operation-aware manifest", () => {
    const manifest = createManifest(DEFAULT_MANIFEST);
    expect(manifest.queryIds.search_timeline).toBeTruthy();
    expect(manifest.featuresFor("unknown")).toEqual(manifest.features);
    expect(manifest.fieldTogglesFor("unknown")).toEqual({});
  });

  test("extracts current query identifiers from a bundle", () => {
    const manifest = extractManifestFromJavascript(
      'queryId:"new-search",operationName:"SearchTimeline"',
      DEFAULT_MANIFEST,
    );
    expect(manifest.queryIds.search_timeline).toBe("new-search");
    expect(
      extractOperationQueryIdsFromJavascript('operationName:"TweetResultByRestId",queryId:"new-tweet"')
        .tweet_result,
    ).toBe("new-tweet");
  });

  test("scrapes an authenticated main bundle and requires real operation matches", async () => {
    const calls: Array<{ readonly url: string; readonly init?: RequestInit }> = [];
    const bundle = [
      ["SearchTimeline", "search"],
      ["UserByScreenName", "user"],
      ["UserTweets", "profile"],
      ["Followers", "followers"],
      ["Following", "following"],
      ["BlueVerifiedFollowers", "verified"],
      ["TweetResultByRestId", "tweet"],
    ]
      .map(([operation, id]) => `queryId:"${id}",operationName:"${operation}"`)
      .join(";");
    const fetcher = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      calls.push({ url, ...(init ? { init } : {}) });
      if (url === "https://x.com/home")
        return new Response(
          '<script src="https://abs.twimg.com/other.js"></script><script src="https://abs.twimg.com/responsive-web/client-web/main.current.js"></script>',
        );
      return new Response(url.includes("main.current.js") ? bundle : "no operations");
    };
    const result = await scrapeManifestFromWeb(DEFAULT_MANIFEST, {
      authToken: "auth",
      fetcher: fetcher as typeof fetch,
    });
    expect(result.queryIds).toMatchObject({ search_timeline: "search", tweet_result: "tweet" });
    expect(calls[1]?.url).toContain("main.current.js");
    expect((calls[0]?.init?.headers as Record<string, string>).Cookie).toBe("auth_token=auth");
    expect((calls[1]?.init?.headers as Record<string, string>).Cookie).toBeUndefined();

    await expect(
      scrapeManifestFromWeb(DEFAULT_MANIFEST, {
        fetcher: (async (input: string | URL | Request) =>
          new Response(
            String(input).includes("x.com/home") ? '<script src="/empty.js">' : "empty",
          )) as typeof fetch,
      }),
    ).rejects.toThrow("did not contain");
  });

  test("loads remote manifests and caches them", async () => {
    const storage = openStorage(":memory:");
    const config = validateConfig({ manifestUrl: "https://manifest.test/current" });
    const provider = new ManifestProvider(config, storage.manifests, async () => ({
      ...DEFAULT_MANIFEST,
      version: "remote",
    }));
    expect((await provider.getManifest()).version).toBe("remote");
    const cachedProvider = new ManifestProvider(config, storage.manifests, async () => {
      throw new Error("offline");
    });
    expect((await cachedProvider.getManifest()).version).toBe("remote");
    storage.database.close();
  });

  test("falls back to local manifest after remote failure", async () => {
    const storage = openStorage(":memory:");
    const config = validateConfig({ manifestUrl: "https://manifest.test/current" });
    const provider = new ManifestProvider(config, storage.manifests, async () => {
      throw new Error("offline");
    });
    expect((await provider.getManifest()).queryIds.search_timeline).toBe(
      DEFAULT_MANIFEST.queryIds.search_timeline,
    );
    storage.database.close();
  });
});
