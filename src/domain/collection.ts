import type { PROGRESS_STATE } from "../constants/collection.js";

export type ProgressState = (typeof PROGRESS_STATE)[keyof typeof PROGRESS_STATE];

export interface TaskProgress {
  readonly collectionId: string;
  readonly taskId: string;
  readonly state: ProgressState;
  readonly cursor?: string;
  readonly inputCursor?: string;
  readonly acceptedIds: readonly string[];
}

export interface AcceptedRecord {
  readonly id: string;
  readonly taskId: string;
  readonly payload: unknown;
}

export interface PageCommit {
  readonly collectionId: string;
  readonly taskId: string;
  readonly state: ProgressState;
  readonly inputCursor?: string;
  readonly nextCursor?: string;
  readonly records: readonly { readonly id: string; readonly payload: unknown }[];
}
