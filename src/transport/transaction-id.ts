import type { ClientTransaction } from "x-client-transaction-id";
import { delay } from "../utils/abort.js";

export interface TransactionIdSource {
  readonly create?: (method: string, url: string) => Promise<string | undefined>;
}

export interface TransactionIdOptions {
  readonly enabled?: boolean;
  readonly ttlMs?: number;
}

export class TransactionIdProvider {
  private client?: ClientTransaction;
  private readyAt = 0;
  private retryAt = 0;
  private initializing?: Promise<ClientTransaction | undefined>;

  public constructor(
    private readonly source?: TransactionIdSource,
    private readonly options: TransactionIdOptions = {},
  ) {}

  public async get(method: string, url: string): Promise<string | undefined> {
    if (this.source?.create) return this.source.create(method, url);
    if (this.options.enabled !== true) return undefined;
    const client = await this.currentClient();
    if (!client) return undefined;
    try {
      return await client.generateTransactionId(method, new URL(url).pathname);
    } catch {
      this.client = undefined;
      this.readyAt = 0;
      this.retryAt = Date.now() + 5 * 60_000;
      return undefined;
    }
  }

  private async currentClient(): Promise<ClientTransaction | undefined> {
    const ttl = Math.max(60_000, this.options.ttlMs ?? 6 * 60 * 60 * 1_000);
    if (this.client && Date.now() - this.readyAt < ttl) return this.client;
    if (this.retryAt > Date.now()) return undefined;
    if (!this.initializing) this.initializing = this.initialize();
    try {
      return await this.initializing;
    } finally {
      this.initializing = undefined;
    }
  }

  private async initialize(): Promise<ClientTransaction | undefined> {
    try {
      const { ClientTransaction, fetchXDocument } = await import("x-client-transaction-id");
      // fetchXDocument cannot be cancelled. One bootstrap stays in-flight; a timeout
      // abandons the wait and keeps the result if it later succeeds.
      const work = fetchXDocument().then((document) => ClientTransaction.create(document));
      const result = await Promise.race([
        work.then((client) => ({ ok: true as const, client })),
        delay(10_000).then(() => ({ ok: false as const })),
      ]);
      if (!result.ok) {
        void work
          .then((client) => {
            this.client = client;
            this.readyAt = Date.now();
            this.retryAt = 0;
          })
          .catch(() => undefined);
        this.retryAt = Date.now() + 5 * 60_000;
        return undefined;
      }
      this.client = result.client;
      this.readyAt = Date.now();
      this.retryAt = 0;
      return this.client;
    } catch {
      this.retryAt = Date.now() + 5 * 60_000;
      return undefined;
    }
  }
}
