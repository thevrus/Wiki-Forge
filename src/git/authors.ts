import { writeFileSync } from "node:fs"
import { join } from "node:path"
import type { DocMap } from "../config"
import { getDirectoryAuthors, getRecentChanges } from "./core"

type AuthorProfile = {
  name: string
  email: string
  totalCommits: number
  lastActive: string
  areas: string[] // source directories they're most active in
}

function buildAuthorProfiles(
  docMap: DocMap,
  repoRoot: string,
): AuthorProfile[] {
  const profileMap = new Map<string, AuthorProfile & { areaSet: Set<string> }>()

  for (const [, entry] of Object.entries(docMap.docs)) {
    if (!entry || entry.type !== "compiled") continue

    const contributors = getDirectoryAuthors(entry.sources, repoRoot)
    for (const c of contributors) {
      const key = c.email.toLowerCase()
      const existing = profileMap.get(key)

      if (existing) {
        existing.totalCommits += c.commits
        if (c.lastActive > existing.lastActive)
          existing.lastActive = c.lastActive
        for (const src of entry.sources) existing.areaSet.add(src)
      } else {
        profileMap.set(key, {
          name: c.name,
          email: c.email,
          totalCommits: c.commits,
          lastActive: c.lastActive,
          areas: [],
          areaSet: new Set(entry.sources),
        })
      }
    }
  }

  return Array.from(profileMap.values())
    .map((p) => ({
      name: p.name,
      email: p.email,
      totalCommits: p.totalCommits,
      lastActive: p.lastActive,
      areas: Array.from(p.areaSet),
    }))
    .sort((a, b) => b.totalCommits - a.totalCommits)
}

export function generateAuthors(
  docsDir: string,
  docMap: DocMap,
  repoRoot: string,
): string {
  const profiles = buildAuthorProfiles(docMap, repoRoot)
  const allSources = Object.values(docMap.docs)
    .filter((e) => e != null && e.type === "compiled")
    .flatMap((e) => e.sources)
  const recentChanges = getRecentChanges(allSources, repoRoot, 90)

  const now = new Date().toISOString()
  const lines: string[] = [
    "---",
    `generated_at: "${now}"`,
    "---",
    "",
    "# Codebase Authors",
    "",
  ]

  // Author profiles
  for (const profile of profiles) {
    lines.push(`## ${profile.name}`)
    lines.push(`Primary areas: ${profile.areas.join(", ")}`)
    lines.push(
      `Active through: ${profile.lastActive} (${profile.totalCommits} commits)`,
    )
    lines.push("")
  }

  // Last touched table
  if (recentChanges.length > 0) {
    lines.push("## Last Touched")
    lines.push("")
    lines.push("| Module | Author | Date |")
    lines.push("|---|---|---|")
    for (const c of recentChanges.slice(0, 20)) {
      lines.push(`| ${c.file} | ${c.author} | ${c.date} |`)
    }
    lines.push("")
  }

  const content = lines.join("\n")
  const authorsPath = join(docsDir, "AUTHORS.md")
  writeFileSync(authorsPath, content)

  return authorsPath
}
