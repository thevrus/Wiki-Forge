import { execSync } from "node:child_process"
import { readFileSync } from "node:fs"
import type { DocEntry } from "./config"
import {
  EXCLUDED_PATTERNS,
  FIND_EXTENSIONS,
  SOURCE_FILE_CAP,
  SOURCE_TOTAL_CAP,
} from "./constants"
import { getDiffForFiles } from "./git"

const TRAILING_GLOB = /[/*]+$/

// No priority ranking — all source files are equally important.
// Doc-map splitting handles focus: each doc has its own focused sources.

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
    return content.length > SOURCE_FILE_CAP
      ? content.slice(0, SOURCE_FILE_CAP)
      : content
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

export type GatherResult = {
  content: string
  fileCount: number
  totalSize: number
  truncatedFiles: string[]
  skippedByPriority: number
}

export function gatherFullSource(
  entry: DocEntry,
  repoRoot: string,
): GatherResult {
  const allPatterns = [...entry.sources, ...entry.context_files]
  const allFiles: string[] = []

  for (const pattern of allPatterns) {
    const searchDir = pattern.replace(TRAILING_GLOB, "")
    try {
      const output = execSync(
        `find "${searchDir}" -type f \\( ${FIND_EXTENSIONS} \\) | sort`,
        { encoding: "utf-8", cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 },
      ).trim()
      if (output) {
        const files = output.split("\n").filter((f) => {
          return !EXCLUDED_PATTERNS.some((ex) => f.includes(ex))
        })
        allFiles.push(...files)
      }
    } catch {
      // Directory may not exist — handled by caller
    }
  }

  // Deduplicate and sort by priority (high priority first)
  const unique = [...new Set(allFiles)]

  if (unique.length === 0) {
    return {
      content: "",
      fileCount: 0,
      totalSize: 0,
      truncatedFiles: [],
      skippedByPriority: 0,
    }
  }

  let total = 0
  const chunks: string[] = []
  const truncatedFiles: string[] = []
  let filesRead = 0

  for (const file of unique) {
    if (total >= SOURCE_TOTAL_CAP) break
    const content = readSourceFile(file, repoRoot)
    if (!content) continue
    filesRead++
    if (content.length >= SOURCE_FILE_CAP) {
      truncatedFiles.push(file)
    }
    const chunk = `--- ${file} ---\n${content}`
    chunks.push(chunk)
    total += chunk.length
  }

  const result = chunks.join("\n\n")
  const finalContent =
    result.length > SOURCE_TOTAL_CAP
      ? result.slice(0, SOURCE_TOTAL_CAP)
      : result

  return {
    content: finalContent,
    fileCount: filesRead,
    totalSize: total,
    truncatedFiles,
    skippedByPriority: unique.length - filesRead,
  }
}
