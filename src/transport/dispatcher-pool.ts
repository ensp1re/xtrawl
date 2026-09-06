import type { Dispatcher } from "undici";
import type { ProxySettings } from "../domain/accounts.js";
import { proxyDispatcher, proxyToUrl } from "./proxy.js";

interface PoolEntry {
  readonly dispatcher: Dispatcher;
  refs: number;
  idleAt?: number;
}

export class DispatcherPool {
  private readonly entries = new Map<string, PoolEntry>();

  public acquire(proxy: string | ProxySettings | undefined): {
    readonly dispatcher?: Dispatcher;
    release(): void;
  } {
    const url = proxyToUrl(proxy);
    if (!url) return { release() {} };
    let entry = this.entries.get(url);
    if (!entry) {
      const dispatcher = proxyDispatcher(url);
      if (!dispatcher) return { release() {} };
      entry = { dispatcher, refs: 0 };
      this.entries.set(url, entry);
    }
    entry.refs += 1;
    entry.idleAt = undefined;
    return {
      dispatcher: entry.dispatcher,
      release: () => {
        const current = this.entries.get(url);
        if (!current) return;
        current.refs -= 1;
        if (current.refs <= 0) current.idleAt = Date.now();
      },
    };
  }

  public size(): number {
    return this.entries.size;
  }

  public async sweep(maxIdleMs = 60_000, now = Date.now()): Promise<void> {
    for (const [key, entry] of this.entries) {
      if (entry.refs > 0 || entry.idleAt === undefined || now - entry.idleAt < maxIdleMs) continue;
      await entry.dispatcher.close();
      this.entries.delete(key);
    }
  }

  public async close(): Promise<void> {
    for (const entry of this.entries.values()) await entry.dispatcher.close();
    this.entries.clear();
  }
}
