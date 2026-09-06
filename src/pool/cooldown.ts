import type { ErrorCategory } from "../domain/errors.js";

export interface CooldownDecision {
  readonly status: "healthy" | "cooling_down" | "unusable";
  readonly availableUntil: number;
  readonly lastErrorCode?: number;
  readonly reason?: string;
}

export function parseRateLimitReset(headers: Readonly<Record<string, string>>): number | undefined {
  const raw = headers["x-rate-limit-reset"] ?? headers["X-Rate-Limit-Reset"];
  const value = raw ? Number(raw) : NaN;
  if (!Number.isFinite(value)) return undefined;
  return value < 10_000_000_000 ? value * 1_000 : value;
}

export function parseRateLimitRemaining(headers: Readonly<Record<string, string>>): number | undefined {
  const raw = headers["x-rate-limit-remaining"] ?? headers["X-Rate-Limit-Remaining"];
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

export function isQuotaExhausted(headers: Readonly<Record<string, string>>): boolean {
  const remaining = parseRateLimitRemaining(headers);
  return remaining !== undefined && remaining <= 0;
}

export function computeCooldown(
  category: ErrorCategory | undefined,
  status: number,
  now: number,
  options: {
    readonly defaultMs: number;
    readonly transientMs: number;
    readonly authMs: number;
    readonly resetAt?: number;
    readonly jitterMs?: number;
  },
): CooldownDecision {
  if (status === 200) return { status: "healthy", availableUntil: 0 };
  if (category === "auth" || status === 401 || status === 403)
    return {
      status: "unusable",
      availableUntil: now + options.authMs,
      lastErrorCode: status,
      reason: "authentication_failed",
    };
  const reset = options.resetAt ?? now + (category === "transient" ? options.transientMs : options.defaultMs);
  const jitter = Math.round(Math.random() * Math.max(0, options.jitterMs ?? 0));
  return {
    status: "cooling_down",
    availableUntil: reset + jitter,
    lastErrorCode: status,
    reason: category ?? "remote_error",
  };
}
