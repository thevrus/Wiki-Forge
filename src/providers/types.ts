export type ProviderRole = "triage" | "compile"

export type GenerateOptions = {
  /** JSON Schema for structured output. Each provider translates to its native
   * equivalent: Claude tool-use, OpenAI response_format, Gemini responseSchema,
   * Ollama format. The response text is guaranteed to be JSON-parseable (or
   * the provider will throw). Does not guarantee Zod schema conformance —
   * callers should still validate with Zod. */
  jsonSchema?: Record<string, unknown>
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
