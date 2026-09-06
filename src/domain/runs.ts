import type { RUN_STATUS } from "../constants/runs.js";

export type RunStatus = (typeof RUN_STATUS)[keyof typeof RUN_STATUS];

export interface RunRecord {
  readonly id: string;
  readonly operation: string;
  readonly queryHash?: string;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly status: RunStatus;
  readonly error?: unknown;
}
