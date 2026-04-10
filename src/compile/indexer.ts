import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { DocMap } from "../config"
import { getRecentChanges } from "../git"
import type { LLMProvider } from "../providers/types"

const SUMMARY_CAP = 10_000

function summaryPrompt(docName: string, content: string): string {
  return [
    "Summarize this document in exactly ONE sentence.",
    "Focus on specifics: name concrete features, systems, rules, or decisions.",
    "Do NOT be generic — a reader should learn something concrete from the summary.",
    "Respond with just the sentence, nothing else.",
    "",
    `## ${docName}`,
    "",
    content.length > SUMMARY_CAP ? content.slice(0, SUMMARY_CAP) : content,
  ].join("\n")
}

export async function generateIndex(
  docsDir: string,
  docMap: DocMap,
  triageProvider: LLMProvider,
  repoRoot?: string,
): Promise<string> {
  const entries = Object.entries(docMap.docs).filter(
    ([, entry]) => entry != null,
  )

  const summaryTasks = entries.map(async ([docPath, entry]) => {
    const fullPath = docPath.startsWith("/") ? docPath : `${docsDir}/${docPath}`

    let content: string
    try {
      content = readFileSync(fullPath, "utf-8")
    } catch {
      return null
    }

    if (!content.trim()) return null

    const raw = await triageProvider.generate(summaryPrompt(docPath, content))
    const summary = raw
      .trim()
      .replace(/^["']|["']$/g, "")
      .replace(/\n/g, " ")

    return {
      name: docPath,
      type: entry.type,
      description: entry.description,
      summary,
    }
  })

  const results = (await Promise.all(summaryTasks)).filter((r) => r != null)

  const now = new Date().toISOString()
  const lines = [
    "---",
    `generated_at: "${now}"`,
    "---",
    "",
    "# Wiki Index",
    "",
    "This wiki is compiled from the codebase by Wiki Forge. Each document reflects the current state of the code.",
    "",
  ]

  const compiled = results.filter((r) => r.type === "compiled")
  const healthChecks = results.filter((r) => r.type === "health-check")

  if (compiled.length > 0) {
    lines.push("## Compiled Documents", "")
    for (const r of compiled) {
      lines.push(`- **[${r.name}](${r.name})** — ${r.summary}`)
    }
    lines.push("")
  }

  if (healthChecks.length > 0) {
    lines.push("## Health-Checked Documents", "")
    for (const r of healthChecks) {
      lines.push(
        `- **[${r.name}](${r.name})** *(human-written, auto-checked)* — ${r.summary}`,
      )
    }
    lines.push("")
  }

  // List entity pages
  const entityFiles = listMdFiles(join(docsDir, "entities"))
  if (entityFiles.length > 0) {
    lines.push("## Entities", "")
    for (const file of entityFiles) {
      const name = file.replace(/\.md$/, "").replace(/-/g, " ")
      lines.push(`- [${name}](entities/${file})`)
    }
    lines.push("")
  }

  // List concept pages
  const conceptFiles = listMdFiles(join(docsDir, "concepts"))
  if (conceptFiles.length > 0) {
    lines.push("## Concepts", "")
    for (const file of conceptFiles) {
      const name = file.replace(/\.md$/, "").replace(/-/g, " ")
      lines.push(`- [${name}](concepts/${file})`)
    }
    lines.push("")
  }

  // Recently changed heat map
  if (repoRoot) {
    const allSources = entries
      .filter(([, e]) => e.type === "compiled")
      .flatMap(([, e]) => e.sources)
    const changes = getRecentChanges(allSources, repoRoot, 30)
    if (changes.length > 0) {
      lines.push("## Recently Changed (last 30 days)", "")
      lines.push("| File | Changed by | Date | What changed |")
      lines.push("|---|---|---|---|")
      for (const c of changes.slice(0, 15)) {
        const shortMsg =
          c.message.length > 60 ? `${c.message.slice(0, 57)}...` : c.message
        lines.push(`| ${c.file} | ${c.author} | ${c.date} | ${shortMsg} |`)
      }
      lines.push("")
    }
  }

  const indexContent = lines.join("\n")
  const indexPath = `${docsDir}/INDEX.md`
  writeFileSync(indexPath, indexContent)

  return indexPath
}

function listMdFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .sort()
  } catch {
    return []
  }
}

/** Generate llms.txt (https://llmstxt.org/) alongside the wiki. */
export function generateLlmsTxt(
  docsDir: string,
  docMap: DocMap,
  projectName?: string,
): string {
  const entries = Object.entries(docMap.docs).filter(
    ([, entry]) => entry != null,
  )

  const title = projectName ?? "Documentation"
  const lines = [
    `# ${title}`,
    "",
    "> Auto-generated documentation compiled from the codebase by wiki-forge.",
    "",
  ]

  const compiled = entries.filter(([, e]) => e!.type === "compiled")
  const healthChecks = entries.filter(([, e]) => e!.type === "health-check")

  if (compiled.length > 0) {
    lines.push("## Compiled Documents", "")
    for (const [docPath, entry] of compiled) {
      lines.push(`- [${docPath}](${docPath}): ${entry!.description}`)
    }
    lines.push("")
  }

  if (healthChecks.length > 0) {
    lines.push("## Health-Checked Documents", "")
    for (const [docPath, entry] of healthChecks) {
      lines.push(`- [${docPath}](${docPath}): ${entry!.description}`)
    }
    lines.push("")
  }

  const entityFiles = listMdFiles(join(docsDir, "entities"))
  if (entityFiles.length > 0) {
    lines.push("## Entities", "")
    for (const file of entityFiles) {
      const name = file.replace(/\.md$/, "").replace(/-/g, " ")
      lines.push(`- [${name}](entities/${file})`)
    }
    lines.push("")
  }

  const conceptFiles = listMdFiles(join(docsDir, "concepts"))
  if (conceptFiles.length > 0) {
    lines.push("## Concepts", "")
    for (const file of conceptFiles) {
      const name = file.replace(/\.md$/, "").replace(/-/g, " ")
      lines.push(`- [${name}](concepts/${file})`)
    }
    lines.push("")
  }

  const content = lines.join("\n")
  const outPath = `${docsDir}/llms.txt`
  writeFileSync(outPath, content)
  return outPath
}
