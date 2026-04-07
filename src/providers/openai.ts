import OpenAI from "openai"
import type { LLMProvider, ProviderConfig } from "./types"

export function createOpenAIProvider(config: ProviderConfig): {
  triage: LLMProvider
  compile: LLMProvider
} {
  const client = new OpenAI({ apiKey: config.apiKey })

  const createProvider = (model: string): LLMProvider => ({
    async generate(prompt, system) {
      const response = await client.chat.completions.create({
        model,
        temperature: 0,
        messages: [
          ...(system ? [{ role: "system" as const, content: system }] : []),
          { role: "user" as const, content: prompt },
        ],
      })

      return response.choices[0]?.message?.content ?? ""
    },
  })

  return {
    triage: createProvider(config.triageModel ?? "gpt-4.1-mini"),
    compile: createProvider(config.compileModel ?? "gpt-4.1"),
  }
}
