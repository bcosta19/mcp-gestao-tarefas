export const DEFAULT_BATCH_CONCURRENCY = 4;

/**
 * Promise.allSettled with a bounded number of active workers. Results retain
 * input order while preventing a large user-provided batch from opening an
 * unbounded number of HTTP requests at once.
 */
export async function allSettledWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  const workerCount = Math.min(Math.max(1, Math.floor(limit)), items.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;

      try {
        results[index] = {
          status: 'fulfilled',
          value: await mapper(items[index], index),
        };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
