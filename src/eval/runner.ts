import { writeFileSync } from "node:fs"
import { join } from "node:path"
import type { LLMProvider } from "../providers/types"
import { consumeUsageSummary } from "../telemetry/usage"
import { asyncPool } from "../utils"
import { type Fixture, loadFixtures } from "./fixtures"
import { answerQuestion, type Judgement, judgeAnswer } from "./judge"
import { buildIndex, type DocIndexEntry, type RetrievedDoc, retrieve } from "./retrieve"

export type EvalCase = {
  fixture: Fixture
  retrieved: RetrievedDoc[]
  answer: string
  judgement: Judgement
}

export type EvalSummary = {
  total: number
  averageScore: number
  /** Cases scoring >= passThreshold (default 0.7). */
  passed: number
  passThreshold: number
  cases: EvalCase[]
  cost: {
    calls: number
    inputTokens: number
    outputTokens: number
    costUSD: number
  }
  fixturesDir: string
  outputPath: string
}

const PASS_THRESHOLD = 0.7

export type RunOptions = {
  /** Concurrency for fixture execution. Each case runs answer + judge sequentially. */
  concurrency?: number
  /** Score at which a case is counted as "passed". */
  passThreshold?: number
}

async function runOne(
  fixture: Fixture,
  index: DocIndexEntry[],
  answerProvider: LLMProvider,
  judgeProvider: LLMProvider,
): Promise<EvalCase> {
  const retrieved = retrieve(fixture.question, index)
  const answer = await answerQuestion(
    fixture.question,
    retrieved,
    answerProvider,
  )
  const judgement = await judgeAnswer(
    fixture.question,
    fixture.expected_facts,
    answer,
    retrieved,
    judgeProvider,
  )
  return { fixture, retrieved, answer, judgement }
}

/** Run all fixtures and write _eval-results.md. */
export async function runEval(
  docsDir: string,
  answerProvider: LLMProvider,
  judgeProvider: LLMProvider,
  options: RunOptions = {},
  onProgress?: (done: number, total: number, fixtureId: string) => void,
): Promise<EvalSummary> {
  const passThreshold = options.passThreshold ?? PASS_THRESHOLD
  const concurrency = options.concurrency ?? 3

  const { fixtures, dir } = loadFixtures(docsDir)
  if (fixtures.length === 0) {
    return {
      total: 0,
      averageScore: 0,
      passed: 0,
      passThreshold,
      cases: [],
      cost: { calls: 0, inputTokens: 0, outputTokens: 0, costUSD: 0 },
      fixturesDir: dir,
      outputPath: join(docsDir, "_eval-results.md"),
    }
  }

  // Reset any pre-existing in-memory usage so eval cost is isolated.
  consumeUsageSummary()

  const index = buildIndex(docsDir)
  const cases: EvalCase[] = new Array(fixtures.length)
  let done = 0
  await asyncPool(concurrency, fixtures, async (fixture, i) => {
    cases[i] = await runOne(fixture, index, answerProvider, judgeProvider)
    done++
    onProgress?.(done, fixtures.length, fixture.id)
  })

  const cost = consumeUsageSummary()

  const averageScore =
    cases.reduce((s, c) => s + c.judgement.score, 0) / cases.length
  const passed = cases.filter((c) => c.judgement.score >= passThreshold).length

  const outputPath = join(docsDir, "_eval-results.md")
  const summary: EvalSummary = {
    total: cases.length,
    averageScore,
    passed,
    passThreshold,
    cases,
    cost,
    fixturesDir: dir,
    outputPath,
  }
  writeFileSync(outputPath, renderResults(summary))
  return summary
}

function renderResults(s: EvalSummary): string {
  const lines: string[] = []
  lines.push("# Eval Results")
  lines.push("")
  lines.push(`> Generated ${new Date().toISOString()}`)
  lines.push("")
  lines.push("## Summary")
  lines.push("")
  lines.push("| | |")
  lines.push("|---|---|")
  lines.push(`| Fixtures | **${s.total}** |`)
  lines.push(`| Average score | **${s.averageScore.toFixed(2)}** / 1.00 |`)
  lines.push(
    `| Passed (≥ ${s.passThreshold.toFixed(2)}) | **${s.passed} / ${s.total}** (${Math.round((s.passed / s.total) * 100)}%) |`,
  )
  lines.push(`| LLM calls | ${s.cost.calls} |`)
  lines.push(
    `| Tokens | ${s.cost.inputTokens.toLocaleString()} in / ${s.cost.outputTokens.toLocaleString()} out |`,
  )
  if (s.cost.costUSD > 0) {
    lines.push(`| Cost | $${s.cost.costUSD.toFixed(4)} |`)
  }
  lines.push("")
  lines.push("## Cases")
  lines.push("")
  lines.push("| ID | Score | Missing | Hallucinated |")
  lines.push("|----|------:|--------:|-------------:|")
  for (const c of s.cases) {
    lines.push(
      `| \`${c.fixture.id}\` | ${c.judgement.score.toFixed(2)} | ${c.judgement.missing.length} | ${c.judgement.hallucinated.length} |`,
    )
  }
  lines.push("")
  lines.push("## Detail")
  lines.push("")
  for (const c of s.cases) {
    lines.push(`### ${c.fixture.id}`)
    lines.push("")
    lines.push(`**Question:** ${c.fixture.question}`)
    lines.push("")
    lines.push(`**Score:** ${c.judgement.score.toFixed(2)}`)
    lines.push("")
    lines.push("**Retrieved:**")
    if (c.retrieved.length === 0) {
      lines.push("- (no docs matched)")
    } else {
      for (const r of c.retrieved) {
        lines.push(`- \`${r.path}\` (score ${r.score.toFixed(3)})`)
      }
    }
    lines.push("")
    lines.push("**Answer:**")
    lines.push("")
    lines.push(`> ${c.answer.replace(/\n/g, "\n> ")}`)
    lines.push("")
    if (c.judgement.missing.length > 0) {
      lines.push("**Missing facts:**")
      for (const m of c.judgement.missing) lines.push(`- ${m}`)
      lines.push("")
    }
    if (c.judgement.hallucinated.length > 0) {
      lines.push("**Hallucinated claims:**")
      for (const h of c.judgement.hallucinated) lines.push(`- ${h}`)
      lines.push("")
    }
    if (c.judgement.notes) {
      lines.push(`*${c.judgement.notes}*`)
      lines.push("")
    }
    lines.push("---")
    lines.push("")
  }
  return lines.join("\n")
}
