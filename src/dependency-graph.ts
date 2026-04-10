import { dirname, join, normalize } from "node:path"
import type { SourceFile } from "./sources"

/**
 * Regex patterns for extracting import specifiers from source code.
 * Captures the module path from: import/export ... from '...', require('...'), import('...')
 */
const IMPORT_PATTERNS = [
  // ES: import X from 'mod', import { X } from 'mod', import 'mod'
  /(?:import|export)\s+[\s\S]*?from\s+['"]([^'"]+)['"]/g,
  // ES: import 'mod' (side-effect)
  /import\s+['"]([^'"]+)['"]/g,
  // CJS: require('mod')
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  // Dynamic: import('mod')
  /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
]

/** Returns true if the specifier is a relative path (starts with . or ..) */
function isRelative(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../")
}

/** Resolve a relative import to a normalized path relative to the repo root. */
function resolveRelative(
  specifier: string,
  importerPath: string,
): string {
  const dir = dirname(importerPath)
  return normalize(join(dir, specifier))
    .replace(/\\/g, "/") // normalize Windows paths
}

/** Find the best matching file in the file set for a resolved import path. */
function findMatch(
  resolved: string,
  fileSet: Set<string>,
): string | undefined {
  // Exact match
  if (fileSet.has(resolved)) return resolved

  // Try common extensions
  const exts = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".py", ".go", ".rs", ".rb", ".java", ".kt", ".swift", ".dart"]
  for (const ext of exts) {
    if (fileSet.has(resolved + ext)) return resolved + ext
  }

  // Try index files
  for (const ext of exts) {
    const indexPath = `${resolved}/index${ext}`
    if (fileSet.has(indexPath)) return indexPath
  }

  return undefined
}

export type DependencyGraph = Map<string, string[]>

/**
 * Build a lightweight dependency graph from source files.
 * Only resolves internal (relative) imports between files in the set.
 */
export function buildDependencyGraph(files: SourceFile[]): DependencyGraph {
  const fileSet = new Set(files.map((f) => f.path))
  const graph: DependencyGraph = new Map()

  for (const file of files) {
    const deps: string[] = []
    const seen = new Set<string>()

    for (const pattern of IMPORT_PATTERNS) {
      // Reset lastIndex for global regexes
      pattern.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = pattern.exec(file.content)) !== null) {
        const specifier = match[1]!
        if (!isRelative(specifier)) continue

        const resolved = resolveRelative(specifier, file.path)
        const target = findMatch(resolved, fileSet)
        if (target && !seen.has(target)) {
          seen.add(target)
          deps.push(target)
        }
      }
    }

    if (deps.length > 0) {
      graph.set(file.path, deps)
    }
  }

  return graph
}

/**
 * Serialize a dependency graph into a human-readable string for LLM prompts.
 * Format: "src/auth/login.ts → src/auth/session.ts, src/api/client.ts"
 */
export function serializeDependencyGraph(graph: DependencyGraph): string {
  if (graph.size === 0) return ""

  const lines = [
    "## Module Dependencies",
    "Internal import relationships between source files:",
    "",
  ]

  for (const [file, deps] of graph) {
    lines.push(`- ${file} → ${deps.join(", ")}`)
  }

  return lines.join("\n")
}
