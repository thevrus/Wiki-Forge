import type { WikiFile, WikiSource } from "../sources"

type SearchResult = {
  file: WikiFile
  score: number
  excerpt: string
}

/**
 * Simple text search across wiki markdown files.
 * No vector embeddings — just keyword matching on well-structured markdown.
 */
function scoreFile(file: WikiFile, terms: string[]): number {
  let score = 0
  const lower = file.content.toLowerCase()

  for (const term of terms) {
    const t = term.toLowerCase()

    // Title match (in first 200 chars or frontmatter) = high score
    const head = lower.slice(0, 200)
    if (head.includes(t)) score += 10

    // Count occurrences in body
    let idx = 0
    let count = 0
    while ((idx = lower.indexOf(t, idx)) !== -1) {
      count++
      idx += t.length
    }
    score += Math.min(count, 10) // cap per-term contribution

    // Heading match = bonus
    const headingMatch = file.content.match(new RegExp(`^#+\\s.*${term}`, "im"))
    if (headingMatch) score += 5
  }

  return score
}

/**
 * Extract the most relevant ~300 char excerpt around the first match.
 */
function extractExcerpt(content: string, terms: string[]): string {
  const lower = content.toLowerCase()

  // Find the first term occurrence
  let bestIdx = -1
  for (const term of terms) {
    const idx = lower.indexOf(term.toLowerCase())
    if (idx !== -1 && (bestIdx === -1 || idx < bestIdx)) {
      bestIdx = idx
    }
  }

  if (bestIdx === -1) {
    // No direct match — return opening paragraph (skip frontmatter)
    const bodyStart = content.indexOf("---", 3)
    const start = bodyStart !== -1 ? bodyStart + 4 : 0
    return content.slice(start, start + 300).trim() + "..."
  }

  // Window around the match
  const start = Math.max(0, bestIdx - 100)
  const end = Math.min(content.length, bestIdx + 200)
  let excerpt = content.slice(start, end).trim()

  if (start > 0) excerpt = "..." + excerpt
  if (end < content.length) excerpt = excerpt + "..."

  return excerpt
}

export async function handleSearch(
  sources: WikiSource[],
  query: string,
): Promise<string> {
  const terms = query
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .slice(0, 10)

  if (terms.length === 0) {
    return "Please provide a search query."
  }

  const results: SearchResult[] = []

  for (const source of sources) {
    const files = await source.list()

    for (const file of files) {
      const score = scoreFile(file, terms)
      if (score > 0) {
        results.push({
          file,
          score,
          excerpt: extractExcerpt(file.content, terms),
        })
      }
    }
  }

  if (results.length === 0) {
    return (
      `No results for "${query}" in compiled wiki pages.\n\n` +
      "The wiki may not cover this topic yet. Try:\n" +
      "- `/wf-why <file>` for live git archaeology on a specific file\n" +
      "- `wiki-forge compile --ingest` to compile with decision context"
    )
  }

  // Sort by score descending, take top 10
  results.sort((a, b) => b.score - a.score)
  const top = results.slice(0, 10)

  const lines = top.map((r, i) => {
    const repoPrefix = sources.length > 1 ? `[${r.file.repo}] ` : ""
    return [
      `### ${i + 1}. ${repoPrefix}${r.file.path}`,
      "",
      r.excerpt.replace(/\n/g, " "),
      "",
    ].join("\n")
  })

  return [
    `# Search results for "${query}"`,
    "",
    `_${results.length} matching page(s), showing top ${top.length}_`,
    "",
    ...lines,
  ].join("\n")
}
