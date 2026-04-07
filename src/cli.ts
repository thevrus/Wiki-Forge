#!/usr/bin/env node

import { orchestrate } from "./orchestrate"
import type { ProviderConfig } from "./providers/types"

const VERSION = "0.1.0"

const HELP = `
wiki-forge v${VERSION}
Keep your docs in sync with your code using LLMs.

Usage:
  wiki-forge <command> [flags]

Commands:
  init         Scaffold .doc-map.json with an example entry
  check        Triage only — report which docs drifted (no writes)
  compile      Full compilation — triage + recompile drifted docs
  health       Run health checks on health-check type docs only
  index        Regenerate INDEX.md from existing docs (uses triage model)
  validate         Check .doc-map.json for missing sources and config errors
  install-commands Install /wf-* slash commands for Claude Code

Flags:
  --provider <gemini|claude|openai|local>  LLM provider (default: gemini)
  --api-key <key>                     API key (or set GEMINI_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY)
  --repo <path>                       Repository root (default: current directory)
  --docs-dir <path>                   Docs output directory (default: docs/)
  --force                             Force recompile all docs regardless of drift
  --interactive, -i                   Interactive setup (for init command)
  --local-cmd <cmd>                   CLI command for local provider (default: "claude -p")

Examples:
  wiki-forge init
  wiki-forge init --interactive
  wiki-forge validate
  wiki-forge check
  wiki-forge compile --provider local
  wiki-forge compile --provider local --local-cmd "codex -q"
  wiki-forge compile --provider claude --api-key sk-ant-...
  wiki-forge compile --force --docs-dir documentation
  wiki-forge health
`.trim()

const ENV_KEY_MAP: Record<string, string> = {
  gemini: "GEMINI_API_KEY",
  claude: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
}

function parseArgs(argv: string[]): {
  command: string | undefined
  provider: "gemini" | "claude" | "openai" | "local"
  apiKey: string | undefined
  repo: string
  docsDir: string | undefined
  force: boolean
  interactive: boolean
  localCmd: string | undefined
} {
  const args = argv.slice(2)
  let command: string | undefined
  let provider: "gemini" | "claude" | "openai" | "local" = "gemini"
  let apiKey: string | undefined
  let repo = process.cwd()
  let docsDir: string | undefined
  let force = false
  let interactive = false
  let localCmd: string | undefined

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === "--provider" && args[i + 1]) {
      const val = args[i + 1]!
      if (
        val !== "gemini" &&
        val !== "claude" &&
        val !== "openai" &&
        val !== "local"
      ) {
        fatal(
          `Unknown provider: ${val}. Must be gemini, claude, openai, or local.`,
        )
      }
      provider = val
      i++
    } else if (arg === "--api-key" && args[i + 1]) {
      apiKey = args[i + 1]!
      i++
    } else if (arg === "--repo" && args[i + 1]) {
      repo = args[i + 1]!
      i++
    } else if (arg === "--docs-dir" && args[i + 1]) {
      docsDir = args[i + 1]!
      i++
    } else if (arg === "--local-cmd" && args[i + 1]) {
      localCmd = args[i + 1]!
      i++
    } else if (arg === "--force") {
      force = true
    } else if (arg === "--interactive" || arg === "-i") {
      interactive = true
    } else if (arg === "--help" || arg === "-h") {
      console.log(HELP)
      process.exit(0)
    } else if (arg === "--version" || arg === "-v") {
      console.log(VERSION)
      process.exit(0)
    } else if (!arg.startsWith("-") && !command) {
      command = arg
    }
  }

  return {
    command,
    provider,
    apiKey,
    repo,
    docsDir,
    force,
    interactive,
    localCmd,
  }
}

function fatal(message: string): never {
  console.error(`\n⚠  ${message}\n`)
  console.error(HELP)
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

  const example = {
    docs: {
      "ARCHITECTURE.md": {
        description:
          "High-level system architecture: services, data flow, and infrastructure",
        type: "compiled",
        sources: ["src/"],
        context_files: ["package.json"],
      },
    },
  }

  writeFileSync(docMapPath, `${JSON.stringify(example, null, 2)}\n`)
  console.log(`📚 Created ${dirName}/.doc-map.json with an example entry.`)
  console.log("   Edit the doc map, then run: wiki-forge compile")
}

// ── Interactive init (React/Ink TUI) ──────────────────────────────────

async function interactiveInit(repo: string, docsDir?: string) {
  const { runInteractiveInit } = await import("./init-interactive")
  await runInteractiveInit(repo, docsDir)
}

// ── Validate ──────────────────────────────────────────────────────────

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

async function main() {
  const {
    command,
    provider,
    apiKey,
    repo,
    docsDir,
    force,
    interactive,
    localCmd,
  } = parseArgs(process.argv)

  if (!command) {
    fatal("No command specified.")
  }

  if (command === "install-commands") {
    const { cpSync, mkdirSync, readdirSync } = await import("node:fs")
    const { join, dirname } = await import("node:path")
    const { fileURLToPath } = await import("node:url")

    const targetDir = join(
      process.env.HOME ?? process.env.USERPROFILE ?? "~",
      ".claude",
      "commands",
    )
    mkdirSync(targetDir, { recursive: true })

    // Resolve commands/ relative to the package root
    const srcDir = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "commands",
    )
    const files = readdirSync(srcDir).filter((f: string) => f.endsWith(".md"))

    for (const file of files) {
      cpSync(join(srcDir, file), join(targetDir, file))
    }

    console.log(`\n✅ Installed ${files.length} commands to ${targetDir}:\n`)
    for (const file of files) {
      console.log(`   /${file.replace(".md", "")}`)
    }
    console.log()
    return
  }

  if (command === "init") {
    if (interactive) {
      await interactiveInit(repo, docsDir)
    } else {
      await runInit(repo, docsDir)
    }
    return
  }

  if (command === "validate") {
    await runValidate(repo, docsDir)
    return
  }

  if (command === "index") {
    const resolvedKey =
      provider === "local" ? "" : resolveApiKey(provider, apiKey)
    const { resolveConfig, loadDocMap } = await import("./config")
    const { createProviders } = await import("./providers")
    const { generateIndex } = await import("./indexer")

    const config = resolveConfig(
      repo,
      docsDir ? `${repo}/${docsDir}` : undefined,
    )
    const docMap = loadDocMap(config.docMapPath)
    const providers = createProviders({
      provider,
      apiKey: resolvedKey,
      localCmd,
    })

    console.log("\n📇 Generating INDEX.md...\n")
    const indexPath = await generateIndex(
      config.docsDir,
      docMap,
      providers.triage,
    )
    console.log(`✅ ${indexPath}\n`)
    return
  }

  const validCommands = ["check", "compile", "health"]
  if (!validCommands.includes(command)) {
    fatal(`Unknown command: ${command}`)
  }

  const resolvedKey =
    provider === "local" ? "" : resolveApiKey(provider, apiKey)

  const providerConfig: ProviderConfig = {
    provider,
    apiKey: resolvedKey,
    localCmd,
  }

  const mode = command as "check" | "compile" | "health"

  console.log(`\n📚 wiki-forge — ${mode} mode`)
  console.log(`   Provider: ${provider}`)
  console.log(`   Repo: ${repo}`)
  if (docsDir) console.log(`   Docs: ${docsDir}`)
  if (force) console.log(`   ⚡ Force recompile: all docs`)
  console.log()

  try {
    const result = await orchestrate({
      repoRoot: repo,
      docsDir: docsDir ? `${repo}/${docsDir}` : undefined,
      provider: providerConfig,
      forceRecompile: force,
      mode,
    })

    // Print triage results
    if (result.triageResults.length > 0) {
      console.log("🔍 Triage results:")
      for (const t of result.triageResults) {
        const icon = t.drifted ? "⚡" : "✅"
        console.log(`   ${icon} ${t.doc} — ${t.reason}`)
      }
      console.log()
    }

    // Print updated docs
    if (result.updatedDocs.length > 0) {
      console.log("📚 Updated docs:")
      for (const doc of result.updatedDocs) {
        console.log(`   ✅ ${doc}`)
      }
      console.log()
    } else if (mode === "compile") {
      console.log("✅ All docs are up to date.\n")
    }

    // Print health issues
    if (result.healthIssues.length > 0) {
      console.log("⚠  Health issues:")
      for (const h of result.healthIssues) {
        console.log(`   ${h.doc}:`)
        for (const issue of h.issues) {
          console.log(`     - ${issue}`)
        }
      }
      console.log()
    } else if (mode === "health") {
      console.log("✅ All health checks passed.\n")
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred"
    console.error(`\n⚠  ${message}\n`)
    process.exit(1)
  }
}

main()
