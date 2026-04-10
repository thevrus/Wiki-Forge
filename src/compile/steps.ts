import type { DocEntry } from "../config"
import { STUFF_THRESHOLD } from "../constants"
import {
  getDiffForFiles,
  getDirectoryAuthors,
  getTicketsForPaths,
} from "../git"
import { type DocContext, formatDocContextForPrompt } from "../ingestion"
import * as log from "../logger"
import type { LLMProvider } from "../providers/types"
import { stripCodeFences } from "../validation/output"
import {
  buildDependencyGraph,
  serializeDependencyGraph,
} from "./dependency-graph"
import {
  formatAuthorContext,
  formatTicketContext,
  injectContributorsFrontmatter,
  injectTicketsFrontmatter,
  parseHealthResponse,
} from "./frontmatter"
import {
  fullRecompilePrompt,
  fullRecompileSystem,
  HEALTH_CHECK_FORMAT,
  healthCheckPrompt,
  recompilePrompt,
  singlePassPrompt,
  singlePassSystem,
  summarizeHierarchically,
} from "./prompts"
import type { GatherResult } from "./sources"
import { gatherFullSource } from "./sources"
import type { SummaryCache } from "./summary-cache"

function noSourcesMessage(entry: DocEntry): string {
  return `No source files found for sources: ${entry.sources.join(", ")}. Check that these directories exist.`
}

/** Diff-only recompile: sends previous doc + git diff instead of full source */
export async function runDiffRecompile(
  entry: DocEntry,
  currentDoc: string,
  changedFiles: string[],
  repoRoot: string,
  lastSync: string,
  style: string,
  compileProvider: LLMProvider,
  domain?: string,
  docContext?: DocContext,
): Promise<string> {
  const diff = getDiffForFiles(lastSync, changedFiles, repoRoot)
  const contributors = getDirectoryAuthors(entry.sources, repoRoot)
  const tickets = getTicketsForPaths(entry.sources, repoRoot)

  const contextBlock = docContext
    ? formatDocContextForPrompt(docContext)
    : `${formatAuthorContext(contributors)}\n${formatTicketContext(tickets)}`

  const prompt = recompilePrompt(
    entry,
    currentDoc,
    diff,
    "",
    style,
    contextBlock,
    domain,
  )
  const result = await compileProvider.generate(prompt)
  const cleaned = stripCodeFences(result.trim())
  return `${injectTicketsFrontmatter(injectContributorsFrontmatter(cleaned, contributors), tickets)}\n`
}

export function gatherDetail(gather: GatherResult): string {
  return log.gatherSummary(
    gather.fileCount,
    gather.totalSize,
    gather.skippedByPriority,
  )
}

export async function runFullRecompile(
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
  docContext?: DocContext,
): Promise<{ doc: string; cacheUpdated: boolean }> {
  const contributors = getDirectoryAuthors(entry.sources, repoRoot)
  const tickets = getTicketsForPaths(entry.sources, repoRoot)

  // Use rich ingestion context if available, fall back to legacy formatting
  const combinedContext = docContext
    ? formatDocContextForPrompt(docContext)
    : `${formatAuthorContext(contributors)}\n${formatTicketContext(tickets)}`

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
      (done, total) =>
        onProgress?.(
          `Summarizing ${done}/${total}`,
          `${done}/${total} batches`,
        ),
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

  const cleaned = stripCodeFences(result.trim())
  const withContributors = injectContributorsFrontmatter(cleaned, contributors)
  return {
    doc: `${injectTicketsFrontmatter(withContributors, tickets)}\n`,
    cacheUpdated,
  }
}

export async function runHealthCheck(
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
