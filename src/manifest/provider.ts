import type { ClientConfig } from "../config/types.js";
import type { Manifest, ManifestPayload } from "../domain/manifest.js";
import { ManifestError } from "../domain/errors.js";
import type { ManifestRepository } from "../storage/manifest-repository.js";
import { DEFAULT_MANIFEST } from "./default-manifest.js";
import { createManifest } from "./model.js";
import { scrapeManifestFromWeb } from "./scraper.js";
import type { ManifestScrapeOptions } from "./scraper.js";

export class ManifestProvider {
  private liveManifest?: Manifest;
  private remoteRefreshAttempted = false;

  public constructor(
    private readonly config: ClientConfig,
    private readonly repository: ManifestRepository,
    private readonly remoteFetch: (url: string) => Promise<unknown> = defaultFetchJson,
    private readonly liveAuthToken?: string,
    private readonly liveScrape: (
      base: ManifestPayload,
      options?: ManifestScrapeOptions,
    ) => Promise<ManifestPayload> = scrapeManifestFromWeb,
  ) {}

  public async getManifest(): Promise<Manifest> {
    const local = createManifest(DEFAULT_MANIFEST);
    if (this.config.manifestScrapeOnInit) {
      if (this.liveManifest) return this.liveManifest;
      return this.live(local, false);
    }
    if (this.config.manifestUrl) {
      if (this.config.manifestUpdateOnInit && !this.remoteRefreshAttempted) {
        this.remoteRefreshAttempted = true;
        try {
          return await this.fetchRemote(this.config.manifestUrl);
        } catch {
          const stale = this.repository.get(this.config.manifestUrl, true);
          if (stale) return createManifest(stale);
        }
      }
      const cached = this.repository.get(this.config.manifestUrl);
      if (cached) return createManifest(cached);
      try {
        return await this.fetchRemote(this.config.manifestUrl);
      } catch {
        const stale = this.repository.get(this.config.manifestUrl, true);
        if (stale) return createManifest(stale);
      }
    }
    return local;
  }

  public async refreshLive(authToken?: string): Promise<Manifest> {
    return this.live(createManifest(DEFAULT_MANIFEST), true, authToken);
  }

  private async fetchRemote(url: string): Promise<Manifest> {
    const remote = await this.remoteFetch(url);
    const payload = normalizePayload(remote);
    this.repository.set(url, payload, this.config.manifestTtlMs);
    return createManifest(payload);
  }

  private async live(local: Manifest, strict: boolean, authToken?: string): Promise<Manifest> {
    try {
      const token = authToken ?? this.liveAuthToken;
      const payload = await this.liveScrape(DEFAULT_MANIFEST, {
        ...(token ? { authToken: token } : {}),
      });
      if (this.config.manifestUrl)
        this.repository.set(this.config.manifestUrl, payload, this.config.manifestTtlMs);
      this.liveManifest = createManifest(payload);
      return this.liveManifest;
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
