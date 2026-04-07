import { readFileSync, writeFileSync } from "node:fs"
import type { DocEntry } from "./config"
import { loadDocMap, resolveConfig } from "./config"
import { getChangedFiles, getCurrentCommit, getLastSyncCommit } from "./git"
import { generateIndex } from "./indexer"
import { createProviders } from "./providers"
import type { LLMProvider, ProviderConfig } from "./providers/types"
import { fileMatchesSources, gatherContext, gatherFullSource } from "./sources"
import { appendCompilationLog, generateWiki } from "./wiki"

// ── Types ──────────────────────────────────────────────────────────────

export type OrchestrateOptions = {
  repoRoot: string
  docsDir?: string
  provider: ProviderConfig
  forceRecompile: boolean
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
Write for a non-technical audience (PMs, designers). Explain WHAT the system does, not HOW.
- YAML frontmatter: description (one sentence), sources (list), compiled_at (ISO timestamp)
- Open with a 2-3 sentence summary paragraph
- Use ## for major sections, ### for subsections
- Be specific: name features, state numbers, describe concrete behavior
- No raw code snippets. No function signatures. Source tracking lives in frontmatter.
- Use bullet lists for rules and constraints, tables for comparisons
- Each section should be independently readable

DIAGRAMS: Include Mermaid diagrams where they clarify structure or flow:
- Architecture: use flowchart or graph showing services/components and how they connect
- Data flows: use sequenceDiagram showing request paths or data pipelines
- State machines: use stateDiagram-v2 for lifecycle states (e.g. booking, order, user status)
- Wrap each diagram in a \`\`\`mermaid code fence. Only include diagrams that add clarity — not every section needs one.

CITATIONS: When stating a specific fact, behavior, or rule derived from the source code, add a brief inline citation in parentheses referencing the source module or area — e.g. (source: auth module), (source: booking rules), (source: payment service). Do NOT use raw file paths or line numbers. Use plain-language module names that a PM would understand.
`.trim()

// ── Prompts ────────────────────────────────────────────────────────────

function triagePrompt(
  entry: DocEntry,
  currentDoc: string,
  diff: string,
  contextCode: string,
): string {
  return [
    "You are a documentation triage agent.",
    "Determine if the following documentation needs to be updated based on the code changes.",
    "",
    `## Document description`,
    entry.description,
    "",
    `## Current documentation`,
    currentDoc,
    "",
    `## Code diff since last sync`,
    diff || "(no diff available)",
    "",
    `## Relevant source code`,
    contextCode || "(no context code)",
    "",
    "Respond with a JSON object (no markdown fencing):",
    '{ "drifted": true/false, "reason": "one-line explanation" }',
  ].join("\n")
}

function recompilePrompt(
  entry: DocEntry,
  currentDoc: string,
  diff: string,
  contextCode: string,
  style: string,
): string {
  const timestamp = new Date().toISOString()
  return [
    "You are a documentation compiler. Update the existing document to reflect the code changes.",
    "Preserve the document's structure. Only modify sections affected by the changes.",
    "Update the compiled_at timestamp in frontmatter.",
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
  ].join("\n")
}

function summarizeSourcePrompt(entry: DocEntry, sourceCode: string): string {
  return [
    "You are a code analyst preparing a structured fact sheet for a documentation compiler.",
    "The documentation is written for product managers and designers — not engineers.",
    "",
    "Extract and organize:",
    "- Features and capabilities (what can users do?)",
    "- Business rules, validation, limits, pricing",
    "- User flows and state transitions",
    "- Entity relationships and data models (in plain language)",
    "- External services and integrations",
    "- Permissions and access control",
    "- Configuration and defaults",
    "",
    "Be thorough and specific. Name concrete things. State numbers and defaults.",
    "Output as structured bullet points grouped by topic.",
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
): string {
  const timestamp = new Date().toISOString()
  return [
    "You are a documentation compiler. Write a complete document from the source code summary.",
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

// ── Helpers ────────────────────────────────────────────────────────────

function readDocFile(docPath: string): string {
  try {
    return readFileSync(docPath, "utf-8")
  } catch {
    return ""
  }
}

function parseTriageResponse(raw: string): {
  drifted: boolean
  reason: string
} {
  try {
    const cleaned = raw
      .replace(/```json?\s*/g, "")
      .replace(/```/g, "")
      .trim()
    const parsed = JSON.parse(cleaned)
    return {
      drifted: Boolean(parsed.drifted),
      reason: String(parsed.reason ?? "no reason provided"),
    }
  } catch {
    // If we can't parse, assume drifted to be safe
    return { drifted: true, reason: "Could not parse triage response" }
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

  const lastSync = getLastSyncCommit(config.lastSyncPath, repoRoot)
  const currentCommit = getCurrentCommit(repoRoot)
  const changedFiles = getChangedFiles(lastSync, repoRoot)

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
    const progress = `[${current}/${total}]`

    const fullDocPath = docPath.startsWith("/")
      ? docPath
      : `${config.docsDir}/${docPath}`
    const currentDoc = readDocFile(fullDocPath)

    // Health-check type docs
    if (entry.type === "health-check") {
      if (mode === "compile" || mode === "health") {
        console.log(`${progress} 🏥 Health-checking ${docPath}...`)
        const issues = await runHealthCheck(
          entry,
          currentDoc,
          repoRoot,
          providers.triage,
        )
        if (issues.length > 0) {
          result.healthIssues.push({ doc: docPath, issues })
          console.log(`${progress} ⚠  ${docPath} — ${issues.length} issue(s)`)
        } else {
          console.log(`${progress} ✅ ${docPath} — healthy`)
        }
      }
      continue
    }

    // Compiled type docs
    if (entry.type !== "compiled") continue

    // Check if any source files changed for this doc
    const allSources = [...entry.sources, ...entry.context_files]
    const hasChanges =
      forceRecompile ||
      changedFiles.some((f) => fileMatchesSources(f, allSources))

    if (!hasChanges && !forceRecompile) {
      console.log(`${progress} ⏭  ${docPath} — no changes`)
      result.triageResults.push({
        doc: docPath,
        drifted: false,
        reason: "No source files changed",
      })
      continue
    }

    if (mode === "check") {
      console.log(`${progress} 🔍 Triaging ${docPath}...`)
      const triageResult = await runTriage(
        entry,
        currentDoc,
        changedFiles,
        repoRoot,
        lastSync,
        providers.triage,
      )
      const icon = triageResult.drifted ? "⚡" : "✅"
      console.log(`${progress} ${icon} ${docPath} — ${triageResult.reason}`)
      result.triageResults.push({ doc: docPath, ...triageResult })
      continue
    }

    if (forceRecompile) {
      console.log(`${progress} 📝 Summarizing ${docPath}...`)
      const t0 = Date.now()
      const updated = await runFullRecompile(
        entry,
        currentDoc,
        repoRoot,
        styleGuide,
        providers.triage,
        providers.compile,
      )
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
      console.log(`${progress} ✅ Compiled ${docPath} (${elapsed}s)`)
      writeFileSync(fullDocPath, updated)
      result.updatedDocs.push(docPath)
      result.docDiffs.push({ doc: docPath, before: currentDoc, after: updated })
      result.triageResults.push({
        doc: docPath,
        drifted: true,
        reason: "Force recompile",
      })
    } else {
      console.log(`${progress} 🔍 Triaging ${docPath}...`)
      const triageResult = await runTriage(
        entry,
        currentDoc,
        changedFiles,
        repoRoot,
        lastSync,
        providers.triage,
      )
      result.triageResults.push({ doc: docPath, ...triageResult })

      if (triageResult.drifted) {
        console.log(`${progress} 📝 Recompiling ${docPath}...`)
        const updated = await runRecompile(
          entry,
          currentDoc,
          changedFiles,
          repoRoot,
          lastSync,
          styleGuide,
          providers.compile,
        )
        console.log(`${progress} ✅ Compiled ${docPath}`)
        writeFileSync(fullDocPath, updated)
        result.updatedDocs.push(docPath)
        result.docDiffs.push({
          doc: docPath,
          before: currentDoc,
          after: updated,
        })
      }
    }
  }

  // Update .last-sync with current commit (only in compile mode)
  if (mode === "compile" && currentCommit) {
    writeFileSync(config.lastSyncPath, `${currentCommit}\n`)
  }

  // Post-compilation: wiki pages, index, and log
  if (mode === "compile") {
    console.log("\n🧠 Extracting entities & concepts...")
    const wikiResult = await generateWiki(
      config.docsDir,
      docMap,
      providers.triage,
    )
    if (wikiResult.entities > 0 || wikiResult.concepts > 0) {
      console.log(
        `   ${wikiResult.entities} entities, ${wikiResult.concepts} concepts`,
      )
    }

    console.log("📇 Generating INDEX.md...")
    await generateIndex(config.docsDir, docMap, providers.triage)

    appendCompilationLog(config.docsDir, {
      updatedDocs: result.updatedDocs,
      healthIssues: result.healthIssues,
      wiki: wikiResult,
    })
    console.log("📋 Updated log.md\n")
  }

  return result
}

// ── Pipeline steps ─────────────────────────────────────────────────────

async function runTriage(
  entry: DocEntry,
  currentDoc: string,
  changedFiles: string[],
  repoRoot: string,
  lastSync: string,
  triageProvider: LLMProvider,
): Promise<{ drifted: boolean; reason: string }> {
  const { diff, contextCode } = gatherContext(
    entry,
    changedFiles,
    repoRoot,
    lastSync,
  )
  const prompt = triagePrompt(entry, currentDoc, diff, contextCode)
  const raw = await triageProvider.generate(prompt)
  return parseTriageResponse(raw)
}

async function runRecompile(
  entry: DocEntry,
  currentDoc: string,
  changedFiles: string[],
  repoRoot: string,
  lastSync: string,
  style: string,
  compileProvider: LLMProvider,
): Promise<string> {
  const { diff, contextCode } = gatherContext(
    entry,
    changedFiles,
    repoRoot,
    lastSync,
  )
  const prompt = recompilePrompt(entry, currentDoc, diff, contextCode, style)
  const result = await compileProvider.generate(prompt)
  return `${result.trim()}\n`
}

async function runFullRecompile(
  entry: DocEntry,
  currentDoc: string,
  repoRoot: string,
  style: string,
  triageProvider: LLMProvider,
  compileProvider: LLMProvider,
): Promise<string> {
  const sourceCode = gatherFullSource(entry, repoRoot)
  const summaryPrompt = summarizeSourcePrompt(entry, sourceCode)
  const summary = await triageProvider.generate(summaryPrompt)

  const prompt = fullRecompilePrompt(entry, currentDoc, summary, style)
  const result = await compileProvider.generate(prompt)
  return `${result.trim()}\n`
}

async function runHealthCheck(
  entry: DocEntry,
  currentDoc: string,
  repoRoot: string,
  triageProvider: LLMProvider,
): Promise<string[]> {
  const sourceCode = gatherFullSource(entry, repoRoot)
  const prompt = healthCheckPrompt(entry, currentDoc, sourceCode)
  const raw = await triageProvider.generate(prompt)
  const { healthy, issues } = parseHealthResponse(raw)
  return healthy ? [] : issues
}
