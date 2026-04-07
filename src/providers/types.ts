export type LLMProvider = {
  generate: (prompt: string, system?: string) => Promise<string>
}

export type ProviderConfig = {
  provider: "gemini" | "claude" | "openai" | "local" | "ollama"
  apiKey: string
  triageModel?: string
  compileModel?: string
  localCmd?: string
  ollamaUrl?: string
}
