import { readFileSync, writeFileSync } from "node:fs"
import pc from "picocolors"
import type { DocEntry } from "./config"
import { loadDocMap, resolveConfig } from "./config"
import type { Contributor, TicketReference } from "./git"
import {
  getCurrentCommit,
  getDiffForFiles,
  getDirectoryAuthors,
  getLastSyncCommit,
  getTicketsForPaths,
} from "./git"
import {
  computeDocHashes,
  diffHashes,
  hashContent,
  loadHashes,
  saveHashes,
  updateHashesForDoc,
} from "./hashes"
import { DOC_CONCURRENCY_CLOUD, DOC_CONCURRENCY_OLLAMA, SOURCE_MIN_USEFUL, STUFF_THRESHOLD } from "./constants"
import { buildDependencyGraph, serializeDependencyGraph } from "./dependency-graph"
import { loadSummaryCache, saveSummaryCache, type SummaryCache } from "./summary-cache"
import { generateIndex, generateLlmsTxt } from "./indexer"
import * as log from "./logger"
import { createProviders } from "./providers"
import type { LLMProvider, ProviderConfig } from "./providers/types"
import type { GatherResult } from "./sources"
import { gatherFullSource } from "./sources"
import { validateCompiledOutput } from "./validate-output"
import { verifyDocClaims } from "./verify-claims"
import { appendCompilationLog, generateWiki } from "./wiki"

// ── Types ──────────────────────────────────────────────────────────────

export type OrchestrateOptions = {
  repoRoot: string
  docsDir?: string
  provider: ProviderConfig
  forceRecompile: boolean
  skipWiki: boolean
  mode: "check" | "compile" | "health"
}

export type OrchestrateResult = {
  updatedDocs: string[]
  healthIssues: Array<{ doc: string; issues: string[] }>
  triageResults: Array<{ doc: string; drifted: boolean; reason: string }>
  docDiffs: Array<{ doc: string; before: string; after: string }>
}

// ── One-shot example ──────────────────────────────────────────────────

const ONE_SHOT_EXAMPLE = `
EXAMPLE of good output (for reference — do NOT copy this content, write about the actual code):

---
title: "Booking System"
slug: booking-system
category: compiled
description: "Appointment scheduling, availability checks, and cancellation rules"
compiled_at: "2026-04-07T00:00:00Z"
---

The booking system handles appointment scheduling for pet grooming and veterinary services. Customers select a service, pick an available time slot, and confirm the booking. Staff can view and manage appointments through an admin dashboard.

## Business Rules & Logic

### Cancellation Policy
- Customers can cancel up to 24 hours before the appointment at no charge
- Cancellations within 24 hours incur a 50% fee (\`LATE_CANCEL_FEE_PCT = 0.5\`)
- No-shows are charged the full amount
- Staff can waive fees via the admin panel (requires \`manager\` role)

### Availability
- Time slots are 30 minutes (\`SLOT_DURATION_MIN = 30\`)
- Maximum 3 concurrent appointments per location
- Blocked dates are configured in \`HOLIDAY_BLACKOUT_DATES\`

## Data Model & Entities

- **Appointment**: customerId, serviceId, locationId, startTime, status (pending → confirmed → completed | cancelled | no-show)
- **Service**: name, durationMinutes, price, category
- **Location**: name, address, timezone, maxConcurrent
`.trim()

// ── Style guide ───────────────────────────────────────────────────────

const DEFAULT_STYLE = `
ACCURACY RULES (non-negotiable):
- ONLY state facts that are directly observable in the provided source code.
- NEVER guess, infer, or assume functionality that isn't in the code. If unsure, omit the claim.
- NEVER invent feature names, API endpoints, data fields, or behaviors.
- Precision over completeness. A short, accurate doc beats a long, hallucinated one.
- NEVER include a section unless you have real facts to put in it. If a section would be empty, DO NOT include it at all — no placeholders, no "no data available", no italicized notes. Just skip the section.

PURPOSE: This document is the BRAIN of the business — not just a tech overview.
Write for a mixed audience: engineers, PMs, designers, QA, new hires, and CEO.
Every section should answer: "What would someone new to this company need to know?"

SECTION MENU — pick from these based on what the source code actually contains. Only include sections you can fill with real content:

- "Product Overview" — What the product does. Who it's for. Core value prop.
- "User Flows & Screens" — Screens/routes the user can reach. Key user journeys.
- "Business Rules & Logic" — THE MOST IMPORTANT when present. Pricing, validation, feature flags, rate limits, state machines, permissions. Look in: constants, validators, middleware, hooks, config, enums, error messages.
- "Data Model & Entities" — Key entities, relationships, fields. In plain language.
- "Architecture & Tech Stack" — Services, packages, APIs, how they connect.
- "Integrations & External Services" — Third-party services, webhooks, data flows.
- "Key Decisions & Context" — Ticket references from git history explaining WHY things were built.

A document with 2 rich sections is far better than 7 empty ones. Write only what you know.

DEPTH RULES:
- Every claim must cite a specific thing from the code: a function name, constant, route, type, hook, or config key.
- "The system handles scheduling" is USELESS. "Users book calls via the /schedule/[petId] route, which renders a multi-step wizard (flea-tick-wizard.tsx)" is USEFUL.
- Name the actual functions, components, constants, types, routes, hooks, and config keys you see in the source code.
- If you cannot name specific things from the code, the section is empty — omit it entirely.

DO NOT restate contributor names, commit counts, or ticket lists as body content — those are already in the YAML frontmatter. The body should contain facts derived from the SOURCE CODE, not from git metadata.

FRONTMATTER: Every doc MUST start with YAML frontmatter:
\`\`\`yaml
---
title: "Human-readable page title"
slug: url-safe-lowercase-slug
category: compiled
icon: emoji
description: "One-sentence summary"
compiled_at: "ISO timestamp"
---
\`\`\`

FORMATTING:
- Open with a 2-3 sentence summary paragraph
- Use ## for major sections, ### for subsections
- No raw code snippets or function signatures
- Use bullet lists for rules/constraints, tables for comparisons
- Each section should be independently readable

DIAGRAMS: Include Mermaid diagrams where they clarify:
- Architecture: flowchart showing services/components
- User flows: sequenceDiagram showing request paths
- State machines: stateDiagram-v2 for lifecycle states
Only include diagrams that add clarity.

CITATIONS: When stating a specific fact from source code, add (source: module name) in parentheses. Use plain-language names, not file paths.
`.trim()

// ── Prompts ────────────────────────────────────────────────────────────

function noSourcesMessage(entry: DocEntry): string {
  return `No source files found for sources: ${entry.sources.join(", ")}. Check that these directories exist.`
}

function recompilePrompt(
  entry: DocEntry,
  currentDoc: string,
  diff: string,
  contextCode: string,
  style: string,
  authorContext: string,
  domain?: string,
): string {
  const timestamp = new Date().toISOString()
  return [
    "You are a documentation compiler. Update the existing document to reflect the code changes.",
    ...(domain ? [`Domain context: ${domain}`] : []),
    "ONLY state facts directly visible in the source code or diff. NEVER guess or infer behavior not shown.",
    "Preserve the document's structure. Only modify sections affected by the changes.",
    "Update the compiled_at timestamp in frontmatter. Preserve all other frontmatter fields (title, slug, category, icon, contributors).",
    "Return ONLY the updated markdown content — no preamble, no fencing.",
    "",
    style,
    "",
    `COMPILE TARGET:`,
    entry.description,
    `Sources: ${entry.sources.join(", ")}`,
    `Timestamp: ${timestamp}`,
    "",
    `## Current documentation`,
    currentDoc,
    "",
    `## Code diff since last sync`,
    diff || "(no diff)",
    "",
    `## Relevant source code`,
    contextCode || "(no context)",
    authorContext,
  ].join("\n")
}

// ── Hierarchical summarization ────────────────────────────────────────

/** Max bytes per batch when grouping small files together. */
const BATCH_SIZE = 25_000

type FileBatch = { label: string; content: string }

/** Group small files into batches; large files stay solo. */
function batchFiles(files: Array<{ path: string; content: string }>): FileBatch[] {
  const batches: FileBatch[] = []
  let currentPaths: string[] = []
  let currentChunks: string[] = []
  let currentSize = 0

  for (const f of files) {
    const chunk = `--- ${f.path} ---\n${f.content}`
    if (currentSize + chunk.length > BATCH_SIZE && currentChunks.length > 0) {
      batches.push({
        label: currentPaths.length === 1 ? currentPaths[0]! : `${currentPaths.length} files`,
        content: currentChunks.join("\n\n"),
      })
      currentPaths = []
      currentChunks = []
      currentSize = 0
    }
    currentPaths.push(f.path)
    currentChunks.push(chunk)
    currentSize += chunk.length
  }
  if (currentChunks.length > 0) {
    batches.push({
      label: currentPaths.length === 1 ? currentPaths[0]! : `${currentPaths.length} files`,
      content: currentChunks.join("\n\n"),
    })
  }
  return batches
}

function summarizeBatchPrompt(batch: FileBatch, description: string, domain?: string): string {
  return [
    `Extract facts from the source code below for: ${description}`,
    ...(domain ? [`Domain: ${domain}`] : []),
    "ONLY include facts visible in the code. Be exhaustive and SPECIFIC:",
    "- Name every exported function, hook, component, class, and type",
    "- Name every route, endpoint, and navigation path",
    "- Name every constant, config key, feature flag, and validation rule",
    "- Name every external service, API call, and integration",
    "- 'The system handles X' is NOT a fact. 'handleBooking() in booking.ts creates an Appointment with status pending' IS a fact.",
    "",
    batch.content,
    "",
    "Output structured bullet points. Group by: Business Rules, User Flows, Data Model, Integrations, Architecture.",
  ].join("\n")
}

/** Run promises with a concurrency limit. */
async function asyncPool<T>(
  concurrency: number,
  items: T[],
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let i = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      await fn(items[idx]!, idx)
    }
  })
  await Promise.all(workers)
}

async function summarizeHierarchically(
  files: Array<{ path: string; content: string }>,
  description: string,
  triageProvider: LLMProvider,
  concurrency: number,
  domain?: string,
  onProgress?: (done: number, total: number) => void,
  summaryCache?: SummaryCache,
): Promise<{ text: string; cacheUpdated: boolean }> {
  const batches = batchFiles(files)
  const summaries: string[] = new Array(batches.length)
  let cacheUpdated = false

  await asyncPool(concurrency, batches, async (batch, idx) => {
    // Check summary cache by content hash
    const contentHash = hashContent(batch.content)
    if (summaryCache?.[contentHash]) {
      summaries[idx] = summaryCache[contentHash]
      onProgress?.(idx + 1, batches.length)
      return
    }

    const prompt = summarizeBatchPrompt(batch, description, domain)
    summaries[idx] = await triageProvider.generate(prompt)

    // Store in cache
    if (summaryCache) {
      summaryCache[contentHash] = summaries[idx]!
      cacheUpdated = true
    }
    onProgress?.(idx + 1, batches.length)
  })

  const text = summaries.filter(Boolean).map((s, i) => {
    return `### ${batches[i]!.label}\n${s}`
  }).join("\n\n")

  return { text, cacheUpdated }
}

function fullRecompileSystem(style: string, domain?: string): string {
  return [
    "You are a documentation compiler. You write knowledge base documents from structured fact summaries.",
    ...(domain ? [`Domain context: ${domain}`] : []),
    "ONLY include facts from the summary. NEVER add information not in the summary.",
    "If a section has no supporting data, OMIT it entirely. Never write placeholder text.",
    "NEVER suggest improvements, process changes, templates, or recommendations. ONLY document what exists.",
    "Return ONLY the markdown document starting with --- frontmatter. No preamble, no code fences.",
    "",
    style,
    "",
    ONE_SHOT_EXAMPLE,
  ].join("\n")
}

function fullRecompilePrompt(
  entry: DocEntry,
  currentDoc: string,
  summary: string,
  authorContext: string,
  depGraph?: string,
): string {
  const timestamp = new Date().toISOString()
  return [
    `COMPILE TARGET:`,
    entry.description,
    `Sources: ${entry.sources.join(", ")}`,
    `Timestamp: ${timestamp}`,
    "",
    `## Current documentation (for structural reference)`,
    currentDoc || "(new document — create from scratch)",
    "",
    `## Source code summary (structured facts extracted from code)`,
    summary,
    authorContext,
    ...(depGraph ? ["", depGraph] : []),
    "",
    "Now write the complete knowledge base document. Start with the --- frontmatter block.",
  ].join("\n")
}

/** JSON schema for Ollama structured output on health checks. */
const HEALTH_CHECK_FORMAT = {
  type: "object",
  properties: {
    healthy: { type: "boolean" },
    issues: { type: "array", items: { type: "string" } },
  },
  required: ["healthy", "issues"],
}

function healthCheckPrompt(
  entry: DocEntry,
  currentDoc: string,
  sourceCode: string,
  domain?: string,
): string {
  return [
    "You are a documentation accuracy checker.",
    ...(domain ? [`Domain context: ${domain}`] : []),
    "Compare the documentation against the source code and identify issues.",
    "Focus on statements that a product manager might rely on that are now wrong.",
    "",
    "Check for:",
    "- Factual errors: features described that no longer exist or work differently",
    "- Missing information: significant new features or rules not covered",
    "- Stale numbers: limits, fees, defaults, or thresholds that changed",
    "- Broken flows: user flows or state transitions that no longer match the code",
    "",
    "Respond with a JSON object (no markdown fencing):",
    '{ "healthy": true/false, "issues": ["specific issue 1", "specific issue 2"] }',
    "",
    `COMPILE TARGET:`,
    entry.description,
    "",
    `## Current documentation`,
    currentDoc,
    "",
    `## Source code`,
    sourceCode,
  ].join("\n")
}

// ── Author context ────────────────────────────────────────────────────

function formatAuthorContext(contributors: Contributor[]): string {
  if (contributors.length === 0) return ""
  const lines = contributors
    .slice(0, 10)
    .map(
      (c) => `- ${c.name}: ${c.commits} commits (last active: ${c.lastActive})`,
    )
  return [
    "",
    "## Contributors (from git history)",
    "The following people have made the most commits to this area of the codebase:",
    ...lines,
    "DO NOT list contributors in the body — they are already in the YAML frontmatter. Only mention a person if they are directly relevant to a technical decision.",
  ].join("\n")
}

function formatTicketContext(tickets: TicketReference[]): string {
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

function buildTicketsFrontmatter(tickets: TicketReference[]): string {
  if (tickets.length === 0) return ""
  const entries = tickets
    .slice(0, 15)
    .map(
      (t) =>
        `  - id: "${t.ticket}"\n    summary: "${t.message.replace(/"/g, '\\"').slice(0, 100)}"`,
    )
  return `related_tickets:\n${entries.join("\n")}`
}

function buildContributorsFrontmatter(contributors: Contributor[]): string {
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
function injectContributorsFrontmatter(
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

function injectTicketsFrontmatter(
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

/** Fill in missing required frontmatter fields from the doc-map entry. */
function backfillFrontmatter(
  doc: string,
  docPath: string,
  entry: DocEntry,
): string {
  // Ensure frontmatter block exists
  if (!doc.startsWith("---")) {
    doc = `---\n---\n\n${doc}`
  }

  const closingIdx = doc.indexOf("---", 3)
  if (closingIdx === -1) return doc

  const fm = doc.slice(4, closingIdx)
  const after = doc.slice(closingIdx)
  const lines = fm.split("\n")

  const has = (key: string) => lines.some((l) => l.match(new RegExp(`^${key}\\s*:`)))

  const slug = docPath
    .replace(/\.md$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")

  const title = docPath
    .replace(/\.md$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())

  const additions: string[] = []
  if (!has("title")) additions.push(`title: "${title}"`)
  if (!has("slug")) additions.push(`slug: ${slug}`)
  if (!has("category")) additions.push(`category: compiled`)
  if (!has("description")) additions.push(`description: "${entry.description}"`)
  if (!has("compiled_at")) additions.push(`compiled_at: "${new Date().toISOString()}"`)

  if (additions.length === 0) return doc

  const before = `---\n${fm.trimEnd()}\n${additions.join("\n")}\n`
  return `${before}${after}`
}

// ── Helpers ────────────────────────────────────────────────────────────

function readDocFile(docPath: string): string {
  try {
    return readFileSync(docPath, "utf-8")
  } catch {
    return ""
  }
}

function parseHealthResponse(raw: string): {
  healthy: boolean
  issues: string[]
} {
  try {
    const cleaned = raw
      .replace(/```json?\s*/g, "")
      .replace(/```/g, "")
      .trim()
    const parsed = JSON.parse(cleaned)
    return {
      healthy: Boolean(parsed.healthy),
      issues: Array.isArray(parsed.issues) ? parsed.issues.map(String) : [],
    }
  } catch {
    return { healthy: false, issues: ["Could not parse health check response"] }
  }
}

// ── Orchestrator ───────────────────────────────────────────────────────

export async function orchestrate(
  options: OrchestrateOptions,
): Promise<OrchestrateResult> {
  // Clean exit on Ctrl+C
  const onSigint = () => {
    console.log("\n\n  Interrupted. Already-compiled docs are saved.\n")
    process.exit(130)
  }
  process.on("SIGINT", onSigint)

  const { repoRoot, docsDir, forceRecompile, mode } = options

  const config = resolveConfig(repoRoot, docsDir)

  let docMap: ReturnType<typeof loadDocMap>
  try {
    docMap = loadDocMap(config.docMapPath)
  } catch {
    throw new Error(
      `No doc map found at ${config.docMapPath}. Run 'wiki-forge init' first.`,
    )
  }
  const providers = createProviders(options.provider)
  const styleGuide = docMap.style ?? DEFAULT_STYLE
  const domain = docMap.domain
  const singlePass = options.provider.provider === "local"
  const triageConcurrency = options.provider.provider === "ollama" ? 1 : 5
  const MAX_ATTEMPTS = 2

  const lastSync = getLastSyncCommit(config.lastSyncPath, repoRoot)
  const currentCommit = getCurrentCommit(repoRoot)

  // File-level hashing for precise drift detection
  let allHashes = loadHashes(config.docsDir)

  const result: OrchestrateResult = {
    updatedDocs: [],
    healthIssues: [],
    triageResults: [],
    docDiffs: [],
  }

  const entries = Object.entries(docMap.docs)

  // Load summary cache for triage reuse
  const summaryCache: SummaryCache = loadSummaryCache(config.docsDir)
  let summaryCacheDirty = false

  // ── Phase 1: Health checks (sequential — lightweight) ──────────────
  for (const [docPath, entry] of entries) {
    if (!entry || entry.type !== "health-check") continue
    if (mode !== "compile" && mode !== "health") continue

    const fullDocPath = docPath.startsWith("/")
      ? docPath
      : `${config.docsDir}/${docPath}`
    const currentDoc = readDocFile(fullDocPath)
    const spinner = log.spin(`Health-checking ${docPath}`)
    const issues = await runHealthCheck(
      entry,
      currentDoc,
      repoRoot,
      providers.triage,
      domain,
    )
    spinner.stop()
    if (issues.length > 0) {
      result.healthIssues.push({ doc: docPath, issues })
      log.warn(`${docPath} — ${issues.length} issue(s)`)
    } else {
      log.success(`${docPath} — healthy`)
    }
  }

  // ── Phase 2: Triage — determine which compiled docs need work ──────
  type CompileJob = {
    docPath: string
    entry: DocEntry
    fullDocPath: string
    currentDoc: string
    currentHashes: Record<string, string>
    hashDiff: ReturnType<typeof diffHashes>
  }
  const compileJobs: CompileJob[] = []

  for (const [docPath, entry] of entries) {
    if (!entry || entry.type !== "compiled") continue

    const fullDocPath = docPath.startsWith("/")
      ? docPath
      : `${config.docsDir}/${docPath}`
    const currentDoc = readDocFile(fullDocPath)

    const currentHashes = computeDocHashes(
      entry.sources,
      entry.context_files,
      repoRoot,
    )
    const previousHashes = allHashes[docPath] ?? {}
    const hashDiff = diffHashes(previousHashes, currentHashes)
    const hasChanges = forceRecompile || hashDiff.changed

    if (!hasChanges) {
      log.skip(`${docPath} — no changes`)
      result.triageResults.push({
        doc: docPath,
        drifted: false,
        reason: "No source files changed",
      })
      continue
    }

    if (mode === "check") {
      const delta = [
        ...hashDiff.changedFiles.map((f) => `modified: ${f}`),
        ...hashDiff.addedFiles.map((f) => `added: ${f}`),
        ...hashDiff.removedFiles.map((f) => `removed: ${f}`),
      ]
      const reason =
        delta.length > 0
          ? `${delta.length} file(s) changed: ${delta.slice(0, 3).join(", ")}${delta.length > 3 ? "..." : ""}`
          : "Force check"
      log.drift(`${docPath} — ${reason}`)
      result.triageResults.push({ doc: docPath, drifted: true, reason })
      continue
    }

    compileJobs.push({ docPath, entry, fullDocPath, currentDoc, currentHashes, hashDiff })
  }

  // ── Phase 3: Compile in parallel ───────────────────────────────────
  const docConcurrency = singlePass
    ? 1
    : options.provider.provider === "ollama"
      ? DOC_CONCURRENCY_OLLAMA
      : DOC_CONCURRENCY_CLOUD

  const compileTotal = compileJobs.length
  const tracker = log.createCompileTracker(compileTotal)

  await asyncPool(docConcurrency, compileJobs, async (job) => {
    const { docPath, entry, fullDocPath, currentDoc, currentHashes, hashDiff } = job

    if (forceRecompile) {
      const handle = tracker.start(docPath, "Gathering...")
      const gather = gatherFullSource(entry, repoRoot)
      if (gather.content === "") {
        handle.fail(`${docPath} — ${noSourcesMessage(entry)}`)
        return
      }
      if (gather.totalSize < SOURCE_MIN_USEFUL) {
        handle.fail(`${docPath} — only ${gather.totalSize} bytes of source (need ${SOURCE_MIN_USEFUL}+), skipping`)
        result.triageResults.push({
          doc: docPath,
          drifted: false,
          reason: `Skipped: insufficient source (${gather.totalSize} bytes)`,
        })
        return
      }
      if (gather.totalSize > 200_000) {
        log.warn(
          `${docPath} source is ${Math.round(gather.totalSize / 1024)}KB — consider splitting into smaller docs for better output quality`,
        )
      }
      handle.update(`Compiling ${docPath}`, gatherDetail(gather))
      const t0 = Date.now()

      let updated = ""
      let validation = validateCompiledOutput("")
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (attempt > 1) {
          handle.update(`Retrying ${docPath} (attempt ${attempt})`, gatherDetail(gather))
        }
        const { doc: raw, cacheUpdated } = await runFullRecompile(
          entry,
          currentDoc,
          gather,
          repoRoot,
          styleGuide,
          singlePass,
          providers.triage,
          providers.compile,
          domain,
          triageConcurrency,
          (phase, detail) => handle.update(`${docPath} — ${phase}`, detail ?? gatherDetail(gather)),
          summaryCache,
        )
        if (cacheUpdated) summaryCacheDirty = true
        updated = backfillFrontmatter(raw, docPath, entry)
        validation = validateCompiledOutput(updated)
        if (validation.valid) break
        if (attempt < MAX_ATTEMPTS) {
          log.warn(`${docPath} — rejected (${validation.warnings[0]}), retrying...`)
        }
      }

      const elapsedSec = (Date.now() - t0) / 1000
      const elapsed = elapsedSec.toFixed(1)
      if (!validation.valid) {
        handle.fail(`${docPath} — rejected`)
        for (const w of validation.warnings) log.warn(w)
        result.triageResults.push({
          doc: docPath,
          drifted: true,
          reason: `Rejected: ${validation.warnings[0]}`,
        })
      } else {
        handle.succeed(`${docPath} ${pc.dim(`(${elapsed}s)`)}`)
        log.gatherWarnings(gather.truncatedFiles)
        if (validation.warnings.length > 0) {
          for (const w of validation.warnings) log.warn(w)
        }
        // Verify backtick-quoted claims against source code
        const claims = verifyDocClaims(validation.cleaned, gather.content)
        if (claims.total > 0 && claims.score < 0.5) {
          log.warn(`${docPath} — ${claims.unverified.length}/${claims.total} code references not found in source: ${claims.unverified.slice(0, 5).join(", ")}`)
        }
        writeFileSync(fullDocPath, `${validation.cleaned}\n`)
        result.updatedDocs.push(docPath)
        result.docDiffs.push({
          doc: docPath,
          before: currentDoc,
          after: validation.cleaned,
        })
        result.triageResults.push({
          doc: docPath,
          drifted: true,
          reason: "Force recompile",
        })
      }
      allHashes = updateHashesForDoc(allHashes, docPath, currentHashes)
      saveHashes(config.docsDir, allHashes)
    } else if (currentDoc && currentDoc.split(/^##\s+/m).length > 1 && currentDoc.length > 500) {
      // Diff-only recompile: send previous doc + git diff (not full source)
      // Only use diff path if existing doc is substantial enough to update.
      const affectedFiles = [...hashDiff.changedFiles, ...hashDiff.addedFiles]
      const nChanged = affectedFiles.length + hashDiff.removedFiles.length
      const handle = tracker.start(docPath, `${nChanged} changed`)
      const t0 = Date.now()

      let updated = ""
      let validation = validateCompiledOutput("")
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (attempt > 1) {
          handle.update(`Retrying ${docPath} (attempt ${attempt})`, `${nChanged} changed`)
        }
        const raw = await runDiffRecompile(
          entry,
          currentDoc,
          affectedFiles,
          repoRoot,
          lastSync,
          styleGuide,
          providers.compile,
          domain,
        )
        updated = backfillFrontmatter(raw, docPath, entry)
        validation = validateCompiledOutput(updated)
        if (validation.valid) break
        if (attempt < MAX_ATTEMPTS) {
          log.warn(`${docPath} — rejected (${validation.warnings[0]}), retrying...`)
        }
      }

      const elapsedSec = (Date.now() - t0) / 1000
      const elapsed = elapsedSec.toFixed(1)
      if (!validation.valid) {
        handle.fail(`${docPath} — rejected`)
        for (const w of validation.warnings) log.warn(w)
        result.triageResults.push({
          doc: docPath,
          drifted: true,
          reason: `Rejected: ${validation.warnings[0]}`,
        })
      } else {
        handle.succeed(`${docPath} ${pc.dim(`(${elapsed}s)`)}`)
        if (validation.warnings.length > 0) {
          for (const w of validation.warnings) log.warn(w)
        }
        writeFileSync(fullDocPath, `${validation.cleaned}\n`)
        result.updatedDocs.push(docPath)
        result.docDiffs.push({
          doc: docPath,
          before: currentDoc,
          after: validation.cleaned,
        })
        result.triageResults.push({
          doc: docPath,
          drifted: true,
          reason: `${nChanged} file(s) changed`,
        })
      }
      allHashes = updateHashesForDoc(allHashes, docPath, currentHashes)
      saveHashes(config.docsDir, allHashes)
    } else {
      // Existing doc is too thin for diff updates — do a full recompile instead
      const handle = tracker.start(docPath, "Full recompile (existing doc too thin)")
      const gather = gatherFullSource(entry, repoRoot)
      if (gather.content === "") {
        handle.fail(`${docPath} — ${noSourcesMessage(entry)}`)
        allHashes = updateHashesForDoc(allHashes, docPath, currentHashes)
        saveHashes(config.docsDir, allHashes)
        return
      }
      if (gather.totalSize < SOURCE_MIN_USEFUL) {
        handle.fail(`${docPath} — only ${gather.totalSize} bytes of source, skipping`)
        result.triageResults.push({ doc: docPath, drifted: false, reason: `Skipped: insufficient source (${gather.totalSize} bytes)` })
        allHashes = updateHashesForDoc(allHashes, docPath, currentHashes)
        saveHashes(config.docsDir, allHashes)
        return
      }
      handle.update(`Compiling ${docPath}`, gatherDetail(gather))
      const t0 = Date.now()

      let updated = ""
      let validation = validateCompiledOutput("")
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (attempt > 1) {
          handle.update(`Retrying ${docPath} (attempt ${attempt})`, gatherDetail(gather))
        }
        const { doc: raw, cacheUpdated } = await runFullRecompile(
          entry, currentDoc, gather, repoRoot, styleGuide, singlePass,
          providers.triage, providers.compile, domain, triageConcurrency,
          (phase, detail) => handle.update(`${docPath} — ${phase}`, detail ?? gatherDetail(gather)),
          summaryCache,
        )
        if (cacheUpdated) summaryCacheDirty = true
        updated = backfillFrontmatter(raw, docPath, entry)
        validation = validateCompiledOutput(updated)
        if (validation.valid) break
        if (attempt < MAX_ATTEMPTS) {
          log.warn(`${docPath} — rejected (${validation.warnings[0]}), retrying...`)
        }
      }

      const elapsedSec = (Date.now() - t0) / 1000
      const elapsed = elapsedSec.toFixed(1)
      if (!validation.valid) {
        handle.fail(`${docPath} — rejected`)
        for (const w of validation.warnings) log.warn(w)
        result.triageResults.push({ doc: docPath, drifted: true, reason: `Rejected: ${validation.warnings[0]}` })
      } else {
        handle.succeed(`${docPath} ${pc.dim(`(${elapsed}s)`)}`)
        log.gatherWarnings(gather.truncatedFiles)
        if (validation.warnings.length > 0) {
          for (const w of validation.warnings) log.warn(w)
        }
        const claims = verifyDocClaims(validation.cleaned, gather.content)
        if (claims.total > 0 && claims.score < 0.5) {
          log.warn(`${docPath} — ${claims.unverified.length}/${claims.total} code references not found in source: ${claims.unverified.slice(0, 5).join(", ")}`)
        }
        writeFileSync(fullDocPath, `${validation.cleaned}\n`)
        result.updatedDocs.push(docPath)
        result.docDiffs.push({ doc: docPath, before: currentDoc, after: validation.cleaned })
        result.triageResults.push({ doc: docPath, drifted: true, reason: "Full recompile (existing doc too thin)" })
      }
      allHashes = updateHashesForDoc(allHashes, docPath, currentHashes)
      saveHashes(config.docsDir, allHashes)
    }
  })

  tracker.destroy()

  // Persist hashes, summary cache, and .last-sync (only in compile mode)
  if (mode === "compile") {
    saveHashes(config.docsDir, allHashes)
    if (summaryCacheDirty) {
      saveSummaryCache(config.docsDir, summaryCache)
    }
    if (currentCommit) {
      writeFileSync(config.lastSyncPath, `${currentCommit}\n`)
    }
  }

  // Post-compilation: wiki pages, index, and log
  if (mode === "compile") {
    let wikiResult = { entities: 0, concepts: 0 }

    if (!options.skipWiki) {
      let spinner = log.spin("Extracting entities & concepts")
      wikiResult = await generateWiki(
        config.docsDir,
        docMap,
        providers.triage,
        repoRoot,
      )
      spinner.stop()
      if (wikiResult.entities > 0 || wikiResult.concepts > 0) {
        log.success(
          `${wikiResult.entities} entities, ${wikiResult.concepts} concepts`,
        )
      }

      spinner = log.spin("Generating INDEX.md")
      await generateIndex(config.docsDir, docMap, providers.triage, repoRoot)
      spinner.stop()
      log.success("INDEX.md")

      generateLlmsTxt(config.docsDir, docMap, domain)
      log.success("llms.txt")
    } else {
      log.skip("Wiki extraction (--skip-wiki)")
    }

    appendCompilationLog(config.docsDir, {
      updatedDocs: result.updatedDocs,
      healthIssues: result.healthIssues,
      wiki: wikiResult,
    })
    log.success("log.md")
  }

  process.removeListener("SIGINT", onSigint)
  return result
}

// ── Pipeline steps ─────────────────────────────────────────────────────

/** Diff-only recompile: sends previous doc + git diff instead of full source */
async function runDiffRecompile(
  entry: DocEntry,
  currentDoc: string,
  changedFiles: string[],
  repoRoot: string,
  lastSync: string,
  style: string,
  compileProvider: LLMProvider,
  domain?: string,
): Promise<string> {
  const diff = getDiffForFiles(lastSync, changedFiles, repoRoot)
  const contributors = getDirectoryAuthors(entry.sources, repoRoot)
  const tickets = getTicketsForPaths(entry.sources, repoRoot)
  const authorContext = formatAuthorContext(contributors)
  const ticketContext = formatTicketContext(tickets)
  const prompt = recompilePrompt(
    entry,
    currentDoc,
    diff,
    "",
    style,
    `${authorContext}\n${ticketContext}`,
    domain,
  )
  const result = await compileProvider.generate(prompt)
  return `${injectTicketsFrontmatter(injectContributorsFrontmatter(result.trim(), contributors), tickets)}\n`
}

function gatherDetail(gather: GatherResult): string {
  return log.gatherSummary(
    gather.fileCount,
    gather.totalSize,
    gather.skippedByPriority,
  )
}

function singlePassSystem(style: string, domain?: string): string {
  return [
    "You are a documentation compiler. You receive source code and produce a knowledge base document.",
    ...(domain ? [`Domain context: ${domain}`] : []),
    "This document is the BRAIN of the business — cover business rules, user flows, data models, AND architecture.",
    "Dig deep into constants, validation, feature flags, pricing, permissions, state machines, error handling.",
    "ONLY state facts directly visible in the source code. NEVER guess or assume. If a section has no supporting data, OMIT it entirely.",
    "",
    style,
    "",
    ONE_SHOT_EXAMPLE,
    "",
    "IMPORTANT: Write DOCUMENTATION, not a code review.",
    "Describe what the code DOES. Do NOT suggest what it SHOULD do.",
    "NEVER write suggestions, recommendations, improvements, or best practices.",
    "Return ONLY the markdown document starting with --- frontmatter. No preamble, no code fences.",
  ].join("\n")
}

function singlePassPrompt(
  entry: DocEntry,
  currentDoc: string,
  sourceCode: string,
  authorContext: string,
  depGraph?: string,
): string {
  const timestamp = new Date().toISOString()
  return [
    `COMPILE TARGET:`,
    entry.description,
    `Sources: ${entry.sources.join(", ")}`,
    `Timestamp: ${timestamp}`,
    "",
    `## Current documentation (for structural reference)`,
    currentDoc || "(new document — create from scratch)",
    "",
    `## Source code`,
    sourceCode,
    authorContext,
    ...(depGraph ? ["", depGraph] : []),
    "",
    "Now write the complete knowledge base document. Start with the --- frontmatter block.",
  ].join("\n")
}

async function runFullRecompile(
  entry: DocEntry,
  currentDoc: string,
  gather: GatherResult,
  repoRoot: string,
  style: string,
  singlePass: boolean,
  triageProvider: LLMProvider,
  compileProvider: LLMProvider,
  domain?: string,
  concurrency = 1,
  onProgress?: (phase: string, detail?: string) => void,
  summaryCache?: SummaryCache,
): Promise<{ doc: string; cacheUpdated: boolean }> {
  const contributors = getDirectoryAuthors(entry.sources, repoRoot)
  const tickets = getTicketsForPaths(entry.sources, repoRoot)
  const authorContext = formatAuthorContext(contributors)
  const ticketContext = formatTicketContext(tickets)
  const combinedContext = `${authorContext}\n${ticketContext}`

  // Build dependency graph from gathered files
  const graph = buildDependencyGraph(gather.files)
  const depGraph = serializeDependencyGraph(graph)

  let result: string
  let cacheUpdated = false

  // Stuffing fast-path: if source fits in a single context window, skip triage
  const useStuffing = !singlePass && gather.totalSize <= STUFF_THRESHOLD

  if (singlePass || useStuffing) {
    if (useStuffing) onProgress?.("Compiling (single-pass)")
    const system = singlePassSystem(style, domain)
    const prompt = singlePassPrompt(
      entry,
      currentDoc,
      gather.content,
      combinedContext,
      depGraph,
    )
    result = await compileProvider.generate(prompt, system)
  } else {
    // Hierarchical summarization: per-file/batch summaries → compile
    const summaryResult = await summarizeHierarchically(
      gather.files,
      entry.description,
      triageProvider,
      concurrency,
      domain,
      (done, total) => onProgress?.(`Summarizing ${done}/${total}`, `${done}/${total} batches`),
      summaryCache,
    )
    cacheUpdated = summaryResult.cacheUpdated
    onProgress?.("Compiling from summaries")
    const system = fullRecompileSystem(style, domain)
    const prompt = fullRecompilePrompt(
      entry,
      currentDoc,
      summaryResult.text,
      combinedContext,
      depGraph,
    )
    result = await compileProvider.generate(prompt, system)
  }

  const withContributors = injectContributorsFrontmatter(
    result.trim(),
    contributors,
  )
  return { doc: `${injectTicketsFrontmatter(withContributors, tickets)}\n`, cacheUpdated }
}

async function runHealthCheck(
  entry: DocEntry,
  currentDoc: string,
  repoRoot: string,
  triageProvider: LLMProvider,
  domain?: string,
): Promise<string[]> {
  const gather = gatherFullSource(entry, repoRoot)
  if (gather.content === "") {
    return [noSourcesMessage(entry)]
  }
  const prompt = healthCheckPrompt(entry, currentDoc, gather.content, domain)
  const raw = await triageProvider.generate(prompt, undefined, {
    format: HEALTH_CHECK_FORMAT,
  })
  const { healthy, issues } = parseHealthResponse(raw)
  return healthy ? [] : issues
}
