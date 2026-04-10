import matter from "gray-matter"

const REQUIRED_FRONTMATTER = ["title", "slug", "category", "description"]

type ValidationResult = {
  valid: boolean
  warnings: string[]
  cleaned: string
}

/**
 * Strip markdown code fences that LLMs sometimes wrap the entire response in.
 * e.g. ```markdown\n...\n``` or ```yaml\n...\n``` or ```\n...\n```
 */
export function stripCodeFences(doc: string): string {
  const trimmed = doc.trim()
  const fenceMatch = trimmed.match(
    /^```(?:markdown|md|yaml|yml)?\s*\n([\s\S]*?)\n```\s*$/,
  )
  if (fenceMatch) return fenceMatch[1]!
  return trimmed
}

/**
 * Count ## headings in the body that have real content underneath (not just
 * contributor/ticket metadata). Returns [total, rich] counts.
 */
function countSections(body: string): { total: number; rich: number } {
  const sections = body.split(/^##\s+/m).slice(1)
  let rich = 0
  for (const s of sections) {
    const cleaned = s
      .replace(/^.*\n/, "") // heading text line
      .replace(/^[*-]\s+.*\d+\s+commits?\b.*$/gm, "") // contributor lines
      .replace(/^[*-]\s+.*(?:#\d+|[A-Z]{2,}-\d+)\b.*$/gm, "") // ticket lines
      .replace(/^[*-]\s+.*last active:.*$/gim, "") // last active lines
      .replace(/\s+/g, " ")
      .trim()
    if (cleaned.length >= 80) rich++
  }
  return { total: sections.length, rich }
}

export function validateCompiledOutput(raw: string): ValidationResult {
  const warnings: string[] = []
  const doc = stripCodeFences(raw)

  // ── Hard failures ──────────────────────────────────────────────────

  // Must have frontmatter
  if (!doc.trimStart().startsWith("---")) {
    warnings.push("Missing YAML frontmatter (---)")
    return { valid: false, warnings, cleaned: doc }
  }

  const { data: fields, content: body } = matter(doc)

  // Must have a body
  if (body.trim().length < 50) {
    warnings.push("Document body is suspiciously short (< 50 chars)")
    return { valid: false, warnings, cleaned: doc }
  }

  // Must not be an LLM refusal
  const bodyLower = body.toLowerCase()
  const hallucinationPhrases = [
    "i don't have access",
    "i cannot access",
    "as an ai",
    "i'm unable to",
    "based on the limited information",
    "i would need more",
    "unfortunately, i",
    "no changes detected",
  ]
  for (const phrase of hallucinationPhrases) {
    if (bodyLower.includes(phrase)) {
      warnings.push(`LLM refusal detected: "${phrase}"`)
      return { valid: false, warnings, cleaned: doc }
    }
  }

  // Must not be a code review
  const reviewPhrases = [
    "suggestion:",
    "improvement:",
    "recommendation:",
    "consider using",
    "you should",
    "you can make",
    "i recommend",
    "areas for improvement",
    "best practices",
    "summary checklist",
    "priority |",
    "process improvements",
    "immediate enhancements",
    "implementation tactics",
    "start small:",
    "the core idea",
    "adoption tactics",
    "definition of done",
    "add these sections",
  ]
  const reviewHits = reviewPhrases.filter((p) => bodyLower.includes(p))
  if (reviewHits.length >= 2) {
    warnings.push(
      `LLM produced a code review instead of documentation (${reviewHits.length} review phrases detected)`,
    )
    return { valid: false, warnings, cleaned: doc }
  }

  // Must have at least one real section (not just a naked paragraph)
  const { total: sectionCount, rich: richCount } = countSections(body)
  if (sectionCount === 0) {
    warnings.push("Document has no ## sections — just a paragraph")
    return { valid: false, warnings, cleaned: doc }
  }

  // ── Soft warnings ──────────────────────────────────────────────────

  // Check required frontmatter fields
  for (const field of REQUIRED_FRONTMATTER) {
    const val = fields[field]
    if (val === undefined || val === null || String(val).trim() === "") {
      warnings.push(`Missing required frontmatter field: ${field}`)
    }
  }

  // Count placeholder phrases (any wrapping: brackets, italics, plain text)
  const placeholderPatterns = [
    /no source (?:data|code|information)/gi,
    /insufficient source/gi,
    /no (?:data|information) (?:available|provided)/gi,
    /no (?:specific )?\w[\w\s,]* (?:were|was) (?:not )?(?:visible|found|identified|detected|present|observable)/gi,
  ]
  let placeholderCount = 0
  for (const pattern of placeholderPatterns) {
    placeholderCount += (body.match(pattern) ?? []).length
  }
  if (placeholderCount > 0) {
    warnings.push(`${placeholderCount} section(s) contain placeholder text`)
  }

  // Warn if no section has real depth
  if (richCount === 0) {
    warnings.push(
      "No section has substantial content (80+ chars excluding metadata)",
    )
  }

  // Validate Mermaid blocks
  const mermaidBlocks = doc.match(/```mermaid\n([\s\S]*?)```/g) ?? []
  for (const block of mermaidBlocks) {
    const content = block
      .replace(/```mermaid\n/, "")
      .replace(/```$/, "")
      .trim()
    const validStarts = [
      "flowchart",
      "graph",
      "sequenceDiagram",
      "stateDiagram",
      "classDiagram",
      "erDiagram",
      "gantt",
      "pie",
      "mindmap",
      "timeline",
    ]
    if (!validStarts.some((s) => content.startsWith(s))) {
      warnings.push("Mermaid block has invalid diagram type")
    }
  }

  const hasErrors = warnings.some(
    (w) =>
      w.startsWith("Missing YAML") ||
      w.startsWith("Document body is") ||
      w.startsWith("LLM refusal") ||
      w.startsWith("LLM produced") ||
      w.startsWith("Document has no ##"),
  )

  return { valid: !hasErrors, warnings, cleaned: doc }
}
