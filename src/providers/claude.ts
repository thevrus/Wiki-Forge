import Anthropic from "@anthropic-ai/sdk"
import { LLM_MAX_TOKENS, LLM_TEMPERATURE } from "../constants"
import { recordUsage } from "../telemetry/usage"
import type { LLMProvider, ProviderConfig, ProviderRole } from "./types"

// Claude's tool schema requires an object-typed input_schema. We wrap the
// caller's JSON schema in a single-tool definition and force the model to
// call it via tool_choice — effectively a typed structured-output channel.
const STRUCTURED_TOOL_NAME = "return_structured_output"

export function createClaudeProvider(config: ProviderConfig): {
  triage: LLMProvider
  compile: LLMProvider
} {
  const client = new Anthropic({ apiKey: config.apiKey })

  const createProvider = (
    model: string,
    role: ProviderRole,
  ): LLMProvider => ({
    async generate(prompt, system, options) {
      const start = Date.now()
      const useTool = !!options?.jsonSchema
      const response = await client.messages.create({
        model,
        max_tokens: LLM_MAX_TOKENS,
        temperature: LLM_TEMPERATURE,
        ...(system ? { system } : {}),
        ...(useTool
          ? {
              tools: [
                {
                  name: STRUCTURED_TOOL_NAME,
                  description:
                    "Return the structured output. This is the only way to respond.",
                  input_schema: options!
                    .jsonSchema as Anthropic.Tool.InputSchema,
                },
              ],
              tool_choice: {
                type: "tool" as const,
                name: STRUCTURED_TOOL_NAME,
              },
            }
          : {}),
        messages: [{ role: "user", content: prompt }],
      })

      recordUsage({
        provider: "claude",
        model,
        role,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        durationMs: Date.now() - start,
      })

      if (useTool) {
        const toolUse = response.content.find(
          (block) => block.type === "tool_use",
        )
        if (toolUse && toolUse.type === "tool_use") {
          return JSON.stringify(toolUse.input)
        }
        // Fall through to text if the model failed to call the tool
      }

      return response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("")
    },
  })

  return {
    triage: createProvider(
      config.triageModel ?? "claude-haiku-4-5-20251001",
      "triage",
    ),
    compile: createProvider(
      config.compileModel ?? "claude-sonnet-4-6-20250514",
      "compile",
    ),
  }
}
