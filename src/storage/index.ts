import { initializeSchema } from "./schema.js";
import { StateDatabase } from "./database.js";
import { AccountRepository } from "./account-repository.js";
import { CheckpointRepository } from "./checkpoint-repository.js";
import { ManifestRepository } from "./manifest-repository.js";
import { ProgressRepository } from "./progress-repository.js";
import { RunRepository } from "./run-repository.js";
import type { AccountRepositoryOptions } from "./types.js";

export interface StorageBundle {
  readonly database: StateDatabase;
  readonly accounts: AccountRepository;
  readonly checkpoints: CheckpointRepository;
  readonly manifests: ManifestRepository;
  readonly runs: RunRepository;
  readonly progress: ProgressRepository;
}

export function openStorage(path: string, options: AccountRepositoryOptions = {}): StorageBundle {
  const database = new StateDatabase(path);
  initializeSchema(database);
  return {
    database,
    accounts: new AccountRepository(database, options),
    checkpoints: new CheckpointRepository(database),
    manifests: new ManifestRepository(database),
    runs: new RunRepository(database),
    progress: new ProgressRepository(database),
  };
}
