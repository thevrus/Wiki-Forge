import { execSync } from "node:child_process"
import type { FileAuthor } from "../ingestion/types"

/**
 * Run git blame on a file and return author ownership percentages.
 * Uses --line-porcelain for reliable parsing.
 */
export function getFileAuthors(
  filePath: string,
  repoRoot: string,
): FileAuthor[] {
  try {
    const output = execSync(`git blame --line-porcelain -- "${filePath}"`, {
      encoding: "utf-8",
      cwd: repoRoot,
      maxBuffer: 10 * 1024 * 1024,
    })

    if (!output) return []

    // Parse porcelain output: each block starts with a SHA line,
    // then key-value pairs including "author" and "author-time"
    const authorLines = new Map<string, { lines: number; lastEpoch: number }>()
    let currentAuthor = ""
    let currentEpoch = 0

    for (const line of output.split("\n")) {
      if (line.startsWith("author ")) {
        currentAuthor = line.slice(7)
      } else if (line.startsWith("author-time ")) {
        currentEpoch = Number(line.slice(12))
      } else if (line.startsWith("\t")) {
        // This is the content line — signals end of a blame block
        if (currentAuthor && currentAuthor !== "Not Committed Yet") {
          const existing = authorLines.get(currentAuthor)
          if (existing) {
            existing.lines++
            if (currentEpoch > existing.lastEpoch) {
              existing.lastEpoch = currentEpoch
            }
          } else {
            authorLines.set(currentAuthor, {
              lines: 1,
              lastEpoch: currentEpoch,
            })
          }
        }
      }
    }

    if (authorLines.size === 0) return []

    const totalLines = [...authorLines.values()].reduce(
      (sum, a) => sum + a.lines,
      0,
    )

    return [...authorLines.entries()]
      .map(([name, { lines, lastEpoch }]) => ({
        name,
        percentage: Math.round((lines / totalLines) * 100),
        lastActive: epochToDate(lastEpoch),
      }))
      .sort((a, b) => b.percentage - a.percentage)
  } catch {
    return []
  }
}

function epochToDate(epoch: number): string {
  return new Date(epoch * 1000).toISOString().slice(0, 10)
}
