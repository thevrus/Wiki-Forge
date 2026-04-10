import { getFileAuthors } from "../git/blame"
import { getFileCommits } from "../git/log"
import {
  fetchPullRequests,
  type GitHubConfig,
  isGitHubAvailable,
} from "./pr-reader"
import { extractAllTicketIds, fetchTickets } from "./ticket-reader"
import type { DocContext, FileAuthor, FileContext, PullRequest } from "./types"

export type IngestionConfig = {
  repoRoot: string
  /** Max commits per file to fetch. */
  commitLimit?: number
  /** Skip GitHub API calls even if GITHUB_TOKEN is set. */
  skipGitHub?: boolean
  /** Skip ticket tracker API calls (Jira, Linear) even if env vars are set. */
  skipTickets?: boolean
  /** Skip git blame (faster but no per-file ownership). */
  skipBlame?: boolean
}

/**
 * Build a FileContext for a single source file.
 * Gathers commits and optionally git blame data.
 * PR and ticket data are fetched at the doc level (see buildDocContext).
 */
export function buildFileContext(
  filePath: string,
  repoRoot: string,
  commitLimit = 20,
  skipBlame = false,
): FileContext {
  const commits = getFileCommits(filePath, repoRoot, commitLimit)
  const authors = skipBlame ? [] : getFileAuthors(filePath, repoRoot)

  return {
    filePath,
    commits,
    pullRequests: [], // filled by linker at doc level
    tickets: [], // filled by linker at doc level
    authors,
  }
}

/**
 * Build the full DocContext for a doc-map entry.
 * This is the main entry point for Sprint 1 ingestion.
 *
 * 1. For each source file: gather commits + blame
 * 2. Collect all PR numbers from commit messages
 * 3. Fetch PR details from GitHub API (if available)
 * 4. Extract ticket IDs from commits + PR descriptions
 * 5. Fetch ticket details from Jira API (if available)
 * 6. Merge everything into a deduplicated DocContext
 */
export async function buildDocContext(
  sourcePaths: string[],
  config: IngestionConfig,
): Promise<DocContext> {
  const {
    repoRoot,
    commitLimit = 20,
    skipGitHub = false,
    skipTickets = false,
    skipBlame = false,
  } = config

  // 1. Build per-file contexts (git log + blame)
  const files: FileContext[] = sourcePaths.map((path) =>
    buildFileContext(path, repoRoot, commitLimit, skipBlame),
  )

  // 2. Collect all PR numbers from already-fetched commits (no extra git call)
  const allPRNumbers = [
    ...new Set(
      files
        .flatMap((f) => f.commits)
        .map((c) => c.prNumber)
        .filter((n): n is number => n !== undefined),
    ),
  ]

  // 3. Fetch PRs from GitHub API
  let pullRequests: PullRequest[] = []
  const ghConfig: GitHubConfig | null = skipGitHub
    ? null
    : isGitHubAvailable(repoRoot)
  if (ghConfig && allPRNumbers.length > 0) {
    pullRequests = await fetchPullRequests(allPRNumbers.slice(0, 30), ghConfig)
  }

  // 4. Extract ticket IDs from commits + PR descriptions
  const allTexts: string[] = []
  for (const file of files) {
    for (const commit of file.commits) {
      allTexts.push(commit.message)
    }
  }
  for (const pr of pullRequests) {
    allTexts.push(pr.description)
    allTexts.push(pr.title)
  }
  const ticketIds = extractAllTicketIds(allTexts)

  // 5. Fetch tickets from configured tracker (Jira, Linear, etc.)
  const tickets = skipTickets ? [] : await fetchTickets(ticketIds.slice(0, 20))

  // 6. Wire PRs and tickets back into file contexts
  for (const file of files) {
    const filePRNumbers = new Set(
      file.commits
        .map((c) => c.prNumber)
        .filter((n): n is number => n !== undefined),
    )
    file.pullRequests = pullRequests.filter((pr) =>
      filePRNumbers.has(pr.number),
    )
    file.tickets = tickets.filter((t) =>
      file.commits.some((c) => c.message.includes(t.key)),
    )
  }

  // 7. Merge authors across files
  const authorMap = new Map<string, FileAuthor>()
  for (const file of files) {
    for (const author of file.authors) {
      const existing = authorMap.get(author.name)
      if (existing) {
        // Weight by max percentage, keep most recent activity
        existing.percentage = Math.max(existing.percentage, author.percentage)
        if (author.lastActive > existing.lastActive) {
          existing.lastActive = author.lastActive
        }
      } else {
        authorMap.set(author.name, { ...author })
      }
    }
  }
  const authors = [...authorMap.values()].sort(
    (a, b) => b.percentage - a.percentage,
  )

  return {
    files,
    pullRequests,
    tickets,
    authors,
  }
}

// ── Formatting helpers for LLM prompts ───────────────────────────────

/**
 * Format DocContext into a text block suitable for LLM prompts.
 * This replaces the raw author/ticket context with rich decision history.
 */
export function formatDocContextForPrompt(
  ctx: DocContext,
  maxLength = 50_000,
): string {
  const sections: string[] = []

  // Decision history from PRs
  if (ctx.pullRequests.length > 0) {
    const prLines = ctx.pullRequests.slice(0, 15).map((pr) => {
      const ticketRef =
        pr.linkedTickets.length > 0 ? ` [${pr.linkedTickets.join(", ")}]` : ""
      const desc =
        pr.description.length > 300
          ? `${pr.description.slice(0, 300)}...`
          : pr.description
      const reviews =
        pr.reviewComments.length > 0
          ? `\n    Review notes: ${pr.reviewComments
              .slice(0, 3)
              .map((r) => r.slice(0, 150))
              .join(" | ")}`
          : ""
      return `  - PR #${pr.number}: ${pr.title} (by ${pr.author})${ticketRef}\n    ${desc}${reviews}`
    })
    sections.push(
      "## Pull Requests (decision context)\n" +
        "These PRs explain WHY code was written this way. Reference them inline (e.g. 'Added per PR #42').\n" +
        prLines.join("\n"),
    )
  }

  // Ticket context from Jira
  if (ctx.tickets.length > 0) {
    const ticketLines = ctx.tickets.slice(0, 10).map((t) => {
      const desc =
        t.description.length > 200
          ? `${t.description.slice(0, 200)}...`
          : t.description
      const linked =
        t.linkedTickets.length > 0
          ? ` → linked: ${t.linkedTickets.join(", ")}`
          : ""
      return `  - ${t.key}: ${t.summary}${linked}\n    ${desc}`
    })
    sections.push(
      "## Linked Tickets\n" +
        "These tickets describe the business requirements behind the code.\n" +
        ticketLines.join("\n"),
    )
  }

  // Git history summary (recent commits across all files)
  const allCommits = ctx.files
    .flatMap((f) => f.commits.map((c) => ({ ...c, file: f.filePath })))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 30)

  if (allCommits.length > 0) {
    const commitLines = allCommits.map((c) => {
      const pr = c.prNumber ? ` (PR #${c.prNumber})` : ""
      return `  - ${c.date} ${c.author}: ${c.message}${pr}`
    })
    sections.push(
      "## Recent Git History\n" +
        "Commit messages showing how this code evolved.\n" +
        commitLines.join("\n"),
    )
  }

  // Authors with ownership percentages (from blame)
  if (ctx.authors.length > 0) {
    const authorLines = ctx.authors
      .slice(0, 10)
      .map(
        (a) =>
          `  - ${a.name}: ${a.percentage}% ownership (last active: ${a.lastActive})`,
      )
    sections.push(
      "## Context Holders (from git blame)\n" +
        "These people wrote this code and can explain decisions.\n" +
        authorLines.join("\n"),
    )
  }

  const result = sections.join("\n\n")
  return result.length > maxLength ? result.slice(0, maxLength) : result
}
