import type { ClientConfig } from "../config/types.js";
import type { Manifest, ManifestPayload, ManifestScrapeOptions } from "../domain/manifest.js";
import { ManifestError } from "../domain/errors.js";
import type { ManifestRepository } from "../storage/manifest-repository.js";
import { DEFAULT_MANIFEST } from "./default-manifest.js";
import { createManifest } from "./model.js";
import { scrapeManifestFromWeb } from "./scraper.js";

export const LIVE_MANIFEST_CACHE_KEY = "xtrawl:live-web";
const REFRESH_BACKOFF_MS = 30_000;

export class ManifestProvider {
  private readonly local: Manifest;
  private active?: Manifest;
  private inFlightRefresh?: Promise<Manifest>;
  private refreshFailedUntil = 0;
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
  ) {
    this.local = this.manifestFrom(DEFAULT_MANIFEST);
  }

  public async getManifest(): Promise<Manifest> {
    if (this.active) return this.active;
    if (this.config.manifestScrapeOnInit) return this.live(false);
    if (this.config.manifestUrl) {
      const remote = await this.loadRemote(this.config.manifestUrl);
      if (remote) {
        this.active = remote;
        return remote;
      }
    }
    const cachedLive = this.readCached(LIVE_MANIFEST_CACHE_KEY);
    if (cachedLive) {
      this.active = cachedLive;
      return cachedLive;
    }
    this.active = this.local;
    return this.local;
  }

  public async refreshLive(authToken?: string): Promise<Manifest> {
    return this.live(true, authToken);
  }

  private async loadRemote(url: string): Promise<Manifest | undefined> {
    if (this.config.manifestUpdateOnInit && !this.remoteRefreshAttempted) {
      this.remoteRefreshAttempted = true;
      try {
        return await this.fetchRemote(url);
      } catch (error) {
        if (error instanceof ManifestError) throw error;
        const stale = this.readCached(url, true);
        if (stale) return stale;
      }
    }
    const cached = this.readCached(url);
    if (cached) return cached;
    try {
      return await this.fetchRemote(url);
    } catch (error) {
      if (error instanceof ManifestError) throw error;
      return this.readCached(url, true);
    }
  }

  private async fetchRemote(url: string): Promise<Manifest> {
    const remote = await this.remoteFetch(url);
    const payload = normalizePayload(remote);
    const manifest = this.manifestFrom(payload);
    this.repository.set(url, payload, this.config.manifestTtlMs);
    return manifest;
  }

  private async live(strict: boolean, authToken?: string): Promise<Manifest> {
    if (this.inFlightRefresh) return this.inFlightRefresh;
    if (Date.now() < this.refreshFailedUntil) {
      if (strict) throw new ManifestError("Live manifest refresh is in backoff.");
      return this.active ?? this.local;
    }
    const pending = this.runLive(strict, authToken).finally(() => {
      if (this.inFlightRefresh === pending) this.inFlightRefresh = undefined;
    });
    this.inFlightRefresh = pending;
    return pending;
  }

  private async runLive(strict: boolean, authToken?: string): Promise<Manifest> {
    try {
      const token = authToken ?? this.liveAuthToken;
      const payload = await this.liveScrape(DEFAULT_MANIFEST, {
        ...(token ? { authToken: token } : {}),
      });
      this.active = this.manifestFrom(payload);
      this.repository.set(
        this.config.manifestUrl ?? LIVE_MANIFEST_CACHE_KEY,
        payload,
        this.config.manifestTtlMs,
      );
      if (this.config.manifestUrl)
        this.repository.set(LIVE_MANIFEST_CACHE_KEY, payload, this.config.manifestTtlMs);
      this.refreshFailedUntil = 0;
      return this.active;
    } catch (error) {
      this.refreshFailedUntil = Date.now() + REFRESH_BACKOFF_MS;
      if (strict) throw new ManifestError(`Live manifest refresh failed: ${String(error)}`);
      return this.active ?? this.local;
    }
  }

  private readCached(key: string, allowExpired = false): Manifest | undefined {
    const payload = this.repository.get(key, allowExpired);
    if (!payload) return undefined;
    try {
      return this.manifestFrom(payload);
    } catch {
      return undefined;
    }
  }

  private manifestFrom(payload: ManifestPayload): Manifest {
    return createManifest(payload, { allowedOrigins: this.config.allowedManifestOrigins });
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
