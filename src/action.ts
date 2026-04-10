import { appendFileSync } from "node:fs"
import { orchestrate } from "./compile/orchestrate"
import { generateDiffPreview } from "./git/diff"
import type { ProviderConfig } from "./providers/types"

function getInput(name: string): string {
  return process.env[`INPUT_${name.toUpperCase()}`] ?? ""
}

function setOutput(name: string, value: string) {
  const outputFile = process.env.GITHUB_OUTPUT
  if (!outputFile) return

  if (value.includes("\n")) {
    const delimiter = `ghadelimiter_${Date.now()}`
    appendFileSync(
      outputFile,
      `${name}<<${delimiter}\n${value}\n${delimiter}\n`,
    )
  } else {
    appendFileSync(outputFile, `${name}=${value}\n`)
  }
}

function logWarning(message: string) {
  console.log(`::warning::${message}`)
}

function logGroup(title: string, fn: () => void) {
  console.log(`::group::${title}`)
  fn()
  console.log("::endgroup::")
}

async function run() {
  const apiKey = getInput("api_key")
  if (!apiKey) {
    console.error("::error::Missing required input: api_key")
    process.exit(1)
  }

  const providerName = getInput("provider") || "gemini"
  if (
    providerName !== "gemini" &&
    providerName !== "claude" &&
    providerName !== "openai"
  ) {
    console.error(`::error::Invalid provider: ${providerName}`)
    process.exit(1)
  }

  const force = getInput("force") === "true"
  const triageModel = getInput("triage_model") || undefined
  const compileModel = getInput("compile_model") || undefined

  const provider: ProviderConfig = {
    provider: providerName,
    apiKey,
    triageModel,
    compileModel,
  }

  const repoRoot = process.env.GITHUB_WORKSPACE ?? process.cwd()
  const docsDir = getInput("docs_dir") || undefined

  console.log(`wiki-forge — compile mode (provider: ${providerName})`)
  if (docsDir) console.log(`Docs directory: ${docsDir}`)
  if (force) console.log("Force recompile enabled")

  try {
    const result = await orchestrate({
      repoRoot,
      docsDir: docsDir ? `${repoRoot}/${docsDir}` : undefined,
      provider,
      forceRecompile: force,
      skipWiki: false,
      mode: "compile",
    })

    // Set outputs
    const docsChanged = result.updatedDocs.length > 0
    setOutput("docs_changed", String(docsChanged))
    setOutput("updated_docs", result.updatedDocs.join(","))
    setOutput("health_issues", String(result.healthIssues.length > 0))

    const diffSummary = generateDiffPreview(result.docDiffs)
    if (diffSummary) {
      setOutput("diff_summary", diffSummary)
    }

    // Log triage results
    if (result.triageResults.length > 0) {
      logGroup("Triage results", () => {
        for (const t of result.triageResults) {
          const status = t.drifted ? "DRIFTED" : "OK"
          console.log(`  [${status}] ${t.doc} — ${t.reason}`)
        }
      })
    }

    // Log updated docs
    if (docsChanged) {
      logGroup("Updated docs", () => {
        for (const doc of result.updatedDocs) {
          console.log(`  ${doc}`)
        }
      })
    } else {
      console.log("All docs are up to date.")
    }

    // Log health issues as warnings
    if (result.healthIssues.length > 0) {
      logGroup("Health issues", () => {
        for (const h of result.healthIssues) {
          logWarning(`${h.doc}: ${h.issues.join("; ")}`)
          for (const issue of h.issues) {
            console.log(`  - ${issue}`)
          }
        }
      })
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred"
    console.error(`::error::${message}`)
    process.exit(1)
  }
}

run()
