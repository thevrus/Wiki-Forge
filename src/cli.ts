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
  brain-init   Scaffold brain/ business knowledge templates
  status       Show drift dashboard (no writes, no LLM calls)
  check        Triage only — report which docs drifted (no writes)
  compile      Full compilation — triage + recompile drifted docs
  health       Run health checks on health-check type docs only
  authors      Generate AUTHORS.md from git history (no LLM calls)
  index        Regenerate INDEX.md from existing docs (uses triage model)
  validate         Check .doc-map.json for missing sources and config errors
  install-commands Install /wf-* slash commands for Claude Code

Flags:
  --provider <gemini|claude|openai|ollama|local>  LLM provider (default: gemini)
  --api-key <key>                     API key (or set GEMINI_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY)
  --repo <path>                       Repository root (default: current directory)
  --docs-dir <path>                   Docs output directory (default: docs/)
  --force                             Force recompile all docs regardless of drift
  --interactive, -i                   Interactive setup (for init command)
  --local-cmd <cmd>                   CLI command for local provider (default: "claude -p")
  --ollama-model <model>              Ollama model name (default: llama3.1)
  --ollama-url <url>                  Ollama server URL (default: http://localhost:11434)

Examples:
  wiki-forge init
  wiki-forge init --interactive
  wiki-forge validate
  wiki-forge check
  wiki-forge compile --provider local
  wiki-forge compile --provider local --local-cmd "codex -q"
  wiki-forge compile --provider claude --api-key sk-ant-...
  wiki-forge compile --provider ollama --ollama-model deepseek-r1
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
  provider: "gemini" | "claude" | "openai" | "local" | "ollama"
  apiKey: string | undefined
  repo: string
  docsDir: string | undefined
  force: boolean
  interactive: boolean
  localCmd: string | undefined
  ollamaModel: string | undefined
  ollamaUrl: string | undefined
} {
  const args = argv.slice(2)
  let command: string | undefined
  let provider: "gemini" | "claude" | "openai" | "local" | "ollama" = "gemini"
  let apiKey: string | undefined
  let repo = process.cwd()
  let docsDir: string | undefined
  let force = false
  let interactive = false
  let localCmd: string | undefined
  let ollamaModel: string | undefined
  let ollamaUrl: string | undefined

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === "--provider" && args[i + 1]) {
      const val = args[i + 1]!
      if (
        val !== "gemini" &&
        val !== "claude" &&
        val !== "openai" &&
        val !== "local" &&
        val !== "ollama"
      ) {
        fatal(
          `Unknown provider: ${val}. Must be gemini, claude, openai, ollama, or local.`,
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
    } else if (arg === "--ollama-model" && args[i + 1]) {
      ollamaModel = args[i + 1]!
      i++
    } else if (arg === "--ollama-url" && args[i + 1]) {
      ollamaUrl = args[i + 1]!
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
    ollamaModel,
    ollamaUrl,
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

function detectSourceDirs(repo: string): string[] {
  const { existsSync, readdirSync, statSync } =
    require("node:fs") as typeof import("node:fs")

  // Common source directory names, ordered by priority
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
    ".swift",
    ".kt",
  ])

  const found: string[] = []

  for (const dir of candidates) {
    const full = `${repo}/${dir}`
    if (existsSync(full) && statSync(full).isDirectory()) {
      found.push(`${dir}/`)
    }
  }

  // If nothing matched, scan top-level for any directory containing source files
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

      // Check if this directory has source files
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

      // Check for package.json or source files to confirm it's a real package
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
        // No package.json but has source files — include anyway
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

  // Check for monorepo workspace packages
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

  if (workspaces.length > 1) {
    // Monorepo: one doc per workspace package + one overview
    const allSources = detectSourceDirs(repo)
    docs["ARCHITECTURE.md"] = {
      description:
        "Monorepo overview: workspace structure, shared dependencies, and cross-package data flow",
      type: "compiled",
      sources: allSources,
      context_files: contextFiles,
    }

    for (const pkg of workspaces) {
      const slug = pkg.name.replace(/^@[^/]+\//, "").replace(/[^a-z0-9-]/g, "-")
      docs[`${slug.toUpperCase()}.md`] = {
        description: `${pkg.name}: features, API, data flow, and business rules`,
        type: "compiled",
        sources: [pkg.path],
        context_files: contextFiles,
      }
    }

    console.log(`📚 Created ${dirName}/.doc-map.json (monorepo detected)`)
    console.log(`   ${workspaces.length} workspace packages found:`)
    for (const pkg of workspaces) {
      console.log(`     ${pkg.name} → ${pkg.path}`)
    }
  } else {
    // Single project: one doc
    const sources = detectSourceDirs(repo)
    docs["ARCHITECTURE.md"] = {
      description:
        "High-level system architecture: services, data flow, and infrastructure",
      type: "compiled",
      sources,
      context_files: contextFiles,
    }

    console.log(`📚 Created ${dirName}/.doc-map.json`)
    console.log(`   Detected sources: ${sources.join(", ")}`)
  }

  writeFileSync(docMapPath, `${JSON.stringify({ docs }, null, 2)}\n`)
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
    ollamaModel,
    ollamaUrl,
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

  if (command === "brain-init") {
    const { cpSync, mkdirSync, existsSync, readdirSync, readFileSync } =
      await import("node:fs")
    const { join, dirname } = await import("node:path")
    const { fileURLToPath } = await import("node:url")

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

    // Wire into doc-map if it exists
    const docMapPath = `${repo}/${docsDir ?? "docs"}/.doc-map.json`
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
        console.log(`\n   ✓ Wired brain/ into ${wired} doc(s) in .doc-map.json`)
      }
    }

    console.log(
      "\n   Fill in the brain docs — they feed into every compilation.",
    )
    console.log("   ▶ Next: /wf-brain claude\n")
    return
  }

  if (command === "authors") {
    const { resolveConfig, loadDocMap } = await import("./config")
    const { generateAuthors } = await import("./authors")

    const config = resolveConfig(
      repo,
      docsDir ? `${repo}/${docsDir}` : undefined,
    )
    const docMap = loadDocMap(config.docMapPath)

    console.log("\n👥 Generating AUTHORS.md...\n")
    const authorsPath = generateAuthors(config.docsDir, docMap, repo)
    console.log(`✅ ${authorsPath}\n`)
    return
  }

  if (command === "index") {
    const resolvedKey =
      provider === "local" || provider === "ollama"
        ? ""
        : resolveApiKey(provider, apiKey)
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
      triageModel: ollamaModel,
      compileModel: ollamaModel,
      ollamaUrl,
    })

    console.log("\n📇 Generating INDEX.md...\n")
    const indexPath = await generateIndex(
      config.docsDir,
      docMap,
      providers.triage,
      repo,
    )
    console.log(`✅ ${indexPath}\n`)
    return
  }

  if (command === "status") {
    const { resolveConfig, loadDocMap } = await import("./config")
    const { loadHashes, computeDocHashes, diffHashes } = await import(
      "./hashes"
    )
    const { getLastSyncCommit } = await import("./git")
    const { readdirSync } = await import("node:fs")
    const { join } = await import("node:path")

    const config = resolveConfig(
      repo,
      docsDir ? `${repo}/${docsDir}` : undefined,
    )

    let docMap: ReturnType<typeof loadDocMap>
    try {
      docMap = loadDocMap(config.docMapPath)
    } catch {
      console.log("\n✗ No .doc-map.json found. Run 'wiki-forge init' first.\n")
      process.exit(1)
    }

    const lastSync = getLastSyncCommit(config.lastSyncPath, repo)
    const allHashes = loadHashes(config.docsDir)

    const entries = Object.entries(docMap.docs).filter(([, e]) => e != null)
    const compiled = entries.filter(([, e]) => e!.type === "compiled")
    const healthChecks = entries.filter(([, e]) => e!.type === "health-check")

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
      console.log(`   Wiki: ${entityCount} entities, ${conceptCount} concepts`)
    }
    console.log(
      `   Total: ${entries.length} docs (${compiled.length} compiled, ${healthChecks.length} health-check)`,
    )
    if (driftCount > 0) {
      console.log(`   ⚡ ${driftCount} doc(s) drifted\n`)
    } else {
      console.log("   ✅ All up to date\n")
    }

    return
  }

  const validCommands = ["check", "compile", "health"]
  if (!validCommands.includes(command)) {
    fatal(`Unknown command: ${command}`)
  }

  const resolvedKey =
    provider === "local" || provider === "ollama"
      ? ""
      : resolveApiKey(provider, apiKey)

  const providerConfig: ProviderConfig = {
    provider,
    apiKey: resolvedKey,
    localCmd,
    triageModel: ollamaModel,
    compileModel: ollamaModel,
    ollamaUrl,
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
