export interface TransactionIdSource {
  readonly create?: (method: string, url: string) => Promise<string | undefined>;
}

export class TransactionIdProvider {
  public constructor(private readonly source?: TransactionIdSource) {}

  public async get(method: string, url: string): Promise<string | undefined> {
    return this.source?.create ? this.source.create(method, url) : undefined;
  }
}
