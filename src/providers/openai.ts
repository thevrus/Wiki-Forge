import OpenAI from "openai"
import { LLM_TEMPERATURE } from "../constants"
import { recordUsage } from "../telemetry/usage"
import type { LLMProvider, ProviderConfig, ProviderRole } from "./types"

export function createOpenAIProvider(config: ProviderConfig): {
  triage: LLMProvider
  compile: LLMProvider
} {
  const client = new OpenAI({ apiKey: config.apiKey })

  const createProvider = (
    model: string,
    role: ProviderRole,
  ): LLMProvider => ({
    async generate(prompt, system, options) {
      const start = Date.now()
      // OpenAI strict mode rejects schemas with additionalProperties:true or
      // optional fields. We pass non-strict so Zod (not the provider) owns
      // the final conformance check — aligns with the rest of the codebase.
      const responseFormat = options?.jsonSchema
        ? {
            response_format: {
              type: "json_schema" as const,
              json_schema: {
                name: "structured_output",
                schema: options.jsonSchema as Record<string, unknown>,
                strict: false,
              },
            },
          }
        : {}

      const response = await client.chat.completions.create({
        model,
        temperature: LLM_TEMPERATURE,
        ...responseFormat,
        messages: [
          ...(system ? [{ role: "system" as const, content: system }] : []),
          { role: "user" as const, content: prompt },
        ],
      })

      if (response.usage) {
        recordUsage({
          provider: "openai",
          model,
          role,
          inputTokens: response.usage.prompt_tokens,
          outputTokens: response.usage.completion_tokens,
          durationMs: Date.now() - start,
        })
      }

      return response.choices[0]?.message?.content ?? ""
    },
  })

  return {
    triage: createProvider(config.triageModel ?? "gpt-4.1-mini", "triage"),
    compile: createProvider(config.compileModel ?? "gpt-4.1", "compile"),
  }
}
