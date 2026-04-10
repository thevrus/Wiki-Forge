import { statSync } from "node:fs"
import { join } from "node:path"
import fg from "fast-glob"
import { BINARY_EXTENSIONS, EXCLUDED_PATTERNS, SOURCE_EXTENSIONS } from "./constants"

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
export function estimateSourceSize(patterns: string[], cwd: string): number {
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

/**
 * List ALL text files in given directories, excluding only binaries and junk.
 * Used by init indexing to catch every source file regardless of language.
 */
export function listAllTextFiles(patterns: string[], cwd: string): string[] {
  const globPatterns: string[] = []
  const directFiles: string[] = []

  for (const p of patterns) {
    const cleaned = p.replace(TRAILING_GLOB, "")
    if (/\.\w+$/.test(cleaned)) {
      directFiles.push(cleaned)
    } else {
      globPatterns.push(`${cleaned}/**/*`)
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

  const all = [...new Set([...directFiles, ...globbed])]

  // Filter out binaries by extension
  return all
    .filter((f) => {
      const ext = f.slice(f.lastIndexOf(".") + 1).toLowerCase()
      return ext !== f && !BINARY_EXTENSIONS.has(ext)
    })
    .sort()
}

/**
 * Estimate total bytes for ALL text files (not just SOURCE_EXTENSIONS).
 * Used by init to measure true coverage.
 */
export function estimateAllTextSize(patterns: string[], cwd: string): number {
  const files = listAllTextFiles(patterns, cwd)
  let total = 0
  for (const f of files) {
    try {
      total += statSync(join(cwd, f)).size
    } catch {
      // skip
    }
  }
  return total
}
