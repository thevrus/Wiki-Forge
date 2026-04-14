import { readFileSync } from "node:fs"
import { join } from "node:path"
import { listMarkdownFiles } from "../file-glob"

export type RetrievedDoc = {
  path: string
  score: number
  excerpt: string
}

export type DocIndexEntry = {
  /** Path relative to the docs dir. */
  path: string
  content: string
  tokens: string[]
}

const MAX_EXCERPT_CHARS = 3000
const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "should",
  "could",
  "what",
  "when",
  "where",
  "why",
  "how",
  "which",
  "who",
  "whom",
  "this",
  "that",
  "these",
  "those",
  "of",
  "to",
  "in",
  "for",
  "on",
  "with",
  "as",
  "by",
  "at",
  "from",
  "and",
  "or",
  "but",
  "if",
  "then",
  "than",
  "so",
  "it",
  "its",
])

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_\-/.]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t))
}

/** Read every .md doc under docsDir and pre-tokenize it. */
export function buildIndex(docsDir: string): DocIndexEntry[] {
  const out: DocIndexEntry[] = []
  for (const rel of listMarkdownFiles(docsDir)) {
    try {
      const content = readFileSync(join(docsDir, rel), "utf-8")
      out.push({ path: rel, content, tokens: tokenize(content) })
    } catch {
      // skip unreadable file
    }
  }
  return out
}

function bestExcerpt(content: string, queryTokens: Set<string>): string {
  // Window around the line with the highest token-hit count. Cheap proxy
  // for "the most relevant section" without embeddings or BM25.
  const lines = content.split("\n")
  let bestIdx = 0
  let bestScore = -1
  for (let i = 0; i < lines.length; i++) {
    const tokens = tokenize(lines[i]!)
    let score = 0
    for (const t of tokens) if (queryTokens.has(t)) score++
    if (score > bestScore) {
      bestScore = score
      bestIdx = i
    }
  }
  const start = Math.max(0, bestIdx - 5)
  const end = Math.min(lines.length, bestIdx + 25)
  const window = lines.slice(start, end).join("\n")
  return window.length > MAX_EXCERPT_CHARS
    ? `${window.slice(0, MAX_EXCERPT_CHARS)}…`
    : window
}

/** Score docs in the index by token-overlap with the question, return top N. */
export function retrieve(
  question: string,
  index: DocIndexEntry[],
  topN = 4,
): RetrievedDoc[] {
  const queryTokens = new Set(tokenize(question))
  if (queryTokens.size === 0) return []

  const ranked: RetrievedDoc[] = []
  for (const doc of index) {
    let hits = 0
    for (const t of doc.tokens) if (queryTokens.has(t)) hits++
    if (hits === 0) continue
    // Normalize by sqrt(doc length) so big docs don't trivially win
    const score = hits / Math.sqrt(doc.tokens.length || 1)
    ranked.push({
      path: doc.path,
      score,
      excerpt: bestExcerpt(doc.content, queryTokens),
    })
  }

  ranked.sort((a, b) => b.score - a.score)
  return ranked.slice(0, topN)
}
