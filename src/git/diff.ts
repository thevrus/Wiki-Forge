import { execSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export type DocDiff = {
  doc: string
  before: string
  after: string
}

const PREVIEW_LINE_CAP = 80
const TOTAL_CAP = 20_000

export function computeUnifiedDiff(
  before: string,
  after: string,
  label: string,
): string {
  if (before === after) return ""

  const dir = mkdtempSync(join(tmpdir(), "wiki-forge-"))
  const oldFile = join(dir, "before")
  const newFile = join(dir, "after")

  try {
    writeFileSync(oldFile, before)
    writeFileSync(newFile, after)

    const result = execSync(
      `diff -u --label "a/${label}" --label "b/${label}" "${oldFile}" "${newFile}" || true`,
      { encoding: "utf-8", maxBuffer: 1024 * 1024 },
    )
    return result.trim()
  } catch {
    return ""
  } finally {
    try {
      rmSync(dir, { recursive: true })
    } catch {}
  }
}

export function generateDiffPreview(diffs: DocDiff[]): string {
  if (diffs.length === 0) return ""

  const sections: string[] = []

  for (const { doc, before, after } of diffs) {
    const isNew = before.trim().length === 0

    if (isNew) {
      const lines = after.split("\n")
      const preview = lines.slice(0, 50).join("\n")
      const truncated = lines.length > 50

      sections.push(
        [
          `### \`${doc}\` (new)`,
          "",
          "<details>",
          "<summary>View content</summary>",
          "",
          "```markdown",
          preview,
          ...(truncated ? ["", "... (truncated)"] : []),
          "```",
          "",
          "</details>",
        ].join("\n"),
      )
    } else {
      const diff = computeUnifiedDiff(before, after, doc)
      if (!diff) continue

      const lines = diff.split("\n")
      const truncated = lines.length > PREVIEW_LINE_CAP
      const preview = truncated
        ? `${lines.slice(0, PREVIEW_LINE_CAP).join("\n")}\n\n... (truncated)`
        : diff

      sections.push(
        [
          `### \`${doc}\``,
          "",
          "<details>",
          "<summary>View diff</summary>",
          "",
          "```diff",
          preview,
          "```",
          "",
          "</details>",
        ].join("\n"),
      )
    }
  }

  const result = sections.join("\n\n")
  return result.length > TOTAL_CAP
    ? `${result.slice(0, TOTAL_CAP)}\n\n_(diff preview truncated)_`
    : result
}
