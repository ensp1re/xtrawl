import type { ConfigInput, ClientConfig } from "../config/types.js";
import type { AccountInput } from "../domain/accounts.js";
import type { TransactionIdSource } from "../transport/transaction-id.js";
import type { SessionFactory } from "../domain/http.js";
import type { AccountStateStore } from "../domain/account-state.js";

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
}

export interface ClientInspection {
  readonly config: ClientConfig;
  readonly accounts: readonly Record<string, unknown>[];
}
