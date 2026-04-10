import { execSync } from "node:child_process"
import type { FileCommit } from "../ingestion/types"

const PR_REF = /\(#(\d+)\)/

/**
 * Get the commit history for a specific file.
 * Returns the last `limit` commits with SHAs, messages, authors, and dates.
 * Extracts PR numbers from commit messages (GitHub squash-merge format).
 */
export function getFileCommits(
  filePath: string,
  repoRoot: string,
  limit = 20,
): FileCommit[] {
  try {
    const output = execSync(
      `git log --follow -n ${limit} --format="%H|%aN|%aI|%s" -- "${filePath}"`,
      { encoding: "utf-8", cwd: repoRoot, maxBuffer: 5 * 1024 * 1024 },
    ).trim()

    if (!output) return []

    const commits: FileCommit[] = []
    for (const line of output.split("\n")) {
      if (!line) continue
      const pipeIdx1 = line.indexOf("|")
      const pipeIdx2 = line.indexOf("|", pipeIdx1 + 1)
      const pipeIdx3 = line.indexOf("|", pipeIdx2 + 1)
      if (pipeIdx1 === -1 || pipeIdx2 === -1 || pipeIdx3 === -1) continue

      const sha = line.slice(0, pipeIdx1)
      const author = line.slice(pipeIdx1 + 1, pipeIdx2)
      const dateStr = line.slice(pipeIdx2 + 1, pipeIdx3)
      const message = line.slice(pipeIdx3 + 1)

      const prMatch = message.match(PR_REF)

      commits.push({
        sha,
        author,
        date: dateStr.slice(0, 10),
        message,
        prNumber: prMatch ? Number(prMatch[1]) : undefined,
      })
    }

    return commits
  } catch {
    return []
  }
}

/**
 * Get unique commit SHAs for a set of file paths.
 * Used to batch-fetch PRs for all files in a doc entry.
 */
export function getCommitSHAsForPaths(
  paths: string[],
  repoRoot: string,
  limit = 50,
): string[] {
  if (paths.length === 0) return []

  try {
    const pathArgs = paths.map((p) => `"${p}"`).join(" ")
    const output = execSync(
      `git log -n ${limit} --format="%H" -- ${pathArgs}`,
      { encoding: "utf-8", cwd: repoRoot, maxBuffer: 5 * 1024 * 1024 },
    ).trim()

    if (!output) return []
    return [...new Set(output.split("\n").filter(Boolean))]
  } catch {
    return []
  }
}

/**
 * Extract PR numbers from commit messages for a set of file paths.
 * Returns unique PR numbers found in squash-merge style messages like "feat: thing (#42)".
 */
export function extractPRNumbersFromHistory(
  paths: string[],
  repoRoot: string,
  limit = 50,
): number[] {
  if (paths.length === 0) return []

  try {
    const pathArgs = paths.map((p) => `"${p}"`).join(" ")
    const output = execSync(
      `git log -n ${limit} --format="%s" -- ${pathArgs}`,
      { encoding: "utf-8", cwd: repoRoot, maxBuffer: 5 * 1024 * 1024 },
    ).trim()

    if (!output) return []

    const prNumbers = new Set<number>()
    for (const line of output.split("\n")) {
      const match = line.match(PR_REF)
      if (match) prNumbers.add(Number(match[1]))
    }
    return [...prNumbers]
  } catch {
    return []
  }
}
