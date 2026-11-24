export interface PacedMapOptions {
  concurrency: number;
  /** Minimum delay between the starts of two calls, across all workers. */
  minIntervalMs: number;
  /** When this returns true, unstarted items resolve through `onSkip`. */
  shouldStop?: () => boolean;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Maps items in order of input while limiting concurrency and request rate. */
export async function pacedMap<T, R>(
  items: readonly T[],
  options: PacedMapOptions,
  run: (item: T) => Promise<R>,
  onSkip: (item: T) => R,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let nextStart = 0;

  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      const startAt = Math.max(Date.now(), nextStart);
      nextStart = startAt + options.minIntervalMs;
      await delay(startAt - Date.now());
      results[index] = options.shouldStop?.() ? onSkip(items[index]) : await run(items[index]);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(options.concurrency, items.length) }, () => worker()),
  );
  return results;
}
