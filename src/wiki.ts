import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { DocMap } from "./config"
import type { LLMProvider } from "./providers/types"

// ── Types ─────────────────────────────────────────────────────────────

type Topic = {
  name: string
  slug: string
  description: string
  referenced_in: string[]
}

type ExtractedTopics = {
  entities: Topic[]
  concepts: Topic[]
}

// ── Extraction ────────────────────────────────────────────────────────

const EXTRACT_PROMPT = `
Read the following compiled documentation and extract:

1. ENTITIES: concrete things in the system — services, APIs, data models, databases, external tools, UI components.
2. CONCEPTS: abstract patterns, flows, or rules — authentication flow, fee calculation, booking lifecycle, permission model.

Only include items that are significant enough to deserve their own wiki page.
Give each a URL-safe slug (lowercase, hyphens).

Respond with JSON only (no markdown fencing):
{
  "entities": [{ "name": "...", "slug": "...", "description": "one sentence", "referenced_in": ["doc1.md"] }],
  "concepts": [{ "name": "...", "slug": "...", "description": "one sentence", "referenced_in": ["doc1.md"] }]
}
`.trim()

function buildExtractionContext(docsDir: string, docMap: DocMap): string {
  const sections: string[] = []

  for (const [docPath, entry] of Object.entries(docMap.docs)) {
    if (!entry) continue
    const fullPath = docPath.startsWith("/") ? docPath : `${docsDir}/${docPath}`
    try {
      const content = readFileSync(fullPath, "utf-8")
      if (content.trim()) {
        sections.push(`## ${docPath}\n\n${content}`)
      }
    } catch {
      // doc doesn't exist yet
    }
  }

  return sections.join("\n\n---\n\n")
}

function parseExtraction(raw: string): ExtractedTopics {
  try {
    const cleaned = raw
      .replace(/```json?\s*/g, "")
      .replace(/```/g, "")
      .trim()
    const parsed = JSON.parse(cleaned)
    return {
      entities: Array.isArray(parsed.entities) ? parsed.entities : [],
      concepts: Array.isArray(parsed.concepts) ? parsed.concepts : [],
    }
  } catch {
    return { entities: [], concepts: [] }
  }
}

// ── Page generation ───────────────────────────────────────────────────

function topicPagePrompt(
  topic: Topic,
  type: "entity" | "concept",
  docsContext: string,
): string {
  return [
    `Write a short wiki page about "${topic.name}" (${type}).`,
    `${topic.description}`,
    "",
    "Rules:",
    "- Start with YAML frontmatter: type, description, referenced_in (list of doc names)",
    "- 2-3 paragraph overview explaining what this is and why it matters",
    "- Use ### subsections if needed (relationships, current state, rules)",
    "- Write for PMs and designers, not engineers",
    "- Be specific and factual — name concrete behaviors, limits, states",
    "- End with a See also line linking related entity/concept names",
    "- Keep it under 300 words",
    "- Return ONLY markdown, no fencing",
    "",
    "## Source documentation (excerpts):",
    docsContext,
  ].join("\n")
}

function extractRelevantContext(topic: Topic, fullContext: string): string {
  // Return a capped subset focused on the topic
  const lines = fullContext.split("\n")
  const relevant: string[] = []
  let collecting = false
  let budget = 5000

  for (const line of lines) {
    if (budget <= 0) break

    const mentionsTopic =
      line.toLowerCase().includes(topic.name.toLowerCase()) ||
      line.toLowerCase().includes(topic.slug.replace(/-/g, " "))

    if (mentionsTopic) {
      collecting = true
    }

    if (collecting) {
      relevant.push(line)
      budget -= line.length
      // Stop collecting after a blank line gap
      if (line.trim() === "" && relevant.length > 5) {
        collecting = false
      }
    }
  }

  return relevant.length > 0 ? relevant.join("\n") : fullContext.slice(0, 3000)
}

// ── Main ──────────────────────────────────────────────────────────────

export async function generateWiki(
  docsDir: string,
  docMap: DocMap,
  triageProvider: LLMProvider,
): Promise<{ entities: number; concepts: number }> {
  const fullContext = buildExtractionContext(docsDir, docMap)
  if (!fullContext.trim()) return { entities: 0, concepts: 0 }

  // Step 1: Extract entities + concepts
  const extractionPrompt = `${EXTRACT_PROMPT}\n\n${fullContext}`
  const raw = await triageProvider.generate(extractionPrompt)
  const { entities, concepts } = parseExtraction(raw)

  if (entities.length === 0 && concepts.length === 0) {
    return { entities: 0, concepts: 0 }
  }

  // Step 2: Create directories
  const entitiesDir = join(docsDir, "entities")
  const conceptsDir = join(docsDir, "concepts")
  const synthesisDir = join(docsDir, "synthesis")
  mkdirSync(entitiesDir, { recursive: true })
  mkdirSync(conceptsDir, { recursive: true })
  mkdirSync(synthesisDir, { recursive: true })

  // Step 3: Generate pages in parallel
  const tasks = [
    ...entities.map(async (topic) => {
      const context = extractRelevantContext(topic, fullContext)
      const prompt = topicPagePrompt(topic, "entity", context)
      const content = await triageProvider.generate(prompt)
      const filePath = join(entitiesDir, `${topic.slug}.md`)
      writeFileSync(filePath, `${content.trim()}\n`)
    }),
    ...concepts.map(async (topic) => {
      const context = extractRelevantContext(topic, fullContext)
      const prompt = topicPagePrompt(topic, "concept", context)
      const content = await triageProvider.generate(prompt)
      const filePath = join(conceptsDir, `${topic.slug}.md`)
      writeFileSync(filePath, `${content.trim()}\n`)
    }),
  ]

  await Promise.all(tasks)

  return { entities: entities.length, concepts: concepts.length }
}

// ── Log ───────────────────────────────────────────────────────────────

export type LogEntry = {
  updatedDocs: string[]
  healthIssues: Array<{ doc: string; issues: string[] }>
  wiki: { entities: number; concepts: number }
}

export function appendCompilationLog(docsDir: string, entry: LogEntry): void {
  const logPath = join(docsDir, "log.md")
  const timestamp = new Date().toISOString()

  const lines: string[] = []

  // Create header if file doesn't exist
  try {
    readFileSync(logPath, "utf-8")
  } catch {
    lines.push("# Compilation Log\n")
  }

  lines.push(`## ${timestamp}\n`)

  if (entry.updatedDocs.length > 0) {
    for (const doc of entry.updatedDocs) {
      lines.push(`- Recompiled **${doc}**`)
    }
  } else {
    lines.push("- No docs needed recompilation")
  }

  if (entry.wiki.entities > 0 || entry.wiki.concepts > 0) {
    lines.push(
      `- Generated ${entry.wiki.entities} entity pages, ${entry.wiki.concepts} concept pages`,
    )
  }

  if (entry.healthIssues.length > 0) {
    for (const h of entry.healthIssues) {
      lines.push(`- Health issue in **${h.doc}**: ${h.issues.join("; ")}`)
    }
  }

  lines.push("")

  appendFileSync(logPath, `${lines.join("\n")}\n`)
}
