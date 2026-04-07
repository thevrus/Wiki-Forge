import { GoogleGenAI } from "@google/genai"
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
          temperature: 0,
          maxOutputTokens: 65536,
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
