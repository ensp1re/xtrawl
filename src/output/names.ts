import type { TargetInput } from "../domain/requests.js";

export function searchOutputName(
  query: string | undefined,
  since: string | undefined,
  until: string | undefined,
  fromUsers: readonly string[] | undefined,
): string {
  const source = query?.trim() || fromUsers?.slice(0, 3).join("_") || "search";
  const parts = [safePart(source), since?.slice(0, 10), until?.slice(0, 10)].filter(Boolean);
  return parts.join("_");
}

export function targetOutputName(operation: string, targets: readonly TargetInput[]): string {
  const names = targets
    .slice(0, 3)
    .map((target) => target.username ?? target.userId)
    .filter((value): value is string => Boolean(value));
  return safePart(names.length > 0 ? `${operation}_${names.join("_")}` : operation);
}

function safePart(value: string): string {
  const cleaned = value
    .split(/\s+/u)
    .slice(0, 3)
    .join("_")
    .replace(/[^A-Za-z0-9_.-]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  return cleaned || "output";
}
