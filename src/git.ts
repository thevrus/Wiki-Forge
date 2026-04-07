import { execSync } from "node:child_process"
import { readFileSync } from "node:fs"

export function getLastSyncCommit(
  lastSyncPath: string,
  repoRoot: string,
  docsDir?: string,
): string {
  try {
    const commit = readFileSync(lastSyncPath, "utf-8").trim()
    if (commit) return commit
  } catch {
    // File doesn't exist or unreadable — fall through to git log
  }

  // Fall back to last commit touching docs/
  try {
    const dir = docsDir ?? "docs/"
    const commit = execSync(`git log -1 --format="%H" -- "${dir}"`, {
      encoding: "utf-8",
      cwd: repoRoot,
    }).trim()
    if (commit) return commit
  } catch {
    // Fall through to initial commit
  }

  // Fall back to initial commit
  try {
    return execSync("git rev-list --max-parents=0 HEAD", {
      encoding: "utf-8",
      cwd: repoRoot,
    }).trim()
  } catch {
    return "HEAD~1"
  }
}

export function getChangedFiles(since: string, repoRoot: string): string[] {
  try {
    const output = execSync(`git diff --name-only ${since}..HEAD`, {
      encoding: "utf-8",
      cwd: repoRoot,
    }).trim()
    if (!output) return []
    return output.split("\n").filter(Boolean)
  } catch {
    return []
  }
}

export function getCurrentCommit(repoRoot: string): string {
  try {
    return execSync("git rev-parse HEAD", {
      encoding: "utf-8",
      cwd: repoRoot,
    }).trim()
  } catch {
    return ""
  }
}

const DIFF_CAP = 50_000

export function getDiffForFiles(
  since: string,
  files: string[],
  repoRoot: string,
): string {
  if (files.length === 0) return ""

  try {
    const filePaths = files.join(" ")
    const diff = execSync(`git diff ${since}..HEAD -- ${filePaths}`, {
      encoding: "utf-8",
      cwd: repoRoot,
      maxBuffer: 10 * 1024 * 1024,
    })
    return diff.length > DIFF_CAP ? diff.slice(0, DIFF_CAP) : diff
  } catch {
    return ""
  }
}
