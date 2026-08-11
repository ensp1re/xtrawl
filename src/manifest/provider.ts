import type { ClientConfig } from "../config/types.js";
import type { Manifest, ManifestPayload } from "../domain/manifest.js";
import { ManifestError } from "../domain/errors.js";
import type { ManifestRepository } from "../storage/manifest-repository.js";
import { DEFAULT_MANIFEST } from "./default-manifest.js";
import { createManifest } from "./model.js";
import { scrapeManifestFromWeb } from "./scraper.js";

export class ManifestProvider {
  public constructor(
    private readonly config: ClientConfig,
    private readonly repository: ManifestRepository,
    private readonly remoteFetch: (url: string) => Promise<unknown> = defaultFetchJson,
  ) {}

  public async getManifest(): Promise<Manifest> {
    const local = createManifest(DEFAULT_MANIFEST);
    if (this.config.manifestScrapeOnInit) return this.live(local, false);
    if (this.config.manifestUrl) {
      const cached = this.repository.get(this.config.manifestUrl);
      if (cached) return createManifest(cached);
      try {
        const remote = await this.remoteFetch(this.config.manifestUrl);
        const payload = normalizePayload(remote);
        this.repository.set(this.config.manifestUrl, payload, this.config.manifestTtlMs);
        return createManifest(payload);
      } catch {
        const stale = this.repository.get(this.config.manifestUrl, true);
        if (stale) return createManifest(stale);
      }
    }
    return local;
  }

  public async refreshLive(): Promise<Manifest> {
    return this.live(createManifest(DEFAULT_MANIFEST), true);
  }

  private async live(local: Manifest, strict: boolean): Promise<Manifest> {
    try {
      const payload = await scrapeManifestFromWeb(DEFAULT_MANIFEST);
      if (this.config.manifestUrl)
        this.repository.set(this.config.manifestUrl, payload, this.config.manifestTtlMs);
      return createManifest(payload);
    } catch (error) {
      if (strict) throw new ManifestError(`Live manifest refresh failed: ${String(error)}`);
      return local;
    }
  }
}

async function defaultFetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Manifest fetch failed with status ${response.status}`);
  return response.json() as Promise<unknown>;
}

function normalizePayload(value: unknown): ManifestPayload {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ManifestError("Remote manifest is not an object.");
  const candidate = value as Partial<ManifestPayload>;
  if (!candidate.queryIds || !candidate.endpoints)
    throw new ManifestError("Remote manifest is missing queryIds or endpoints.");
  return candidate as ManifestPayload;
}
