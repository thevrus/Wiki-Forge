export const VERSION = "0.5.0"

export const ENV_KEY_MAP: Record<string, string> = {
  gemini: "GEMINI_API_KEY",
  claude: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
}

export const providerArg = {
  type: "enum" as const,
  description: "LLM provider",
  default: "gemini",
  options: ["gemini", "claude", "openai", "ollama", "local"],
}

export const repoArg = {
  type: "string" as const,
  description: "Repository root",
  default: process.cwd(),
}

export const docsDirArg = {
  type: "string" as const,
  description: "Docs output directory",
}

export const apiKeyArg = {
  type: "string" as const,
  description:
    "API key (or set GEMINI_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY)",
}

export const localCmdArg = {
  type: "string" as const,
  description: 'CLI command for local provider (default: "claude -p")',
}

export const ollamaModelArg = {
  type: "string" as const,
  description: "Ollama model name (default: llama3.1)",
}

export const ollamaUrlArg = {
  type: "string" as const,
  description: "Ollama server URL (default: http://localhost:11434)",
}

export const forceArg = {
  type: "boolean" as const,
  description: "Force recompile all docs regardless of drift",
  default: false,
}

export const skipWikiArg = {
  type: "boolean" as const,
  description: "Skip entity/concept extraction (faster compile)",
  default: false,
}

export const ingestArg = {
  type: "boolean" as const,
  description:
    "Enable git history ingestion (blame, PRs, tickets) for richer decision context",
  default: false,
}

export const skipGitHubArg = {
  type: "boolean" as const,
  description: "Skip GitHub API calls during ingestion",
  default: false,
}

export const skipTicketsArg = {
  type: "boolean" as const,
  description: "Skip ticket tracker API calls (Jira, Linear) during ingestion",
  default: false,
}

export const llmArgs = {
  provider: providerArg,
  "api-key": apiKeyArg,
  repo: repoArg,
  "docs-dir": docsDirArg,
  force: forceArg,
  "skip-wiki": skipWikiArg,
  ingest: ingestArg,
  "skip-github": skipGitHubArg,
  "skip-tickets": skipTicketsArg,
  "local-cmd": localCmdArg,
  "ollama-model": ollamaModelArg,
  "ollama-url": ollamaUrlArg,
}

export function fatal(message: string): never {
  console.error(`\n⚠  ${message}\n`)
  process.exit(1)
}

export function resolveApiKey(
  provider: string,
  explicit: string | undefined,
): string {
  if (explicit) return explicit
  const envVar = ENV_KEY_MAP[provider]
  if (!envVar) fatal(`Unknown provider: ${provider}`)
  const key = process.env[envVar]
  if (!key)
    fatal(`No API key. Set --api-key or ${envVar} environment variable.`)
  return key
}
