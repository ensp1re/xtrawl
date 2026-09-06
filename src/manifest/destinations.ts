import { ManifestError } from "../domain/errors.js";

export const DEFAULT_CREDENTIAL_HOSTS = [
  "x.com",
  "www.x.com",
  "api.x.com",
  "twitter.com",
  "www.twitter.com",
  "api.twitter.com",
] as const;

const GRAPHQL_PATH = /^\/(?:i\/api\/)?graphql\/[A-Za-z0-9_-]+\/[A-Za-z0-9_]+$/u;

export function allowedCredentialHosts(extraOrigins: readonly string[] = []): ReadonlySet<string> {
  const hosts = new Set<string>(DEFAULT_CREDENTIAL_HOSTS);
  for (const origin of extraOrigins) {
    const host = originHost(origin);
    if (host) hosts.add(host);
  }
  return hosts;
}

export function assertCredentialDestination(value: string, extraOrigins: readonly string[] = []): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ManifestError("Manifest endpoint is not a valid URL.");
  }
  if (parsed.protocol !== "https:")
    throw new ManifestError(`Refusing non-HTTPS credential destination: ${parsed.origin}`);
  if (!allowedCredentialHosts(extraOrigins).has(parsed.hostname))
    throw new ManifestError(`Refusing untrusted credential destination: ${parsed.origin}`);
  if (!GRAPHQL_PATH.test(parsed.pathname))
    throw new ManifestError(`Refusing untrusted credential path: ${parsed.pathname}`);
  return parsed.toString();
}

function originHost(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    return new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    return undefined;
  }
}
