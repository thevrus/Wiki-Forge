import * as log from "../logger"

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
  const { estimateSourceSize } =
    require("../file-glob") as typeof import("../file-glob")
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

export async function runInit(repo: string, customDocsDir?: string) {
  const { mkdirSync, writeFileSync, existsSync } = await import("node:fs")
  const dirName = customDocsDir ?? "docs"
  const docsDir = `${repo}/${dirName}`
  const docMapPath = `${docsDir}/.doc-map.json`

  if (existsSync(docMapPath)) {
    log.skip(`${dirName}/.doc-map.json already exists, skipping.`)
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

  const { estimateSourceSize } = await import("../file-glob")
  const { SOURCE_BUDGET } = await import("../constants")

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
      description:
        "hooks, services, API clients, data fetching, state management",
    },
    {
      pattern:
        /\/(constants?|config|rules?|validations?|policies|permissions?)\//,
      suffix: "BUSINESS-RULES",
      description:
        "business rules, validation, constants, feature flags, permissions",
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
    const rootConfigs = ["package.json", "tsconfig.json", "turbo.json"].filter(
      (f) => existsSync(`${repo}/${f}`),
    )
    docs["ARCHITECTURE.md"] = {
      description:
        "Monorepo overview: workspace structure, shared dependencies, cross-package data flow, and tech stack",
      type: "compiled",
      sources:
        rootConfigs.length > 0
          ? rootConfigs
          : detectSourceDirs(repo).slice(0, 3),
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

    log.intro("wiki-forge init")
    log.success(`Created ${dirName}/.doc-map.json (monorepo detected)`)
    log.keyValue({
      workspaces: `${workspaces.length} packages`,
      docs: `${Object.keys(docs).length} configured`,
    })
    log.list(
      Object.keys(docs).map((name) => {
        const size = estimateSourceSize(docs[name]!.sources, repo)
        const sizeKb = Math.round(size / 1024)
        return {
          label: name,
          detail: `${sizeKb}KB`,
          status: size > SOURCE_BUDGET ? ("warn" as const) : ("ok" as const),
        }
      }),
    )
  } else {
    // Single project
    const sources = detectSourceDirs(repo)
    const totalSize = estimateSourceSize(sources, repo)
    const primarySource = sources[0] ?? "src/"
    // Scan inside the source dir, not the repo root
    const subDirs = scanDomainDirs(`${repo}/${primarySource}`)

    if (totalSize <= SOURCE_BUDGET) {
      docs["PRODUCT.md"] = {
        description:
          "Complete product knowledge base: features, user flows, business rules, data model, integrations, and architecture",
        type: "compiled",
        sources,
        context_files: contextFiles,
      }
    } else {
      splitPackage("Project", "PRODUCT", primarySource, subDirs)
    }

    log.intro("wiki-forge init")
    log.success(`Created ${dirName}/.doc-map.json`)
    log.keyValue({
      sources: `${sources.join(", ")} (${Math.round(totalSize / 1024)}KB)`,
      docs: `${Object.keys(docs).length} configured`,
    })
  }

  writeFileSync(docMapPath, `${JSON.stringify({ docs }, null, 2)}\n`)
  log.outro("Edit the doc map, then run: wiki-forge compile")
}

// ── Smart Init (LLM-powered) ─────────────────────────────────────────

type SmartDocEntry = {
  description: string
  type: "compiled" | "health-check"
  sources: string[]
  context_files: string[]
}

export async function runSmartInit(
  repo: string,
  provider: import("../providers/types").LLMProvider,
  customDocsDir?: string,
) {
  const { mkdirSync, writeFileSync, readFileSync, existsSync } = await import("node:fs")
  const dirName = customDocsDir ?? "docs"
  const docsDir = `${repo}/${dirName}`
  const docMapPath = `${docsDir}/.doc-map.json`

  if (existsSync(docMapPath)) {
    const existing = readFileSync(docMapPath, "utf-8").trim()
    const parsed = JSON.parse(existing)
    if (parsed.docs && Object.keys(parsed.docs).length > 0) {
      log.skip(`${dirName}/.doc-map.json already exists with ${Object.keys(parsed.docs).length} docs, skipping.`)
      return
    }
  }

  mkdirSync(docsDir, { recursive: true })

  log.intro("wiki-forge init (smart)")
  const spinner = log.spin("Indexing project structure...")

  const { estimateAllTextSize } = await import("../file-glob")
  const { SOURCE_BUDGET } = await import("../constants")
  const budgetKB = Math.round(SOURCE_BUDGET / 1024)

  // List every text file in the repo — the LLM needs full visibility to group by feature
  const { listAllTextFiles: listAll } = await import("../file-glob")
  const allFiles = listAll(["./"], repo)

  // Build dir → direct children mapping
  const dirFiles = new Map<string, string[]>()
  for (const f of allFiles) {
    const lastSlash = f.lastIndexOf("/")
    const dir = lastSlash >= 0 ? `${f.slice(0, lastSlash)}/` : "./"
    if (!dirFiles.has(dir)) dirFiles.set(dir, [])
    dirFiles.get(dir)!.push(f)
  }

  // Build annotated tree: every file listed under its directory with size totals
  const dirStats: string[] = []
  const treeLines: string[] = []
  const sortedDirs = [...dirFiles.keys()].sort()

  for (const dir of sortedDirs) {
    const size = estimateAllTextSize([dir], repo)
    if (size === 0) continue
    const sizeKB = Math.round(size / 1024)
    const children = dirFiles.get(dir) ?? []
    const header = `${dir}  (${children.length} files, ${sizeKB}KB)`
    dirStats.push(header)
    treeLines.push(header)
    for (const f of children) {
      treeLines.push(`  ${f}`)
    }
  }

  // If tree is huge, send full file list without per-dir headers to maximize coverage
  let treeStr: string
  if (treeLines.length <= 4000) {
    treeStr = treeLines.join("\n")
  } else {
    // Too many lines for interleaved view — send compact: dir summaries + flat file list
    const compact = [
      "## Directory summaries",
      ...dirStats,
      "",
      "## All files",
      ...allFiles,
    ]
    treeStr = compact.slice(0, 6000).join("\n")
  }

  // Read README and package.json for context
  let readme = ""
  for (const name of ["README.md", "readme.md", "README"]) {
    try {
      readme = readFileSync(`${repo}/${name}`, "utf-8").slice(0, 3000)
      break
    } catch { /* skip */ }
  }


  spinner.text = "Suggesting docs for your codebase..."

  // Detect project config files for context_files suggestion
  const configCandidates = [
    "package.json", "Cargo.toml", "go.mod", "pyproject.toml", "setup.py",
    "Gemfile", "build.gradle", "pom.xml", "mix.exs", "pubspec.yaml",
    "composer.json", "Package.swift", "CMakeLists.txt", "Makefile",
  ]
  const detectedConfigs = configCandidates.filter((f) => existsSync(`${repo}/${f}`))
  const configHint = detectedConfigs.length > 0
    ? `context_files should include: ${JSON.stringify(detectedConfigs)}`
    : "context_files can be empty if no project config file exists"

  const system = `You are a documentation architect. Given a codebase with directory sizes, suggest documentation pages for a wiki-forge doc-map. This works with ANY language or framework.

CRITICAL RULES:
1. Split by FEATURE DOMAIN, not by code layer. Good: "Cart", "Auth", "Payments", "Scheduling". Bad: "Components", "Utils", "Models", "Handlers".
2. Each doc's total source size must stay under ${budgetKB}KB. Add up the (KB) numbers from the directory listing. If a feature's directories exceed the budget, split into sub-features.
3. Group directories that serve the SAME feature into ONE doc. Examples:
   - Go: cmd/server/, internal/auth/, pkg/auth/ → one AUTH doc
   - Rust: src/payments/, src/models/payment.rs → one PAYMENTS doc
   - TS: src/vue/apps/cart/, src/components/cart/, src/hooks/useCart/ → one CART doc
   - Python: app/billing/, app/models/invoice.py, app/tasks/billing.py → one BILLING doc
4. Sources must be real directories or files from the tree.
5. Target 8-20 docs for large projects (>500KB total), 4-8 for small ones.
6. Descriptions must name actual features, screens, APIs, services, or domains from THIS codebase.
7. Doc names: UPPER-KEBAB.md (e.g. "CART.md", "AUTH.md", "PAYMENTS.md", "INSURANCE-LISTING.md")
8. type is always "compiled".
9. ${configHint}
10. Always include an ARCHITECTURE.md covering project structure, tech stack, and how pieces connect. Its sources should be config files and top-level entry points only (small).

Return ONLY valid JSON. No markdown fences, no explanation, no comments.
Format: { "docs": { "NAME.md": { "description": "...", "type": "compiled", "sources": ["dir1/", "dir2/"], "context_files": [...] } } }`

  // Read any detected config file for extra context
  let configContent = ""
  for (const f of detectedConfigs.slice(0, 2)) {
    try {
      configContent += `## ${f}\n${readFileSync(`${repo}/${f}`, "utf-8").slice(0, 2000)}\n\n`
    } catch { /* skip */ }
  }

  const prompt = [
    "Analyze this codebase and suggest documentation pages.\n",
    "## Directories with sizes\n```",
    treeStr,
    "```\n",
    readme ? `## README (excerpt)\n${readme}\n` : "",
    configContent || "",
    `\nBudget: each doc must stay under ${budgetKB}KB of source. Split large directories by feature.`,
    "\nReturn the doc-map JSON.",
  ].filter(Boolean).join("\n")

  try {
    const raw = await provider.generate(prompt, system)
    spinner.stop()

    // Parse JSON from response (strip code fences if present)
    const jsonStr = raw.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim()
    const result = JSON.parse(jsonStr) as { docs: Record<string, SmartDocEntry> }

    if (!result.docs || Object.keys(result.docs).length === 0) {
      log.warn("LLM returned empty doc-map, falling back to pattern-based init")
      await runInit(repo, customDocsDir)
      return
    }

    // ── Step 1: Validate sources exist ─────────────────────────────
    const validatedDocs: Record<string, SmartDocEntry> = {}
    for (const [name, entry] of Object.entries(result.docs)) {
      const validSources = entry.sources.filter((s) => {
        const full = `${repo}/${s.replace(/\/$/, "")}`
        return existsSync(full)
      })
      if (validSources.length > 0) {
        validatedDocs[name] = {
          ...entry,
          sources: validSources,
          context_files: (entry.context_files ?? []).filter((f) => existsSync(`${repo}/${f}`)),
        }
      }
    }

    if (Object.keys(validatedDocs).length === 0) {
      log.warn("No valid source paths found in LLM response, falling back to pattern-based init")
      await runInit(repo, customDocsDir)
      return
    }

    // ── Step 2: Coverage check — find unclaimed source dirs ──────
    const claimedDirs = new Set<string>()
    for (const entry of Object.values(validatedDocs)) {
      for (const s of entry.sources) {
        claimedDirs.add(s.replace(/\/$/, ""))
      }
    }

    // All source directories with actual code
    const allSourceDirs = dirStats
      .map((line) => line.split("  ")[0]!.replace(/\/$/, ""))
      .filter((d) => {
        const size = estimateAllTextSize([`${d}/`], repo)
        return size >= 1024 // ignore dirs under 1KB
      })

    const unclaimed = allSourceDirs.filter((d) => {
      // A dir is claimed if it or any parent is in claimedDirs
      return ![...claimedDirs].some(
        (claimed) => d === claimed || d.startsWith(`${claimed}/`) || claimed.startsWith(`${d}/`),
      )
    })

    // Auto-assign unclaimed dirs to an UNCOVERED.md doc
    if (unclaimed.length > 0) {
      const unclaimedSize = estimateAllTextSize(
        unclaimed.map((d) => `${d}/`),
        repo,
      )
      if (unclaimedSize >= 1024) {
        const unclaimedKB = Math.round(unclaimedSize / 1024)
        // If small enough, bundle into one doc; otherwise split
        if (unclaimedSize <= SOURCE_BUDGET) {
          validatedDocs["UNCOVERED.md"] = {
            description: `Modules not covered by other docs: ${unclaimed.slice(0, 5).join(", ")}${unclaimed.length > 5 ? ` (+${unclaimed.length - 5} more)` : ""}`,
            type: "compiled",
            sources: unclaimed.map((d) => `${d}/`),
            context_files: detectedConfigs.slice(0, 1),
          }
          log.warn(`${unclaimed.length} directories (${unclaimedKB}KB) were not covered by the LLM — added to UNCOVERED.md`)
        } else {
          // Split unclaimed into individual docs
          let addedCount = 0
          for (const d of unclaimed) {
            const size = estimateAllTextSize([`${d}/`], repo)
            if (size < 1024) continue
            const slug = d.replace(/\//g, "-").replace(/^-|-$/g, "").toUpperCase()
            validatedDocs[`${slug}.md`] = {
              description: `${d.split("/").pop() ?? d}: auto-detected uncovered module`,
              type: "compiled",
              sources: [`${d}/`],
              context_files: detectedConfigs.slice(0, 1),
            }
            addedCount++
          }
          log.warn(`${addedCount} uncovered directories (${unclaimedKB}KB) added as individual docs`)
        }
      }
    }

    // ── Step 3: Size warnings ───────────────────────────────────
    for (const [name, entry] of Object.entries(validatedDocs)) {
      const size = estimateAllTextSize(entry.sources, repo)
      if (size > SOURCE_BUDGET) {
        const sizeKB = Math.round(size / 1024)
        log.warn(`${name}: ${sizeKB}KB exceeds ${budgetKB}KB budget — consider splitting`)
      }
    }

    // ── Step 4: Write ───────────────────────────────────────────
    writeFileSync(docMapPath, `${JSON.stringify({ docs: validatedDocs }, null, 2)}\n`)
    mkdirSync(`${docsDir}/entities`, { recursive: true })
    mkdirSync(`${docsDir}/concepts`, { recursive: true })

    const totalCoverage = estimateAllTextSize(
      Object.values(validatedDocs).flatMap((e) => e.sources),
      repo,
    )
    const totalSource = estimateAllTextSize(
      allSourceDirs.map((d) => `${d}/`),
      repo,
    )
    const coveragePct = totalSource > 0 ? Math.round((totalCoverage / totalSource) * 100) : 100

    log.success(`Created ${dirName}/.doc-map.json`)
    log.keyValue({
      docs: `${Object.keys(validatedDocs).length} configured`,
      coverage: `${coveragePct}% of source indexed`,
    })
    log.list(
      Object.entries(validatedDocs).map(([name, entry]) => {
        const size = estimateAllTextSize(entry.sources, repo)
        const sizeKB = Math.round(size / 1024)
        return {
          label: name,
          detail: `${sizeKB}KB — ${entry.description.slice(0, 50)}`,
          status: (size > SOURCE_BUDGET ? "warn" : "ok") as "warn" | "ok",
        }
      }),
    )
    log.outro("Edit the doc map, then run: wiki-forge compile")
  } catch (err) {
    spinner.stop()
    log.warn(`LLM init failed: ${err instanceof Error ? err.message : "unknown error"}`)
    log.warn("Falling back to pattern-based init")
    await runInit(repo, customDocsDir)
  }
}

export async function interactiveInit(repo: string, docsDir?: string) {
  const { runInteractiveInit } = await import("./init-interactive")
  await runInteractiveInit(repo, docsDir)
}
