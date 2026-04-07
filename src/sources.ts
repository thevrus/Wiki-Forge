import { execSync } from "node:child_process"
import { readFileSync } from "node:fs"
import type { DocEntry } from "./config"
import { getDiffForFiles } from "./git"

const TRAILING_GLOB = /[/*]+$/

const SOURCE_CAP = 10_000
const FULL_SOURCE_CAP = 400_000

const EXCLUDED_PATTERNS = ["node_modules", ".git", "generated", ".d.ts"]

export function fileMatchesSources(
  filePath: string,
  sources: string[],
): boolean {
  return sources.some((source) => {
    const prefix = source.replace(TRAILING_GLOB, "")
    return filePath.startsWith(prefix)
  })
}

export function readSourceFile(filePath: string, repoRoot: string): string {
  try {
    const fullPath = `${repoRoot}/${filePath}`
    const content = readFileSync(fullPath, "utf-8")
    return content.length > SOURCE_CAP ? content.slice(0, SOURCE_CAP) : content
  } catch {
    return ""
  }
}

export function gatherContext(
  entry: DocEntry,
  changedFiles: string[],
  repoRoot: string,
  lastSync: string,
): { diff: string; contextCode: string; affectedFiles: string[] } {
  const allSources = [...entry.sources, ...entry.context_files]
  const affectedFiles = changedFiles.filter((f) =>
    fileMatchesSources(f, allSources),
  )

  const diff = getDiffForFiles(lastSync, affectedFiles, repoRoot)

  const contextCode = entry.context_files
    .flatMap((source) => {
      const prefix = source.replace(TRAILING_GLOB, "")
      return changedFiles
        .filter((f) => f.startsWith(prefix))
        .map((f) => {
          const content = readSourceFile(f, repoRoot)
          return content ? `--- ${f} ---\n${content}` : ""
        })
    })
    .filter(Boolean)
    .join("\n\n")

  return { diff, contextCode, affectedFiles }
}

export function gatherFullSource(entry: DocEntry, repoRoot: string): string {
  const allPatterns = [...entry.sources, ...entry.context_files]
  const allFiles: string[] = []

  for (const pattern of allPatterns) {
    const searchDir = pattern.replace(TRAILING_GLOB, "")
    try {
      const output = execSync(
        `find ${searchDir} -type f \\( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.json" \\) | sort`,
        { encoding: "utf-8", cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 },
      ).trim()
      if (output) {
        const files = output.split("\n").filter((f) => {
          return !EXCLUDED_PATTERNS.some((ex) => f.includes(ex))
        })
        allFiles.push(...files)
      }
    } catch {
      // Directory may not exist
    }
  }

  // Deduplicate
  const unique = [...new Set(allFiles)]

  let total = 0
  const chunks: string[] = []

  for (const file of unique) {
    if (total >= FULL_SOURCE_CAP) break
    const content = readSourceFile(file, repoRoot)
    if (!content) continue
    const chunk = `--- ${file} ---\n${content}`
    chunks.push(chunk)
    total += chunk.length
  }

  const result = chunks.join("\n\n")
  return result.length > FULL_SOURCE_CAP
    ? result.slice(0, FULL_SOURCE_CAP)
    : result
}
