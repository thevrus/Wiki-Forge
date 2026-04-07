const REQUIRED_FRONTMATTER = ["title", "slug", "category", "description"]

type ValidationResult = {
  valid: boolean
  warnings: string[]
  cleaned: string
}

function extractFrontmatter(
  doc: string,
): { frontmatter: string; body: string } | null {
  const match = doc.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return null
  return { frontmatter: match[1]!, body: match[2]! }
}

function parseFrontmatterFields(
  frontmatter: string,
): Record<string, string | string[]> {
  const fields: Record<string, string | string[]> = {}
  for (const line of frontmatter.split("\n")) {
    const match = line.match(/^(\w[\w_]*)\s*:\s*(.+)/)
    if (match) {
      const key = match[1]!
      let value = match[2]!.trim()
      // Strip quotes
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      fields[key] = value
    }
  }
  return fields
}

/**
 * Strip markdown code fences that LLMs sometimes wrap the entire response in.
 * e.g. ```markdown\n...\n``` or ```\n...\n```
 */
function stripCodeFences(doc: string): string {
  const trimmed = doc.trim()
  // Match ```markdown or ``` at the start and ``` at the end
  const fenceMatch = trimmed.match(
    /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/,
  )
  if (fenceMatch) return fenceMatch[1]!
  return trimmed
}

export function validateCompiledOutput(raw: string): ValidationResult {
  const warnings: string[] = []
  const doc = stripCodeFences(raw)

  // Check for frontmatter
  const parsed = extractFrontmatter(doc)
  if (!parsed) {
    warnings.push("Missing YAML frontmatter (---)")
    return { valid: false, warnings, cleaned: doc }
  }

  // Check required fields
  const fields = parseFrontmatterFields(parsed.frontmatter)
  for (const field of REQUIRED_FRONTMATTER) {
    if (!fields[field] || String(fields[field]).trim() === "") {
      warnings.push(`Missing required frontmatter field: ${field}`)
    }
  }

  // Check body isn't empty
  if (parsed.body.trim().length < 50) {
    warnings.push("Document body is suspiciously short (< 50 chars)")
    return { valid: false, warnings, cleaned: doc }
  }

  // Check for obvious hallucination signals
  const bodyLower = parsed.body.toLowerCase()
  const hallucinationPhrases = [
    "i don't have access",
    "i cannot access",
    "as an ai",
    "i'm unable to",
    "based on the limited information",
    "i would need more",
    "unfortunately, i",
  ]
  for (const phrase of hallucinationPhrases) {
    if (bodyLower.includes(phrase)) {
      warnings.push(`LLM refusal detected: "${phrase}"`)
      return { valid: false, warnings, cleaned: doc }
    }
  }

  // Check for insufficient source markers
  const insufficientCount = (
    parsed.body.match(/\[insufficient source data\]/gi) ?? []
  ).length
  if (insufficientCount > 0) {
    warnings.push(
      `${insufficientCount} section(s) marked as insufficient source data`,
    )
  }

  // Validate Mermaid blocks (basic syntax check)
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
      w.startsWith("Document body") ||
      w.startsWith("LLM refusal"),
  )

  return { valid: !hasErrors, warnings, cleaned: doc }
}
