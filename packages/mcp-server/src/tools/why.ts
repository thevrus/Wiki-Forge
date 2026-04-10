import type { WikiSource } from "../sources"

/**
 * Map a source file path to its wiki page path.
 * src/payments/stripe.ts → payments/stripe.md
 * src/auth/oauth.ts → auth/oauth.md
 * packages/api/src/routes.ts → api/routes.md
 */
function sourceToWikiPath(filePath: string): string[] {
  // Try multiple mapping strategies and return all candidates
  const candidates: string[] = []

  // Strip common prefixes
  let cleaned = filePath
    .replace(/^(src|lib|app|packages)\//, "")
    .replace(/^[^/]+\/src\//, "") // packages/foo/src/bar → bar

  // Replace extension with .md
  cleaned = cleaned.replace(
    /\.(ts|tsx|js|jsx|py|go|rs|rb|java|kt|swift|php)$/,
    ".md",
  )
  candidates.push(cleaned)

  // Also try just the filename
  const basename = cleaned.split("/").pop()
  if (basename && basename !== cleaned) {
    candidates.push(basename)
  }

  // Try directory-level match (src/payments/stripe.ts → PAYMENTS.md)
  const dir = filePath.split("/").slice(0, -1).pop()
  if (dir) {
    candidates.push(`${dir.toUpperCase()}.md`)
    candidates.push(`${dir}.md`)
  }

  return candidates
}

export async function handleWhy(
  sources: WikiSource[],
  filePath: string,
): Promise<string> {
  const candidates = sourceToWikiPath(filePath)

  for (const source of sources) {
    // Try each candidate path
    for (const candidate of candidates) {
      const content = await source.read(candidate)
      if (content) {
        return `# Decision context for \`${filePath}\`\n\n_Source: ${source.name}/${candidate}_\n\n${content}`
      }
    }

    // Fallback: search all wiki files for mentions of this file
    const allFiles = await source.list()
    const fileName = filePath.split("/").pop() ?? filePath
    const moduleName = fileName.replace(/\.[^.]+$/, "")

    for (const file of allFiles) {
      if (
        file.content.includes(fileName) ||
        file.content.includes(moduleName)
      ) {
        return `# Decision context for \`${filePath}\`\n\n_Found in: ${source.name}/${file.path}_\n\n${file.content}`
      }
    }
  }

  return (
    `No compiled context for \`${filePath}\`.\n\n` +
    "To generate context:\n" +
    "- Run `wiki-forge compile --ingest` to compile wiki pages with decision history\n" +
    "- Or use `/wf-why` in Claude Code for live git archaeology"
  )
}
