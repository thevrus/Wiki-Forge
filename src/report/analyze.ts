import { execSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { DocMap } from "../config"
import { listFiles } from "../file-glob"
import { type Contributor, getDirectoryAuthors } from "../git"
import { summarizeTelemetry } from "../telemetry/usage"
import { computeBusFactor, docPathToTitle } from "../utils"

// ── Types ─────────────────────────────────────────────────────────────

export type ModuleAnalysis = {
  name: string
  docPath: string
  sources: string[]
  busFactor: number
  primaryOwner: { name: string; percentage: number } | null
  authors: AuthorBreakdown[]
  totalCommits: number
  lastActive: string // YYYY-MM-DD or "" if no history
  decisions: DecisionInfo[]
  decisionCoverage: number // 0-1
  riskLevel: "critical" | "moderate" | "low"
}

export type AuthorBreakdown = {
  name: string
  commits: number
  percentage: number
  lastActive: string
}

export type DecisionInfo = {
  summary: string
  source: string // e.g. "PR #923, ACME-456"
  module: string
  author: string
  date: string
}

export type TeamMember = {
  name: string
  modulesOwned: string[] // modules where they have >50% commits
  modulesTouched: string[]
  totalDecisions: number
  totalCommits: number
  lastActive: string
  status: "active" | "inactive" // inactive = no commits in 30+ days
}

export type CoverageGap = {
  file: string
  commits: number
  issue: string
  suggestedFix: string
}

export type OrphanedDoc = {
  docPath: string
  sources: string[]
}

export type ReportData = {
  generatedAt: string
  modules: ModuleAnalysis[]
  team: TeamMember[]
  recentDecisions: DecisionInfo[]
  coverageGaps: CoverageGap[]
  orphanedDocs: OrphanedDoc[]
  totals: {
    documentableFiles: number
    compiledPages: number
    withDecisions: number
    withoutDecisions: number
    totalDecisions: number
    incidentsReferenced: number
    adrsLinked: number
  }
  compilationStats: {
    totalCompiles: number
    averageCost: string
    totalCost: string
  } | null
}

// ── Module analysis ───────────────────────────────────────────────────

function computeAuthorBreakdowns(
  contributors: Contributor[],
): AuthorBreakdown[] {
  const total = contributors.reduce((sum, c) => sum + c.commits, 0)
  if (total === 0) return []

  return contributors.map((c) => ({
    name: c.name,
    commits: c.commits,
    percentage: Math.round((c.commits / total) * 100),
    lastActive: c.lastActive,
  }))
}

// ── Decision extraction ───────────────────────────────────────────────

const DECISION_HEADING =
  /^###?\s+.*(?:decision|chose|decided|rationale|why\s+we|trade-?off)/im
const BUSINESS_RULE_HEADING =
  /^###?\s+.*(?:business\s+rule|pricing|validation|permission|cancellation|policy)/im
const ADR_REF = /\bADR[- ]?\d+\b/gi
const PR_REF = /(?:#|PR\s*#?)(\d+)/g
const TICKET_REF = /\b[A-Z][A-Z0-9]+-\d+\b/g
const INCIDENT_REF = /\b(?:incident|outage|postmortem|post-mortem)\b/gi

type DocDecisions = {
  decisions: DecisionInfo[]
  adrsLinked: number
  incidentsReferenced: number
}

function extractDecisions(
  docContent: string,
  moduleName: string,
): DocDecisions {
  const decisions: DecisionInfo[] = []
  let adrsLinked = 0
  let incidentsReferenced = 0

  // Count ADRs
  const adrMatches = docContent.match(ADR_REF)
  if (adrMatches)
    adrsLinked = new Set(adrMatches.map((m) => m.toUpperCase())).size

  // Count incidents
  const incidentMatches = docContent.match(INCIDENT_REF)
  if (incidentMatches) incidentsReferenced = incidentMatches.length

  const lines = docContent.split("\n")
  let inDecisionSection = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!

    if (DECISION_HEADING.test(line) || BUSINESS_RULE_HEADING.test(line)) {
      inDecisionSection = true
      continue
    }

    // Exit decision section on next ## heading
    if (inDecisionSection && /^##\s+/.test(line)) {
      inDecisionSection = false
      continue
    }

    if (!inDecisionSection) continue

    // Extract decision bullets
    if (/^[-*]\s+/.test(line) && line.length > 20) {
      const summary = line.replace(/^[-*]\s+/, "").trim()
      const sources: string[] = []

      const prs = [...summary.matchAll(PR_REF)].map((m) => `#${m[1]}`)
      const tickets = [...summary.matchAll(TICKET_REF)]
      sources.push(...prs, ...tickets.map((m) => m[0]))

      // Look for author in parenthetical
      const authorMatch = summary.match(/\((?:by\s+)?([A-Z][a-z]+ [A-Z]\.?)\)/)

      decisions.push({
        summary: summary.slice(0, 120),
        source: sources.join(", ") || "inline",
        module: moduleName,
        author: authorMatch?.[1] ?? "",
        date: "",
      })
    }
  }

  // Also extract inline ticket references with explanatory context
  // Pattern: "X was added because/after/per TICKET-123"
  const inlineDecisions = docContent.matchAll(
    /(?:added|changed|moved|switched|created|introduced|removed)\s+.*?\b(?:because|after|per|due to|for)\s+.*?([A-Z][A-Z0-9]+-\d+|#\d+)/gi,
  )
  for (const match of inlineDecisions) {
    const sentence = match[0].slice(0, 120)
    const ticket = match[1]!
    if (!decisions.some((d) => d.summary.includes(ticket))) {
      decisions.push({
        summary: sentence,
        source: ticket,
        module: moduleName,
        author: "",
        date: "",
      })
    }
  }

  return { decisions, adrsLinked, incidentsReferenced }
}

// ── Git-based PR extraction ───────────────────────────────────────────

type CommitInfo = {
  sha: string
  author: string
  date: string
  message: string
  prNumber?: number
  files: string[]
}

function getRecentCommits(
  repoRoot: string,
  days: number,
  paths?: string[],
): CommitInfo[] {
  try {
    const pathArgs = paths ? paths.map((p) => `"${p}"`).join(" ") : ""
    const pathClause = pathArgs ? ` -- ${pathArgs}` : ""
    const output = execSync(
      `git log --since="${days} days ago" --format="COMMIT|%H|%aN|%aI|%s" --name-only${pathClause}`,
      { encoding: "utf-8", cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 },
    ).trim()

    if (!output) return []

    const commits: CommitInfo[] = []
    let current: CommitInfo | null = null

    for (const line of output.split("\n")) {
      if (line.startsWith("COMMIT|")) {
        if (current) commits.push(current)
        const parts = line.slice(7).split("|")
        const message = parts.slice(3).join("|")
        const prMatch = message.match(/\(#(\d+)\)/)
        current = {
          sha: parts[0]!,
          author: parts[1]!,
          date: (parts[2] ?? "").slice(0, 10),
          message,
          prNumber: prMatch ? Number(prMatch[1]) : undefined,
          files: [],
        }
      } else if (current && line.trim()) {
        current.files.push(line.trim())
      }
    }
    if (current) commits.push(current)

    return commits
  } catch {
    return []
  }
}

// ── Compilation stats from log.md ─────────────────────────────────────

function parseCompilationStats(
  docsDir: string,
): ReportData["compilationStats"] {
  const logPath = join(docsDir, "log.md")
  if (!existsSync(logPath)) return null

  try {
    const content = readFileSync(logPath, "utf-8")
    const entries = content.split(/^##\s+/m).filter(Boolean)
    const totalCompiles = entries.length

    // Enrich with real cost from _telemetry.jsonl when available. Telemetry
    // counts days with recorded LLM calls as "runs" — close enough to
    // log.md's compile count for aggregate cost math.
    const telemetry = summarizeTelemetry(docsDir)
    if (telemetry && telemetry.runs > 0 && telemetry.costUSD > 0) {
      return {
        totalCompiles,
        averageCost: `$${(telemetry.costUSD / telemetry.runs).toFixed(4)}`,
        totalCost: `$${telemetry.costUSD.toFixed(2)}`,
      }
    }

    return {
      totalCompiles,
      averageCost: "—",
      totalCost: "—",
    }
  } catch {
    return null
  }
}

// ── Count source files matched by doc-map ─────────────────────────────

function countSourceFiles(docMap: DocMap, repoRoot: string): number {
  const allSources = new Set<string>()
  for (const entry of Object.values(docMap.docs)) {
    if (!entry || entry.type !== "compiled") continue
    for (const path of listFiles(entry.sources, repoRoot)) {
      allSources.add(path)
    }
  }
  return allSources.size
}

// ── Main analysis ─────────────────────────────────────────────────────

export function analyzeRepository(
  docsDir: string,
  docMap: DocMap,
  repoRoot: string,
): ReportData {
  const now = new Date().toISOString()
  const today = now.slice(0, 10)

  const modules: ModuleAnalysis[] = []
  let totalDecisions = 0
  let totalAdrs = 0
  let totalIncidents = 0
  let withDecisions = 0

  const teamMap = new Map<
    string,
    {
      commits: number
      decisions: number
      modules: Set<string>
      owned: Set<string>
      lastActive: string
    }
  >()

  const allDecisions: DecisionInfo[] = []
  const orphanedDocs: OrphanedDoc[] = []

  // Analyze each doc-map entry as a module
  const compiledEntries = Object.entries(docMap.docs).filter(
    ([, e]) => e != null && e.type === "compiled",
  )

  for (const [docPath, entry] of compiledEntries) {
    if (!entry) continue

    // Orphan detection: doc's declared sources no longer exist on disk.
    // We check `sources` specifically (not context_files) because sources
    // are the doc's subject. Only flag when the compiled doc file is still
    // present — if the doc itself was already removed, it's not "orphaned".
    const fullDocPath = join(docsDir, docPath)
    if (existsSync(fullDocPath) && entry.sources.length > 0) {
      const matchedSources = listFiles(entry.sources, repoRoot)
      if (matchedSources.length === 0) {
        orphanedDocs.push({ docPath, sources: entry.sources })
        continue
      }
    }

    const moduleName = docPathToTitle(docPath)
    const contributors = getDirectoryAuthors(entry.sources, repoRoot)
    const busFactor = computeBusFactor(contributors)
    const authorBreakdowns = computeAuthorBreakdowns(contributors)
    const totalCommits = contributors.reduce((sum, c) => sum + c.commits, 0)

    const primaryOwner =
      authorBreakdowns.length > 0
        ? {
            name: authorBreakdowns[0]!.name,
            percentage: authorBreakdowns[0]!.percentage,
          }
        : null

    const lastActive =
      contributors.length > 0
        ? contributors.reduce(
            (latest, c) => (c.lastActive > latest ? c.lastActive : latest),
            "",
          )
        : ""

    // Read compiled doc for decision analysis
    let docDecisions: DocDecisions = {
      decisions: [],
      adrsLinked: 0,
      incidentsReferenced: 0,
    }

    if (existsSync(fullDocPath)) {
      const docContent = readFileSync(fullDocPath, "utf-8")
      docDecisions = extractDecisions(docContent, moduleName)
    }

    const decisionCount = docDecisions.decisions.length
    totalDecisions += decisionCount
    totalAdrs += docDecisions.adrsLinked
    totalIncidents += docDecisions.incidentsReferenced
    if (decisionCount > 0) withDecisions++

    allDecisions.push(...docDecisions.decisions)

    // Determine risk level
    let riskLevel: ModuleAnalysis["riskLevel"] = "low"
    if (busFactor <= 1 && decisionCount === 0) {
      riskLevel = "critical"
    } else if (busFactor <= 1 || decisionCount === 0) {
      riskLevel = "moderate"
    }

    // Inactive primary owner escalates risk
    if (primaryOwner && lastActive && lastActive < daysAgo(today, 30)) {
      if (riskLevel === "moderate") riskLevel = "critical"
      else if (riskLevel === "low") riskLevel = "moderate"
    }

    modules.push({
      name: moduleName,
      docPath,
      sources: entry.sources,
      busFactor,
      primaryOwner,
      authors: authorBreakdowns,
      totalCommits,
      lastActive,
      decisions: docDecisions.decisions,
      decisionCoverage:
        compiledEntries.length > 0 ? decisionCount / compiledEntries.length : 0,
      riskLevel,
    })

    // Aggregate team data
    for (const author of authorBreakdowns) {
      const existing = teamMap.get(author.name)
      if (existing) {
        existing.commits += author.commits
        existing.modules.add(moduleName)
        if (author.percentage > 50) existing.owned.add(moduleName)
        if (author.lastActive > existing.lastActive) {
          existing.lastActive = author.lastActive
        }
      } else {
        teamMap.set(author.name, {
          commits: author.commits,
          decisions: 0,
          modules: new Set([moduleName]),
          owned: author.percentage > 50 ? new Set([moduleName]) : new Set(),
          lastActive: author.lastActive,
        })
      }
    }
  }

  // Attribute decisions to team members
  for (const decision of allDecisions) {
    if (decision.author) {
      const member = teamMap.get(decision.author)
      if (member) member.decisions++
    }
  }

  // Build team list
  const team: TeamMember[] = Array.from(teamMap.entries())
    .map(([name, data]) => ({
      name,
      modulesOwned: Array.from(data.owned),
      modulesTouched: Array.from(data.modules),
      totalDecisions: data.decisions,
      totalCommits: data.commits,
      lastActive: data.lastActive,
      status: (data.lastActive >= daysAgo(today, 30)
        ? "active"
        : "inactive") as TeamMember["status"],
    }))
    .sort((a, b) => b.totalCommits - a.totalCommits)

  // Build coverage gaps
  const coverageGaps: CoverageGap[] = []
  for (const mod of modules) {
    if (mod.decisions.length === 0 && mod.totalCommits > 5) {
      const issue =
        mod.busFactor <= 1
          ? "Single owner, no decisions documented"
          : "No decisions documented"
      const suggestedFix =
        mod.busFactor <= 1 && mod.primaryOwner
          ? `Ask ${mod.primaryOwner.name} to review wiki page`
          : "Run `wf why --deep` to infer from commit history"
      coverageGaps.push({
        file: mod.sources.join(", "),
        commits: mod.totalCommits,
        issue,
        suggestedFix,
      })
    }
  }

  // Recent decisions (last 30 days) — enrich with dates from git
  const recentCommits = getRecentCommits(repoRoot, 30)
  const recentDecisions = allDecisions
    .map((d) => {
      // Try to find a date from recent commits matching the PR/ticket
      if (d.source) {
        const prMatch = d.source.match(/#(\d+)/)
        if (prMatch) {
          const commit = recentCommits.find(
            (c) => c.prNumber === Number(prMatch[1]),
          )
          if (commit) {
            return {
              ...d,
              date: commit.date,
              author: d.author || commit.author,
            }
          }
        }
      }
      return d
    })
    .filter((d) => d.date)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 15)

  const documentableFiles = countSourceFiles(docMap, repoRoot)

  return {
    generatedAt: now,
    modules,
    team,
    recentDecisions,
    coverageGaps,
    orphanedDocs,
    totals: {
      documentableFiles,
      compiledPages: compiledEntries.length,
      withDecisions,
      withoutDecisions: compiledEntries.length - withDecisions,
      totalDecisions,
      incidentsReferenced: totalIncidents,
      adrsLinked: totalAdrs,
    },
    compilationStats: parseCompilationStats(docsDir),
  }
}

// ── Weekly analysis ───────────────────────────────────────────────────

export type WeeklyData = {
  period: { start: string; end: string; weekNumber: number; year: number }
  commits: CommitInfo[]
  prsMerged: Array<{
    number: number
    title: string
    author: string
    module: string
    decisions: number
  }>
  engineerActivity: Array<{
    name: string
    prsMerged: number
    decisionsAuthored: number
    modulesTouched: string[]
    newModules: string[]
  }>
  current: ReportData
  previous: ReportData | null
}

export function analyzeWeek(
  docsDir: string,
  docMap: DocMap,
  repoRoot: string,
  days = 7,
): WeeklyData {
  const current = analyzeRepository(docsDir, docMap, repoRoot)
  const end = new Date()
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000)

  // Compute ISO week number
  const d = new Date(Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()))
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNumber = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  )

  const commits = getRecentCommits(repoRoot, days)

  // Group commits by PR number to identify merged PRs
  const prMap = new Map<
    number,
    { title: string; author: string; files: string[] }
  >()
  for (const commit of commits) {
    if (commit.prNumber) {
      const existing = prMap.get(commit.prNumber)
      if (existing) {
        existing.files.push(...commit.files)
      } else {
        prMap.set(commit.prNumber, {
          title: commit.message.replace(/\s*\(#\d+\)\s*$/, ""),
          author: commit.author,
          files: [...commit.files],
        })
      }
    }
  }

  // Map PRs to modules
  const prsMerged = Array.from(prMap.entries()).map(([number, pr]) => {
    const matchingModule = current.modules.find((mod) =>
      pr.files.some((f) => mod.sources.some((s) => f.startsWith(s))),
    )
    return {
      number,
      title: pr.title,
      author: pr.author,
      module: matchingModule?.name ?? "other",
      decisions: 0, // enriched later from current analysis
    }
  })

  // Engineer activity
  const engineerMap = new Map<
    string,
    { prs: Set<number>; modules: Set<string>; newModules: Set<string> }
  >()
  for (const commit of commits) {
    const existing = engineerMap.get(commit.author)
    if (existing) {
      if (commit.prNumber) existing.prs.add(commit.prNumber)
      for (const f of commit.files) {
        const mod = current.modules.find((m) =>
          m.sources.some((s) => f.startsWith(s)),
        )
        if (mod) existing.modules.add(mod.name)
      }
    } else {
      const prs = new Set<number>()
      const modules = new Set<string>()
      if (commit.prNumber) prs.add(commit.prNumber)
      for (const f of commit.files) {
        const mod = current.modules.find((m) =>
          m.sources.some((s) => f.startsWith(s)),
        )
        if (mod) modules.add(mod.name)
      }
      engineerMap.set(commit.author, { prs, modules, newModules: new Set() })
    }
  }

  const engineerActivity = Array.from(engineerMap.entries())
    .map(([name, data]) => ({
      name,
      prsMerged: data.prs.size,
      decisionsAuthored: current.recentDecisions.filter(
        (d) => d.author === name,
      ).length,
      modulesTouched: Array.from(data.modules),
      newModules: Array.from(data.newModules),
    }))
    .sort((a, b) => b.prsMerged - a.prsMerged)

  // Try to load previous status for delta comparison
  const previousPath = join(docsDir, "_reports", ".previous-status.json")
  let previous: ReportData | null = null
  if (existsSync(previousPath)) {
    try {
      previous = JSON.parse(readFileSync(previousPath, "utf-8"))
    } catch {
      // ignore
    }
  }

  return {
    period: {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
      weekNumber,
      year: end.getFullYear(),
    },
    commits,
    prsMerged,
    engineerActivity,
    current,
    previous,
  }
}

// ── Helpers ───────────────────────────────────────────────────────────

export function daysSince(dateStr: string): number {
  if (!dateStr) return 999
  const diff = Date.now() - new Date(dateStr).getTime()
  return Math.floor(diff / (24 * 60 * 60 * 1000))
}

function daysAgo(today: string, n: number): string {
  const d = new Date(today)
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}
