const chains = new Map<string, Promise<unknown>>();

export async function withDestinationLock<T>(path: string, work: () => Promise<T>): Promise<T> {
  const previous = chains.get(path) ?? Promise.resolve();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = previous.then(
    () => held,
    () => held,
  );
  chains.set(path, chained);
  await previous.catch(() => undefined);
  try {
    return await work();
  } finally {
    release();
  }
}
