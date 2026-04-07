import { LLM_TEMPERATURE, OLLAMA_TIMEOUT_MINUTES } from "../constants"
import type { LLMProvider, ProviderConfig } from "./types"

const DEFAULT_BASE_URL = "http://localhost:11434"

export function createOllamaProvider(config: ProviderConfig): {
  triage: LLMProvider
  compile: LLMProvider
} {
  const baseUrl = config.ollamaUrl ?? DEFAULT_BASE_URL

  const createProvider = (model: string): LLMProvider => ({
    async generate(prompt, system) {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MINUTES * 60 * 1000),
        body: JSON.stringify({
          model,
          stream: false,
          keep_alive: `${OLLAMA_TIMEOUT_MINUTES}m`,
          options: { temperature: LLM_TEMPERATURE },
          messages: [
            ...(system ? [{ role: "system", content: system }] : []),
            { role: "user", content: prompt },
          ],
        }),
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`Ollama error (${response.status}): ${text}`)
      }

      const data = (await response.json()) as {
        message?: { content?: string }
      }
      return data.message?.content ?? ""
    },
  })

  return {
    triage: createProvider(config.triageModel ?? "llama3.1"),
    compile: createProvider(config.compileModel ?? "llama3.1"),
  }
}
