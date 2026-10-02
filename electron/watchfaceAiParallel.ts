/** Independent image work only. Editor commands must remain in model order. */
export const WATCHFACE_AI_IMAGE_CONCURRENCY = 3;

/**
 * Keeps outcomes in input order even when images complete out of order.
 * Cancellation stops new jobs, passes the same signal to active jobs, and waits
 * for their cleanup before returning. Jobs not started receive an abort result.
 * Rejections are isolated so a failed image does not discard successful assets.
 */
export async function runWatchfaceAiParallel<T, R>(
  items: readonly T[],
  run: (item: T, index: number, signal: AbortSignal) => Promise<R>,
  options: { signal: AbortSignal; concurrency?: number }
): Promise<PromiseSettledResult<R>[]> {
  const requested = options.concurrency ?? WATCHFACE_AI_IMAGE_CONCURRENCY;
  if (!Number.isInteger(requested) || requested < 1) {
    throw new RangeError("Image concurrency must be a positive integer.");
  }
  const concurrency = Math.min(requested, WATCHFACE_AI_IMAGE_CONCURRENCY, items.length);
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let next = 0;
  const worker = async () => {
    while (!options.signal.aborted && next < items.length) {
      const index = next++;
      try {
        results[index] = { status: "fulfilled", value: await run(items[index], index, options.signal) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  if (next < items.length) {
    const reason = options.signal.reason ?? Object.assign(new Error("Image generation cancelled."), { name: "AbortError" });
    for (; next < items.length; next++) results[next] = { status: "rejected", reason };
  }
  return results;
}
