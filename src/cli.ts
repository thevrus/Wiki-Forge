#!/usr/bin/env node

import { defineCommand, runMain } from "citty"
import {
  docsDirArg,
  ENV_KEY_MAP,
  llmArgs,
  repoArg,
  resolveApiKey,
  VERSION,
} from "./cli/args"
import { interactiveInit, runInit } from "./cli/init"
import { interactiveWizard } from "./cli/wizard"
import { orchestrate } from "./compile/orchestrate"
import * as log from "./logger"
import type { ProviderConfig } from "./providers/types"

// ── Validate ────────────────────────────────────────────────────────

async function runValidate(repo: string, docsDir?: string) {
  const { validateDocMap } = await import("./validation/doc-map")

  const issues = validateDocMap(
    repo,
    docsDir ? `${repo}/${docsDir}` : undefined,
  )

  if (issues.length === 0) {
    log.intro("wiki-forge validate")
    log.success("Doc map is valid.")
    log.outro("")
    return
  }

  const errors = issues.filter((i) => i.severity === "error")
  const warnings = issues.filter((i) => i.severity === "warning")

  log.intro("wiki-forge validate")
  log.list(
    issues.map((issue) => ({
      label: `${issue.doc}: ${issue.message}`,
      status:
        issue.severity === "error" ? ("error" as const) : ("warn" as const),
    })),
  )
  log.outro(`${errors.length} error(s), ${warnings.length} warning(s)`)

  if (errors.length > 0) process.exit(1)
}

// ── Orchestrate helper ──────────────────────────────────────────────

async function runOrchestrate(
  mode: "check" | "compile" | "health",
  args: {
    provider: string
    "api-key"?: string
    repo: string
    "docs-dir"?: string
    force: boolean
    "skip-wiki": boolean
    ingest: boolean
    "skip-github": boolean
    "skip-tickets": boolean
    "local-cmd"?: string
    "ollama-model"?: string
    "ollama-url"?: string
  },
) {
  const provider = args.provider
  const resolvedKey =
    mode === "check" || provider === "local" || provider === "ollama"
      ? ""
      : resolveApiKey(provider, args["api-key"])

  const providerConfig: ProviderConfig = {
    provider: provider as ProviderConfig["provider"],
    apiKey: resolvedKey,
    localCmd: args["local-cmd"],
    triageModel: args["ollama-model"],
    compileModel: args["ollama-model"],
    ollamaUrl: args["ollama-url"],
  }

  const pc = (await import("picocolors")).default

  if (mode === "check") {
    log.intro(`wiki-forge check`)
    log.keyValue({ repo: args.repo })
  } else {
    log.header(mode, provider, args.repo)
    if (args.force) log.info(pc.yellow("Force recompile: all docs"))
    if (args.ingest) log.info(pc.cyan("Ingestion: git history, PRs, tickets"))
  }

  try {
    const result = await orchestrate({
      repoRoot: args.repo,
      docsDir: args["docs-dir"]
        ? `${args.repo}/${args["docs-dir"]}`
        : undefined,
      provider: providerConfig,
      forceRecompile: args.force,
      skipWiki: args["skip-wiki"],
      ingest: args.ingest,
      skipGitHub: args["skip-github"],
      skipTickets: args["skip-tickets"],
      quiet: mode === "check",
      mode,
    })

    if (mode === "check") {
      // Render check results as a table
      const drifted = result.triageResults.filter((t) => t.drifted).length
      const checkRows: log.TableRow[] = result.triageResults.map((t) => {
        if (!t.drifted) {
          return {
            Document: t.doc,
            Status: pc.green("✓ up to date"),
            Changed: "",
          }
        }
        // Extract just the count from "10 file(s) changed: added: ..."
        const countMatch = t.reason.match(/^(\d+) file/)
        const count = countMatch ? countMatch[1]! : "?"
        const detail = t.reason.includes("added:")
          ? "new files"
          : t.reason.includes("modified:")
            ? "modified"
            : "changed"
        return {
          Document: t.doc,
          Status: pc.yellow(`⚡ ${detail}`),
          Changed: count,
        }
      })
      log.table(["Document", "Status", "Changed"], checkRows)
      log.outro(drifted > 0 ? `${drifted} doc(s) drifted` : "all up to date")
    } else {
      const summaryLines: string[] = []

      if (result.updatedDocs.length > 0) {
        summaryLines.push(
          `${pc.green("✓")} ${pc.bold(`${result.updatedDocs.length}`)} doc(s) compiled`,
        )
      } else if (mode === "compile") {
        summaryLines.push(`${pc.green("✓")} All docs up to date`)
      }

      if (result.healthIssues.length > 0) {
        summaryLines.push(
          `${pc.yellow("⚠")} ${result.healthIssues.length} health issue(s)`,
        )
        for (const h of result.healthIssues) {
          for (const issue of h.issues) {
            summaryLines.push(`  ${pc.dim(h.doc)}: ${issue}`)
          }
        }
      } else if (mode === "health") {
        summaryLines.push(`${pc.green("✓")} All health checks passed`)
      }

      log.summary(summaryLines)
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred"
    log.error(message)
    process.exit(1)
  }
}

// ── Subcommands ─────────────────────────────────────────────────────

const main = defineCommand({
  meta: {
    name: "wiki-forge",
    version: VERSION,
    description: "Keep your docs in sync with your code using LLMs.",
  },
  run: async ({ rawArgs }) => {
    // Only show wizard when invoked with no subcommand
    if (rawArgs.length === 0) {
      await interactiveWizard(main)
    }
  },
  subCommands: {
    init: defineCommand({
      meta: { description: "Scaffold .doc-map.json with an example entry" },
      args: {
        repo: repoArg,
        "docs-dir": docsDirArg,
        interactive: {
          type: "boolean" as const,
          alias: "i",
          description: "Interactive setup",
          default: false,
        },
      },
      run: async ({ args }) => {
        if (args.interactive) {
          await interactiveInit(args.repo, args["docs-dir"])
        } else {
          await runInit(args.repo, args["docs-dir"])
        }
      },
    }),

    compile: defineCommand({
      meta: {
        description: "Full compilation — triage + recompile drifted docs",
      },
      args: llmArgs,
      run: async ({ args }) => {
        await runOrchestrate("compile", args)
      },
    }),

    check: defineCommand({
      meta: {
        description: "Triage only — report which docs drifted (no writes)",
      },
      args: llmArgs,
      run: async ({ args }) => {
        await runOrchestrate("check", args)
      },
    }),

    health: defineCommand({
      meta: { description: "Run health checks on health-check type docs only" },
      args: llmArgs,
      run: async ({ args }) => {
        await runOrchestrate("health", args)
      },
    }),

    status: defineCommand({
      meta: { description: "Show drift dashboard (no writes, no LLM calls)" },
      args: { repo: repoArg, "docs-dir": docsDirArg },
      run: async ({ args }) => {
        const { resolveConfig, loadDocMap } = await import("./config")
        const { loadHashes, computeDocHashes, diffHashes } = await import(
          "./compile/hashes"
        )
        const { getLastSyncCommit } = await import("./git")
        const { readdirSync } = await import("node:fs")
        const { join } = await import("node:path")

        const repo = args.repo
        const config = resolveConfig(
          repo,
          args["docs-dir"] ? `${repo}/${args["docs-dir"]}` : undefined,
        )

        let docMap: ReturnType<typeof loadDocMap>
        try {
          docMap = loadDocMap(config.docMapPath)
        } catch {
          log.error("No .doc-map.json found. Run 'wiki-forge init' first.")
          process.exit(1)
        }

        const lastSync = getLastSyncCommit(config.lastSyncPath, repo)
        const allHashes = loadHashes(config.docsDir)

        const entries = Object.entries(docMap.docs).filter(([, e]) => e != null)
        const compiled = entries.filter(([, e]) => e!.type === "compiled")
        const healthChecks = entries.filter(
          ([, e]) => e!.type === "health-check",
        )

        const pc = (await import("picocolors")).default
        let driftCount = 0
        const rows: log.TableRow[] = []

        for (const [docPath, entry] of entries) {
          if (!entry) continue
          if (entry.type === "health-check") {
            rows.push({ Document: docPath, Status: "health-check", Files: "—" })
            continue
          }
          const currentHashes = computeDocHashes(
            entry.sources,
            entry.context_files,
            repo,
          )
          const previousHashes = allHashes[docPath] ?? {}
          const hashDiff = diffHashes(previousHashes, currentHashes)
          const fileCount = Object.keys(currentHashes).length

          if (Object.keys(previousHashes).length === 0) {
            rows.push({
              Document: docPath,
              Status: pc.dim("not yet compiled"),
              Files: String(fileCount),
            })
            driftCount++
          } else if (hashDiff.changed) {
            const n =
              hashDiff.changedFiles.length +
              hashDiff.addedFiles.length +
              hashDiff.removedFiles.length
            rows.push({
              Document: docPath,
              Status: pc.yellow(`${n} changed`),
              Files: String(fileCount),
            })
            driftCount++
          } else {
            rows.push({
              Document: docPath,
              Status: pc.green("✓ up to date"),
              Files: String(fileCount),
            })
          }
        }

        const countFiles = (dir: string) => {
          try {
            return readdirSync(join(config.docsDir, dir)).filter((f: string) =>
              f.endsWith(".md"),
            ).length
          } catch {
            return 0
          }
        }
        const entityCount = countFiles("entities")
        const conceptCount = countFiles("concepts")

        log.intro("wiki-forge status")
        log.keyValue({
          "last sync": lastSync.slice(0, 7),
          "docs dir": config.docsDir,
        })
        log.table(["Document", "Status", "Files"], rows)

        const wikiLine =
          entityCount > 0 || conceptCount > 0
            ? `Wiki: ${entityCount} entities, ${conceptCount} concepts\n`
            : ""
        const totalLine = `${entries.length} docs (${compiled.length} compiled, ${healthChecks.length} health-check)`
        if (driftCount > 0) {
          log.outro(`${wikiLine}${totalLine} · ${driftCount} drifted`)
        } else {
          log.outro(`${wikiLine}${totalLine} · all up to date`)
        }
      },
    }),

    authors: defineCommand({
      meta: {
        description: "Generate AUTHORS.md from git history (no LLM calls)",
      },
      args: { repo: repoArg, "docs-dir": docsDirArg },
      run: async ({ args }) => {
        const { resolveConfig, loadDocMap } = await import("./config")
        const { generateAuthors } = await import("./git/authors")

        const config = resolveConfig(
          args.repo,
          args["docs-dir"] ? `${args.repo}/${args["docs-dir"]}` : undefined,
        )
        const docMap = loadDocMap(config.docMapPath)

        log.intro("wiki-forge authors")
        const authorsPath = generateAuthors(config.docsDir, docMap, args.repo)
        log.success(authorsPath)
        log.outro("")
      },
    }),

    index: defineCommand({
      meta: {
        description:
          "Regenerate INDEX.md from existing docs (uses triage model)",
      },
      args: llmArgs,
      run: async ({ args }) => {
        const provider = args.provider
        const resolvedKey =
          provider === "local" || provider === "ollama"
            ? ""
            : resolveApiKey(provider, args["api-key"])
        const { resolveConfig, loadDocMap } = await import("./config")
        const { createProviders } = await import("./providers")
        const { generateIndex } = await import("./compile/indexer")

        const config = resolveConfig(
          args.repo,
          args["docs-dir"] ? `${args.repo}/${args["docs-dir"]}` : undefined,
        )
        const docMap = loadDocMap(config.docMapPath)
        const providers = createProviders({
          provider: provider as ProviderConfig["provider"],
          apiKey: resolvedKey,
          localCmd: args["local-cmd"],
          triageModel: args["ollama-model"],
          compileModel: args["ollama-model"],
          ollamaUrl: args["ollama-url"],
        })

        log.intro("wiki-forge index")
        const indexPath = await generateIndex(
          config.docsDir,
          docMap,
          providers.triage,
          args.repo,
        )
        log.success(indexPath)
        log.outro("")
      },
    }),

    validate: defineCommand({
      meta: {
        description:
          "Check .doc-map.json for missing sources and config errors",
      },
      args: { repo: repoArg, "docs-dir": docsDirArg },
      run: async ({ args }) => {
        await runValidate(args.repo, args["docs-dir"])
      },
    }),

    report: defineCommand({
      meta: {
        description:
          "Generate brain health report and/or weekly report (uses LLM when provider given)",
      },
      args: {
        ...llmArgs,
        weekly: {
          type: "boolean" as const,
          description: "Also generate the weekly report",
          default: false,
        },
        days: {
          type: "string" as const,
          description: "Number of days to cover in weekly report (default: 7)",
        },
      },
      run: async ({ args }) => {
        const { resolveConfig, loadDocMap } = await import("./config")
        const { createProviders } = await import("./providers")
        const {
          analyzeRepository,
          analyzeWeek,
          generateStatusReport,
          generateWeeklyReport,
        } = await import("./report")

        const repo = args.repo
        const config = resolveConfig(
          repo,
          args["docs-dir"] ? `${repo}/${args["docs-dir"]}` : undefined,
        )

        let docMap: ReturnType<typeof loadDocMap>
        try {
          docMap = loadDocMap(config.docMapPath)
        } catch {
          log.error("No .doc-map.json found. Run 'wiki-forge init' first.")
          process.exit(1)
        }

        const provider = args.provider
        let triageProvider:
          | Awaited<ReturnType<typeof createProviders>>["triage"]
          | undefined
        try {
          const envVar = ENV_KEY_MAP[provider]
          const apiKey =
            args["api-key"] ?? (envVar ? process.env[envVar] : undefined)

          if (provider === "ollama") {
            const providers = createProviders({
              provider: "ollama",
              apiKey: "",
              triageModel: args["ollama-model"],
              compileModel: args["ollama-model"],
              ollamaUrl: args["ollama-url"],
            })
            triageProvider = providers.triage
          } else if (provider === "local") {
            const providers = createProviders({
              provider: "local",
              apiKey: "",
              localCmd: args["local-cmd"],
            })
            triageProvider = providers.triage
          } else if (apiKey) {
            const providers = createProviders({
              provider: provider as ProviderConfig["provider"],
              apiKey,
              localCmd: args["local-cmd"],
              triageModel: args["ollama-model"],
              compileModel: args["ollama-model"],
              ollamaUrl: args["ollama-url"],
            })
            triageProvider = providers.triage
          }
        } catch {
          // Provider creation failed — template fallback
        }

        const mode = triageProvider ? "LLM" : "template"
        log.intro("wiki-forge report")
        log.info(`Mode: ${mode}`)

        let spinner = log.spin("Generating brain health report...")
        const statusPath = await generateStatusReport(
          config.docsDir,
          analyzeRepository(config.docsDir, docMap, repo),
          triageProvider,
        )
        spinner.stop()
        log.success(statusPath)

        if (args.weekly) {
          const days = args.days ? Number(args.days) : 7
          spinner = log.spin("Generating weekly report...")
          const weeklyPath = await generateWeeklyReport(
            config.docsDir,
            analyzeWeek(config.docsDir, docMap, repo, days),
            triageProvider,
          )
          spinner.stop()
          log.success(weeklyPath)
        }

        log.outro("")
      },
    }),

    "install-commands": defineCommand({
      meta: { description: "Install /wf-* slash commands for Claude Code" },
      args: {},
      run: async () => {
        const { cpSync, mkdirSync, readdirSync } = await import("node:fs")
        const { join, dirname } = await import("node:path")
        const { fileURLToPath } = await import("node:url")

        const targetDir = join(
          process.env.HOME ?? process.env.USERPROFILE ?? "~",
          ".claude",
          "commands",
        )
        mkdirSync(targetDir, { recursive: true })

        const srcDir = join(
          dirname(fileURLToPath(import.meta.url)),
          "..",
          "commands",
        )
        const files = readdirSync(srcDir).filter((f: string) =>
          f.endsWith(".md"),
        )

        for (const file of files) {
          cpSync(join(srcDir, file), join(targetDir, file))
        }

        log.intro("wiki-forge install-commands")
        log.success(`Installed ${files.length} commands to ${targetDir}`)
        log.list(
          files.map((file: string) => ({
            label: `/${file.replace(".md", "")}`,
          })),
        )
        log.outro("")
      },
    }),
  },
})

runMain(main)
