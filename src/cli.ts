#!/usr/bin/env node

import { defineCommand, runMain } from "citty"
import { orchestrate } from "./orchestrate"
import type { ProviderConfig } from "./providers/types"

const VERSION = "0.5.0"

// ── Shared arg definitions ──────────────────────────────────────────

const providerArg = {
  type: "enum" as const,
  description: "LLM provider",
  default: "gemini",
  options: ["gemini", "claude", "openai", "ollama", "local"],
}

const repoArg = {
  type: "string" as const,
  description: "Repository root",
  default: process.cwd(),
}

const docsDirArg = {
  type: "string" as const,
  description: "Docs output directory",
}

const apiKeyArg = {
  type: "string" as const,
  description:
    "API key (or set GEMINI_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY)",
}

const localCmdArg = {
  type: "string" as const,
  description: 'CLI command for local provider (default: "claude -p")',
}

const ollamaModelArg = {
  type: "string" as const,
  description: "Ollama model name (default: llama3.1)",
}

const ollamaUrlArg = {
  type: "string" as const,
  description: "Ollama server URL (default: http://localhost:11434)",
}

const forceArg = {
  type: "boolean" as const,
  description: "Force recompile all docs regardless of drift",
  default: false,
}

const skipWikiArg = {
  type: "boolean" as const,
  description: "Skip entity/concept extraction (faster compile)",
  default: false,
}

// ── Helpers ──────────────────────────────────────────────────────────

const ENV_KEY_MAP: Record<string, string> = {
  gemini: "GEMINI_API_KEY",
  claude: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
}

function fatal(message: string): never {
  console.error(`\n⚠  ${message}\n`)
  process.exit(1)
}

function resolveApiKey(provider: string, explicit: string | undefined): string {
  if (explicit) return explicit
  const envVar = ENV_KEY_MAP[provider]
  if (!envVar) fatal(`Unknown provider: ${provider}`)
  const key = process.env[envVar]
  if (!key)
    fatal(`No API key. Set --api-key or ${envVar} environment variable.`)
  return key
}

function detectSourceDirs(repo: string): string[] {
  const { existsSync, readdirSync, statSync } =
    require("node:fs") as typeof import("node:fs")

  const candidates = [
    "src",
    "lib",
    "app",
    "apps",
    "packages",
    "services",
    "server",
    "client",
    "api",
    "core",
    "modules",
    "components",
    "cmd",
    "pkg",
    "internal",
    "crates",
    "django",
    "flask",
    "main",
    "domain",
    "controllers",
    "models",
    "mix",
  ]

  const sourceExts = new Set([
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".py",
    ".go",
    ".rs",
    ".rb",
    ".java",
    ".kt",
    ".scala",
    ".cs",
    ".swift",
    ".php",
    ".ex",
    ".dart",
  ])

  const found: string[] = []

  for (const dir of candidates) {
    const full = `${repo}/${dir}`
    if (existsSync(full) && statSync(full).isDirectory()) {
      found.push(`${dir}/`)
    }
  }

  if (found.length === 0) {
    const entries = readdirSync(repo, { withFileTypes: true })
    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        entry.name.startsWith(".") ||
        entry.name === "node_modules" ||
        entry.name === "docs" ||
        entry.name === "brain" ||
        entry.name === "dist" ||
        entry.name === "build" ||
        entry.name === "vendor"
      )
        continue

      try {
        const files = readdirSync(`${repo}/${entry.name}`)
        const hasSource = files.some((f: string) => {
          const ext = f.slice(f.lastIndexOf("."))
          return sourceExts.has(ext)
        })
        if (hasSource) found.push(`${entry.name}/`)
      } catch {
        // skip unreadable
      }
    }
  }

  return found.length > 0 ? found : ["src/"]
}

function detectWorkspacePackages(
  repo: string,
): Array<{ name: string; path: string }> {
  const { existsSync, readdirSync, readFileSync, statSync } =
    require("node:fs") as typeof import("node:fs")

  const workspaceDirs = ["apps", "packages", "services"]
  const packages: Array<{ name: string; path: string }> = []

  for (const dir of workspaceDirs) {
    const full = `${repo}/${dir}`
    if (!existsSync(full) || !statSync(full).isDirectory()) continue

    const entries = readdirSync(full, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue
      const pkgPath = `${full}/${entry.name}`

      const hasPkgJson = existsSync(`${pkgPath}/package.json`)
      if (hasPkgJson) {
        try {
          const raw = readFileSync(`${pkgPath}/package.json`, "utf-8")
          const pkg = JSON.parse(raw)
          packages.push({
            name: pkg.name ?? entry.name,
            path: `${dir}/${entry.name}/`,
          })
        } catch {
          packages.push({ name: entry.name, path: `${dir}/${entry.name}/` })
        }
      } else {
        try {
          const files = readdirSync(pkgPath)
          const hasSource = files.some(
            (f: string) =>
              f.endsWith(".ts") ||
              f.endsWith(".tsx") ||
              f.endsWith(".js") ||
              f.endsWith(".py") ||
              f.endsWith(".go"),
          )
          if (hasSource) {
            packages.push({ name: entry.name, path: `${dir}/${entry.name}/` })
          }
        } catch {
          // skip
        }
      }
    }
  }

  return packages
}

function scanDomainDirs(dir: string): string[] {
  const { readdirSync } = require("node:fs") as typeof import("node:fs")
  const dirs: string[] = []

  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        entry.name.startsWith(".") ||
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name === "build" ||
        entry.name === ".expo" ||
        entry.name === ".next" ||
        entry.name === "assets" ||
        entry.name === "docs"
      )
        continue

      dirs.push(`${entry.name}/`)

      try {
        const subEntries = readdirSync(`${dir}/${entry.name}`, {
          withFileTypes: true,
        })
        for (const sub of subEntries) {
          if (
            sub.isDirectory() &&
            !sub.name.startsWith(".") &&
            sub.name !== "node_modules"
          ) {
            dirs.push(`${entry.name}/${sub.name}/`)
          }
        }
      } catch {
        // skip
      }
    }
  } catch {
    // skip
  }

  return dirs
}

function splitDirIfNeeded(
  dir: string,
  repoRoot: string,
  budget: number,
): string[] {
  const { readdirSync } = require("node:fs") as typeof import("node:fs")
  const { estimateSourceSize } = require("./file-glob") as typeof import("./file-glob")
  const fullDir = `${repoRoot}/${dir}`
  try {
    const entries = readdirSync(fullDir, { withFileTypes: true })
    const subDirs = entries
      .filter(
        (e) =>
          e.isDirectory() &&
          !e.name.startsWith(".") &&
          e.name !== "node_modules",
      )
      .map((e) => `${dir}${e.name}/`)

    if (subDirs.length <= 1) return [dir]

    const totalSize = estimateSourceSize(subDirs, repoRoot)
    if (totalSize === 0) return [dir]
    // Only split if subdirs actually help
    return totalSize > budget ? subDirs : [dir]
  } catch {
    return [dir]
  }
}

// ── Init ──────────────────────────────────────────────────────────────

async function runInit(repo: string, customDocsDir?: string) {
  const { mkdirSync, writeFileSync, existsSync } = await import("node:fs")
  const dirName = customDocsDir ?? "docs"
  const docsDir = `${repo}/${dirName}`
  const docMapPath = `${docsDir}/.doc-map.json`

  if (existsSync(docMapPath)) {
    console.log(`⏭  ${dirName}/.doc-map.json already exists, skipping.`)
    return
  }

  mkdirSync(docsDir, { recursive: true })

  const contextFiles = existsSync(`${repo}/package.json`)
    ? ["package.json"]
    : []

  const workspaces = detectWorkspacePackages(repo)

  const docs: Record<
    string,
    {
      description: string
      type: string
      sources: string[]
      context_files: string[]
    }
  > = {}

  const { estimateSourceSize } = await import("./file-glob")
  const { SOURCE_BUDGET } = await import("./constants")

  // Domain category patterns for splitting large packages
  const DOMAIN_CATEGORIES: Array<{
    pattern: RegExp
    suffix: string
    description: string
  }> = [
    {
      pattern: /\/(app|pages?|screens?|views?|tabs|navigation|routes?)\//,
      suffix: "SCREENS",
      description: "screens, navigation, routes, and user-facing flows",
    },
    {
      pattern: /\/(components?|ui|widgets?|elements?)\//,
      suffix: "COMPONENTS",
      description: "reusable UI components, design system elements",
    },
    {
      pattern: /\/(hooks?|services?|api|clients?|graphql|queries|mutations)\//,
      suffix: "DATA-LAYER",
      description: "hooks, services, API clients, data fetching, state management",
    },
    {
      pattern: /\/(constants?|config|rules?|validations?|policies|permissions?)\//,
      suffix: "BUSINESS-RULES",
      description: "business rules, validation, constants, feature flags, permissions",
    },
    {
      pattern: /\/(store|state|redux|zustand|context|providers?)\//,
      suffix: "STATE",
      description: "state management, stores, context providers",
    },
    {
      pattern: /\/(utils?|helpers?|lib|shared|common)\//,
      suffix: "UTILS",
      description: "shared utilities, helpers, and common modules",
    },
    {
      pattern: /\/(models?|types?|schemas?|entities|domain)\//,
      suffix: "MODELS",
      description: "data models, types, schemas, and domain entities",
    },
    {
      pattern: /\/(notifications?|push|messaging|alerts?)\//,
      suffix: "NOTIFICATIONS",
      description: "notifications, push messaging, alerts",
    },
  ]

  function splitPackage(
    pkgName: string,
    prefix: string,
    pkgPath: string,
    subDirs: string[],
  ) {
    const totalSize = estimateSourceSize([pkgPath], repo)
    const upper = prefix.toUpperCase()

    // Small package — single doc
    if (totalSize <= SOURCE_BUDGET) {
      docs[`${upper}.md`] = {
        description: `${pkgName}: complete knowledge base — features, user flows, business rules, data model, integrations`,
        type: "compiled",
        sources: [pkgPath],
        context_files: contextFiles,
      }
      return
    }

    // Large package — split by domain categories
    const claimed = new Set<string>()

    for (const cat of DOMAIN_CATEGORIES) {
      const matching = subDirs
        .filter((d) => cat.pattern.test(`/${d}`))
        .map((d) => `${pkgPath}${d}`)

      if (matching.length === 0) continue

      const size = estimateSourceSize(matching, repo)
      if (size === 0) continue

      for (const d of matching) claimed.add(d)

      if (size <= SOURCE_BUDGET) {
        docs[`${upper}-${cat.suffix}.md`] = {
          description: `${pkgName} ${cat.description}`,
          type: "compiled",
          sources: matching,
          context_files: contextFiles,
        }
      } else {
        // Category too large — split by individual subdirectory
        // Drop parent dirs that have children also in the list
        const leaves = matching.filter(
          (d) => !matching.some((other) => other !== d && other.startsWith(d)),
        )
        // For single-dir categories that are still too big, scan one level deeper
        const finalDirs =
          leaves.length === 1
            ? splitDirIfNeeded(leaves[0]!, repo, SOURCE_BUDGET)
            : leaves
        for (const dir of finalDirs) {
          const dirSize = estimateSourceSize([dir], repo)
          if (dirSize === 0) continue
          const dirName = dir
            .replace(pkgPath, "")
            .replace(/\//g, "-")
            .replace(/-$/, "")
            .toUpperCase()
          const shortName = dir.replace(pkgPath, "").replace(/\/$/, "")
          docs[`${upper}-${dirName}.md`] = {
            description: `${pkgName} ${shortName}: ${cat.description}`,
            type: "compiled",
            sources: [dir],
            context_files: contextFiles,
          }
        }
      }
    }

    // Unclaimed dirs get an overview doc (or split further if too large)
    const unclaimed = subDirs
      .map((d) => `${pkgPath}${d}`)
      .filter((d) => !claimed.has(d))
    // Drop parent dirs that have children also in the list
    const unclaimedLeaves = unclaimed.filter(
      (d) => !unclaimed.some((other) => other !== d && other.startsWith(d)),
    )

    if (unclaimedLeaves.length > 0) {
      const unclaimedSize = estimateSourceSize(unclaimedLeaves, repo)
      if (unclaimedSize > 0 && unclaimedSize <= SOURCE_BUDGET) {
        docs[`${upper}.md`] = {
          description: `${pkgName} overview: architecture, entry points, and modules not covered by other docs`,
          type: "compiled",
          sources: unclaimedLeaves,
          context_files: contextFiles,
        }
      } else if (unclaimedSize > SOURCE_BUDGET) {
        for (const dir of unclaimedLeaves) {
          const dirSize = estimateSourceSize([dir], repo)
          if (dirSize === 0) continue
          const dirName = dir
            .replace(pkgPath, "")
            .replace(/\//g, "-")
            .replace(/-$/, "")
            .toUpperCase()
          const shortName = dir.replace(pkgPath, "").replace(/\/$/, "")
          docs[`${upper}-${dirName}.md`] = {
            description: `${pkgName} ${shortName}`,
            type: "compiled",
            sources: [dir],
            context_files: contextFiles,
          }
        }
      }
    }
  }

  if (workspaces.length > 1) {
    // Monorepo: top-level architecture + per-package split
    const rootConfigs = ["package.json", "tsconfig.json", "turbo.json"]
      .filter((f) => existsSync(`${repo}/${f}`))
    docs["ARCHITECTURE.md"] = {
      description:
        "Monorepo overview: workspace structure, shared dependencies, cross-package data flow, and tech stack",
      type: "compiled",
      sources: rootConfigs.length > 0 ? rootConfigs : detectSourceDirs(repo).slice(0, 3),
      context_files: contextFiles,
    }

    for (const pkg of workspaces) {
      const slug = pkg.name.replace(/^@[^/]+\//, "").replace(/[^a-z0-9-]/g, "-")
      const pkgFull = `${repo}/${pkg.path}`
      const subDirs = scanDomainDirs(pkgFull)
      splitPackage(pkg.name, slug, pkg.path, subDirs)
    }

    // Remove docs with negligible source (<1KB)
    for (const name of Object.keys(docs)) {
      const size = estimateSourceSize(docs[name]!.sources, repo)
      if (size < 1024) delete docs[name]
    }

    console.log(`📚 Created ${dirName}/.doc-map.json (monorepo detected)`)
    console.log(`   ${workspaces.length} workspace packages found`)
    console.log(`   ${Object.keys(docs).length} docs configured:`)
    for (const name of Object.keys(docs)) {
      const size = estimateSourceSize(docs[name]!.sources, repo)
      const sizeKb = Math.round(size / 1024)
      const flag = size > SOURCE_BUDGET ? " ⚠ large" : ""
      console.log(`     ${name} (${sizeKb}KB)${flag}`)
    }
  } else {
    // Single project
    const sources = detectSourceDirs(repo)
    const totalSize = estimateSourceSize(sources, repo)
    const subDirs = scanDomainDirs(repo)

    if (totalSize <= SOURCE_BUDGET) {
      docs["PRODUCT.md"] = {
        description:
          "Complete product knowledge base: features, user flows, business rules, data model, integrations, and architecture",
        type: "compiled",
        sources,
        context_files: contextFiles,
      }
    } else {
      splitPackage("Project", "PRODUCT", sources[0] ?? "src/", subDirs)
    }

    console.log(`📚 Created ${dirName}/.doc-map.json`)
    console.log(`   Detected sources: ${sources.join(", ")} (${Math.round(totalSize / 1024)}KB)`)
    console.log(`   ${Object.keys(docs).length} docs configured`)
  }

  writeFileSync(docMapPath, `${JSON.stringify({ docs }, null, 2)}\n`)
  console.log("   Edit the doc map, then run: wiki-forge compile")
}

async function interactiveInit(repo: string, docsDir?: string) {
  const { runInteractiveInit } = await import("./init-interactive")
  await runInteractiveInit(repo, docsDir)
}

// ── Validate ────────────────────────────────────────────────────────

async function runValidate(repo: string, docsDir?: string) {
  const { validateDocMap } = await import("./validate")

  const issues = validateDocMap(
    repo,
    docsDir ? `${repo}/${docsDir}` : undefined,
  )

  if (issues.length === 0) {
    console.log("\n✅ Doc map is valid.\n")
    return
  }

  const errors = issues.filter((i) => i.severity === "error")
  const warnings = issues.filter((i) => i.severity === "warning")

  console.log("\n📋 Validation results:\n")
  for (const issue of issues) {
    const icon = issue.severity === "error" ? "✗" : "⚠"
    console.log(`   ${icon} ${issue.doc}: ${issue.message}`)
  }

  console.log(`\n   ${errors.length} error(s), ${warnings.length} warning(s)\n`)

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
    "local-cmd"?: string
    "ollama-model"?: string
    "ollama-url"?: string
  },
) {
  const provider = args.provider
  const resolvedKey =
    provider === "local" || provider === "ollama"
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

  const log = await import("./logger")
  const pc = (await import("picocolors")).default

  log.header(mode, provider, args.repo)
  if (args.force) log.info(pc.yellow("Force recompile: all docs"))

  try {
    const result = await orchestrate({
      repoRoot: args.repo,
      docsDir: args["docs-dir"] ? `${args.repo}/${args["docs-dir"]}` : undefined,
      provider: providerConfig,
      forceRecompile: args.force,
      skipWiki: args["skip-wiki"],
      mode,
    })

    const summaryLines: string[] = []

    if (result.updatedDocs.length > 0) {
      summaryLines.push(
        `${pc.green("✓")} ${pc.bold(`${result.updatedDocs.length}`)} doc(s) compiled`,
      )
    } else if (mode === "compile") {
      summaryLines.push(`${pc.green("✓")} All docs up to date`)
    }

    const drifted = result.triageResults.filter((t) => t.drifted).length
    if (mode === "check" && drifted > 0) {
      summaryLines.push(`${pc.magenta("⚡")} ${drifted} doc(s) drifted`)
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
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred"
    log.error(message)
    process.exit(1)
  }
}

// ── Subcommands ─────────────────────────────────────────────────────

const llmArgs = {
  provider: providerArg,
  "api-key": apiKeyArg,
  repo: repoArg,
  "docs-dir": docsDirArg,
  force: forceArg,
  "skip-wiki": skipWikiArg,
  "local-cmd": localCmdArg,
  "ollama-model": ollamaModelArg,
  "ollama-url": ollamaUrlArg,
}

const main = defineCommand({
  meta: {
    name: "wiki-forge",
    version: VERSION,
    description: "Keep your docs in sync with your code using LLMs.",
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
      meta: { description: "Full compilation — triage + recompile drifted docs" },
      args: llmArgs,
      run: async ({ args }) => {
        await runOrchestrate("compile", args)
      },
    }),

    check: defineCommand({
      meta: { description: "Triage only — report which docs drifted (no writes)" },
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
          "./hashes"
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
          console.log(
            "\n✗ No .doc-map.json found. Run 'wiki-forge init' first.\n",
          )
          process.exit(1)
        }

        const lastSync = getLastSyncCommit(config.lastSyncPath, repo)
        const allHashes = loadHashes(config.docsDir)

        const entries = Object.entries(docMap.docs).filter(([, e]) => e != null)
        const compiled = entries.filter(([, e]) => e!.type === "compiled")
        const healthChecks = entries.filter(
          ([, e]) => e!.type === "health-check",
        )

        let driftCount = 0
        const lines: string[] = []

        for (const [docPath, entry] of entries) {
          if (!entry) continue
          if (entry.type === "health-check") {
            lines.push(`  ⚠ ${docPath.padEnd(24)} — health-check`)
            continue
          }
          const currentHashes = computeDocHashes(
            entry.sources,
            entry.context_files,
            repo,
          )
          const previousHashes = allHashes[docPath] ?? {}
          const hashDiff = diffHashes(previousHashes, currentHashes)

          if (Object.keys(previousHashes).length === 0) {
            lines.push(`  ○ ${docPath.padEnd(24)} — not yet compiled`)
            driftCount++
          } else if (hashDiff.changed) {
            const n =
              hashDiff.changedFiles.length +
              hashDiff.addedFiles.length +
              hashDiff.removedFiles.length
            lines.push(`  ⚡ ${docPath.padEnd(24)} — ${n} file(s) changed`)
            driftCount++
          } else {
            lines.push(`  ✓ ${docPath.padEnd(24)} — up to date`)
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

        console.log("\n📊 wiki-forge status")
        console.log(`   Last sync: ${lastSync.slice(0, 7)}`)
        console.log(`   Docs dir:  ${config.docsDir}\n`)
        console.log("   Documents:")
        for (const l of lines) console.log(`  ${l}`)
        console.log()
        if (entityCount > 0 || conceptCount > 0) {
          console.log(
            `   Wiki: ${entityCount} entities, ${conceptCount} concepts`,
          )
        }
        console.log(
          `   Total: ${entries.length} docs (${compiled.length} compiled, ${healthChecks.length} health-check)`,
        )
        if (driftCount > 0) {
          console.log(`   ⚡ ${driftCount} doc(s) drifted\n`)
        } else {
          console.log("   ✅ All up to date\n")
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
        const { generateAuthors } = await import("./authors")

        const config = resolveConfig(
          args.repo,
          args["docs-dir"] ? `${args.repo}/${args["docs-dir"]}` : undefined,
        )
        const docMap = loadDocMap(config.docMapPath)

        console.log("\n👥 Generating AUTHORS.md...\n")
        const authorsPath = generateAuthors(config.docsDir, docMap, args.repo)
        console.log(`✅ ${authorsPath}\n`)
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
        const { generateIndex } = await import("./indexer")

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

        console.log("\n📇 Generating INDEX.md...\n")
        const indexPath = await generateIndex(
          config.docsDir,
          docMap,
          providers.triage,
          args.repo,
        )
        console.log(`✅ ${indexPath}\n`)
      },
    }),

    validate: defineCommand({
      meta: {
        description:
          "Check .doc-map.json for missing sources and config errors",
      },
      args: { repo: repoArg, "docs-dir": docsDirArg },
      run: async ({ args }) => {
        await runValidate(
          args.repo,
          args["docs-dir"],
        )
      },
    }),

    "brain-init": defineCommand({
      meta: { description: "Scaffold brain/ business knowledge templates" },
      args: { repo: repoArg, "docs-dir": docsDirArg },
      run: async ({ args }) => {
        const { cpSync, mkdirSync, existsSync, readdirSync, readFileSync } =
          await import("node:fs")
        const { join, dirname } = await import("node:path")
        const { fileURLToPath } = await import("node:url")

        const repo = args.repo
        const brainDir = `${repo}/brain`
        if (existsSync(brainDir)) {
          const existing = readdirSync(brainDir).filter((f: string) =>
            f.endsWith(".md"),
          )
          if (existing.length > 0) {
            console.log(
              `\n⏭  brain/ already exists with ${existing.length} files.\n`,
            )
            return
          }
        }

        mkdirSync(brainDir, { recursive: true })
        mkdirSync(`${brainDir}/DECISIONS`, { recursive: true })

        const templatesDir = join(
          dirname(fileURLToPath(import.meta.url)),
          "..",
          "brain-templates",
        )
        const templates = readdirSync(templatesDir).filter((f: string) =>
          f.endsWith(".md"),
        )

        for (const file of templates) {
          cpSync(join(templatesDir, file), join(brainDir, file))
        }

        console.log(`\n🧠 Created brain/ with ${templates.length} templates:\n`)
        for (const file of templates) {
          console.log(`   brain/${file}`)
        }

        const docsDir = args["docs-dir"] ?? "docs"
        const docMapPath = `${repo}/${docsDir}/.doc-map.json`
        if (existsSync(docMapPath)) {
          const raw = readFileSync(docMapPath, "utf-8")
          const docMap = JSON.parse(raw)
          const brainFiles = templates.map((f: string) => `brain/${f}`)
          let wired = 0
          for (const [, entry] of Object.entries(docMap.docs ?? {})) {
            const e = entry as { context_files?: string[] }
            if (
              e.context_files &&
              !e.context_files.some((f: string) => f.startsWith("brain/"))
            ) {
              e.context_files.push(...brainFiles)
              wired++
            }
          }
          if (wired > 0) {
            const { writeFileSync } = await import("node:fs")
            writeFileSync(docMapPath, `${JSON.stringify(docMap, null, 2)}\n`)
            console.log(
              `\n   ✓ Wired brain/ into ${wired} doc(s) in .doc-map.json`,
            )
          }
        }

        console.log(
          "\n   Fill in the brain docs — they feed into every compilation.",
        )
        console.log("   ▶ Next: /wf-brain claude\n")
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

        console.log(
          `\n✅ Installed ${files.length} commands to ${targetDir}:\n`,
        )
        for (const file of files) {
          console.log(`   /${file.replace(".md", "")}`)
        }
        console.log()
      },
    }),
  },
})

runMain(main)
