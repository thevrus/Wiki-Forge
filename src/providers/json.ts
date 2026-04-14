import { z } from "zod"
import { stripCodeFences } from "../validation/output"
import type { LLMProvider } from "./types"

/** Extract JSON from LLM output that may contain markdown, preamble, or trailing text. */
function safeParse(raw: string): unknown {
  const cleaned = raw.trim()

  // Try direct parse first
  try {
    return JSON.parse(cleaned)
  } catch {
    /* fall through */
  }

  // Strip code fences
  try {
    return JSON.parse(stripCodeFences(cleaned))
  } catch {
    /* fall through */
  }

  // Find the first { and last } — extract JSON object from surrounding text
  const firstBrace = cleaned.indexOf("{")
  const lastBrace = cleaned.lastIndexOf("}")
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1))
    } catch {
      /* fall through */
    }
  }

  throw new Error(
    `Could not extract JSON from LLM response (${cleaned.length} chars, starts with: ${cleaned.slice(0, 100)})`,
  )
}

export async function generateJSON<T>(
  provider: LLMProvider,
  schema: z.ZodType<T>,
  prompt: string,
  system?: string,
): Promise<T> {
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>
  const raw = await provider.generate(prompt, system, { jsonSchema })
  const parsed = safeParse(raw)
  return schema.parse(parsed)
}

/** Best-effort variant: returns null on any failure (parse, validation, network). */
export async function tryGenerateJSON<T>(
  provider: LLMProvider,
  schema: z.ZodType<T>,
  prompt: string,
  system?: string,
): Promise<T | null> {
  try {
    return await generateJSON(provider, schema, prompt, system)
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error"
    // Log the actual error so users know why smart init failed
    if (process.env.DEBUG) console.error(`[json] ${msg}`)
    return null
  }
}
