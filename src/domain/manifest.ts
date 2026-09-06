export type FeatureFlags = Readonly<Record<string, boolean>>;
export type FieldToggles = Readonly<Record<string, boolean>>;

export interface ManifestPayload {
  readonly version: string;
  readonly queryIds: Readonly<Record<string, string>>;
  readonly endpoints: Readonly<Record<string, string>>;
  readonly features?: FeatureFlags;
  readonly operationFeatures?: Readonly<Record<string, FeatureFlags>>;
  readonly operationFieldToggles?: Readonly<Record<string, FieldToggles>>;
  readonly timeoutSeconds?: number;
}

export interface ManifestCreateOptions {
  readonly allowedOrigins?: readonly string[];
}

export interface ManifestScrapeOptions {
  readonly authToken?: string;
  readonly fetcher?: typeof fetch;
  readonly maxScripts?: number;
}

export interface Manifest {
  readonly version: string;
  readonly queryIds: Readonly<Record<string, string>>;
  readonly endpoints: Readonly<Record<string, string>>;
  readonly features: FeatureFlags;
  readonly operationFeatures: Readonly<Record<string, FeatureFlags>>;
  readonly operationFieldToggles: Readonly<Record<string, FieldToggles>>;
  readonly timeoutSeconds: number;
  featuresFor(operation: string): FeatureFlags;
  fieldTogglesFor(operation: string): FieldToggles;
}
