import { statSync } from "node:fs"
import { join } from "node:path"
import fg from "fast-glob"
import { EXCLUDED_PATTERNS, SOURCE_EXTENSIONS } from "./constants"

const GLOB_IGNORE = EXCLUDED_PATTERNS.map((p) => `**/*${p}*/**`)
const EXT_GLOB = `*.{${SOURCE_EXTENSIONS.join(",")}}`
const TRAILING_GLOB = /[/*]+$/

/**
 * List source files matching the given directory patterns.
 * Replaces `execSync('find ...')` calls with fast-glob.
 */
export function listFiles(patterns: string[], cwd: string): string[] {
  const globPatterns: string[] = []
  const directFiles: string[] = []

  for (const p of patterns) {
    const cleaned = p.replace(TRAILING_GLOB, "")
    // If it has a file extension, treat as a direct file path
    if (/\.\w+$/.test(cleaned)) {
      directFiles.push(cleaned)
    } else {
      globPatterns.push(`${cleaned}/**/${EXT_GLOB}`)
    }
  }

  const globbed =
    globPatterns.length > 0
      ? fg.sync(globPatterns, {
          cwd,
          ignore: GLOB_IGNORE,
          dot: false,
          onlyFiles: true,
        })
      : []

  return [...new Set([...directFiles, ...globbed])].sort()
}

/**
 * Estimate total source bytes for given directory patterns.
 * Used by init to decide whether to split docs.
 */
export function estimateSourceSize(
  patterns: string[],
  cwd: string,
): number {
  const files = listFiles(patterns, cwd)
  let total = 0
  for (const f of files) {
    try {
      total += statSync(join(cwd, f)).size
    } catch {
      // skip missing files
    }
  }
  return total
}
