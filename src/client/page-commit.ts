import { PROGRESS_STATE } from "../constants/collection.js";
import type { ProgressState } from "../domain/collection.js";
import type { StorageBundle } from "../storage/index.js";

export function commitAcceptedPage(
  storage: StorageBundle,
  input: {
    readonly collectionId: string;
    readonly taskId: string;
    readonly state: ProgressState;
    readonly inputCursor?: string;
    readonly nextCursor?: string;
    readonly records: readonly { readonly id: string; readonly payload: unknown }[];
    readonly persistLegacyCheckpoint?: boolean;
  },
): void {
  storage.progress.commitPage({
    collectionId: input.collectionId,
    taskId: input.taskId,
    state: input.state,
    ...(input.inputCursor === undefined ? {} : { inputCursor: input.inputCursor }),
    ...(input.nextCursor === undefined ? {} : { nextCursor: input.nextCursor }),
    records: input.records,
  });
  if (!input.persistLegacyCheckpoint) return;
  const cursor = input.state === PROGRESS_STATE.CAPPED ? input.inputCursor : input.nextCursor;
  if (cursor) storage.checkpoints.save(input.taskId, { root: cursor });
  else if (input.state === PROGRESS_STATE.EXHAUSTED || input.state === PROGRESS_STATE.CAPPED)
    storage.checkpoints.clear(input.taskId);
}
