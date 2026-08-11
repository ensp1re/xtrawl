import { createHash } from "node:crypto";
import { stableJson } from "../utils/fingerprint.js";

export function queryHash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}
