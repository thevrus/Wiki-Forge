import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import * as clack from "@clack/prompts"
import { runCommand } from "citty"
import * as log from "../logger"
import { ENV_KEY_MAP, VERSION } from "./args"

const LLM_COMMANDS = new Set(["compile", "health", "index", "report"])

type SavedPrefs = {
  provider?: string
  ollamaModel?: string
  ollamaUrl?: string
  localCmd?: string
}

function prefsPath(): string {
  return join(process.cwd(), ".wiki-forge-prefs.json")
}

function loadPrefs(): SavedPrefs {
  try {
    if (existsSync(prefsPath())) {
      return JSON.parse(readFileSync(prefsPath(), "utf-8"))
    }
  } catch {}
  return {}
}

function savePrefs(prefs: SavedPrefs): void {
  try {
    writeFileSync(prefsPath(), `${JSON.stringify(prefs, null, 2)}\n`)
  } catch {}
}

export async function promptProvider(): Promise<string[] | null> {
  const provider = await clack.select({
    message: "Which LLM provider?",
    options: [
      { value: "ollama", label: "Ollama", hint: "local, free, private" },
      {
        value: "gemini",
        label: "Gemini",
        hint: "Google, needs GEMINI_API_KEY",
      },
      {
        value: "claude",
        label: "Claude",
        hint: "Anthropic, needs ANTHROPIC_API_KEY",
      },
      { value: "openai", label: "OpenAI", hint: "needs OPENAI_API_KEY" },
      { value: "local", label: "Local command", hint: "custom shell command" },
    ],
  })
  if (clack.isCancel(provider)) return null

  const args = ["--provider", provider as string]

  if (provider === "ollama") {
    const ollamaUrl = args.find((a) => a === "--ollama-url")
      ? args[args.indexOf("--ollama-url") + 1]
      : "http://localhost:11434"

    // Try to fetch installed models from Ollama
    let installedModels: string[] = []
    try {
      const res = await fetch(`${ollamaUrl}/api/tags`)
      if (res.ok) {
        const data = (await res.json()) as { models?: Array<{ name: string }> }
        installedModels = (data.models ?? []).map((m) => m.name).sort()
      }
    } catch {
      // Ollama not running — fall back to text input
    }

    let model: string | symbol
    if (installedModels.length > 0) {
      model = await clack.select({
        message: "Ollama model?",
        options: installedModels.map((m) => ({ value: m, label: m })),
      })
    } else {
      model = await clack.text({
        message: "Ollama model? (couldn't reach Ollama to list models)",
        placeholder: "qwen2.5-coder:14b",
        defaultValue: "qwen2.5-coder:14b",
      })
    }
    if (clack.isCancel(model)) return null
    if (model) args.push("--ollama-model", model as string)
  } else if (provider === "local") {
    const cmd = await clack.text({
      message: "Local command (receives prompt on stdin, outputs to stdout)?",
      placeholder: "my-llm-wrapper",
    })
    if (clack.isCancel(cmd)) return null
    if (cmd) args.push("--local-cmd", cmd)
  } else {
    const envVar = ENV_KEY_MAP[provider as string]
    const hasKey = envVar ? !!process.env[envVar] : false
    if (!hasKey) {
      const key = await clack.text({
        message: `API key${envVar ? ` (or set ${envVar})` : ""}:`,
        validate: (v) => ((v ?? "").length < 5 ? "Key too short" : undefined),
      })
      if (clack.isCancel(key)) return null
      if (key) args.push("--api-key", key)
    }
  }

  return args
}

export async function interactiveWizard(
  main: ReturnType<typeof import("citty").defineCommand>,
) {
  log.intro(`wiki-forge v${VERSION}`)

  const { existsSync } = await import("node:fs")
  const hasDocMap = existsSync(`${process.cwd()}/docs/.doc-map.json`)

  const commandOptions = hasDocMap
    ? [
        { value: "compile", label: "Compile", hint: "update drifted docs" },
        { value: "check", label: "Check", hint: "see what drifted, no writes" },
        { value: "status", label: "Status", hint: "dashboard" },
        { value: "report", label: "Report", hint: "brain health report" },
      ]
    : [
        {
          value: "init",
          label: "Init",
          hint: "set up wiki-forge for this repo",
        },
      ]

  // Loop allows Esc to go back to command selection from provider step
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const command = await clack.select({
      message: "What would you like to do?",
      options: commandOptions,
    })

    if (clack.isCancel(command)) {
      log.outro("Cancelled.")
      return
    }

    const extraArgs: string[] = []

    if (LLM_COMMANDS.has(command as string)) {
      const prefs = loadPrefs()
      let providerArgs: string[] | null = null

      if (prefs.provider) {
        const label =
          prefs.provider === "ollama" && prefs.ollamaModel
            ? `${prefs.provider} (${prefs.ollamaModel})`
            : prefs.provider
        const reuse = await clack.confirm({
          message: `Use ${label}?`,
          initialValue: true,
        })
        if (clack.isCancel(reuse)) {
          continue // Esc → back to command selection
        }
        if (reuse) {
          providerArgs = ["--provider", prefs.provider]
          if (prefs.ollamaModel)
            providerArgs.push("--ollama-model", prefs.ollamaModel)
          if (prefs.ollamaUrl)
            providerArgs.push("--ollama-url", prefs.ollamaUrl)
          if (prefs.localCmd) providerArgs.push("--local-cmd", prefs.localCmd)
        }
      }

      if (!providerArgs) {
        providerArgs = await promptProvider()
        if (!providerArgs) {
          continue // Esc → back to command selection
        }
        // Save for next time
        const newPrefs: SavedPrefs = {}
        const idx = (flag: string) => providerArgs!.indexOf(flag)
        newPrefs.provider = providerArgs[idx("--provider") + 1]
        if (idx("--ollama-model") >= 0)
          newPrefs.ollamaModel = providerArgs[idx("--ollama-model") + 1]
        if (idx("--ollama-url") >= 0)
          newPrefs.ollamaUrl = providerArgs[idx("--ollama-url") + 1]
        if (idx("--local-cmd") >= 0)
          newPrefs.localCmd = providerArgs[idx("--local-cmd") + 1]
        savePrefs(newPrefs)
      }

      extraArgs.push(...providerArgs)
    }

    // Run the selected subcommand directly
    const subCommands = (
      main as unknown as { subCommands: Record<string, unknown> }
    ).subCommands
    const sub = subCommands?.[command as string]
    if (sub) {
      process.argv = [
        process.argv[0]!,
        process.argv[1]!,
        command as string,
        ...extraArgs,
      ]
      await runCommand(sub as Parameters<typeof runCommand>[0], {
        rawArgs: extraArgs,
      })
    }
    process.exit(0)
  }
}
