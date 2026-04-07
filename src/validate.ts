import { existsSync, readFileSync } from "node:fs"
import { DocMapSchema, resolveConfig } from "./config"

export type ValidationIssue = {
  doc: string
  severity: "error" | "warning"
  message: string
}

export function validateDocMap(
  repoRoot: string,
  docsDir?: string,
): ValidationIssue[] {
  const config = resolveConfig(repoRoot, docsDir)

  let raw: string
  try {
    raw = readFileSync(config.docMapPath, "utf-8")
  } catch {
    return [
      {
        doc: "(config)",
        severity: "error",
        message: `Cannot read ${config.docMapPath}`,
      },
    ]
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return [
      {
        doc: "(config)",
        severity: "error",
        message: `${config.docMapPath} is not valid JSON`,
      },
    ]
  }

  const result = DocMapSchema.safeParse(parsed)
  if (!result.success) {
    return result.error.issues.map((issue) => ({
      doc: "(config)",
      severity: "error" as const,
      message: `Schema error at ${issue.path.join(".")}: ${issue.message}`,
    }))
  }

  const docMap = result.data
  const issues: ValidationIssue[] = []
  const entries = Object.entries(docMap.docs)

  if (entries.length === 0) {
    issues.push({
      doc: "(config)",
      severity: "warning",
      message: "Doc map has no entries",
    })
    return issues
  }

  for (const [docPath, entry] of entries) {
    if (!entry) continue

    if (!entry.description.trim()) {
      issues.push({
        doc: docPath,
        severity: "warning",
        message:
          "Empty description — the LLM needs this to understand what to write",
      })
    }

    if (entry.sources.length === 0) {
      issues.push({
        doc: docPath,
        severity: "warning",
        message: "No sources defined — the LLM has nothing to read",
      })
    } else {
      for (const source of entry.sources) {
        const cleanPath = source.replace(/[/*]+$/, "")
        const fullPath = `${repoRoot}/${cleanPath}`
        if (!existsSync(fullPath)) {
          issues.push({
            doc: docPath,
            severity: "error",
            message: `Source "${source}" does not exist`,
          })
        }
      }
    }

    for (const ctxFile of entry.context_files) {
      const cleanPath = ctxFile.replace(/[/*]+$/, "")
      const fullPath = `${repoRoot}/${cleanPath}`
      if (!existsSync(fullPath)) {
        issues.push({
          doc: docPath,
          severity: "warning",
          message: `Context file "${ctxFile}" does not exist`,
        })
      }
    }
  }

  return issues
}
