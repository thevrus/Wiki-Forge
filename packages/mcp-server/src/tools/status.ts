import type { WikiFile, WikiSource } from "../sources"

type ModuleStats = {
  name: string
  path: string
  decisions: number
  contributors: Map<string, { commits: number; lastActive: string }>
  busFactor: number
  riskLevel: "critical" | "moderate" | "low"
}

type RecentDecision = {
  date: string
  module: string
  summary: string
  source: string
}

/** Parse frontmatter contributors block. */
function parseContributors(
  content: string,
): Map<string, { commits: number; lastActive: string }> {
  const map = new Map<string, { commits: number; lastActive: string }>()
  const blocks = content.matchAll(
    /- name: "([^"]+)"\n\s+commits: (\d+)\n\s+last_active: "([^"]+)"/g,
  )
  for (const m of blocks) {
    map.set(m[1]!, { commits: Number(m[2]), lastActive: m[3]! })
  }
  return map
}

/** Count decision references in a wiki page. */
function countDecisions(content: string): number {
  let count = 0
  const patterns = [
    /\bPR\s*#\d+/gi,
    /\b[A-Z][A-Z0-9]+-\d+\b/g,
    /\bdecision\b/gi,
    /\bchose\b/gi,
    /\brationale\b/gi,
    /\btrade-?off\b/gi,
  ]
  for (const p of patterns) {
    const m = content.match(p)
    if (m) count += m.length
  }
  return count
}

/** Strip YAML frontmatter from markdown. */
function stripFrontmatter(content: string): string {
  if (!content.startsWith("---")) return content
  const end = content.indexOf("---", 3)
  if (end === -1) return content
  return content.slice(end + 3)
}

/** Extract recent decision-like sentences from wiki body (not frontmatter). */
function extractDecisions(
  content: string,
  moduleName: string,
): RecentDecision[] {
  const body = stripFrontmatter(content)
  const decisions: RecentDecision[] = []

  for (const line of body.split("\n")) {
    const prMatch = line.match(/PR\s*#(\d+)/)
    const ticketMatch = line.match(/\b([A-Z][A-Z0-9]+-\d+)\b/)
    if (!prMatch && !ticketMatch) continue
    // skip tables, code blocks, headings
    if (
      line.startsWith("|") ||
      line.startsWith("---") ||
      line.startsWith("```")
    )
      continue
    // skip lines that look like raw YAML or metadata
    if (/^\s*(id|summary|key|name):\s/.test(line)) continue

    const source = prMatch ? `PR #${prMatch[1]}` : ticketMatch![0]
    const summary = line
      .replace(/^[-*•]\s*/, "")
      .replace(/`[^`]+`/g, (m) => m.slice(1, -1)) // unwrap backticks
      .trim()
      .slice(0, 120)

    if (summary.length > 15) {
      decisions.push({ date: "", module: moduleName, summary, source })
    }
  }

  return decisions.slice(0, 5)
}

/** Analyze all wiki files for a source. */
function analyzeFiles(files: WikiFile[]): {
  modules: ModuleStats[]
  totalPages: number
  pagesWithDecisions: number
  totalDecisions: number
  allContributors: Map<string, { commits: number; lastActive: string }>
  recentDecisions: RecentDecision[]
} {
  const modules: ModuleStats[] = []
  const allContributors = new Map<
    string,
    { commits: number; lastActive: string }
  >()
  const recentDecisions: RecentDecision[] = []
  let totalPages = 0
  let pagesWithDecisions = 0
  let totalDecisions = 0

  for (const file of files) {
    if (
      file.path.startsWith("_") ||
      file.path === "INDEX.md" ||
      file.path === "llms.txt" ||
      file.path === "log.md" ||
      file.path.startsWith("entities/") ||
      file.path.startsWith("concepts/")
    ) {
      continue
    }

    totalPages++
    const decisions = countDecisions(file.content)
    if (decisions > 0) pagesWithDecisions++
    totalDecisions += decisions

    const contributors = parseContributors(file.content)
    for (const [name, data] of contributors) {
      const existing = allContributors.get(name)
      if (existing) {
        existing.commits += data.commits
        if (data.lastActive > existing.lastActive)
          existing.lastActive = data.lastActive
      } else {
        allContributors.set(name, { ...data })
      }
    }

    // Compute bus factor
    const totalCommits = [...contributors.values()].reduce(
      (s, c) => s + c.commits,
      0,
    )
    let accum = 0
    let busFactor = 0
    const sorted = [...contributors.entries()].sort(
      (a, b) => b[1].commits - a[1].commits,
    )
    for (const [, data] of sorted) {
      accum += data.commits
      busFactor++
      if (totalCommits > 0 && accum / totalCommits >= 0.5) break
    }

    const riskLevel: "critical" | "moderate" | "low" =
      busFactor <= 1 && decisions === 0
        ? "critical"
        : busFactor <= 1 || decisions === 0
          ? "moderate"
          : "low"

    const moduleName = file.path.replace(/\.md$/, "")
    modules.push({
      name: moduleName,
      path: file.path,
      decisions,
      contributors,
      busFactor,
      riskLevel,
    })

    recentDecisions.push(...extractDecisions(file.content, moduleName))
  }

  return {
    modules,
    totalPages,
    pagesWithDecisions,
    totalDecisions,
    allContributors,
    recentDecisions: recentDecisions.slice(0, 15),
  }
}

/** Render the full status report with charts. */
function renderReport(
  sourceName: string,
  multiRepo: boolean,
  analysis: ReturnType<typeof analyzeFiles>,
): string {
  const {
    modules,
    totalPages,
    pagesWithDecisions,
    totalDecisions,
    allContributors,
    recentDecisions,
  } = analysis
  const coverage =
    totalPages > 0 ? Math.round((pagesWithDecisions / totalPages) * 100) : 0
  const lines: string[] = []

  if (multiRepo) lines.push(`# ${sourceName}`, "")

  // ── Overview table ────────────────────────────────────────────────
  lines.push(
    "## \ud83e\udde0 Brain Health",
    "",
    "| Metric | Value |",
    "|--------|-------|",
    `| Compiled pages | **${totalPages}** |`,
    `| With decision context | **${pagesWithDecisions}** (${coverage}%) |`,
    `| Total decision references | **${totalDecisions}** |`,
    `| Contributors tracked | **${allContributors.size}** |`,
    "",
  )

  // ── Decision coverage bar chart ───────────────────────────────────
  if (modules.length >= 2) {
    lines.push(
      "## \ud83d\udcca Decision coverage by module",
      "",
      "```mermaid",
      "xychart-beta",
      '  title "Decisions per module"',
      `  x-axis [${modules.map((m) => `"${m.name}"`).join(", ")}]`,
      `  y-axis "Decisions" 0 --> ${Math.max(...modules.map((m) => m.decisions), 5)}`,
      `  bar [${modules.map((m) => m.decisions).join(", ")}]`,
      "```",
      "",
    )
  }

  // ── Knowledge risk quadrant chart ─────────────────────────────────
  if (modules.length >= 2) {
    const maxBf = Math.max(...modules.map((m) => m.busFactor), 1)
    lines.push(
      "## \u26a0\ufe0f Knowledge risk map",
      "",
      "```mermaid",
      "quadrantChart",
      "    title Knowledge risk by module",
      '    x-axis "Low decision coverage" --> "High decision coverage"',
      '    y-axis "Low bus factor" --> "High bus factor"',
      '    quadrant-1 "Safe"',
      '    quadrant-2 "Needs decisions"',
      '    quadrant-3 "Critical risk"',
      '    quadrant-4 "Needs distribution"',
    )
    for (const mod of modules) {
      const x =
        mod.decisions > 0 ? Math.min(mod.decisions / 5, 1) * 0.8 + 0.15 : 0.05
      const y = maxBf > 0 ? (mod.busFactor / (maxBf + 1)) * 0.8 + 0.1 : 0.1
      const slug = mod.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/-+$/, "")
      lines.push(`    ${slug}: [${x.toFixed(2)}, ${y.toFixed(2)}]`)
    }
    lines.push("```", "")
  }

  // ── Risk tables ───────────────────────────────────────────────────
  const critical = modules.filter((m) => m.riskLevel === "critical")
  const moderate = modules.filter((m) => m.riskLevel === "moderate")

  if (critical.length > 0) {
    lines.push(
      "## \ud83d\udea8 Critical risk modules",
      "",
      "| Module | Bus factor | Primary owner | Decisions |",
      "|--------|:---------:|---------------|:---------:|",
    )
    for (const mod of critical) {
      const sorted = [...mod.contributors.entries()].sort(
        (a, b) => b[1].commits - a[1].commits,
      )
      const owner = sorted[0]
        ? `${sorted[0][0]} (${sorted[0][1].commits} commits)`
        : "—"
      lines.push(
        `| ${mod.name} | **${mod.busFactor}** | ${owner} | ${mod.decisions} |`,
      )
    }
    lines.push("")
  }

  if (moderate.length > 0) {
    lines.push(
      "## \ud83d\udfe1 Moderate risk modules",
      "",
      "| Module | Bus factor | Decisions |",
      "|--------|:---------:|:---------:|",
    )
    for (const mod of moderate) {
      lines.push(`| ${mod.name} | **${mod.busFactor}** | ${mod.decisions} |`)
    }
    lines.push("")
  }

  // ── Team context distribution (pie chart) ─────────────────────────
  if (allContributors.size >= 2) {
    const sortedTeam = [...allContributors.entries()].sort(
      (a, b) => b[1].commits - a[1].commits,
    )
    lines.push(
      "## \ud83d\udc65 Team context distribution",
      "",
      "```mermaid",
      "pie title Commit distribution across team",
    )
    for (const [name, data] of sortedTeam.slice(0, 10)) {
      lines.push(`    "${name}" : ${data.commits}`)
    }
    lines.push("```", "")

    lines.push(
      "| Engineer | Commits | Last active |",
      "|----------|:-------:|-------------|",
    )
    for (const [name, data] of sortedTeam) {
      lines.push(`| ${name} | ${data.commits} | ${data.lastActive} |`)
    }
    lines.push("")
  }

  // ── Recent decisions ──────────────────────────────────────────────
  if (recentDecisions.length > 0) {
    lines.push(
      "## \ud83d\udcdd Recent decisions",
      "",
      "| Module | Decision | Source |",
      "|--------|----------|--------|",
    )
    for (const d of recentDecisions.slice(0, 10)) {
      lines.push(`| ${d.module} | ${d.summary} | ${d.source} |`)
    }
    lines.push("")
  }

  // ── Action items ──────────────────────────────────────────────────
  const actions: string[] = []

  if (coverage < 50) {
    actions.push(
      "Run `wiki-forge compile --ingest` to enrich pages with decision context from git history and PRs.",
    )
  }
  for (const mod of critical) {
    const sorted = [...mod.contributors.entries()].sort(
      (a, b) => b[1].commits - a[1].commits,
    )
    const owner = sorted[0]?.[0] ?? "unknown"
    actions.push(
      `**${mod.name}** — bus factor 1, ${owner} holds all context. Schedule a pairing session.`,
    )
  }

  if (actions.length > 0) {
    lines.push("## \u2705 Action items", "")
    for (const a of actions) {
      lines.push(`- ${a}`)
    }
    lines.push("")
  }

  return lines.join("\n")
}

export async function handleStatus(sources: WikiSource[]): Promise<string> {
  const sections: string[] = []

  for (const source of sources) {
    // Try to read the pre-compiled _status.md first (has LLM-generated narrative)
    const statusContent = await source.read("_status.md")
    if (statusContent) {
      if (sources.length > 1) {
        sections.push(`# ${source.name}\n\n${statusContent}`)
      } else {
        sections.push(statusContent)
      }
      continue
    }

    // Fallback: compute stats from wiki files with charts and risk analysis
    const files = await source.list()
    if (files.length === 0) {
      sections.push(
        sources.length > 1
          ? `# ${source.name}\n\nNo compiled wiki pages found.`
          : "No compiled wiki pages found. Run `wiki-forge compile` to generate.",
      )
      continue
    }

    const analysis = analyzeFiles(files)
    sections.push(renderReport(source.name, sources.length > 1, analysis))
  }

  return sections.join("\n\n---\n\n")
}
