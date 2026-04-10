import { z } from "zod"
import { asyncPool } from "../utils"
import { extractTicketIds } from "./ticket-reader"
import type { PullRequest } from "./types"

// ── GitHub API via Octokit ───────────────────────────────────────────

type OctokitLike = {
  request: (
    route: string,
    params: Record<string, unknown>,
  ) => Promise<{ data: unknown }>
}

export type GitHubConfig = {
  owner: string
  repo: string
  token: string
}

let _octokit: OctokitLike | null = null

async function getOctokit(token: string): Promise<OctokitLike> {
  if (_octokit) return _octokit
  const { Octokit } = await import("octokit")
  _octokit = new Octokit({ auth: token })
  return _octokit
}

/** Detect owner/repo from git remote origin URL. */
export function detectGitHubRepo(
  repoRoot: string,
): { owner: string; repo: string } | null {
  try {
    const { execSync } =
      require("node:child_process") as typeof import("node:child_process")
    const url = execSync("git remote get-url origin", {
      encoding: "utf-8",
      cwd: repoRoot,
    }).trim()

    // SSH: git@github.com:owner/repo.git
    const sshMatch = url.match(/github\.com[:/]([^/]+)\/([^/.]+)/)
    if (sshMatch) return { owner: sshMatch[1]!, repo: sshMatch[2]! }

    // HTTPS: https://github.com/owner/repo.git
    const httpsMatch = url.match(/github\.com\/([^/]+)\/([^/.]+)/)
    if (httpsMatch) return { owner: httpsMatch[1]!, repo: httpsMatch[2]! }

    return null
  } catch {
    return null
  }
}

const prDataSchema = z.object({
  title: z.string(),
  body: z.string().nullable(),
  user: z.object({ login: z.string() }).nullable(),
})

const reviewsSchema = z.array(z.object({ body: z.string().nullable() }))

async function fetchPR(
  octokit: OctokitLike,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<PullRequest | null> {
  try {
    const [prResponse, reviewResponse] = await Promise.all([
      octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
        owner,
        repo,
        pull_number: prNumber,
      }),
      octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews", {
        owner,
        repo,
        pull_number: prNumber,
      }),
    ])
    const prParsed = prDataSchema.safeParse(prResponse.data)
    if (!prParsed.success) return null
    const pr = prParsed.data

    const reviewsParsed = reviewsSchema.safeParse(reviewResponse.data)
    const reviews = reviewsParsed.success ? reviewsParsed.data : []

    const description = pr.body ?? ""
    const reviewComments = reviews
      .map((r) => r.body)
      .filter((b): b is string => b != null && b.length > 10)
      .slice(0, 10)

    const allText = `${description}\n${reviewComments.join("\n")}`
    const linkedTickets = extractTicketIds(allText)

    return {
      number: prNumber,
      title: pr.title,
      description,
      author: pr.user?.login ?? "unknown",
      reviewComments,
      linkedTickets,
    }
  } catch {
    return null
  }
}

/**
 * Fetch multiple PRs from GitHub, with concurrency limit.
 * Skips PRs that fail to fetch.
 */
export async function fetchPullRequests(
  prNumbers: number[],
  config: GitHubConfig,
  concurrency = 3,
): Promise<PullRequest[]> {
  if (prNumbers.length === 0) return []

  const octokit = await getOctokit(config.token)
  const results: PullRequest[] = []

  await asyncPool(concurrency, prNumbers, async (prNumber) => {
    const pr = await fetchPR(octokit, config.owner, config.repo, prNumber)
    if (pr) results.push(pr)
  })

  return results.sort((a, b) => b.number - a.number)
}

/**
 * Check if GitHub API is available (token set and repo detected).
 */
export function isGitHubAvailable(repoRoot: string): GitHubConfig | null {
  const token = process.env.GITHUB_TOKEN
  if (!token) return null

  const repo = detectGitHubRepo(repoRoot)
  if (!repo) return null

  return { ...repo, token }
}
