import { spawn } from "node:child_process"
import type { LLMProvider } from "./types"

function callCli(cmd: string, args: string[], prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      stdio: ["pipe", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString()
    })
    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString()
    })

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `${cmd} exited with code ${code}`))
      } else {
        resolve(stdout)
      }
    })

    proc.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new Error(
            `"${cmd}" not found. Install it or use --provider gemini/claude/openai.`,
          ),
        )
      } else {
        reject(err)
      }
    })

    proc.stdin.write(prompt)
    proc.stdin.end()
  })
}

/**
 * Parses a command string like "claude -p" into [cmd, ...args].
 * Prompt is piped via stdin.
 */
function parseCommand(command: string): { cmd: string; args: string[] } {
  const parts = command.split(/\s+/).filter(Boolean)
  const cmd = parts[0]!
  const args = parts.slice(1)
  return { cmd, args }
}

export function createLocalProvider(command = "claude -p"): {
  triage: LLMProvider
  compile: LLMProvider
} {
  const { cmd, args } = parseCommand(command)

  const provider: LLMProvider = {
    async generate(prompt) {
      return callCli(cmd, args, prompt)
    },
  }

  return { triage: provider, compile: provider }
}
