import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"
import matter from "gray-matter"
import type { DocMap } from "../config"
import { getDirectoryAuthors } from "../git"
import { tryGenerateJSON } from "../providers/json"
import type { LLMProvider } from "../providers/types"
import { type Extraction, ExtractionSchema } from "../schemas"

// ── Types ─────────────────────────────────────────────────────────────

type Topic = {
  name: string
  slug: string
  description: string
  referenced_in: string[]
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

// ── Cross-run dedup ───────────────────────────────────────────────────
// As the wiki matures, each run's extraction will rediscover the same
// entities. Without dedup, we'd overwrite well-written pages and fragment
// on near-duplicate names (AuthService vs UserAuthService). The rule:
// if an incoming topic matches an existing page by slug or by tokenized
// name similarity, leave the existing page alone.

type ExistingTopic = {
  slug: string
  name: string
  tokens: Set<string>
}

/** Split a name into lowercase tokens, handling camelCase and separators. */
function tokenize(name: string): Set<string> {
  const spaced = name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\-./]+/g, " ")
    .toLowerCase()
  const tokens = spaced.split(/\s+/).filter((t) => t.length > 1)
  return new Set(tokens)
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const t of a) if (b.has(t)) intersection++
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

const DEDUP_SIMILARITY_THRESHOLD = 0.6

/** Load existing topic pages from disk so we know what's already documented. */
function loadExistingTopics(dir: string): ExistingTopic[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  const out: ExistingTopic[] = []
  for (const file of entries) {
    if (!file.endsWith(".md")) continue
    const slug = file.replace(/\.md$/, "")
    let name = slug
    try {
      const raw = readFileSync(join(dir, file), "utf-8")
      const parsed = matter(raw)
      const fm = parsed.data as { title?: string; slug?: string }
      if (typeof fm.title === "string" && fm.title.trim()) {
        name = fm.title.trim().replace(/^["']|["']$/g, "")
      }
    } catch {
      // fall through — use slug as name
    }
    out.push({ slug, name, tokens: tokenize(name) })
  }
  return out
}

/** True if an incoming topic duplicates an existing page. */
function isDuplicate(topic: Topic, existing: ExistingTopic[]): boolean {
  const incomingTokens = tokenize(topic.name)
  for (const e of existing) {
    if (e.slug === topic.slug) return true
    if (jaccard(incomingTokens, e.tokens) >= DEDUP_SIMILARITY_THRESHOLD) {
      return true
    }
  }
  return false
}

// ── Page generation ───────────────────────────────────────────────────

function topicPagePrompt(
  topic: Topic,
  type: "entity" | "concept",
  docsContext: string,
  authorContext: string,
): string {
  return [
    `Write a short wiki page about "${topic.name}" (${type}).`,
    `${topic.description}`,
    "",
    "Rules:",
    "- Start with YAML frontmatter containing these fields:",
    `  title: "Human-readable name"`,
    `  slug: "${topic.slug}"`,
    `  category: ${type === "entity" ? "entities" : "concepts"}`,
    `  icon: (one emoji representing this ${type})`,
    `  description: "One-sentence summary"`,
    `  type: ${type}`,
    `  referenced_in: [list of doc names that mention this]`,
    "- 2-3 paragraph overview explaining what this is and why it matters",
    "- Use ### subsections if needed (relationships, current state, rules)",
    "- Write for PMs and designers, not engineers",
    "- Be specific and factual — name concrete behaviors, limits, states",
    "- If contributor data is provided, naturally mention who maintains or owns this area",
    "- End with a See also line linking related entity/concept names",
    "- Keep it under 300 words",
    "- Return ONLY markdown, no fencing",
    "",
    "## Source documentation (excerpts):",
    docsContext,
    authorContext,
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
  repoRoot?: string,
): Promise<{ entities: number; concepts: number }> {
  const fullContext = buildExtractionContext(docsDir, docMap)
  if (!fullContext.trim()) return { entities: 0, concepts: 0 }

  // Step 1: Extract entities + concepts via structured output
  const extractionPrompt = `${EXTRACT_PROMPT}\n\n${fullContext}`
  const extracted: Extraction = (await tryGenerateJSON(
    triageProvider,
    ExtractionSchema,
    extractionPrompt,
  )) ?? { entities: [], concepts: [] }

  if (extracted.entities.length === 0 && extracted.concepts.length === 0) {
    return { entities: 0, concepts: 0 }
  }

  // Cross-run dedup: drop incoming topics that match an existing page on disk.
  // Preserves hand-tuned or previously compiled pages and prevents near-name
  // fragmentation (e.g. AuthService vs UserAuthService on a second run).
  const existingEntities = loadExistingTopics(join(docsDir, "entities"))
  const existingConcepts = loadExistingTopics(join(docsDir, "concepts"))
  const entities = extracted.entities.filter(
    (t) => !isDuplicate(t, existingEntities),
  )
  const concepts = extracted.concepts.filter(
    (t) => !isDuplicate(t, existingConcepts),
  )

  if (entities.length === 0 && concepts.length === 0) {
    return { entities: 0, concepts: 0 }
  }

  // Collect all source paths for author lookups
  const allSources = Object.values(docMap.docs)
    .filter((e) => e != null)
    .flatMap((e) => e.sources)

  // Build author context once for entity/concept pages
  let authorContext = ""
  if (repoRoot && allSources.length > 0) {
    const contributors = getDirectoryAuthors(allSources, repoRoot)
    if (contributors.length > 0) {
      const lines = contributors
        .slice(0, 10)
        .map(
          (c) =>
            `- ${c.name}: ${c.commits} commits (last active: ${c.lastActive})`,
        )
      authorContext = ["", "## Contributors (from git history)", ...lines].join(
        "\n",
      )
    }
  }

  // Step 2: Create directories
  const entitiesDir = join(docsDir, "entities")
  const conceptsDir = join(docsDir, "concepts")
  mkdirSync(entitiesDir, { recursive: true })
  mkdirSync(conceptsDir, { recursive: true })

  // Step 3: Generate pages in parallel
  const tasks = [
    ...entities.map(async (topic) => {
      const context = extractRelevantContext(topic, fullContext)
      const prompt = topicPagePrompt(topic, "entity", context, authorContext)
      const content = await triageProvider.generate(prompt)
      const filePath = join(entitiesDir, `${topic.slug}.md`)
      writeFileSync(filePath, `${content.trim()}\n`)
    }),
    ...concepts.map(async (topic) => {
      const context = extractRelevantContext(topic, fullContext)
      const prompt = topicPagePrompt(topic, "concept", context, authorContext)
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
