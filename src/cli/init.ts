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

export async function interactiveInit(repo: string, docsDir?: string) {
  const { runInteractiveInit } = await import("./init-interactive")
  await runInteractiveInit(repo, docsDir)
}
