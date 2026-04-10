/** Run promises with a concurrency limit. */
export async function asyncPool<T>(
  concurrency: number,
  items: T[],
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let i = 0
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (i < items.length) {
        const idx = i++
        await fn(items[idx]!, idx)
      }
    },
  )
  await Promise.all(workers)
}

/**
 * Bus factor: minimum authors needed to cover 50% of commits.
 * Expects entries sorted by commits descending.
 */
export function computeBusFactor(entries: Array<{ commits: number }>): number {
  if (entries.length === 0) return 0
  const total = entries.reduce((sum, c) => sum + c.commits, 0)
  if (total === 0) return 0

  let accumulated = 0
  let count = 0
  for (const c of entries) {
    accumulated += c.commits
    count++
    if (accumulated >= total * 0.5) break
  }
  return count
}

/**
 * Bus factor from percentage-based author entries.
 * Expects entries sorted by percentage descending.
 */
export function computeBusFactorFromPercentages(
  entries: Array<{ percentage: number }>,
): number {
  if (entries.length === 0) return 0
  let accum = 0
  let count = 0
  for (const e of entries) {
    accum += e.percentage
    count++
    if (accum >= 50) break
  }
  return count
}

/** Convert a doc path like "auth-flows.md" to a display title "Auth Flows". */
export function docPathToTitle(docPath: string): string {
  return docPath
    .replace(/\.md$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
}
