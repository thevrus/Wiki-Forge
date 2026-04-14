import { appendFileSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { ProviderRole } from "../providers/types"

// Pricing in USD per 1M tokens. Unknown models still get tracked for tokens;
// cost is 0. Prices drift — eval harness output is the ground truth, not an
// exact invoice.
type Price = { input: number; output: number }

const PRICING: Record<string, Price> = {
  // Anthropic
  "claude-haiku-4-5-20251001": { input: 1.0, output: 5.0 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-sonnet-4-6-20250514": { input: 3.0, output: 15.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-opus-4-6": { input: 15.0, output: 75.0 },
  // OpenAI
  "gpt-4.1": { input: 2.0, output: 8.0 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  // Gemini
  "gemini-2.5-flash": { input: 0.075, output: 0.3 },
  "gemini-2.5-pro": { input: 1.25, output: 5.0 },
}

function priceFor(model: string): Price | null {
  if (PRICING[model]) return PRICING[model]
  // Prefix match so "claude-sonnet-4-6-20250514-foo" still resolves
  for (const key of Object.keys(PRICING)) {
    if (model.startsWith(key)) return PRICING[key]!
  }
  return null
}

export function computeCostUSD(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = priceFor(model)
  if (!p) return 0
  return (inputTokens * p.input) / 1e6 + (outputTokens * p.output) / 1e6
}

export type UsageRecord = {
  ts: string
  provider: string
  model: string
  role: ProviderRole
  inputTokens: number
  outputTokens: number
  durationMs: number
  costUSD: number
}

let records: UsageRecord[] = []

export function recordUsage(r: Omit<UsageRecord, "ts" | "costUSD">): void {
  records.push({
    ts: new Date().toISOString(),
    costUSD: computeCostUSD(r.model, r.inputTokens, r.outputTokens),
    ...r,
  })
}

export function resetUsage(): void {
  records = []
}

export type UsageSummary = {
  calls: number
  inputTokens: number
  outputTokens: number
  costUSD: number
}

function summarize(rs: UsageRecord[]): UsageSummary {
  return {
    calls: rs.length,
    inputTokens: rs.reduce((s, r) => s + r.inputTokens, 0),
    outputTokens: rs.reduce((s, r) => s + r.outputTokens, 0),
    costUSD: rs.reduce((s, r) => s + r.costUSD, 0),
  }
}

/** Append in-memory records to wiki/_telemetry.jsonl and reset. */
export function flushTelemetry(docsDir: string): UsageSummary {
  const summary = summarize(records)
  if (records.length === 0) return summary

  const path = join(docsDir, "_telemetry.jsonl")
  const payload = `${records.map((r) => JSON.stringify(r)).join("\n")}\n`
  appendFileSync(path, payload)
  resetUsage()
  return summary
}

/** Drain in-memory usage and return the summary without writing to disk.
 * Used by eval, which reports its own cost but should not pollute the
 * compile cost log. */
export function consumeUsageSummary(): UsageSummary {
  const summary = summarize(records)
  resetUsage()
  return summary
}

export type TelemetrySummary = UsageSummary & { runs: number }

/** Aggregate _telemetry.jsonl. Runs ≈ distinct calendar days with calls —
 * good enough proxy without tracking explicit run IDs. */
export function summarizeTelemetry(docsDir: string): TelemetrySummary | null {
  const path = join(docsDir, "_telemetry.jsonl")
  if (!existsSync(path)) return null

  try {
    const content = readFileSync(path, "utf-8")
    const lines = content.split("\n").filter((l) => l.trim())
    if (lines.length === 0) return null

    const days = new Set<string>()
    let costUSD = 0
    let inputTokens = 0
    let outputTokens = 0
    let calls = 0

    for (const line of lines) {
      try {
        const r = JSON.parse(line) as UsageRecord
        days.add(r.ts.slice(0, 10))
        costUSD += r.costUSD
        inputTokens += r.inputTokens
        outputTokens += r.outputTokens
        calls++
      } catch {
        // skip malformed line
      }
    }

    return { calls, costUSD, inputTokens, outputTokens, runs: days.size }
  } catch {
    return null
  }
}
