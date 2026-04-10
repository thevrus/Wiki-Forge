import type { WikiSource } from "../sources"

type ContextHolder = {
  name: string
  percentage?: number
  lastActive?: string
  modules: string[]
}

/**
 * Extract context holders from wiki file frontmatter and content.
 * Looks for contributors YAML block and "Context Holders" sections.
 */
function extractContextHolders(
  content: string,
  filePath: string,
): ContextHolder[] {
  const holders = new Map<string, ContextHolder>()

  // Parse YAML frontmatter contributors
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (fmMatch) {
    const fm = fmMatch[1]!
    // Match: - name: "Alice Chen"\n    commits: 47\n    last_active: "2026-04-08"
    const contributorBlocks = fm.matchAll(
      /- name: "([^"]+)"\n\s+commits: (\d+)\n\s+last_active: "([^"]+)"/g,
    )
    for (const match of contributorBlocks) {
      const name = match[1]!
      const existing = holders.get(name)
      if (existing) {
        existing.modules.push(filePath)
      } else {
        holders.set(name, {
          name,
          lastActive: match[3],
          modules: [filePath],
        })
      }
    }
  }

  // Look for "Context Holders" or "Contributors" sections in body
  const sectionMatch = content.match(
    /##\s*(?:Context Holders|Contributors|Who to Ask)[\s\S]*?(?=\n##|\n---|z)/i,
  )
  if (sectionMatch) {
    const nameMatches = sectionMatch[0].matchAll(
      /[-*]\s+\*?\*?([^:*\n]+)\*?\*?\s*[:\-–]\s*(\d+)%?\s*(?:ownership)?\s*(?:\(last active: ([^)]+)\))?/g,
    )
    for (const match of nameMatches) {
      const name = match[1]!.trim()
      const existing = holders.get(name)
      if (existing) {
        existing.percentage = Number(match[2])
        existing.modules.push(filePath)
      } else {
        holders.set(name, {
          name,
          percentage: Number(match[2]),
          lastActive: match[3],
          modules: [filePath],
        })
      }
    }
  }

  return [...holders.values()]
}

export async function handleWho(
  sources: WikiSource[],
  fileOrDir: string,
): Promise<string> {
  const allHolders = new Map<string, ContextHolder>()
  const searchTerm =
    fileOrDir
      .split("/")
      .pop()
      ?.replace(/\.[^.]+$/, "") ?? fileOrDir

  for (const source of sources) {
    const files = await source.list()

    for (const file of files) {
      // Check if this wiki page is relevant to the query
      const isRelevant =
        file.path.includes(searchTerm) ||
        file.content.includes(searchTerm) ||
        file.content.includes(fileOrDir)

      if (!isRelevant) continue

      const holders = extractContextHolders(file.content, file.path)
      for (const h of holders) {
        const existing = allHolders.get(h.name)
        if (existing) {
          existing.modules.push(...h.modules)
          if (
            h.percentage &&
            (!existing.percentage || h.percentage > existing.percentage)
          ) {
            existing.percentage = h.percentage
          }
          if (
            h.lastActive &&
            (!existing.lastActive || h.lastActive > existing.lastActive)
          ) {
            existing.lastActive = h.lastActive
          }
        } else {
          allHolders.set(h.name, { ...h })
        }
      }
    }
  }

  if (allHolders.size === 0) {
    return (
      `No context holders found for \`${fileOrDir}\`.\n\n` +
      "This file may not have compiled wiki pages yet. " +
      "Run `wiki-forge compile --ingest` to generate context."
    )
  }

  const sorted = [...allHolders.values()].sort(
    (a, b) => (b.percentage ?? 0) - (a.percentage ?? 0),
  )

  const busFactor = sorted.filter((h) => (h.percentage ?? 0) >= 20).length
  const busFactorWarning =
    busFactor <= 1
      ? "\n\n**Warning: Bus factor is 1.** Only one person has significant context on this area."
      : ""

  const lines = sorted.map((h) => {
    const pct = h.percentage ? `${h.percentage}%` : "—"
    const active = h.lastActive ?? "unknown"
    const mods = [...new Set(h.modules)].slice(0, 5).join(", ")
    return `| ${h.name} | ${pct} | ${active} | ${mods} |`
  })

  return [
    `# Context holders for \`${fileOrDir}\``,
    "",
    `**Bus factor: ${busFactor || "unknown"}**${busFactorWarning}`,
    "",
    "| Person | Ownership | Last Active | Modules |",
    "|--------|-----------|-------------|---------|",
    ...lines,
    "",
    "_Data from compiled wiki pages. Run `wiki-forge compile --ingest` to update._",
  ].join("\n")
}
