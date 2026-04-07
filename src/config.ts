import { execSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { z } from "zod"

export const DocEntrySchema = z.object({
  description: z.string(),
  type: z.enum(["compiled", "health-check"]),
  sources: z.array(z.string()),
  context_files: z.array(z.string()),
})

export const DocMapSchema = z.object({
  docs: z.record(z.string(), DocEntrySchema),
  style: z.string().optional(),
})

export type DocEntry = z.infer<typeof DocEntrySchema>
export type DocMap = z.infer<typeof DocMapSchema>

export type WikiForgeConfig = {
  docsDir: string
  docMapPath: string
  lastSyncPath: string
  repoRoot: string
}

export function loadDocMap(path: string): DocMap {
  const raw = readFileSync(path, "utf-8")
  return DocMapSchema.parse(JSON.parse(raw))
}

export function resolveConfig(
  repoRoot?: string,
  docsDir?: string,
): WikiForgeConfig {
  const root =
    repoRoot ??
    execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim()

  const dir = docsDir ?? `${root}/docs`

  return {
    docsDir: dir,
    docMapPath: `${dir}/.doc-map.json`,
    lastSyncPath: `${dir}/.last-sync`,
    repoRoot: root,
  }
}
