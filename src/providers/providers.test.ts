import { describe, expect, test } from "bun:test"
import { createProviders } from "."
import type { ProviderConfig } from "./types"

describe("createProviders", () => {
  test("creates ollama provider without API key", () => {
    const config: ProviderConfig = {
      provider: "ollama",
      apiKey: "",
    }
    const providers = createProviders(config)
    expect(providers.triage).toBeDefined()
    expect(providers.compile).toBeDefined()
    expect(typeof providers.triage.generate).toBe("function")
    expect(typeof providers.compile.generate).toBe("function")
  })

  test("creates local provider without API key", () => {
    const config: ProviderConfig = {
      provider: "local",
      apiKey: "",
      localCmd: "echo test",
    }
    const providers = createProviders(config)
    expect(providers.triage).toBeDefined()
    expect(providers.compile).toBeDefined()
  })

  test("creates gemini provider", () => {
    const config: ProviderConfig = {
      provider: "gemini",
      apiKey: "fake-key",
    }
    const providers = createProviders(config)
    expect(providers.triage).toBeDefined()
    expect(providers.compile).toBeDefined()
  })

  test("creates claude provider", () => {
    const config: ProviderConfig = {
      provider: "claude",
      apiKey: "fake-key",
    }
    const providers = createProviders(config)
    expect(providers.triage).toBeDefined()
    expect(providers.compile).toBeDefined()
  })

  test("creates openai provider", () => {
    const config: ProviderConfig = {
      provider: "openai",
      apiKey: "fake-key",
    }
    const providers = createProviders(config)
    expect(providers.triage).toBeDefined()
    expect(providers.compile).toBeDefined()
  })

  test("ollama provider respects custom model", () => {
    const config: ProviderConfig = {
      provider: "ollama",
      apiKey: "",
      triageModel: "mistral",
      compileModel: "deepseek-r1",
    }
    const providers = createProviders(config)
    expect(providers.triage).toBeDefined()
    expect(providers.compile).toBeDefined()
  })

  test("ollama provider respects custom URL", () => {
    const config: ProviderConfig = {
      provider: "ollama",
      apiKey: "",
      ollamaUrl: "http://192.168.1.10:11434",
    }
    const providers = createProviders(config)
    expect(providers.triage).toBeDefined()
    expect(providers.compile).toBeDefined()
  })
})
