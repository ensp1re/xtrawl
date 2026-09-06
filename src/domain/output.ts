import type { SAVE_FORMAT } from "../constants/output.js";

export type OutputFormat = (typeof SAVE_FORMAT)[keyof typeof SAVE_FORMAT];
