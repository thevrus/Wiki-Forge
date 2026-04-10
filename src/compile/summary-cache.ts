import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/** Maps batch content hash → LLM summary text. */
export type SummaryCache = Record<string, string>

const CACHE_FILE = ".doc-summaries.json"

export function loadSummaryCache(docsDir: string): SummaryCache {
  try {
    return JSON.parse(readFileSync(join(docsDir, CACHE_FILE), "utf-8"))
  } catch {
    return {}
  }
}

export function saveSummaryCache(docsDir: string, cache: SummaryCache): void {
  writeFileSync(
    join(docsDir, CACHE_FILE),
    `${JSON.stringify(cache, null, 2)}\n`,
  )
}
