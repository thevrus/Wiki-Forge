import type { ReportData, WeeklyData } from "../report/analyze"
import { stripCodeFences } from "./output"

export type ReportValidation = {
  valid: boolean
  warnings: string[]
  cleaned: string
}

export function validateStatusReport(
  raw: string,
  data: ReportData,
): ReportValidation {
  const warnings: string[] = []
  let cleaned = raw.trim()

  // Strip wrapping code fences if LLM wrapped the markdown
  cleaned = stripCodeFences(cleaned)

  // Must have a title
  if (!cleaned.includes("Brain Health") && !cleaned.includes("brain health")) {
    warnings.push("Missing '# Brain Health' title")
  }

  // Must have at least 2 ## sections
  const sectionCount = (cleaned.match(/^## /gm) ?? []).length
  if (sectionCount < 2) {
    warnings.push(`Only ${sectionCount} sections found (expected 3+)`)
  }

  // Must contain overview table with real numbers
  if (data.totals.compiledPages > 0) {
    if (!cleaned.includes(String(data.totals.compiledPages))) {
      warnings.push("Overview doesn't contain correct compiled pages count")
    }
  }

  // Validate Mermaid blocks
  const mermaidBlocks = cleaned.match(/```mermaid[\s\S]*?```/g) ?? []
  for (const block of mermaidBlocks) {
    const inner = block.replace(/```mermaid\n?/, "").replace(/\n?```$/, "")
    if (inner.includes("undefined") || inner.includes("null")) {
      warnings.push("Mermaid block contains 'undefined' or 'null'")
    }
    // quadrantChart data points must have [x, y] format
    if (inner.includes("quadrantChart")) {
      const dataLines = inner.split("\n").filter((l) => /^\s+\S+.*\[/.test(l))
      for (const line of dataLines) {
        if (!/\[\s*[\d.]+\s*,\s*[\d.]+\s*\]/.test(line)) {
          warnings.push(`Invalid quadrant data point: ${line.trim()}`)
        }
      }
    }
  }

  // Check for LLM refusal / disclaimer
  const refusalPatterns = [
    /I (?:cannot|can't|don't have|am unable)/i,
    /As an AI/i,
    /I'd be happy to help/i,
    /here'?s (?:the|a) (?:report|document)/i,
  ]
  for (const pattern of refusalPatterns) {
    if (pattern.test(cleaned.slice(0, 200))) {
      warnings.push("Output starts with an LLM preamble")
      // Try to strip preamble — find first # heading
      const headingIdx = cleaned.search(/^# /m)
      if (headingIdx > 0) {
        cleaned = cleaned.slice(headingIdx)
      }
    }
  }

  // Must be substantial
  if (cleaned.length < 200) {
    warnings.push(`Output too short (${cleaned.length} chars)`)
  }

  return {
    valid: warnings.length === 0,
    warnings,
    cleaned,
  }
}

export function validateWeeklyReport(
  raw: string,
  data: WeeklyData,
): ReportValidation {
  const warnings: string[] = []
  let cleaned = raw.trim()

  cleaned = stripCodeFences(cleaned)

  if (
    !cleaned.includes("# Weekly report") &&
    !cleaned.includes("# weekly report")
  ) {
    warnings.push("Missing '# Weekly report' title")
  }

  const sectionCount = (cleaned.match(/^## /gm) ?? []).length
  if (sectionCount < 2) {
    warnings.push(`Only ${sectionCount} sections found (expected 3+)`)
  }

  // Must reference actual PR numbers if any exist
  if (data.prsMerged.length > 0) {
    const firstPR = data.prsMerged[0]!
    if (!cleaned.includes(`#${firstPR.number}`)) {
      warnings.push(`First PR #${firstPR.number} not found in output`)
    }
  }

  const refusalPatterns = [
    /I (?:cannot|can't|don't have|am unable)/i,
    /As an AI/i,
  ]
  for (const pattern of refusalPatterns) {
    if (pattern.test(cleaned.slice(0, 200))) {
      warnings.push("Output starts with an LLM preamble")
      const headingIdx = cleaned.search(/^# /m)
      if (headingIdx > 0) {
        cleaned = cleaned.slice(headingIdx)
      }
    }
  }

  if (cleaned.length < 200) {
    warnings.push(`Output too short (${cleaned.length} chars)`)
  }

  return {
    valid: warnings.length === 0,
    warnings,
    cleaned,
  }
}
