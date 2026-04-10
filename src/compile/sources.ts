import { readFileSync } from "node:fs"
import type { DocEntry } from "../config"
import { SOURCE_FILE_CAP, SOURCE_TOTAL_CAP } from "../constants"
import { listFiles } from "../file-glob"
import { getDiffForFiles } from "../git"

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

export type SourceFile = { path: string; content: string }

export type GatherResult = {
  content: string
  files: SourceFile[]
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
  const unique = listFiles(allPatterns, repoRoot)

  if (unique.length === 0) {
    return {
      content: "",
      files: [],
      fileCount: 0,
      totalSize: 0,
      truncatedFiles: [],
      skippedByPriority: 0,
    }
  }

  let total = 0
  const chunks: string[] = []
  const files: SourceFile[] = []
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
    files.push({ path: file, content })
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
    files,
    fileCount: filesRead,
    totalSize: total,
    truncatedFiles,
    skippedByPriority: unique.length - filesRead,
  }
}
