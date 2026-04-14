import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

export type Fixture = {
  /** Identifier for reporting. Defaults to the filename + index. */
  id: string
  /** Question a user would ask the wiki. */
  question: string
  /** Facts the correct answer must contain. LLM judge scores presence of each. */
  expected_facts: string[]
  /** Source fixture file, for traceability. */
  file: string
}

export type LoadResult = {
  fixtures: Fixture[]
  /** Directory that was scanned (for error messages). */
  dir: string
}

/** Load every *.json file under wiki/_eval/ as a list of fixtures. */
export function loadFixtures(docsDir: string): LoadResult {
  const dir = join(docsDir, "_eval")
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return { fixtures: [], dir }
  }

  const fixtures: Fixture[] = []
  for (const file of entries) {
    if (!file.endsWith(".json")) continue
    const fullPath = join(dir, file)
    try {
      const raw = readFileSync(fullPath, "utf-8")
      const parsed = JSON.parse(raw) as unknown
      const arr = Array.isArray(parsed) ? parsed : [parsed]
      arr.forEach((item, i) => {
        if (!item || typeof item !== "object") return
        const f = item as {
          id?: string
          question?: string
          expected_facts?: unknown
        }
        if (!f.question || !Array.isArray(f.expected_facts)) return
        fixtures.push({
          id: f.id ?? `${file.replace(/\.json$/, "")}#${i + 1}`,
          question: f.question,
          expected_facts: f.expected_facts.filter(
            (x): x is string => typeof x === "string",
          ),
          file,
        })
      })
    } catch {
      // skip unparseable file
    }
  }

  return { fixtures, dir }
}
