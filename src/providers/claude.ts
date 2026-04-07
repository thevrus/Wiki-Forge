import Anthropic from "@anthropic-ai/sdk"
import type { LLMProvider, ProviderConfig } from "./types"

export function createClaudeProvider(config: ProviderConfig): {
  triage: LLMProvider
  compile: LLMProvider
} {
  const client = new Anthropic({ apiKey: config.apiKey })

  const createProvider = (model: string): LLMProvider => ({
    async generate(prompt, system) {
      const response = await client.messages.create({
        model,
        max_tokens: 65536,
        temperature: 0,
        ...(system ? { system } : {}),
        messages: [{ role: "user", content: prompt }],
      })

      return response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("")
    },
  })

  return {
    triage: createProvider(config.triageModel ?? "claude-haiku-4-5-20251001"),
    compile: createProvider(
      config.compileModel ?? "claude-sonnet-4-6-20250514",
    ),
  }
}
