import { GoogleGenAI } from "@google/genai"
import { LLM_MAX_TOKENS, LLM_TEMPERATURE } from "../constants"
import type { LLMProvider, ProviderConfig } from "./types"

export function createGeminiProvider(config: ProviderConfig): {
  triage: LLMProvider
  compile: LLMProvider
} {
  const ai = new GoogleGenAI({ apiKey: config.apiKey })

  const createProvider = (model: string): LLMProvider => ({
    async generate(prompt, system) {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          temperature: LLM_TEMPERATURE,
          maxOutputTokens: LLM_MAX_TOKENS,
          ...(system ? { systemInstruction: system } : {}),
        },
      })
      return response.text ?? ""
    },
  })

  return {
    triage: createProvider(config.triageModel ?? "gemini-2.5-flash"),
    compile: createProvider(config.compileModel ?? "gemini-2.5-pro"),
  }
}
