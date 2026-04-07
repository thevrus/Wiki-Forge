import { createClaudeProvider } from "./claude"
import { createGeminiProvider } from "./gemini"
import { createLocalProvider } from "./local"
import { createOpenAIProvider } from "./openai"
import type { LLMProvider, ProviderConfig } from "./types"

export type { LLMProvider, ProviderConfig }

export function createProviders(config: ProviderConfig): {
  triage: LLMProvider
  compile: LLMProvider
} {
  switch (config.provider) {
    case "gemini":
      return createGeminiProvider(config)
    case "claude":
      return createClaudeProvider(config)
    case "openai":
      return createOpenAIProvider(config)
    case "local":
      return createLocalProvider(config.localCmd)
  }
}
