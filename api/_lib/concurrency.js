/**
 * concurrency.js
 * One primitive: run N async jobs at a time.
 *
 * Creating a Supabase Auth account is a round trip, and a 2,700-student
 * roster is 2,700 of them. Done one after another that is minutes of an
 * import sitting idle waiting on the network. Done all at once it is a
 * thundering herd that Auth rate-limits. A small fixed pool is the whole
 * answer, and it is short enough that reaching for a dependency would
 * cost more than it saves.
 */

/**
 * Applies `worker` to every item, `limit` at a time, in order of start.
 * Results come back in the original order. A worker that throws rejects
 * the whole call, so workers that need to survive a failure should catch
 * it themselves — both callers here record the failure per row and carry
 * on, which is what an import should do.
 */
export async function runPool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;

  const runner = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  return results;
}
