import { execSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { FIND_EXTENSIONS } from "./constants"

// ── Types ─────────────────────────────────────────────────────────────

export type FileHashes = Record<string, Record<string, string>>
// { "ARCHITECTURE.md": { "src/api/router.ts": "abc123", ... } }

type HashState = {
  hashes: FileHashes
}

// ── Read / Write ──────────────────────────────────────────────────────

const HASH_FILE = ".doc-hashes.json"

export function loadHashes(docsDir: string): FileHashes {
  try {
    const raw = readFileSync(join(docsDir, HASH_FILE), "utf-8")
    const parsed: HashState = JSON.parse(raw)
    return parsed.hashes ?? {}
  } catch {
    return {}
  }
}

export function saveHashes(docsDir: string, hashes: FileHashes): void {
  const state: HashState = { hashes }
  writeFileSync(join(docsDir, HASH_FILE), `${JSON.stringify(state, null, 2)}\n`)
}

// ── Hashing ───────────────────────────────────────────────────────────

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16)
}

function listSourceFiles(patterns: string[], repoRoot: string): string[] {
  const allFiles: string[] = []
  const trailingGlob = /[/*]+$/

  for (const pattern of patterns) {
    const searchDir = pattern.replace(trailingGlob, "")
    try {
      const output = execSync(
        `find "${searchDir}" -type f \\( ${FIND_EXTENSIONS} \\) | sort`,
        { encoding: "utf-8", cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 },
      ).trim()
      if (output) {
        const files = output
          .split("\n")
          .filter((f) => !f.includes("node_modules") && !f.includes(".git"))
        allFiles.push(...files)
      }
    } catch {
      // single file pattern
      allFiles.push(searchDir)
    }
  }

  return [...new Set(allFiles)]
}

// ── Compute current hashes for a doc ─────────────────────────────────

export function computeDocHashes(
  sources: string[],
  contextFiles: string[],
  repoRoot: string,
): Record<string, string> {
  const patterns = [...sources, ...contextFiles]
  const files = listSourceFiles(patterns, repoRoot)
  const result: Record<string, string> = {}

  for (const file of files) {
    try {
      const content = readFileSync(join(repoRoot, file), "utf-8")
      result[file] = hashContent(content)
    } catch {
      // file gone — skip
    }
  }

  return result
}

// ── Diff detection ───────────────────────────────────────────────────

export type HashDiffResult = {
  changed: boolean
  changedFiles: string[]
  addedFiles: string[]
  removedFiles: string[]
}

export function diffHashes(
  previous: Record<string, string>,
  current: Record<string, string>,
): HashDiffResult {
  const changedFiles: string[] = []
  const addedFiles: string[] = []
  const removedFiles: string[] = []

  for (const [file, hash] of Object.entries(current)) {
    if (!(file in previous)) {
      addedFiles.push(file)
    } else if (previous[file] !== hash) {
      changedFiles.push(file)
    }
  }

  for (const file of Object.keys(previous)) {
    if (!(file in current)) {
      removedFiles.push(file)
    }
  }

  const changed =
    changedFiles.length > 0 || addedFiles.length > 0 || removedFiles.length > 0

  return { changed, changedFiles, addedFiles, removedFiles }
}

// ── Bulk update ──────────────────────────────────────────────────────

export function updateHashesForDoc(
  allHashes: FileHashes,
  docPath: string,
  currentHashes: Record<string, string>,
): FileHashes {
  return { ...allHashes, [docPath]: currentHashes }
}
