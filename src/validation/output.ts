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
 * Strip duplicate frontmatter from the body.
 * Some LLMs output a real frontmatter block followed by a ```yaml code block
 * containing a second frontmatter, or two consecutive ---...--- blocks.
 */
export function stripDuplicateFrontmatter(doc: string): string {
  const trimmed = doc.trim()
  if (!trimmed.startsWith("---")) return trimmed

  // Find the end of the first frontmatter block
  const firstClose = trimmed.indexOf("---", 3)
  if (firstClose === -1) return trimmed
  const afterFirst = trimmed.slice(firstClose + 3)

  // Check if body starts with a second frontmatter (possibly inside a code fence)
  const bodyStart = afterFirst.replace(/^\s*/, "")

  // Pattern 1: ```yaml\n---\n...\n---\n```
  const fencedFm = bodyStart.match(
    /^```(?:yaml|yml)\s*\n---\n[\s\S]*?\n---\s*\n```\s*\n?([\s\S]*)$/,
  )
  if (fencedFm) {
    return `${trimmed.slice(0, firstClose + 3)}\n\n${fencedFm[1]!.trim()}`
  }

  // Pattern 2: bare second ---\n...\n--- immediately after first frontmatter
  const bareFm = bodyStart.match(/^---\n[\s\S]*?\n---\s*\n([\s\S]*)$/)
  if (bareFm) {
    // Verify it looks like frontmatter (has key: value lines)
    const secondBlock = bodyStart.slice(3, bodyStart.indexOf("---", 3))
    if (/^\s*\w[\w_-]*\s*:/m.test(secondBlock)) {
      return `${trimmed.slice(0, firstClose + 3)}\n\n${bareFm[1]!.trim()}`
    }
  }

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
  const doc = stripDuplicateFrontmatter(stripCodeFences(raw))

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
