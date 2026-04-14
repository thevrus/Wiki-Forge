import { readFileSync } from "node:fs"
import type { DocEntry } from "../config"
import type { Contributor, TicketReference } from "../git"
import { docPathToTitle } from "../utils"
import { STYLE_VERSION } from "./prompts"

// ── Author context ────────────────────────────────────────────────────

export function formatAuthorContext(contributors: Contributor[]): string {
  if (contributors.length === 0) return ""
  const total = contributors.reduce((sum, c) => sum + c.commits, 0)
  const lines = contributors.slice(0, 10).map((c) => {
    const pct = total > 0 ? Math.round((c.commits / total) * 100) : 0
    return `- ${c.name}: ${pct}% ownership (${c.commits} commits, last active: ${c.lastActive})`
  })
  return [
    "",
    "## Context Holders (from git history)",
    "Ownership percentages are based on commit counts to this area of the codebase.",
    "Use these in the Context Holders section of the output.",
    ...lines,
    "DO NOT list contributors in the body text — they are already in the YAML frontmatter. Only reference a person BY NAME if they are directly relevant to a specific decision or non-obvious pattern.",
  ].join("\n")
}

export function formatTicketContext(tickets: TicketReference[]): string {
  if (tickets.length === 0) return ""
  const lines = tickets
    .slice(0, 20)
    .map((t) => `- ${t.ticket}: ${t.message} (${t.author}, ${t.date})`)
  return [
    "",
    "## Related Tickets (from git history)",
    "These tickets/PRs are linked to this area of the codebase. Reference them INLINE where they explain WHY something was built (e.g. 'Retry logic was added per CXC-1080').",
    "DO NOT create a standalone section that just lists tickets — they are already in the YAML frontmatter.",
    ...lines,
  ].join("\n")
}

export function buildTicketsFrontmatter(tickets: TicketReference[]): string {
  if (tickets.length === 0) return ""
  const entries = tickets
    .slice(0, 15)
    .map(
      (t) =>
        `  - id: "${t.ticket}"\n    summary: "${t.message.replace(/"/g, '\\"').slice(0, 100)}"`,
    )
  return `related_tickets:\n${entries.join("\n")}`
}

export function buildContributorsFrontmatter(
  contributors: Contributor[],
): string {
  if (contributors.length === 0) return ""
  const entries = contributors
    .slice(0, 10)
    .map(
      (c) =>
        `  - name: "${c.name}"\n    commits: ${c.commits}\n    last_active: "${c.lastActive}"`,
    )
  return `contributors:\n${entries.join("\n")}`
}

/** Injects contributors into existing YAML frontmatter, or adds frontmatter if missing */
export function injectContributorsFrontmatter(
  doc: string,
  contributors: Contributor[],
): string {
  if (contributors.length === 0) return doc
  const block = buildContributorsFrontmatter(contributors)

  // Doc already has frontmatter — inject before closing ---
  if (doc.startsWith("---")) {
    const closingIdx = doc.indexOf("---", 3)
    if (closingIdx !== -1) {
      const before = doc.slice(0, closingIdx).trimEnd()
      const after = doc.slice(closingIdx)
      return `${before}\n${block}\n${after}`
    }
  }

  // No frontmatter — wrap the contributors block
  return `---\n${block}\n---\n\n${doc}`
}

export function injectTicketsFrontmatter(
  doc: string,
  tickets: TicketReference[],
): string {
  if (tickets.length === 0) return doc
  const block = buildTicketsFrontmatter(tickets)

  if (doc.startsWith("---")) {
    const closingIdx = doc.indexOf("---", 3)
    if (closingIdx !== -1) {
      const before = doc.slice(0, closingIdx).trimEnd()
      const after = doc.slice(closingIdx)
      return `${before}\n${block}\n${after}`
    }
  }

  return doc
}

export type CompileMeta = {
  provider?: string
  model?: string
  sourceCommit?: string
  ingested?: boolean
  duration?: number // seconds
}

/** Fill in missing required frontmatter fields and always update compile metadata. */
export function backfillFrontmatter(
  doc: string,
  docPath: string,
  entry: DocEntry,
  meta?: CompileMeta,
): string {
  // Ensure frontmatter block exists
  if (!doc.startsWith("---")) {
    doc = `---\n---\n\n${doc}`
  }

  const closingIdx = doc.indexOf("---", 3)
  if (closingIdx === -1) return doc

  let fm = doc.slice(4, closingIdx)
  const after = doc.slice(closingIdx)
  const lines = fm.split("\n")

  const has = (key: string) =>
    lines.some((l) => l.match(new RegExp(`^${key}\\s*:`)))

  const set = (key: string, value: string) => {
    const idx = lines.findIndex((l) => l.match(new RegExp(`^${key}\\s*:`)))
    if (idx >= 0) {
      lines[idx] = `${key}: ${value}`
    } else {
      lines.push(`${key}: ${value}`)
    }
  }

  const slug = docPath
    .replace(/\.md$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")

  const title = docPathToTitle(docPath)

  if (!has("title")) set("title", `"${title}"`)
  if (!has("slug")) set("slug", slug)
  if (!has("category")) set("category", "compiled")
  if (!has("description")) set("description", `"${entry.description}"`)

  // Always update compile metadata
  set("compiled_at", `"${new Date().toISOString()}"`)
  set("style_version", String(STYLE_VERSION))
  if (meta?.provider)
    set(
      "compiled_by",
      `"${meta.provider}${meta.model ? ` (${meta.model})` : ""}"`,
    )
  if (meta?.sourceCommit) set("source_commit", `"${meta.sourceCommit}"`)
  if (meta?.ingested != null) set("ingested", String(meta.ingested))
  if (meta?.duration != null)
    set("compile_seconds", String(Math.round(meta.duration)))

  fm = lines.filter(Boolean).join("\n")
  return `---\n${fm.trimEnd()}\n${after}`
}

// ── Helpers ────────────────────────────────────────────────────────────

export function readDocFile(docPath: string): string {
  try {
    return readFileSync(docPath, "utf-8")
  } catch {
    return ""
  }
}

