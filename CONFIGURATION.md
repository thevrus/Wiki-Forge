# Configuration

## Doc map

`docs/.doc-map.json` maps documentation to source code:

```json
{
  "docs": {
    "ARCHITECTURE.md": {
      "description": "System architecture: services, APIs, data flows",
      "type": "compiled",
      "sources": ["src/api/", "src/services/"],
      "context_files": ["package.json"]
    },
    "DECISIONS.md": {
      "description": "Architectural decision records",
      "type": "health-check",
      "sources": ["src/"],
      "context_files": []
    }
  },
  "style": "Write for a technical audience. Include code examples."
}
```

| Field | What it does |
|---|---|
| `description` | Tells the LLM what the doc covers |
| `type` | `"compiled"` = LLM writes it. `"health-check"` = human writes it, LLM checks it |
| `sources` | Directories the LLM reads |
| `context_files` | Always-included files for broader context |
| `style` | Optional — override the default writing style |

## LLM providers (CLI / GitHub Action)

| Provider | Triage model | Compile model | Env var |
|---|---|---|---|
| `gemini` | gemini-2.5-flash | gemini-2.5-pro | `GEMINI_API_KEY` |
| `claude` | claude-haiku-4-5 | claude-sonnet-4-6 | `ANTHROPIC_API_KEY` |
| `openai` | gpt-4.1-mini | gpt-4.1 | `OPENAI_API_KEY` |
| `ollama` | llama3.1 | llama3.1 | (none needed) |
| `local` | claude -p | claude -p | (none needed) |

The `local` provider pipes prompts through the `claude` CLI. Use `--local-cmd` for other tools:

```bash
wiki-forge compile --provider local --local-cmd "codex -q"
```

## CLI Reference

```
wiki-forge <command> [flags]

Commands:
  init              Scaffold .doc-map.json (--interactive for guided setup)
  compile           Compile drifted docs (--force for full recompile)
  check             Report drift without writing
  health            Check human-written docs for contradictions
  report            Generate brain health dashboard and/or weekly report
  status            Show drift dashboard (no writes, no LLM)
  index             Regenerate INDEX.md
  validate          Check config for missing sources
  install-commands  Install /wf-* slash commands for Claude Code

Flags:
  --provider <gemini|claude|openai|ollama|local>  LLM provider (default: gemini)
  --api-key <key>             API key (or set env var)
  --repo <path>               Repository root (default: cwd)
  --docs-dir <path>           Docs directory (default: docs)
  --force                     Recompile all docs
  --ingest                    Enrich with git history, PRs, and tickets
  --skip-github               Skip GitHub API calls during ingestion
  --skip-tickets              Skip ticket tracker calls (Jira, Linear)
  --weekly                    Also generate the weekly report (for report cmd)
  --interactive, -i           Interactive setup (for init)
  --local-cmd <cmd>           CLI command for local provider (default: "claude -p")
  --ollama-model <model>      Ollama model name (default: llama3.1)
  --ollama-url <url>          Ollama server URL (default: http://localhost:11434)
```
