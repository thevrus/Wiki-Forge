// ── FileContext: the enriched context object for compilation ──────────

export type FileCommit = {
  sha: string
  message: string
  author: string
  date: string // YYYY-MM-DD
  prNumber?: number
}

export type PullRequest = {
  number: number
  title: string
  description: string
  author: string
  reviewComments: string[]
  linkedTickets: string[] // e.g. ["ACME-456", "#301"]
}

export type Ticket = {
  key: string
  summary: string
  description: string
  comments: string[]
  linkedTickets: string[]
}

export type FileAuthor = {
  name: string
  percentage: number
  lastActive: string // YYYY-MM-DD
}

export type FileContext = {
  filePath: string
  commits: FileCommit[]
  pullRequests: PullRequest[]
  tickets: Ticket[]
  authors: FileAuthor[]
}

/** Aggregated context for an entire doc entry (multiple source files). */
export type DocContext = {
  files: FileContext[]
  /** Unique PRs across all files, deduplicated by number. */
  pullRequests: PullRequest[]
  /** Unique tickets across all files, deduplicated by key. */
  tickets: Ticket[]
  /** Top authors across all files, merged by name. */
  authors: FileAuthor[]
}
