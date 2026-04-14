import { GoogleGenAI } from "@google/genai"
import { LLM_MAX_TOKENS, LLM_TEMPERATURE } from "../constants"
import { recordUsage } from "../telemetry/usage"
import type { LLMProvider, ProviderConfig, ProviderRole } from "./types"

export function createGeminiProvider(config: ProviderConfig): {
  triage: LLMProvider
  compile: LLMProvider
} {
  const ai = new GoogleGenAI({ apiKey: config.apiKey })

  const createProvider = (
    model: string,
    role: ProviderRole,
  ): LLMProvider => ({
    async generate(prompt, system, options) {
      const start = Date.now()
      const structured = options?.jsonSchema
        ? {
            responseMimeType: "application/json",
            responseSchema: options.jsonSchema,
          }
        : {}

      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          temperature: LLM_TEMPERATURE,
          maxOutputTokens: LLM_MAX_TOKENS,
          ...(system ? { systemInstruction: system } : {}),
          ...structured,
        },
      })
      const usage = response.usageMetadata
      if (usage) {
        recordUsage({
          provider: "gemini",
          model,
          role,
          inputTokens: usage.promptTokenCount ?? 0,
          outputTokens: usage.candidatesTokenCount ?? 0,
          durationMs: Date.now() - start,
        })
      }
      return response.text ?? ""
    },
  })

  return {
    triage: createProvider(config.triageModel ?? "gemini-2.5-flash", "triage"),
    compile: createProvider(config.compileModel ?? "gemini-2.5-pro", "compile"),
  }
}
