import { readFileSync } from "node:fs"
import type { DocEntry } from "../config"
import { SOURCE_FILE_CAP, SOURCE_TOTAL_CAP } from "../constants"
import { listFiles } from "../file-glob"
import { getDiffForFiles } from "../git"
import { type InjectionFinding, scanForInjection } from "./injection-scan"
import { allocateBudget, scoreFiles } from "./scorer"

const TRAILING_GLOB = /[/*]+$/

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
  injectionFindings: InjectionFinding[]
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
      injectionFindings: [],
    }
  }

  // Score files by importance and allocate byte budgets
  const scores = scoreFiles(unique, repoRoot)
  const budgets = allocateBudget(scores)
  const budgetMap = new Map(budgets.map((b) => [b.path, b.maxBytes]))

  let total = 0
  const chunks: string[] = []
  const files: SourceFile[] = []
  const truncatedFiles: string[] = []
  const injectionFindings: InjectionFinding[] = []
  let filesRead = 0
  let skipped = 0

  // Files are already sorted by importance (highest first)
  for (const { path: file } of scores) {
    if (total >= SOURCE_TOTAL_CAP) {
      skipped++
      continue
    }

    const budget = budgetMap.get(file) ?? SOURCE_FILE_CAP
    let content: string
    try {
      const fullPath = `${repoRoot}/${file}`
      const raw = readFileSync(fullPath, "utf-8")
      content = raw.length > budget ? raw.slice(0, budget) : raw
    } catch {
      continue
    }
    if (!content) continue

    filesRead++
    if (content.length >= budget && budget < SOURCE_FILE_CAP) {
      truncatedFiles.push(file)
    }
    injectionFindings.push(...scanForInjection(file, content))
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
    skippedByPriority: skipped,
    injectionFindings,
  }
}
