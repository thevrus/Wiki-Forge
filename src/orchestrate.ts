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
  loadHashes,
  saveHashes,
  updateHashesForDoc,
} from "./hashes"
import { generateIndex } from "./indexer"
import * as log from "./logger"
import { createProviders } from "./providers"
import type { LLMProvider, ProviderConfig } from "./providers/types"
import type { GatherResult } from "./sources"
import { gatherFullSource } from "./sources"
import { validateCompiledOutput } from "./validate-output"
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

// ── Style guide ───────────────────────────────────────────────────────

const DEFAULT_STYLE = `
ACCURACY RULES (non-negotiable):
- ONLY state facts that are directly observable in the provided source code.
- NEVER guess, infer, or assume functionality that isn't in the code. If you're unsure, omit the claim or write "[Insufficient source data]".
- NEVER invent feature names, API endpoints, data fields, or behaviors.
- Precision over completeness. A short, accurate doc beats a long, hallucinated one.

PURPOSE: This document is the BRAIN of the business — not just a tech overview.
Write for a mixed audience: engineers, PMs, designers, QA, new hires, and CEO.
Every section should answer: "What would someone new to this company need to know?"

REQUIRED SECTIONS (include all that apply, in this order):

## Product Overview
What the product does. Who it's for. Core value prop. In plain language.

## User Flows & Screens
Every screen, page, or route the user can reach. What they can do on each.
Map the user journey from entry to completion for key flows.

## Business Rules & Logic
This is the MOST IMPORTANT section. Extract every rule from the code:
- Pricing rules, tier limits, free vs paid boundaries
- Validation rules (what input is accepted/rejected, and why)
- Feature flags and what they gate
- Rate limits, quotas, caps
- Discount codes, promo logic, coupon rules
- Time-based rules (expiration, cooldowns, windows)
- State machine transitions (what can move from state A to state B)
- Permission checks (who can do what, role-based access)
Look in: constants files, validation functions, middleware, hooks, config objects, enums, error messages.

## Data Model & Entities
Key entities, their relationships, and what fields matter. In plain language.
What does a User/Customer/Pet/Order/Subscription look like?

## Architecture & Tech Stack
Services, packages, APIs, how they connect. Keep it concise — the business sections above are more important.

## Integrations & External Services
Third-party services, APIs, webhooks. What data flows in/out.

## Key Decisions & Context
Reference ticket numbers from git history to explain WHY things were built.
Link decisions to their business rationale when visible from code or commits.

FRONTMATTER: Every doc MUST start with YAML frontmatter:
\`\`\`yaml
---
title: "Human-readable page title"
slug: url-safe-lowercase-slug
category: compiled
icon: emoji
description: "One-sentence summary"
sources: ["src/services/", "src/api/"]
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
): string {
  const timestamp = new Date().toISOString()
  return [
    "You are a documentation compiler. Update the existing document to reflect the code changes.",
    "ONLY state facts directly visible in the source code or diff. NEVER guess or infer behavior not shown.",
    "Preserve the document's structure. Only modify sections affected by the changes.",
    "Update the compiled_at timestamp in frontmatter. Preserve all other frontmatter fields (title, slug, category, icon, contributors).",
    "Return ONLY the updated markdown content — no preamble, no fencing.",
    "",
    style,
    "",
    `## Document description`,
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

function summarizeSourcePrompt(entry: DocEntry, sourceCode: string): string {
  return [
    "You are a code analyst preparing a structured fact sheet for a documentation compiler.",
    "CRITICAL: ONLY extract facts directly visible in the source code. NEVER infer or guess.",
    "",
    "Extract EVERYTHING under these categories. Be exhaustive — this fact sheet is the brain of the business.",
    "",
    "## BUSINESS RULES (most important — dig deep):",
    "- Every constant, limit, cap, threshold, timeout, fee, discount, price point",
    "- Every validation rule: what input is accepted/rejected, min/max lengths, required fields",
    "- Feature flags and what they enable/disable",
    "- State machine transitions: what states exist, what triggers transitions",
    "- Permission/role checks: who can do what",
    "- Time-based rules: expiration, cooldowns, retry windows, scheduling constraints",
    "- Error handling: what errors are thrown, what messages users see",
    "Look in: constants files, enums, config objects, validation functions, middleware, hooks",
    "",
    "## USER FLOWS:",
    "- Every screen/page/route and what happens on each",
    "- Navigation paths: where can the user go from each screen",
    "- Forms: what fields, what validation, what happens on submit",
    "- Conditional UI: what shows/hides based on state, role, or feature flag",
    "",
    "## DATA MODEL:",
    "- Key entities and their fields (in plain language)",
    "- Relationships between entities",
    "- What gets stored, what's computed, what's ephemeral",
    "",
    "## INTEGRATIONS:",
    "- Third-party services, APIs, SDKs",
    "- What data flows in/out",
    "- Webhooks, events, analytics tracking",
    "",
    "## ARCHITECTURE:",
    "- How the code is organized (packages, modules, layers)",
    "- Key technical decisions visible in the code",
    "",
    "Be thorough and specific. Name concrete things. State exact numbers and defaults.",
    "Every fact must be traceable to the source code. Output as structured bullet points.",
    "",
    `## Document to be written`,
    entry.description,
    "",
    `## Source code`,
    sourceCode,
  ].join("\n")
}

function fullRecompilePrompt(
  entry: DocEntry,
  currentDoc: string,
  summary: string,
  style: string,
  authorContext: string,
): string {
  const timestamp = new Date().toISOString()
  return [
    "You are a documentation compiler. Write a complete document from the source code summary.",
    "ONLY include facts from the summary. NEVER add information not present in the summary. If a section would be empty, write '[Insufficient source data]'.",
    "Return ONLY the markdown content — no preamble, no fencing.",
    "",
    style,
    "",
    `## Document description`,
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
  ].join("\n")
}

function healthCheckPrompt(
  entry: DocEntry,
  currentDoc: string,
  sourceCode: string,
): string {
  return [
    "You are a documentation accuracy checker.",
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
    `## Document description`,
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
    "Weave authorship naturally into the documentation where relevant — mention who owns or maintains key areas.",
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
    "These tickets/PRs are linked to this area of the codebase. Use them to explain WHY things were built or changed.",
    "Include ticket references naturally in the documentation where they add context (e.g. 'Retry logic was added per CXC-1080').",
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
  const singlePass =
    options.provider.provider === "local" ||
    options.provider.provider === "ollama"

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
  const total = entries.length
  let current = 0

  for (const [docPath, entry] of entries) {
    if (!entry) continue
    current++

    const fullDocPath = docPath.startsWith("/")
      ? docPath
      : `${config.docsDir}/${docPath}`
    const currentDoc = readDocFile(fullDocPath)

    // Health-check type docs
    if (entry.type === "health-check") {
      if (mode === "compile" || mode === "health") {
        const spinner = log.spin(
          `${log.progress(current, total, "")} Health-checking ${docPath}`,
        )
        const issues = await runHealthCheck(
          entry,
          currentDoc,
          repoRoot,
          providers.triage,
        )
        spinner.stop()
        if (issues.length > 0) {
          result.healthIssues.push({ doc: docPath, issues })
          log.warn(`${docPath} — ${issues.length} issue(s)`)
        } else {
          log.success(`${docPath} — healthy`)
        }
      }
      continue
    }

    // Compiled type docs
    if (entry.type !== "compiled") continue

    // Hash-based drift detection: compare file hashes instead of git diff
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

    if (forceRecompile) {
      const cs = log.compileProgress(current, total, `Gathering ${docPath}`)
      const gather = gatherFullSource(entry, repoRoot)
      if (gather.content === "") {
        cs.fail(`${docPath} — ${noSourcesMessage(entry)}`)
        continue
      }
      cs.update(`Compiling ${docPath}`, gatherDetail(gather))
      const t0 = Date.now()
      const updated = await runFullRecompile(
        entry,
        currentDoc,
        gather,
        repoRoot,
        styleGuide,
        singlePass,
        providers.triage,
        providers.compile,
      )
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
      const validation = validateCompiledOutput(updated)
      if (!validation.valid) {
        cs.fail(`${docPath} — rejected`)
        for (const w of validation.warnings) log.warn(w)
        result.triageResults.push({
          doc: docPath,
          drifted: true,
          reason: `Rejected: ${validation.warnings[0]}`,
        })
      } else {
        cs.succeed(`${docPath} ${pc.dim(`(${elapsed}s)`)}`)
        log.gatherWarnings(gather.truncatedFiles)
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
          reason: "Force recompile",
        })
      }
      allHashes = updateHashesForDoc(allHashes, docPath, currentHashes)
    } else {
      // Diff-only recompile: send previous doc + git diff (not full source)
      const affectedFiles = [...hashDiff.changedFiles, ...hashDiff.addedFiles]
      const nChanged = affectedFiles.length + hashDiff.removedFiles.length
      const cs = log.compileProgress(
        current,
        total,
        `Compiling ${docPath}`,
        `${nChanged} changed`,
      )
      const t0 = Date.now()
      const updated = await runDiffRecompile(
        entry,
        currentDoc,
        affectedFiles,
        repoRoot,
        lastSync,
        styleGuide,
        providers.compile,
      )
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
      const validation = validateCompiledOutput(updated)
      if (!validation.valid) {
        cs.fail(`${docPath} — rejected`)
        for (const w of validation.warnings) log.warn(w)
        result.triageResults.push({
          doc: docPath,
          drifted: true,
          reason: `Rejected: ${validation.warnings[0]}`,
        })
      } else {
        cs.succeed(`${docPath} ${pc.dim(`(${elapsed}s)`)}`)
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
    }
  }

  // Persist hashes and .last-sync (only in compile mode)
  if (mode === "compile") {
    saveHashes(config.docsDir, allHashes)
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

function singlePassPrompt(
  entry: DocEntry,
  currentDoc: string,
  sourceCode: string,
  style: string,
  authorContext: string,
): string {
  const timestamp = new Date().toISOString()
  return [
    "You are a documentation compiler. Write a COMPLETE knowledge base document from the source code.",
    "This document is the BRAIN of the business — cover business rules, user flows, data models, AND architecture.",
    "Dig deep into constants, validation, feature flags, pricing, permissions, state machines, error handling.",
    "ONLY state facts directly visible in the source code. NEVER guess or assume. If unsure, write '[Insufficient source data]'.",
    "Return ONLY the markdown content — no preamble, no code fences wrapping the output.",
    "",
    style,
    "",
    `## Document description`,
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
): Promise<string> {
  const contributors = getDirectoryAuthors(entry.sources, repoRoot)
  const tickets = getTicketsForPaths(entry.sources, repoRoot)
  const authorContext = formatAuthorContext(contributors)
  const ticketContext = formatTicketContext(tickets)
  const combinedContext = `${authorContext}\n${ticketContext}`

  let result: string
  if (singlePass) {
    const prompt = singlePassPrompt(
      entry,
      currentDoc,
      gather.content,
      style,
      combinedContext,
    )
    result = await compileProvider.generate(prompt)
  } else {
    const summaryPrompt = summarizeSourcePrompt(entry, gather.content)
    const summary = await triageProvider.generate(summaryPrompt)
    const prompt = fullRecompilePrompt(
      entry,
      currentDoc,
      summary,
      style,
      combinedContext,
    )
    result = await compileProvider.generate(prompt)
  }

  const withContributors = injectContributorsFrontmatter(
    result.trim(),
    contributors,
  )
  return `${injectTicketsFrontmatter(withContributors, tickets)}\n`
}

async function runHealthCheck(
  entry: DocEntry,
  currentDoc: string,
  repoRoot: string,
  triageProvider: LLMProvider,
): Promise<string[]> {
  const gather = gatherFullSource(entry, repoRoot)
  if (gather.content === "") {
    return [noSourcesMessage(entry)]
  }
  const prompt = healthCheckPrompt(entry, currentDoc, gather.content)
  const raw = await triageProvider.generate(prompt)
  const { healthy, issues } = parseHealthResponse(raw)
  return healthy ? [] : issues
}
