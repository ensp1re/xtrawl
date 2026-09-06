import { validateConfig } from "../../src/config/validation.js";
import { DEFAULT_MANIFEST } from "../../src/manifest/default-manifest.js";
import { createManifest } from "../../src/manifest/model.js";
import {
  extractManifestFromJavascript,
  extractOperationFeaturesFromJavascript,
  extractOperationQueryIdsFromJavascript,
  scrapeManifestFromWeb,
} from "../../src/manifest/scraper.js";
import { ManifestError } from "../../src/domain/errors.js";
import { LIVE_MANIFEST_CACHE_KEY, ManifestProvider } from "../../src/manifest/provider.js";
import { openStorage } from "../../src/storage/index.js";

describe("manifest management", () => {
  test("rejects a remote manifest that targets an unapproved origin", async () => {
    const storage = openStorage(":memory:");
    const provider = new ManifestProvider(
      validateConfig({ manifestUrl: "https://manifest.test/current" }),
      storage.manifests,
      async () => ({
        ...DEFAULT_MANIFEST,
        endpoints: {
          ...DEFAULT_MANIFEST.endpoints,
          search_timeline: "https://evil.test/i/api/graphql/{query_id}/SearchTimeline",
        },
      }),
    );
    await expect(provider.getManifest()).rejects.toThrow(ManifestError);
    expect(storage.manifests.get("https://manifest.test/current")).toBeUndefined();
    storage.database.close();
  });

  test("accepts synthetic origins when they are explicitly allowed", () => {
    const manifest = createManifest(
      {
        ...DEFAULT_MANIFEST,
        endpoints: {
          ...DEFAULT_MANIFEST.endpoints,
          search_timeline: "https://graphql.test/i/api/graphql/{query_id}/SearchTimeline",
        },
      },
      { allowedOrigins: ["graphql.test"] },
    );
    expect(manifest.endpoints.search_timeline).toContain("graphql.test");
  });

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

  test("extracts operation feature switches from current bundles", () => {
    const source =
      'operationName:"SearchTimeline",queryId:"id",metadata:{featureSwitches:["feature_one","feature_two"]}';
    expect(extractOperationFeaturesFromJavascript(source)).toEqual({
      search_timeline: { feature_one: false, feature_two: false },
    });
    expect(
      extractManifestFromJavascript(source, DEFAULT_MANIFEST).operationFeatures?.search_timeline,
    ).toMatchObject({ feature_one: false, feature_two: false });
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

  test("forces the configured remote manifest refresh on first use", async () => {
    const storage = openStorage(":memory:");
    const url = "https://manifest.test/current";
    storage.manifests.set(url, { ...DEFAULT_MANIFEST, version: "cached" }, 60_000);
    let calls = 0;
    const provider = new ManifestProvider(
      validateConfig({ manifestUrl: url, manifestUpdateOnInit: true }),
      storage.manifests,
      async () => {
        calls += 1;
        return { ...DEFAULT_MANIFEST, version: "fresh" };
      },
    );
    expect((await provider.getManifest()).version).toBe("fresh");
    expect((await provider.getManifest()).version).toBe("fresh");
    expect(calls).toBe(1);
    storage.database.close();
  });

  test("retains a live refresh in default mode for later pages", async () => {
    const storage = openStorage(":memory:");
    let scrapes = 0;
    const provider = new ManifestProvider(
      validateConfig(),
      storage.manifests,
      undefined,
      undefined,
      async () => {
        scrapes += 1;
        return { ...DEFAULT_MANIFEST, version: "audit-refreshed" };
      },
    );
    expect((await provider.getManifest()).version).toBe(DEFAULT_MANIFEST.version);
    expect((await provider.refreshLive()).version).toBe("audit-refreshed");
    expect((await provider.getManifest()).version).toBe("audit-refreshed");
    expect(scrapes).toBe(1);
    storage.database.close();
  });

  test("coalesces concurrent live refreshes into one scrape", async () => {
    const storage = openStorage(":memory:");
    let scrapes = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const startedGate = new Promise<void>((resolve) => {
      started = resolve;
    });
    const provider = new ManifestProvider(
      validateConfig(),
      storage.manifests,
      undefined,
      undefined,
      async () => {
        scrapes += 1;
        started();
        await gate;
        return { ...DEFAULT_MANIFEST, version: "shared" };
      },
    );
    const pending = Promise.all(Array.from({ length: 10 }, () => provider.refreshLive()));
    await startedGate;
    release();
    const versions = (await pending).map((manifest) => manifest.version);
    expect(new Set(versions)).toEqual(new Set(["shared"]));
    expect(scrapes).toBe(1);
    storage.database.close();
  });

  test("keeps a validated fallback after a failed live refresh", async () => {
    const storage = openStorage(":memory:");
    let scrapes = 0;
    const provider = new ManifestProvider(
      validateConfig(),
      storage.manifests,
      undefined,
      undefined,
      async () => {
        scrapes += 1;
        if (scrapes === 1) return { ...DEFAULT_MANIFEST, version: "live-1" };
        throw new Error("scrape failed");
      },
    );
    expect((await provider.refreshLive()).version).toBe("live-1");
    await expect(provider.refreshLive()).rejects.toThrow("Live manifest refresh failed");
    expect((await provider.getManifest()).version).toBe("live-1");
    storage.database.close();
  });

  test("persists a live refresh under a dedicated cache key", async () => {
    const storage = openStorage(":memory:");
    const first = new ManifestProvider(
      validateConfig(),
      storage.manifests,
      undefined,
      undefined,
      async () => ({ ...DEFAULT_MANIFEST, version: "persisted-live" }),
    );
    await first.refreshLive();
    expect(storage.manifests.get(LIVE_MANIFEST_CACHE_KEY)?.version).toBe("persisted-live");
    const second = new ManifestProvider(
      validateConfig(),
      storage.manifests,
      async () => {
        throw new Error("remote should not run");
      },
      undefined,
      async () => {
        throw new Error("scrape should not run");
      },
    );
    expect((await second.getManifest()).version).toBe("persisted-live");
    storage.database.close();
  });

  test("fetches a repeated script URL only once", async () => {
    const calls: string[] = [];
    const bundle = 'queryId:"search",operationName:"SearchTimeline"';
    const fetcher = async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      calls.push(url);
      if (url === "https://x.com/home")
        return new Response(
          '<script src="https://abs.twimg.com/responsive-web/client-web/main.current.js"></script><script src="https://abs.twimg.com/responsive-web/client-web/main.current.js"></script>',
        );
      return new Response(bundle);
    };
    await scrapeManifestFromWeb(DEFAULT_MANIFEST, { fetcher: fetcher as typeof fetch });
    expect(calls.filter((url) => url.includes("main.current.js"))).toHaveLength(1);
  });
});
