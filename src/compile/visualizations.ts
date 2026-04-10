import type { DocContext, FileCommit } from "../ingestion/types"
import { computeBusFactorFromPercentages } from "../utils"
import type { DependencyGraph } from "./dependency-graph"

// ── Decision timeline ────────────────────────────────────────────────

function quarterLabel(date: string): string {
  const [year, month] = date.split("-").map(Number)
  const q = Math.ceil(month! / 3)
  return `${year} Q${q}`
}

export function decisionTimeline(ctx: DocContext, docName: string): string {
  const events: Array<{ date: string; label: string; source: string }> = []

  for (const pr of ctx.pullRequests) {
    const commit = ctx.files
      .flatMap((f) => f.commits)
      .find((c) => c.prNumber === pr.number)
    const date = commit?.date ?? ""
    if (!date) continue
    const tickets =
      pr.linkedTickets.length > 0 ? ` [${pr.linkedTickets.join(", ")}]` : ""
    events.push({
      date,
      label: pr.title.slice(0, 60),
      source: `PR #${pr.number}${tickets}`,
    })
  }

  // Also include commits with meaningful messages that aren't PR-linked
  for (const file of ctx.files) {
    for (const c of file.commits) {
      if (c.prNumber) continue // already covered by PR
      if (c.message.length < 15) continue
      if (/^(chore|style|ci|docs|build):/i.test(c.message)) continue
      events.push({
        date: c.date,
        label: c.message.slice(0, 60),
        source: c.sha.slice(0, 7),
      })
    }
  }

  if (events.length < 2) return ""

  // Deduplicate and sort
  const seen = new Set<string>()
  const unique = events.filter((e) => {
    const key = e.source
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  unique.sort((a, b) => a.date.localeCompare(b.date))

  // Group by quarter
  const quarters = new Map<string, typeof unique>()
  for (const e of unique) {
    const q = quarterLabel(e.date)
    if (!quarters.has(q)) quarters.set(q, [])
    quarters.get(q)!.push(e)
  }

  const slug = docName.replace(/\.md$/i, "").toLowerCase()
  const lines = [
    "",
    "## 📅 Decision timeline",
    "",
    "```mermaid",
    "timeline",
    `    title ${slug} — evolution`,
  ]

  for (const [quarter, items] of quarters) {
    lines.push(`    section ${quarter}`)
    for (const item of items.slice(0, 4)) {
      lines.push(`        ${item.label} : ${item.source}`)
    }
  }

  lines.push("```", "")
  return lines.join("\n")
}

// ── Change frequency heatmap ─────────────────────────────────────────

export function changeFrequency(ctx: DocContext): string {
  const fileCounts = new Map<string, number>()

  for (const file of ctx.files) {
    const name = file.filePath.split("/").pop() ?? file.filePath
    fileCounts.set(name, file.commits.length)
  }

  if (fileCounts.size < 2) return ""

  // Sort by commit count descending, take top 10
  const sorted = [...fileCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)

  // Skip if all files have 0 commits
  if (sorted.every(([, c]) => c === 0)) return ""

  const maxVal = Math.max(...sorted.map(([, c]) => c), 5)

  const lines = [
    "",
    "## 📊 Change frequency",
    "",
    "```mermaid",
    "xychart-beta",
    '  title "Commits per file (recent history)"',
    `  x-axis [${sorted.map(([f]) => `"${f}"`).join(", ")}]`,
    `  y-axis "Commits" 0 --> ${maxVal}`,
    `  bar [${sorted.map(([, c]) => c).join(", ")}]`,
    "```",
    "",
  ]

  return lines.join("\n")
}

// ── Complexity signal ────────────────────────────────────────────────

type FileComplexity = {
  name: string
  decisions: number
  commits: number
  risk: "🔴 High" | "🟡 Medium" | "🟢 Low"
}

function countFileDecisions(commits: FileCommit[]): number {
  let count = 0
  for (const c of commits) {
    if (c.prNumber) count++
    if (/\b(fix|incident|hotfix|revert|breaking)\b/i.test(c.message)) count++
  }
  return count
}

export function complexitySignal(ctx: DocContext): string {
  const files: FileComplexity[] = []

  for (const file of ctx.files) {
    const name = file.filePath.split("/").pop() ?? file.filePath
    const decisions = countFileDecisions(file.commits)
    const commits = file.commits.length
    const risk =
      decisions >= 5
        ? ("🔴 High" as const)
        : decisions >= 2
          ? ("🟡 Medium" as const)
          : ("🟢 Low" as const)
    files.push({ name, decisions, commits, risk })
  }

  if (files.length < 2) return ""
  if (files.every((f) => f.decisions === 0)) return ""

  // Sort by decisions descending
  files.sort((a, b) => b.decisions - a.decisions)
  const top = files.slice(0, 10)
  const maxVal = Math.max(...top.map((f) => f.decisions), 3)

  const lines = [
    "",
    "## 🎯 Complexity signal",
    "",
    "```mermaid",
    "xychart-beta",
    '  title "Decision density — context required to modify safely"',
    `  x-axis [${top.map((f) => `"${f.name}"`).join(", ")}]`,
    `  y-axis "Decisions + incidents" 0 --> ${maxVal}`,
    `  bar [${top.map((f) => f.decisions).join(", ")}]`,
    "```",
    "",
    "| File | Decisions | Commits | Risk to modify |",
    "|------|:---------:|:-------:|:--------------:|",
  ]

  for (const f of top) {
    lines.push(`| \`${f.name}\` | ${f.decisions} | ${f.commits} | ${f.risk} |`)
  }

  lines.push("")
  return lines.join("\n")
}

// ── Dependency risk map ──────────────────────────────────────────────

export function dependencyRiskMap(
  graph: DependencyGraph,
  docSources: string[],
): string {
  // Find files in this doc's sources that have dependencies
  const relevant = new Map<string, string[]>()
  const consumers = new Map<string, string[]>() // reverse: who depends on me

  for (const [file, deps] of graph) {
    if (docSources.some((s) => file.startsWith(s.replace(/[/*]+$/, "")))) {
      relevant.set(file, deps)
    }
    for (const dep of deps) {
      if (!consumers.has(dep)) consumers.set(dep, [])
      consumers.get(dep)!.push(file)
    }
  }

  if (relevant.size === 0) return ""

  const lines = ["", "## 🔗 Dependency map", "", "```mermaid", "flowchart TD"]

  const nodeId = (path: string) =>
    path
      .replace(/[^a-zA-Z0-9]/g, "_")
      .replace(/_+/g, "_")
      .slice(0, 40)

  const shortName = (path: string) => path.split("/").pop() ?? path

  const added = new Set<string>()

  for (const [file, deps] of relevant) {
    const id = nodeId(file)
    if (!added.has(id)) {
      lines.push(`    ${id}["${shortName(file)}"]`)
      added.add(id)
    }
    for (const dep of deps) {
      if (dep === file) continue // skip self-references
      const depId = nodeId(dep)
      if (!added.has(depId)) {
        lines.push(`    ${depId}["${shortName(dep)}"]`)
        added.add(depId)
      }
      lines.push(`    ${id} --> ${depId}`)
    }
  }

  // Show upstream consumers
  for (const [file] of relevant) {
    const upstreams = consumers.get(file) ?? []
    for (const up of upstreams.slice(0, 5)) {
      if (relevant.has(up)) continue // already in the graph
      const upId = nodeId(up)
      if (!added.has(upId)) {
        lines.push(`    ${upId}["${shortName(up)}"]`)
        added.add(upId)
      }
      lines.push(`    ${upId} -.-> ${nodeId(file)}`)
    }
  }

  // Style the main module files
  for (const [file] of relevant) {
    lines.push(
      `    style ${nodeId(file)} fill:#f0f0ff,stroke:#8250df,stroke-width:2px`,
    )
  }

  lines.push("```", "")
  return lines.join("\n")
}

// ── Module health summary ────────────────────────────────────────────

export function moduleHealthSummary(
  ctx: DocContext,
  graph: DependencyGraph,
): string {
  const totalCommits = ctx.files.reduce((s, f) => s + f.commits.length, 0)

  // Bus factor
  const sorted = [...ctx.authors].sort((a, b) => b.percentage - a.percentage)
  const busFactor = computeBusFactorFromPercentages(sorted)

  // Blast radius: count upstream consumers
  let upstreamCount = 0
  for (const [file] of ctx.files.map((f) => [f.filePath])) {
    for (const [, deps] of graph) {
      if (deps.includes(file as string)) upstreamCount++
    }
  }

  // Change frequency
  const changeLabel =
    totalCommits > 20 ? "🟡 Hot" : totalCommits > 5 ? "— Normal" : "🟢 Quiet"

  // Bus factor indicator
  const bfLabel = busFactor <= 1 ? "🔴" : busFactor <= 2 ? "🟡" : "🟢"

  // Decision coverage
  const filesWithDecisions = ctx.files.filter(
    (f) => f.commits.some((c) => c.prNumber) || f.pullRequests.length > 0,
  ).length
  const coveragePct =
    ctx.files.length > 0
      ? Math.round((filesWithDecisions / ctx.files.length) * 100)
      : 0

  // Confidence based on data richness
  const confidence =
    ctx.pullRequests.length >= 5
      ? "High"
      : ctx.pullRequests.length >= 2
        ? "Medium"
        : "Low"
  const confLabel =
    confidence === "High" ? "🟢" : confidence === "Medium" ? "🟡" : "🔴"

  const lines = [
    "",
    "## 📋 Module health",
    "",
    "| Metric | Value | |",
    "|--------|-------|:-:|",
    `| Decision coverage | ${filesWithDecisions}/${ctx.files.length} (${coveragePct}%) | ${coveragePct >= 80 ? "🟢" : coveragePct >= 50 ? "🟡" : "🔴"} |`,
    `| Bus factor | ${busFactor} | ${bfLabel} |`,
    `| PRs referenced | ${ctx.pullRequests.length} | |`,
    `| Tickets linked | ${ctx.tickets.length} | |`,
    `| Change frequency | ${totalCommits} commits | ${changeLabel} |`,
    `| Blast radius | ${upstreamCount} upstream consumers | ${upstreamCount > 3 ? "🟡" : "🟢"} |`,
    `| Confidence | ${confidence} (${ctx.pullRequests.length} PRs, ${ctx.tickets.length} tickets) | ${confLabel} |`,
    "",
  ]

  return lines.join("\n")
}

// ── Recent activity feed ─────────────────────────────────────────────

export function recentActivity(ctx: DocContext): string {
  type Activity = { date: string; event: string; who: string; detail: string }
  const activities: Activity[] = []

  // PRs
  for (const pr of ctx.pullRequests) {
    const commit = ctx.files
      .flatMap((f) => f.commits)
      .find((c) => c.prNumber === pr.number)
    activities.push({
      date: commit?.date ?? "",
      event: "PR merged",
      who: pr.author,
      detail: `#${pr.number} — ${pr.title.slice(0, 50)}`,
    })
  }

  // Recent commits not tied to PRs
  const allCommits = ctx.files
    .flatMap((f) => f.commits)
    .filter((c) => !c.prNumber)
    .sort((a, b) => b.date.localeCompare(a.date))

  for (const c of allCommits.slice(0, 10)) {
    if (c.message.length < 10) continue
    activities.push({
      date: c.date,
      event: "Commit",
      who: c.author,
      detail: c.message.slice(0, 50),
    })
  }

  if (activities.length === 0) return ""

  activities.sort((a, b) => b.date.localeCompare(a.date))
  const top = activities.slice(0, 10)

  const lines = [
    "",
    "## 🕐 Recent activity",
    "",
    "| Date | Event | Who | Detail |",
    "|------|-------|-----|--------|",
  ]

  for (const a of top) {
    lines.push(`| ${a.date} | ${a.event} | ${a.who} | ${a.detail} |`)
  }

  lines.push("")
  return lines.join("\n")
}

// ── Knowledge transfer checklist ─────────────────────────────────────

export function knowledgeTransfer(ctx: DocContext, docName: string): string {
  // Only generate when bus factor is 1
  if (ctx.authors.length === 0) return ""

  const topAuthor = ctx.authors[0]!
  const secondAuthor = ctx.authors[1]

  // Bus factor > 1 if second author has ≥20%
  if (secondAuthor && secondAuthor.percentage >= 20) return ""

  const slug = docName.replace(/\.md$/i, "")
  const prCount = ctx.pullRequests.length
  const ticketCount = ctx.tickets.length

  const items: string[] = []
  items.push(`- [ ] Read this wiki page fully (15 min)`)

  if (prCount > 0) {
    const keyPR = ctx.pullRequests[0]!
    items.push(
      `- [ ] Read PR #${keyPR.number} — "${keyPR.title.slice(0, 50)}" for design rationale (10 min)`,
    )
  }

  if (ticketCount > 0) {
    items.push(
      `- [ ] Review linked tickets for business context (${ticketCount} tickets, 15 min)`,
    )
  }

  items.push(`- [ ] Trace the main code path through the module (30 min)`)

  // Check for non-obvious patterns (commits with "fix", "revert", "workaround")
  const tricky = ctx.files
    .flatMap((f) => f.commits)
    .filter((c) => /\b(fix|workaround|hack|revert|hotfix)\b/i.test(c.message))
  if (tricky.length > 0) {
    items.push(
      `- [ ] Understand ${tricky.length} workaround(s) — search for "fix"/"workaround" in git log (15 min)`,
    )
  }

  items.push(
    `- [ ] Pair with ${topAuthor.name} on one PR touching this module (1-2 hours)`,
  )
  items.push(
    `- [ ] Make one small change with ${topAuthor.name} reviewing (half day)`,
  )

  const totalMin =
    15 +
    (prCount > 0 ? 10 : 0) +
    (ticketCount > 0 ? 15 : 0) +
    30 +
    (tricky.length > 0 ? 15 : 0)
  const totalHours = Math.ceil(totalMin / 60)

  const lines = [
    "",
    "## 🎓 Knowledge transfer checklist",
    "",
    `> ⚠️ **Bus factor is 1.** ${topAuthor.name} holds ${topAuthor.percentage}% of context for ${slug}.`,
    "",
    ...items,
    "",
    `**Estimated time to reach bus factor 2:** ~${totalHours} hour(s) of focused work + 1 PR`,
    "",
  ]

  return lines.join("\n")
}

// ── Master function: generate all applicable sections ────────────────

export type VisualizationInput = {
  ctx: DocContext
  graph: DependencyGraph
  docName: string
  docSources: string[]
}

export function generateVisualizations(input: VisualizationInput): string {
  const { ctx, graph, docName, docSources } = input

  const sections = [
    moduleHealthSummary(ctx, graph),
    decisionTimeline(ctx, docName),
    changeFrequency(ctx),
    complexitySignal(ctx),
    dependencyRiskMap(graph, docSources),
    recentActivity(ctx),
    knowledgeTransfer(ctx, docName),
  ]

  const content = sections.filter(Boolean).join("\n")
  if (!content) return ""

  return `\n\n---\n\n<!-- Auto-generated visualizations from git history. Do not edit. -->\n${content}`
}
