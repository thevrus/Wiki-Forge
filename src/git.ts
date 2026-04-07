import { execSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { DIFF_CAP } from "./constants"

// ── Types ─────────────────────────────────────────────────────────────

export type Contributor = {
  name: string
  email: string
  commits: number
  lastActive: string // ISO date (YYYY-MM-DD)
}

export type RecentChange = {
  file: string
  author: string
  date: string // ISO date
  message: string
}

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

// ── Author extraction ─────────────────────────────────────────────────

export function getDirectoryAuthors(
  paths: string[],
  repoRoot: string,
): Contributor[] {
  if (paths.length === 0) return []

  try {
    // git shortlog -sne gives: "  34\tAlice Chen <alice@co.com>"
    const pathArgs = paths.map((p) => `"${p}"`).join(" ")
    const output = execSync(
      `git log --all --format="%aN|%aE|%aI" -- ${pathArgs}`,
      { encoding: "utf-8", cwd: repoRoot, maxBuffer: 5 * 1024 * 1024 },
    ).trim()

    if (!output) return []

    const authorMap = new Map<
      string,
      { name: string; email: string; commits: number; lastActive: string }
    >()

    for (const line of output.split("\n")) {
      if (!line) continue
      const [name, email, dateStr] = line.split("|")
      if (!name || !email || !dateStr) continue

      const date = dateStr.slice(0, 10) // YYYY-MM-DD
      const key = email.toLowerCase()
      const existing = authorMap.get(key)

      if (existing) {
        existing.commits++
        if (date > existing.lastActive) existing.lastActive = date
      } else {
        authorMap.set(key, { name, email, commits: 1, lastActive: date })
      }
    }

    return Array.from(authorMap.values()).sort((a, b) => b.commits - a.commits)
  } catch {
    return []
  }
}

export function getRecentChanges(
  paths: string[],
  repoRoot: string,
  days = 30,
): RecentChange[] {
  if (paths.length === 0) return []

  try {
    const pathArgs = paths.map((p) => `"${p}"`).join(" ")
    const output = execSync(
      `git log --since="${days} days ago" --format="%aN|%aI|%s" --name-only -- ${pathArgs}`,
      { encoding: "utf-8", cwd: repoRoot, maxBuffer: 5 * 1024 * 1024 },
    ).trim()

    if (!output) return []

    const changes: RecentChange[] = []
    let currentAuthor = ""
    let currentDate = ""
    let currentMessage = ""

    for (const line of output.split("\n")) {
      if (!line) continue

      if (line.includes("|")) {
        const parts = line.split("|")
        if (parts.length >= 3) {
          currentAuthor = parts[0]!
          currentDate = parts[1]!.slice(0, 10)
          currentMessage = parts.slice(2).join("|")
        }
      } else if (currentAuthor && line.trim()) {
        changes.push({
          file: line.trim(),
          author: currentAuthor,
          date: currentDate,
          message: currentMessage,
        })
      }
    }

    // Deduplicate: keep the most recent change per file
    const seen = new Map<string, RecentChange>()
    for (const change of changes) {
      if (!seen.has(change.file) || change.date > seen.get(change.file)!.date) {
        seen.set(change.file, change)
      }
    }

    return Array.from(seen.values()).sort((a, b) =>
      b.date.localeCompare(a.date),
    )
  } catch {
    return []
  }
}

// ── Ticket extraction ─────────────────────────────────────────────────

export type TicketReference = {
  ticket: string // e.g. "CXC-1080", "#198"
  message: string // commit message
  author: string
  date: string // YYYY-MM-DD
  files: string[] // files touched in that commit
}

// Matches tickets from any tracker:
//   Jira/Linear/Shortcut: CXC-1080, ENG-42, FE-123, PROJ-7
//   GitHub PRs: (#198), #123
const TICKET_PATTERNS = [
  /\b([A-Z][A-Z0-9]+-\d+)\b/g, // Jira, Linear, Shortcut: CXC-1080, ENG-42
  /\(#(\d+)\)/g, // GitHub PR: (#198)
  /(?:^|\s)#(\d+)\b/g, // Standalone: #123
]

function extractTickets(text: string): string[] {
  const tickets = new Set<string>()
  for (const pattern of TICKET_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const ticket = match[1]!
      // For pure numbers from GitHub PRs, prefix with #
      tickets.add(/^\d+$/.test(ticket) ? `#${ticket}` : ticket)
    }
  }
  return Array.from(tickets)
}

export function getTicketsForPaths(
  paths: string[],
  repoRoot: string,
  days = 180,
): TicketReference[] {
  if (paths.length === 0) return []

  try {
    const pathArgs = paths.map((p) => `"${p}"`).join(" ")
    const output = execSync(
      `git log --since="${days} days ago" --format="COMMIT|%aN|%aI|%s" --name-only -- ${pathArgs}`,
      { encoding: "utf-8", cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 },
    ).trim()

    if (!output) return []

    const tickets: TicketReference[] = []
    let currentAuthor = ""
    let currentDate = ""
    let currentMessage = ""
    let currentTickets: string[] = []
    let currentFiles: string[] = []

    for (const line of output.split("\n")) {
      if (line.startsWith("COMMIT|")) {
        // Flush previous commit
        if (currentTickets.length > 0 && currentFiles.length > 0) {
          for (const ticket of currentTickets) {
            tickets.push({
              ticket,
              message: currentMessage,
              author: currentAuthor,
              date: currentDate,
              files: [...currentFiles],
            })
          }
        }

        const parts = line.slice(7).split("|")
        currentAuthor = parts[0] ?? ""
        currentDate = (parts[1] ?? "").slice(0, 10)
        currentMessage = parts.slice(2).join("|")
        currentTickets = extractTickets(currentMessage)
        currentFiles = []
      } else if (line.trim()) {
        currentFiles.push(line.trim())
      }
    }

    // Flush last commit
    if (currentTickets.length > 0 && currentFiles.length > 0) {
      for (const ticket of currentTickets) {
        tickets.push({
          ticket,
          message: currentMessage,
          author: currentAuthor,
          date: currentDate,
          files: [...currentFiles],
        })
      }
    }

    // Deduplicate by ticket, keep the most recent
    const seen = new Map<string, TicketReference>()
    for (const ref of tickets) {
      const existing = seen.get(ref.ticket)
      if (!existing || ref.date > existing.date) {
        seen.set(ref.ticket, ref)
      }
    }

    return Array.from(seen.values()).sort((a, b) =>
      b.date.localeCompare(a.date),
    )
  } catch {
    return []
  }
}

export function getDiffForFiles(
  since: string,
  files: string[],
  repoRoot: string,
): string {
  if (files.length === 0) return ""

  try {
    const filePaths = files.map((f) => `"${f}"`).join(" ")
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
