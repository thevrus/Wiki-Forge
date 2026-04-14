import { readFileSync, writeFileSync } from "node:fs"
import pc from "picocolors"
import type { DocEntry } from "../config"
import { loadDocMap, resolveConfig } from "../config"
import {
  DOC_CONCURRENCY_CLOUD,
  DOC_CONCURRENCY_OLLAMA,
  SOURCE_MIN_USEFUL,
} from "../constants"
import { listFiles } from "../file-glob"
import { getCurrentCommit, getLastSyncCommit } from "../git"
import { buildDocContext, type DocContext } from "../ingestion"
import * as log from "../logger"
import { createProviders } from "../providers"
import type { ProviderConfig } from "../providers/types"
import { analyzeRepository } from "../report/analyze"
import { generateStatusReport } from "../report/status"
import { flushTelemetry } from "../telemetry/usage"
import { verifyDocClaims } from "../validation/claims"
import { validateCompiledOutput } from "../validation/output"
import { buildDependencyGraph } from "./dependency-graph"
import { backfillFrontmatter, readDocFile } from "./frontmatter"
import {
  computeDocHashes,
  diffHashes,
  loadHashes,
  saveHashes,
  updateHashesForDoc,
} from "./hashes"
import { generateIndex, generateLlmsTxt } from "./indexer"
import { DEFAULT_STYLE, noSourcesMessage } from "./prompts"
import { asyncPool } from "../utils"
import { gatherFullSource } from "./sources"
import {
  gatherDetail,
  runDiffRecompile,
  runFullRecompile,
  runHealthCheck,
} from "./steps"
import {
  loadSummaryCache,
  type SummaryCache,
  saveSummaryCache,
} from "./summary-cache"
import { generateVisualizations } from "./visualizations"
import { appendCompilationLog, generateWiki } from "./wiki"

export type OrchestrateOptions = {
  repoRoot: string
  docsDir?: string
  provider: ProviderConfig
  forceRecompile: boolean
  skipWiki: boolean
  mode: "check" | "compile" | "health"
  /** Enable git history ingestion (blame, PRs, tickets) for richer compilation context. */
  ingest?: boolean
  /** Skip GitHub API calls during ingestion. */
  skipGitHub?: boolean
  /** Skip ticket tracker API calls (Jira, Linear) during ingestion. */
  skipTickets?: boolean
  /** Suppress per-doc log output (check mode uses its own table). */
  quiet?: boolean
}

export type OrchestrateResult = {
  updatedDocs: string[]
  healthIssues: Array<{ doc: string; issues: string[] }>
  triageResults: Array<{ doc: string; drifted: boolean; reason: string }>
  docDiffs: Array<{ doc: string; before: string; after: string }>
}

export async function orchestrate(
  options: OrchestrateOptions,
): Promise<OrchestrateResult> {
  // Clean exit on Ctrl+C — save progress before exiting
  let allHashesRef: Record<string, Record<string, string>> = {}
  const onSigint = () => {
    console.log("\n\n  Interrupted. Saving progress...")
    try {
      const docsDirResolved = resolveConfig(repoRoot, docsDir).docsDir
      saveHashes(docsDirResolved, allHashesRef)
      flushTelemetry(docsDirResolved)
    } catch {
      /* best effort */
    }
    console.log("  Already-compiled docs are saved.\n")
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
  // Skip provider creation for check mode — it only does hash comparison
  const _providers = mode === "check" ? null : createProviders(options.provider)
  const providers = () => _providers!
  const styleGuide = docMap.style ?? DEFAULT_STYLE
  const domain = docMap.domain
  const singlePass = options.provider.provider === "local"
  const triageConcurrency = options.provider.provider === "ollama" ? 1 : 5
  const MAX_ATTEMPTS = 2

  const lastSync = getLastSyncCommit(config.lastSyncPath, repoRoot)
  const currentCommit = getCurrentCommit(repoRoot)

  // Compile metadata for frontmatter
  const compileMeta: import("./frontmatter").CompileMeta = {
    provider: options.provider.provider,
    model: options.provider.compileModel ?? options.provider.triageModel,
    sourceCommit: currentCommit || undefined,
    ingested: options.ingest,
  }

  // File-level hashing for precise drift detection
  let allHashes = loadHashes(config.docsDir)
  allHashesRef = allHashes

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
      providers().triage,
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
      if (!options.quiet) log.skip(`${docPath} — no changes`)
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
      if (!options.quiet) log.drift(`${docPath} — ${reason}`)
      result.triageResults.push({ doc: docPath, drifted: true, reason })
      continue
    }

    compileJobs.push({
      docPath,
      entry,
      fullDocPath,
      currentDoc,
      currentHashes,
      hashDiff,
    })
  }

  // ── Phase 3: Compile in parallel ───────────────────────────────────
  const docConcurrency = singlePass
    ? 1
    : options.provider.provider === "ollama"
      ? DOC_CONCURRENCY_OLLAMA
      : DOC_CONCURRENCY_CLOUD

  const compileTotal = compileJobs.length
  const tracker = log.createCompileTracker(compileTotal)

  const useIngestion = options.ingest ?? false

  await asyncPool(docConcurrency, compileJobs, async (job) => {
    const { docPath, entry, fullDocPath, currentDoc, currentHashes, hashDiff } =
      job

    // Build context from git history — always for visualizations, enriched with APIs when --ingest
    const sourcePaths = listFiles(entry.sources, repoRoot)
    let docContext: DocContext | undefined
    if (sourcePaths.length > 0) {
      docContext = await buildDocContext(sourcePaths, {
        repoRoot,
        skipGitHub: useIngestion ? options.skipGitHub : true,
        skipTickets: useIngestion ? options.skipTickets : true,
        skipBlame: !useIngestion, // blame is slower, only run with --ingest
      })
    }

    /** Append deterministic visualizations to compiled doc content. */
    function appendViz(
      content: string,
      gather?: { files: Array<{ path: string; content: string }> },
    ): string {
      if (!docContext) return content
      // Use gathered source files for dep graph, or fall back to reading them
      const files =
        gather?.files ??
        sourcePaths
          .map((p) => {
            try {
              return {
                path: p,
                content: readFileSync(`${repoRoot}/${p}`, "utf-8"),
              }
            } catch {
              return { path: p, content: "" }
            }
          })
          .filter((f) => f.content)
      const graph = buildDependencyGraph(files)
      const viz = generateVisualizations({
        ctx: docContext,
        graph,
        docName: docPath,
        docSources: entry.sources,
      })
      return viz ? `${content}${viz}` : content
    }

    if (forceRecompile) {
      const handle = tracker.start(docPath, "Gathering...")
      const gather = gatherFullSource(entry, repoRoot)
      if (gather.content === "") {
        handle.fail(`${docPath} — ${noSourcesMessage(entry)}`)
        return
      }
      if (gather.totalSize < SOURCE_MIN_USEFUL) {
        handle.fail(
          `${docPath} — only ${gather.totalSize} bytes of source (need ${SOURCE_MIN_USEFUL}+), skipping`,
        )
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
          handle.update(
            `Retrying ${docPath} (attempt ${attempt})`,
            gatherDetail(gather),
          )
        }
        const { doc: raw, cacheUpdated } = await runFullRecompile(
          entry,
          currentDoc,
          gather,
          repoRoot,
          styleGuide,
          singlePass,
          providers().triage,
          providers().compile,
          domain,
          triageConcurrency,
          (phase, detail) =>
            handle.update(
              `${docPath} — ${phase}`,
              detail ?? gatherDetail(gather),
            ),
          summaryCache,
          docContext,
        )
        if (cacheUpdated) summaryCacheDirty = true
        updated = backfillFrontmatter(raw, docPath, entry, {
          ...compileMeta,
          duration: (Date.now() - t0) / 1000,
        })
        validation = validateCompiledOutput(updated)
        if (validation.valid) break
        if (attempt < MAX_ATTEMPTS) {
          log.warn(
            `${docPath} — rejected (${validation.warnings[0]}), retrying...`,
          )
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
        log.injectionWarnings(gather.injectionFindings)
        if (validation.warnings.length > 0) {
          for (const w of validation.warnings) log.warn(w)
        }
        // Verify backtick-quoted claims against source code
        const claims = verifyDocClaims(validation.cleaned, gather.content)
        if (claims.total > 0 && claims.score < 0.5) {
          log.warn(
            `${docPath} — ${claims.unverified.length}/${claims.total} code references not found in source: ${claims.unverified.slice(0, 5).join(", ")}`,
          )
        }
        const final = appendViz(validation.cleaned, gather)
        writeFileSync(fullDocPath, `${final}\n`)
        result.updatedDocs.push(docPath)
        result.docDiffs.push({
          doc: docPath,
          before: currentDoc,
          after: final,
        })
        result.triageResults.push({
          doc: docPath,
          drifted: true,
          reason: "Force recompile",
        })
      }
      allHashes = updateHashesForDoc(allHashes, docPath, currentHashes)
    } else if (
      currentDoc &&
      currentDoc.split(/^##\s+/m).length > 1 &&
      currentDoc.length > 500
    ) {
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
          handle.update(
            `Retrying ${docPath} (attempt ${attempt})`,
            `${nChanged} changed`,
          )
        }
        const raw = await runDiffRecompile(
          entry,
          currentDoc,
          affectedFiles,
          repoRoot,
          lastSync,
          styleGuide,
          providers().compile,
          domain,
          docContext,
        )
        updated = backfillFrontmatter(raw, docPath, entry, {
          ...compileMeta,
          duration: (Date.now() - t0) / 1000,
        })
        validation = validateCompiledOutput(updated)
        if (validation.valid) break
        if (attempt < MAX_ATTEMPTS) {
          log.warn(
            `${docPath} — rejected (${validation.warnings[0]}), retrying...`,
          )
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
        const final2 = appendViz(validation.cleaned)
        writeFileSync(fullDocPath, `${final2}\n`)
        result.updatedDocs.push(docPath)
        result.docDiffs.push({
          doc: docPath,
          before: currentDoc,
          after: final2,
        })
        result.triageResults.push({
          doc: docPath,
          drifted: true,
          reason: `${nChanged} file(s) changed`,
        })
      }
      allHashes = updateHashesForDoc(allHashes, docPath, currentHashes)
    } else {
      // Existing doc is too thin for diff updates — do a full recompile instead
      const handle = tracker.start(
        docPath,
        "Full recompile (existing doc too thin)",
      )
      const gather = gatherFullSource(entry, repoRoot)
      if (gather.content === "") {
        handle.fail(`${docPath} — ${noSourcesMessage(entry)}`)
        allHashes = updateHashesForDoc(allHashes, docPath, currentHashes)
        return
      }
      if (gather.totalSize < SOURCE_MIN_USEFUL) {
        handle.fail(
          `${docPath} — only ${gather.totalSize} bytes of source, skipping`,
        )
        result.triageResults.push({
          doc: docPath,
          drifted: false,
          reason: `Skipped: insufficient source (${gather.totalSize} bytes)`,
        })
        allHashes = updateHashesForDoc(allHashes, docPath, currentHashes)
        return
      }
      handle.update(`Compiling ${docPath}`, gatherDetail(gather))
      const t0 = Date.now()

      let updated = ""
      let validation = validateCompiledOutput("")
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (attempt > 1) {
          handle.update(
            `Retrying ${docPath} (attempt ${attempt})`,
            gatherDetail(gather),
          )
        }
        const { doc: raw, cacheUpdated } = await runFullRecompile(
          entry,
          currentDoc,
          gather,
          repoRoot,
          styleGuide,
          singlePass,
          providers().triage,
          providers().compile,
          domain,
          triageConcurrency,
          (phase, detail) =>
            handle.update(
              `${docPath} — ${phase}`,
              detail ?? gatherDetail(gather),
            ),
          summaryCache,
          docContext,
        )
        if (cacheUpdated) summaryCacheDirty = true
        updated = backfillFrontmatter(raw, docPath, entry, {
          ...compileMeta,
          duration: (Date.now() - t0) / 1000,
        })
        validation = validateCompiledOutput(updated)
        if (validation.valid) break
        if (attempt < MAX_ATTEMPTS) {
          log.warn(
            `${docPath} — rejected (${validation.warnings[0]}), retrying...`,
          )
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
        log.injectionWarnings(gather.injectionFindings)
        if (validation.warnings.length > 0) {
          for (const w of validation.warnings) log.warn(w)
        }
        const claims = verifyDocClaims(validation.cleaned, gather.content)
        if (claims.total > 0 && claims.score < 0.5) {
          log.warn(
            `${docPath} — ${claims.unverified.length}/${claims.total} code references not found in source: ${claims.unverified.slice(0, 5).join(", ")}`,
          )
        }
        const final3 = appendViz(validation.cleaned, gather)
        writeFileSync(fullDocPath, `${final3}\n`)
        result.updatedDocs.push(docPath)
        result.docDiffs.push({
          doc: docPath,
          before: currentDoc,
          after: final3,
        })
        result.triageResults.push({
          doc: docPath,
          drifted: true,
          reason: "Full recompile (existing doc too thin)",
        })
      }
      allHashes = updateHashesForDoc(allHashes, docPath, currentHashes)
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
        providers().triage,
        repoRoot,
      )
      spinner.stop()
      if (wikiResult.entities > 0 || wikiResult.concepts > 0) {
        log.success(
          `${wikiResult.entities} entities, ${wikiResult.concepts} concepts`,
        )
      }

      spinner = log.spin("Generating INDEX.md")
      await generateIndex(config.docsDir, docMap, providers().triage, repoRoot)
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

    // Generate brain health dashboard (_status.md)
    try {
      const reportData = analyzeRepository(config.docsDir, docMap, repoRoot)
      await generateStatusReport(config.docsDir, reportData, providers().triage)
      log.success("_status.md")
    } catch {
      log.warn("_status.md generation failed")
    }
  }

  // Flush LLM telemetry to _telemetry.jsonl and print a one-line summary.
  // Happens for both compile and health modes so any LLM call is recorded.
  if (mode !== "check") {
    const summary = flushTelemetry(config.docsDir)
    if (summary.calls > 0) {
      const cost =
        summary.costUSD > 0
          ? ` · ${pc.dim(`$${summary.costUSD.toFixed(4)}`)}`
          : ""
      log.info(
        `${summary.calls} LLM calls · ${summary.inputTokens.toLocaleString()} in / ${summary.outputTokens.toLocaleString()} out${cost}`,
      )
    }
  }

  process.removeListener("SIGINT", onSigint)
  return result
}
