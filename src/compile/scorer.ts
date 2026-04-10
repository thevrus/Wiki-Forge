import { execSync } from "node:child_process"
import { statSync } from "node:fs"
import { join } from "node:path"
import { SOURCE_FILE_CAP, SOURCE_TOTAL_CAP } from "../constants"

// ── Importance scoring ──────────────────────────────────────────────

export type FileScore = {
  path: string
  score: number
  commitCount: number
  authorCount: number
  ticketCount: number
  recentChanges: number
  sizeBytes: number
}

/**
 * Score source files by importance. Higher score = more likely to contain
 * decisions, business logic, and institutional knowledge.
 *
 * Signals (weighted):
 *   - Commit count      (0.30) — high churn = complex/important
 *   - Unique authors    (0.20) — many hands = shared context, bus factor risk
 *   - Ticket references (0.20) — linked to product decisions
 *   - Recent changes    (0.15) — actively maintained = relevant
 *   - File size         (0.15) — larger files hold more logic
 */
export function scoreFiles(
  filePaths: string[],
  repoRoot: string,
): FileScore[] {
  if (filePaths.length === 0) return []

  // Single git log call for all files — parse commits, authors, tickets per file
  const fileStats = new Map<
    string,
    { commits: number; authors: Set<string>; tickets: number; recent: number }
  >()

  for (const f of filePaths) {
    fileStats.set(f, { commits: 0, authors: new Set(), tickets: 0, recent: 0 })
  }

  try {
    const pathArgs = filePaths.map((p) => `"${p}"`).join(" ")
    const output = execSync(
      `git log --format="COMMIT|%aN|%aI|%s" --name-only -- ${pathArgs}`,
      {
        encoding: "utf-8",
        cwd: repoRoot,
        maxBuffer: 10 * 1024 * 1024,
      },
    ).trim()

    if (output) {
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
      const cutoff = thirtyDaysAgo.toISOString().slice(0, 10)

      const TICKET_PATTERN = /\b[A-Z][A-Z0-9]+-\d+\b|\(#\d+\)/g

      let currentAuthor = ""
      let currentDate = ""
      let currentTickets = 0

      for (const line of output.split("\n")) {
        if (line.startsWith("COMMIT|")) {
          const parts = line.slice(7).split("|")
          currentAuthor = parts[0] ?? ""
          currentDate = (parts[1] ?? "").slice(0, 10)
          const message = parts.slice(2).join("|")
          currentTickets = (message.match(TICKET_PATTERN) ?? []).length
        } else if (line.trim() && currentAuthor) {
          const stat = fileStats.get(line.trim())
          if (stat) {
            stat.commits++
            stat.authors.add(currentAuthor)
            stat.tickets += currentTickets
            if (currentDate >= cutoff) stat.recent++
          }
        }
      }
    }
  } catch {
    // git not available — fall back to size-only scoring
  }

  // Get file sizes
  const scores: FileScore[] = []
  for (const path of filePaths) {
    let sizeBytes = 0
    try {
      sizeBytes = statSync(join(repoRoot, path)).size
    } catch {
      // skip
    }

    const stat = fileStats.get(path) ?? {
      commits: 0,
      authors: new Set<string>(),
      tickets: 0,
      recent: 0,
    }

    scores.push({
      path,
      score: 0, // computed below
      commitCount: stat.commits,
      authorCount: stat.authors.size,
      ticketCount: stat.tickets,
      recentChanges: stat.recent,
      sizeBytes,
    })
  }

  // Normalize each signal to 0-1 and compute weighted score
  if (scores.length === 0) return scores

  const maxCommits = Math.max(1, ...scores.map((s) => s.commitCount))
  const maxAuthors = Math.max(1, ...scores.map((s) => s.authorCount))
  const maxTickets = Math.max(1, ...scores.map((s) => s.ticketCount))
  const maxRecent = Math.max(1, ...scores.map((s) => s.recentChanges))
  const maxSize = Math.max(1, ...scores.map((s) => s.sizeBytes))

  for (const s of scores) {
    s.score =
      0.3 * (s.commitCount / maxCommits) +
      0.2 * (s.authorCount / maxAuthors) +
      0.2 * (s.ticketCount / maxTickets) +
      0.15 * (s.recentChanges / maxRecent) +
      0.15 * (s.sizeBytes / maxSize)
  }

  return scores.sort((a, b) => b.score - a.score)
}

// ── Token budget allocation ─────────────────────────────────────────

export type FileBudget = {
  path: string
  score: number
  maxBytes: number
}

/**
 * Allocate a byte budget to each file proportional to its importance score.
 * Every file gets at least `minBytes` to avoid dropping anything entirely.
 */
export function allocateBudget(
  scores: FileScore[],
  totalBudget = SOURCE_TOTAL_CAP,
  minBytes = 2000,
): FileBudget[] {
  if (scores.length === 0) return []

  const totalScore = scores.reduce((sum, s) => sum + s.score, 0)
  if (totalScore === 0) {
    // Equal distribution
    const perFile = Math.floor(totalBudget / scores.length)
    return scores.map((s) => ({ path: s.path, score: s.score, maxBytes: perFile }))
  }

  // First pass: proportional allocation with floor
  const budgets: FileBudget[] = scores.map((s) => {
    const proportional = Math.floor((s.score / totalScore) * totalBudget)
    return {
      path: s.path,
      score: s.score,
      maxBytes: Math.max(proportional, minBytes),
    }
  })

  // Cap individual files at SOURCE_FILE_CAP
  for (const b of budgets) {
    b.maxBytes = Math.min(b.maxBytes, SOURCE_FILE_CAP)
  }

  return budgets
}
