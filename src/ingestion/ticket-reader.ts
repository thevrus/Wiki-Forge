import { z } from "zod"
import { asyncPool } from "../utils"
import type { Ticket } from "./types"

// ── Ticket ID extraction ─────────────────────────────────────────────

// Matches Jira, Linear, Shortcut, Height, and similar PROJECT-123 patterns
const PROJECT_TICKET = /\b([A-Z][A-Z0-9]+-\d+)\b/g

// Matches Linear URLs: linear.app/team/issue/ENG-42
const LINEAR_URL = /linear\.app\/[^/]+\/issue\/([A-Z][A-Z0-9]+-\d+)/g

// Matches Shortcut URLs: app.shortcut.com/org/story/12345
const SHORTCUT_URL = /app\.shortcut\.com\/[^/]+\/story\/(\d+)/g

// Matches GitHub PR refs: (#198)
const GITHUB_PR_REF = /\(#(\d+)\)/g

// Matches standalone GitHub issue/PR refs: #123
const GITHUB_ISSUE_REF = /(?:^|\s)#(\d+)\b/g

/**
 * Extract ticket IDs from text.
 * Works with Jira, Linear, Shortcut, GitHub PR/issue refs, and any PROJECT-123 format.
 */
export function extractTicketIds(text: string): string[] {
  const tickets = new Set<string>()

  for (const match of text.matchAll(PROJECT_TICKET)) {
    tickets.add(match[1]!)
  }
  for (const match of text.matchAll(LINEAR_URL)) {
    tickets.add(match[1]!)
  }
  for (const match of text.matchAll(SHORTCUT_URL)) {
    tickets.add(`SC-${match[1]}`)
  }
  for (const match of text.matchAll(GITHUB_PR_REF)) {
    tickets.add(`#${match[1]}`)
  }
  for (const match of text.matchAll(GITHUB_ISSUE_REF)) {
    tickets.add(`#${match[1]}`)
  }

  return [...tickets]
}

/**
 * Extract ticket IDs from multiple text sources (commit messages, PR descriptions).
 */
export function extractAllTicketIds(texts: string[]): string[] {
  const all = new Set<string>()
  for (const text of texts) {
    for (const id of extractTicketIds(text)) {
      all.add(id)
    }
  }
  return [...all]
}

// ── Tracker detection ────────────────────────────────────────────────

export type TrackerType = "jira" | "linear" | "none"

export type TrackerConfig =
  | { type: "jira"; jira: JiraConfig }
  | { type: "linear"; linear: LinearConfig }
  | { type: "none" }

/** Detect which issue tracker is configured via env vars. Prefers Linear. */
export function detectTracker(): TrackerConfig {
  const linear = isLinearAvailable()
  if (linear) return { type: "linear", linear }

  const jira = isJiraAvailable()
  if (jira) return { type: "jira", jira }

  return { type: "none" }
}

// ── Jira API ─────────────────────────────────────────────────────────

export type JiraConfig = {
  baseUrl: string // e.g. https://acme.atlassian.net
  email: string
  apiToken: string
}

export function isJiraAvailable(): JiraConfig | null {
  const baseUrl = process.env.JIRA_URL
  const email = process.env.JIRA_EMAIL
  const apiToken = process.env.JIRA_API_TOKEN
  if (!baseUrl || !email || !apiToken) return null
  return { baseUrl: baseUrl.replace(/\/$/, ""), email, apiToken }
}

const adfNode: z.ZodType<unknown> = z.lazy(() =>
  z
    .object({
      text: z.string().optional(),
      content: z.array(adfNode).optional(),
    })
    .catchall(z.unknown()),
)

const jiraIssueSchema = z.object({
  key: z.string(),
  fields: z.object({
    summary: z.string(),
    description: z.union([adfNode, z.string(), z.null()]).optional(),
    comment: z
      .object({
        comments: z
          .array(z.object({ body: z.union([adfNode, z.string()]).optional() }))
          .optional(),
      })
      .optional(),
    issuelinks: z
      .array(
        z.object({
          outwardIssue: z.object({ key: z.string() }).optional(),
          inwardIssue: z.object({ key: z.string() }).optional(),
        }),
      )
      .optional(),
  }),
})

const linearResponseSchema = z.object({
  data: z
    .object({
      issue: z
        .object({
          identifier: z.string(),
          title: z.string(),
          description: z.string().nullable(),
          comments: z
            .object({ nodes: z.array(z.object({ body: z.string() })) })
            .optional(),
          relations: z
            .object({
              nodes: z.array(
                z.object({
                  relatedIssue: z.object({ identifier: z.string() }).optional(),
                }),
              ),
            })
            .optional(),
        })
        .nullable(),
    })
    .optional(),
})

async function fetchJiraTicket(
  ticketKey: string,
  config: JiraConfig,
): Promise<Ticket | null> {
  try {
    const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString(
      "base64",
    )
    const res = await fetch(
      `${config.baseUrl}/rest/api/3/issue/${ticketKey}?fields=summary,description,comment,issuelinks`,
      {
        headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
      },
    )

    if (!res.ok) return null
    const raw = await res.json()
    const parsed = jiraIssueSchema.safeParse(raw)
    if (!parsed.success) return null
    const data = parsed.data

    const description =
      typeof data.fields.description === "string"
        ? data.fields.description
        : extractADFText(data.fields.description)

    const comments = (data.fields.comment?.comments ?? [])
      .slice(0, 10)
      .map((c) => {
        if (typeof c.body === "string") return c.body
        return extractADFText(c.body)
      })
      .filter((c) => c.length > 0)

    const linkedTickets = (data.fields.issuelinks ?? [])
      .flatMap((link) => [link.outwardIssue?.key, link.inwardIssue?.key])
      .filter((k): k is string => Boolean(k))

    return {
      key: data.key,
      summary: data.fields.summary,
      description,
      comments,
      linkedTickets,
    }
  } catch {
    return null
  }
}

function extractADFText(node: unknown): string {
  if (!node || typeof node !== "object") return ""
  const obj = node as Record<string, unknown>
  if (obj.text && typeof obj.text === "string") return obj.text
  if (Array.isArray(obj.content))
    return obj.content.map(extractADFText).join("")
  return ""
}

export async function fetchJiraTickets(
  ticketKeys: string[],
  config: JiraConfig,
  concurrency = 3,
): Promise<Ticket[]> {
  if (ticketKeys.length === 0) return []
  const results: Ticket[] = []
  await asyncPool(concurrency, ticketKeys, async (key) => {
    const ticket = await fetchJiraTicket(key, config)
    if (ticket) results.push(ticket)
  })
  return results
}

// ── Linear API ───────────────────────────────────────────────────────

export type LinearConfig = {
  apiKey: string
}

export function isLinearAvailable(): LinearConfig | null {
  const apiKey = process.env.LINEAR_API_KEY
  if (!apiKey) return null
  return { apiKey }
}

async function fetchLinearIssue(
  issueId: string,
  config: LinearConfig,
): Promise<Ticket | null> {
  try {
    const res = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: config.apiKey,
      },
      body: JSON.stringify({
        query: `query($id: String!) {
          issue(id: $id) {
            identifier
            title
            description
            comments { nodes { body } }
            relations { nodes { relatedIssue { identifier } } }
          }
        }`,
        variables: { id: issueId },
      }),
    })

    if (!res.ok) return null
    const raw = await res.json()
    const parsed = linearResponseSchema.safeParse(raw)
    if (!parsed.success) return null

    const issue = parsed.data.data?.issue
    if (!issue) return null

    return {
      key: issue.identifier,
      summary: issue.title,
      description: issue.description ?? "",
      comments: (issue.comments?.nodes ?? [])
        .map((c) => c.body)
        .filter((b) => b.length > 0)
        .slice(0, 10),
      linkedTickets: (issue.relations?.nodes ?? [])
        .map((r) => r.relatedIssue?.identifier)
        .filter((k): k is string => Boolean(k)),
    }
  } catch {
    return null
  }
}

/** Linear uses identifier format (ENG-42), but the API needs the UUID or identifier. */
export async function fetchLinearTickets(
  ticketKeys: string[],
  config: LinearConfig,
  concurrency = 3,
): Promise<Ticket[]> {
  if (ticketKeys.length === 0) return []
  const results: Ticket[] = []
  await asyncPool(concurrency, ticketKeys, async (key) => {
    const ticket = await fetchLinearIssue(key, config)
    if (ticket) results.push(ticket)
  })
  return results
}

// ── Unified fetch ────────────────────────────────────────────────────

/**
 * Fetch tickets from whatever tracker is configured.
 * Detects Jira/Linear from env vars automatically.
 */
export async function fetchTickets(ticketKeys: string[]): Promise<Ticket[]> {
  if (ticketKeys.length === 0) return []

  const tracker = detectTracker()
  switch (tracker.type) {
    case "jira":
      return fetchJiraTickets(ticketKeys, tracker.jira)
    case "linear":
      return fetchLinearTickets(ticketKeys, tracker.linear)
    case "none":
      return []
  }
}
