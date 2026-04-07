import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"
import {
  Badge,
  ConfirmInput,
  MultiSelect,
  Spinner,
  StatusMessage,
} from "@inkjs/ui"
import { Box, render, Text, useApp } from "ink"
import { useEffect, useState } from "react"

// ── Types ─────────────────────────────────────────────────────────────

type DocSuggestion = {
  name: string
  description: string
  type: "compiled" | "health-check"
  sources: string[]
  contextFiles: string[]
}

type Phase = "scan" | "select" | "confirm" | "done"

// ── Directory detection ───────────────────────────────────────────────

const IGNORED = new Set([
  "node_modules",
  "dist",
  "build",
  ".git",
  ".next",
  ".nuxt",
  "coverage",
  "__pycache__",
  ".cache",
  ".turbo",
])

function detectDirectories(repo: string): string[] {
  const dirs: string[] = []

  const topLevel = readdirSync(repo).filter((f) => {
    if (f.startsWith(".") || IGNORED.has(f)) return false
    try {
      return statSync(join(repo, f)).isDirectory()
    } catch {
      return false
    }
  })

  for (const dir of topLevel) {
    dirs.push(`${dir}/`)
    try {
      const subs = readdirSync(join(repo, dir)).filter((f) => {
        if (f.startsWith(".") || IGNORED.has(f)) return false
        try {
          return statSync(join(repo, dir, f)).isDirectory()
        } catch {
          return false
        }
      })
      for (const sub of subs) {
        dirs.push(`${dir}/${sub}/`)
      }
    } catch {}
  }

  return dirs
}

// ── Suggestion templates ──────────────────────────────────────────────

const DOC_TEMPLATES = [
  {
    name: "ARCHITECTURE.md",
    description:
      "System architecture: services, APIs, data flows, and infrastructure",
    type: "compiled" as const,
    patterns: ["src/", "lib/", "server/", "backend/"],
    contextPatterns: [
      "package.json",
      "tsconfig.json",
      "docker-compose.yml",
      "Dockerfile",
    ],
  },
  {
    name: "PRODUCT.md",
    description: "User-facing screens, flows, features, and UI states",
    type: "compiled" as const,
    patterns: [
      "src/app/",
      "src/pages/",
      "src/components/",
      "src/screens/",
      "src/views/",
      "app/",
      "pages/",
      "components/",
    ],
    contextPatterns: [],
  },
  {
    name: "DATA.md",
    description: "Data models, entities, relationships, and storage",
    type: "compiled" as const,
    patterns: [
      "src/types/",
      "src/models/",
      "src/db/",
      "src/schema/",
      "prisma/",
      "drizzle/",
      "src/entities/",
      "models/",
      "schema/",
    ],
    contextPatterns: [],
  },
  {
    name: "BUSINESS_RULES.md",
    description:
      "Validation rules, business logic, fees, eligibility, and constraints",
    type: "compiled" as const,
    patterns: [
      "src/lib/",
      "src/utils/",
      "src/middleware/",
      "src/services/",
      "src/logic/",
      "lib/",
      "utils/",
    ],
    contextPatterns: [],
  },
  {
    name: "API.md",
    description:
      "API endpoints, request/response formats, authentication, and rate limits",
    type: "compiled" as const,
    patterns: [
      "src/api/",
      "src/routes/",
      "src/controllers/",
      "src/handlers/",
      "api/",
      "routes/",
    ],
    contextPatterns: [],
  },
]

function buildSuggestions(dirs: string[], repo: string): DocSuggestion[] {
  const result: DocSuggestion[] = []

  for (const template of DOC_TEMPLATES) {
    const matchedSources = template.patterns.filter((p) => dirs.includes(p))
    if (matchedSources.length === 0) continue

    const contextFiles = template.contextPatterns.filter((f) =>
      existsSync(join(repo, f)),
    )

    result.push({
      name: template.name,
      description: template.description,
      type: template.type,
      sources: matchedSources,
      contextFiles,
    })
  }

  if (dirs.some((d) => d === "src/" || d === "lib/" || d === "app/")) {
    result.push({
      name: "DECISIONS.md",
      description:
        "Architectural decision records with alternatives and tradeoffs",
      type: "health-check",
      sources: ["src/"],
      contextFiles: [],
    })
  }

  return result
}

// ── Write doc map ─────────────────────────────────────────────────────

function writeDocMap(
  repo: string,
  docsDir: string | undefined,
  selected: DocSuggestion[],
): void {
  const dirName = docsDir ?? "docs"
  const fullDocsDir = join(repo, dirName)
  const docMapPath = join(fullDocsDir, ".doc-map.json")

  const docs: Record<
    string,
    {
      description: string
      type: string
      sources: string[]
      context_files: string[]
    }
  > = {}

  for (const s of selected) {
    docs[s.name] = {
      description: s.description,
      type: s.type,
      sources: s.sources,
      context_files: s.contextFiles,
    }
  }

  mkdirSync(fullDocsDir, { recursive: true })
  writeFileSync(docMapPath, `${JSON.stringify({ docs }, null, 2)}\n`)
}

// ── React components ──────────────────────────────────────────────────

function Header() {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color="blue">
        {"📚 wiki-forge"} <Text dimColor>interactive setup</Text>
      </Text>
    </Box>
  )
}

function DirectoryList({ dirs }: { dirs: string[] }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text dimColor>Found directories:</Text>
      <Box flexDirection="column" paddingLeft={2}>
        {dirs.map((d) => (
          <Text key={d} color="cyan">
            {d}
          </Text>
        ))}
      </Box>
    </Box>
  )
}

function SuggestionDetail({ suggestion }: { suggestion: DocSuggestion }) {
  return (
    <Box flexDirection="column" paddingLeft={2} marginBottom={1}>
      {suggestion.sources.map((s) => (
        <Text key={s} dimColor>
          {" "}
          source: {s}
        </Text>
      ))}
      {suggestion.contextFiles.map((f) => (
        <Text key={f} dimColor>
          {" "}
          context: {f}
        </Text>
      ))}
    </Box>
  )
}

function App({ repo, docsDir }: { repo: string; docsDir: string | undefined }) {
  const { exit } = useApp()
  const [phase, setPhase] = useState<Phase>("scan")
  const [dirs, setDirs] = useState<string[]>([])
  const [suggestions, setSuggestions] = useState<DocSuggestion[]>([])
  const [selected, setSelected] = useState<DocSuggestion[]>([])
  const [wrote, setWrote] = useState(false)

  useEffect(() => {
    const detected = detectDirectories(repo)
    setDirs(detected)
    const sugg = buildSuggestions(detected, repo)
    setSuggestions(sugg)
    setPhase(sugg.length > 0 ? "select" : "done")
  }, [repo])

  useEffect(() => {
    if (phase === "done") {
      const timer = setTimeout(() => exit(), 100)
      return () => clearTimeout(timer)
    }
  }, [phase, exit])

  if (phase === "scan") {
    return (
      <Box flexDirection="column">
        <Header />
        <Spinner label="Scanning directories..." />
      </Box>
    )
  }

  if (phase === "select") {
    const options = suggestions.map((s) => ({
      label: `${s.name}  ${s.type === "health-check" ? "(health-check) " : ""}— ${s.description}`,
      value: s.name,
    }))

    return (
      <Box flexDirection="column">
        <Header />
        <DirectoryList dirs={dirs} />

        <Box flexDirection="column">
          <Text>
            Select docs to generate{" "}
            <Text dimColor>(space = toggle, enter = confirm)</Text>:
          </Text>
          <Box marginTop={1}>
            <MultiSelect
              options={options}
              defaultValue={suggestions.map((s) => s.name)}
              onSubmit={(values) => {
                const sel = suggestions.filter((s) => values.includes(s.name))
                setSelected(sel)
                setPhase(sel.length > 0 ? "confirm" : "done")
              }}
            />
          </Box>
        </Box>
      </Box>
    )
  }

  if (phase === "confirm") {
    return (
      <Box flexDirection="column">
        <Header />
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>Will create {docsDir ?? "docs"}/.doc-map.json with:</Text>
          {selected.map((s) => (
            <Box key={s.name} flexDirection="column" paddingLeft={2}>
              <Text>
                <Badge color={s.type === "health-check" ? "yellow" : "green"}>
                  {s.type}
                </Badge>{" "}
                <Text bold>{s.name}</Text>
              </Text>
              <SuggestionDetail suggestion={s} />
            </Box>
          ))}
        </Box>

        <Box>
          <Text>Confirm? </Text>
          <ConfirmInput
            onConfirm={() => {
              writeDocMap(repo, docsDir, selected)
              setWrote(true)
              setPhase("done")
            }}
            onCancel={() => {
              setSelected([])
              setPhase("done")
            }}
          />
        </Box>
      </Box>
    )
  }

  // done
  return (
    <Box flexDirection="column">
      {wrote ? (
        <>
          <StatusMessage variant="success">
            Created {docsDir ?? "docs"}/.doc-map.json with {selected.length}{" "}
            doc(s)
          </StatusMessage>
          <Text dimColor> Next: wiki-forge compile</Text>
        </>
      ) : (
        <Text dimColor>No docs selected.</Text>
      )}
    </Box>
  )
}

// ── Entry point ───────────────────────────────────────────────────────

export async function runInteractiveInit(
  repo: string,
  docsDir?: string,
): Promise<void> {
  const dirName = docsDir ?? "docs"
  const docMapPath = join(repo, dirName, ".doc-map.json")

  if (existsSync(docMapPath)) {
    console.log(`⏭  ${dirName}/.doc-map.json already exists, skipping.`)
    return
  }

  const app = render(<App repo={repo} docsDir={docsDir} />)
  await app.waitUntilExit()
}
