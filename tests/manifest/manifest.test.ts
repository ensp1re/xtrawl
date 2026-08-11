import { validateConfig } from "../../src/config/validation.js";
import { DEFAULT_MANIFEST } from "../../src/manifest/default-manifest.js";
import { createManifest } from "../../src/manifest/model.js";
import { extractManifestFromJavascript } from "../../src/manifest/scraper.js";
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
