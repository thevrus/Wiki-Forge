import { execSync } from "node:child_process"
import { readFileSync } from "node:fs"
import type { DocEntry } from "./config"
import { getDiffForFiles } from "./git"

const TRAILING_GLOB = /[/*]+$/

const SOURCE_CAP = 10_000
const FULL_SOURCE_CAP = 400_000

const EXCLUDED_PATTERNS = [
  "node_modules",
  ".git",
  "generated",
  ".d.ts",
  "__tests__",
  "__mocks__",
  ".test.",
  ".spec.",
  ".stories.",
  "fixtures",
  "bun.lock",
  "yarn.lock",
  "package-lock",
  "pnpm-lock",
]

// Shared with hashes.ts — all language extensions we support
const SOURCE_EXTENSIONS = [
  "ts",
  "tsx",
  "js",
  "jsx",
  "json",
  "py",
  "go",
  "rs",
  "rb",
  "java",
  "swift",
  "kt",
]

// Higher priority = read first (business logic before config/types)
const PRIORITY_PATTERNS: Array<{ pattern: RegExp; priority: number }> = [
  // Business logic, services, core — read these first
  {
    pattern: /\/(services?|domain|core|rules|handlers?|controllers?)\//,
    priority: 100,
  },
  { pattern: /\/(api|routes?|endpoints?)\//, priority: 90 },
  { pattern: /\/(models?|schemas?|entities)\//, priority: 80 },
  { pattern: /\/(hooks?|composables?|providers?)\//, priority: 70 },
  { pattern: /\/(components?|views?|screens?|pages?)\//, priority: 60 },
  { pattern: /\/(utils?|helpers?|lib)\//, priority: 50 },
  // Types and config — still useful context but lower priority
  { pattern: /\/(types?|interfaces?)\//, priority: 30 },
  { pattern: /\/(config|constants?)\//, priority: 25 },
  // Tooling config — read last, only if room
  { pattern: /package\.json$/, priority: 15 },
  { pattern: /tsconfig/, priority: 5 },
  { pattern: /turbo\.json$/, priority: 5 },
  { pattern: /(biome|eslint|prettier)/, priority: 5 },
  { pattern: /(webpack|vite|metro|babel)\.config/, priority: 5 },
  { pattern: /\.(husky|github)\//, priority: 5 },
]

function filePriority(path: string): number {
  for (const { pattern, priority } of PRIORITY_PATTERNS) {
    if (pattern.test(path)) return priority
  }
  return 40 // default: between config and utils
}

const FIND_EXTENSIONS = SOURCE_EXTENSIONS.map((ext) => `-name "*.${ext}"`).join(
  " -o ",
)

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
        `find ${searchDir} -type f \\( ${FIND_EXTENSIONS} \\) | sort`,
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
  const unique = [...new Set(allFiles)].sort(
    (a, b) => filePriority(b) - filePriority(a),
  )

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
    if (total >= FULL_SOURCE_CAP) break
    const content = readSourceFile(file, repoRoot)
    if (!content) continue
    filesRead++
    if (content.length >= SOURCE_CAP) {
      truncatedFiles.push(file)
    }
    const chunk = `--- ${file} ---\n${content}`
    chunks.push(chunk)
    total += chunk.length
  }

  const result = chunks.join("\n\n")
  const finalContent =
    result.length > FULL_SOURCE_CAP ? result.slice(0, FULL_SOURCE_CAP) : result

  return {
    content: finalContent,
    fileCount: filesRead,
    totalSize: total,
    truncatedFiles,
    skippedByPriority: unique.length - filesRead,
  }
}
