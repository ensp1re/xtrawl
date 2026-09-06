import type { ConfigInput, ClientConfig } from "../config/types.js";
import type { AccountInput, ProxySettings } from "../domain/accounts.js";
import type { TransactionIdSource } from "../transport/types.js";
import type { SessionFactory } from "../domain/http.js";
import type { AccountStateStore } from "../domain/account-state.js";
import type { DiagnosticListener } from "../domain/diagnostics.js";
import type { ProfileTimelineRequest, SearchRequest } from "../domain/requests.js";
import type { AccountPool } from "../pool/account-pool.js";
import type { ApiEngine } from "../engine/api-engine.js";
import type { StorageBundle } from "../storage/index.js";

export interface ClientOptions extends ConfigInput {
  readonly cookiesFile?: string;
  readonly accountsFile?: string;
  readonly envFile?: string;
  readonly authToken?: string;
  readonly csrfToken?: string;
  readonly cookies?: unknown;
  readonly accounts?: readonly AccountInput[];
  readonly provision?: boolean;
  readonly sessionFactory?: SessionFactory;
  readonly transactionIdSource?: TransactionIdSource;
  readonly accountStore?: AccountStateStore;
  readonly onDiagnostic?: DiagnosticListener;
}

export interface ClientInspection {
  readonly config: ClientConfig;
  readonly accounts: readonly Record<string, unknown>[];
}

export interface CollectionContext {
  readonly config: ClientConfig;
  readonly pool: AccountPool;
  readonly engine: ApiEngine;
  readonly storage: StorageBundle;
  readonly signal?: AbortSignal;
}

export type SearchContext = CollectionContext;

export interface SearchTask {
  readonly id: string;
  readonly request: SearchRequest;
}

export interface PageExecutionOptions {
  readonly cursor?: string;
  readonly maxAccountSwitches?: number;
  readonly onRetry?: () => void;
}

export interface AccountListOptions {
  readonly eligibleOnly?: boolean;
  readonly unusableOnly?: boolean;
  readonly includeCookies?: boolean;
  readonly revealSecrets?: boolean;
}

export interface AccountImportOptions {
  readonly accountsFile?: string;
  readonly cookiesFile?: string;
  readonly envFile?: string;
  readonly cookies?: unknown;
  readonly accounts?: readonly AccountInput[];
  readonly proxy?: string | ProxySettings;
}

export type SaveOptions = Pick<ProfileTimelineRequest, "save" | "saveDir" | "saveFormat" | "saveName">;
