import http from "node:http"
import {
  LLM_MAX_TOKENS,
  LLM_TEMPERATURE,
  OLLAMA_TIMEOUT_MINUTES,
} from "../constants"
import { recordUsage } from "../telemetry/usage"
import type { LLMProvider, ProviderConfig, ProviderRole } from "./types"

const DEFAULT_BASE_URL = "http://localhost:11434"
const TIMEOUT_MS = OLLAMA_TIMEOUT_MINUTES * 60 * 1000
const MAX_CTX = 131072

/** Estimate tokens from byte length (~4 chars per token for code). */
function adaptiveNumCtx(prompt: string, system?: string): number {
  const totalChars = prompt.length + (system?.length ?? 0)
  const estimatedTokens = Math.ceil(totalChars / 3.5) // conservative estimate for code
  const needed = estimatedTokens + LLM_MAX_TOKENS + 512 // input + max output + buffer
  // Round up to nearest 4096 for KV cache alignment
  const aligned = Math.ceil(needed / 4096) * 4096
  return Math.min(aligned, MAX_CTX)
}

export function createOllamaProvider(config: ProviderConfig): {
  triage: LLMProvider
  compile: LLMProvider
} {
  const baseUrl = config.ollamaUrl ?? DEFAULT_BASE_URL

  const createProvider = (
    model: string,
    role: ProviderRole,
  ): LLMProvider => ({
    async generate(prompt, system, options) {
      const start = Date.now()
      const url = new URL(`${baseUrl}/api/chat`)
      const body = JSON.stringify({
        model,
        stream: true,
        keep_alive: `${OLLAMA_TIMEOUT_MINUTES}m`,
        options: {
          temperature: LLM_TEMPERATURE,
          num_ctx: adaptiveNumCtx(prompt, system),
        },
        ...(options?.jsonSchema ? { format: options.jsonSchema } : {}),
        messages: [
          ...(system ? [{ role: "system", content: system }] : []),
          { role: "user", content: prompt },
        ],
      })

      let promptEvalCount = 0
      let evalCount = 0

      const consumeLine = (line: string, chunks: string[]): void => {
        if (!line.trim()) return
        try {
          const obj = JSON.parse(line) as {
            message?: { content?: string }
            prompt_eval_count?: number
            eval_count?: number
          }
          if (obj.message?.content) chunks.push(obj.message.content)
          if (typeof obj.prompt_eval_count === "number")
            promptEvalCount = obj.prompt_eval_count
          if (typeof obj.eval_count === "number") evalCount = obj.eval_count
        } catch {
          // malformed line — skip
        }
      }

      return new Promise<string>((resolve, reject) => {
        const req = http.request(
          url,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(body),
            },
          },
          (res) => {
            if (res.statusCode !== 200) {
              let error = ""
              res.on("data", (chunk: Buffer) => (error += chunk.toString()))
              res.on("end", () =>
                reject(new Error(`Ollama error (${res.statusCode}): ${error}`)),
              )
              return
            }

            const chunks: string[] = []
            let buffer = ""

            res.on("data", (chunk: Buffer) => {
              buffer += chunk.toString()
              const lines = buffer.split("\n")
              buffer = lines.pop()! // keep incomplete trailing line
              for (const line of lines) consumeLine(line, chunks)
            })

            res.on("end", () => {
              if (buffer) consumeLine(buffer, chunks)
              recordUsage({
                provider: "ollama",
                model,
                role,
                inputTokens: promptEvalCount,
                outputTokens: evalCount,
                durationMs: Date.now() - start,
              })
              resolve(chunks.join(""))
            })

            res.on("error", reject)
          },
        )

        // 30-min idle timeout — covers the gap between response headers
        // and first token while Ollama processes a large prompt
        req.setTimeout(TIMEOUT_MS, () => {
          req.destroy(
            new Error(
              `Ollama request timed out after ${OLLAMA_TIMEOUT_MINUTES} minutes`,
            ),
          )
        })

        req.on("error", reject)
        req.write(body)
        req.end()
      })
    },
  })

  return {
    triage: createProvider(config.triageModel ?? "llama3.1", "triage"),
    compile: createProvider(config.compileModel ?? "llama3.1", "compile"),
  }
}
