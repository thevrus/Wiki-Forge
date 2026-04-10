export type GenerateOptions = {
  /** JSON schema for Ollama structured outputs. Forces model to return valid JSON matching the schema. */
  format?: Record<string, unknown>
}

export type LLMProvider = {
  generate: (
    prompt: string,
    system?: string,
    options?: GenerateOptions,
  ) => Promise<string>
}

export type ProviderConfig = {
  provider: "gemini" | "claude" | "openai" | "local" | "ollama"
  apiKey: string
  triageModel?: string
  compileModel?: string
  localCmd?: string
  ollamaUrl?: string
}
