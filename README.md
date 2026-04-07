# Wiki Forge

**Your codebase already knows everything. Your team shouldn't have to read it to find out.**

Wiki Forge compiles your source code into a plain-language wiki that PMs, designers, and new engineers can actually understand. When code changes, it detects drift and rewrites only what changed.

```
Your code ──→ Wiki Forge ──→ Up-to-date wiki
  (source)     (compiler)      (docs, entities, concepts, index)
```

---

## Why

Documentation rots because maintaining it is manual work that competes with shipping features. Wiki Forge treats docs as compiled artifacts — the code is the source of truth, the LLM is the compiler, the docs are the build output.

| Approach | How it works | Downside |
|---|---|---|
| Write docs manually | Engineer authors and maintains | Goes stale, competes with shipping |
| RAG / chatbot | Re-reads code on every question | Slow, expensive, no persistence |
| **Wiki Forge** | Compiles once, updates incrementally | Version-controlled, reviewed, always current |

---

## Two ways to use it

### 1. Claude Code slash commands (recommended)

Zero install. Just copy the command files.

```bash
# Clone and install the slash commands
git clone https://github.com/thevrus/wiki-forge.git
cp wiki-forge/commands/*.md ~/.claude/commands/
```

Then in any project:

```
/wf-init                     # interview + scan → creates .doc-map.json
/wf-compile --force          # compile all docs from scratch
/wf-compile                  # incremental — only recompile drifted docs
/wf-check                    # preview what drifted (read-only)
/wf-health                   # check human-written docs for contradictions
/wf-validate                 # check config for missing sources
/wf-index                    # regenerate INDEX.md
/wf-query "how do fees work" # ask questions, save answers as wiki pages
```

No API key needed — Claude Code is the LLM.

### 2. GitHub Action (for CI/CD)

Automatically compiles docs on every push to main:

```yaml
# .github/workflows/docs-sync.yml
name: Docs Sync

on:
  push:
    branches: [main]
    paths-ignore: ["docs/**"]

permissions:
  contents: write
  pull-requests: write

jobs:
  compile:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: thevrus/wiki-forge@v1
        id: forge
        with:
          api_key: ${{ secrets.GEMINI_API_KEY }}

      - uses: peter-evans/create-pull-request@v7
        if: steps.forge.outputs.docs_changed == 'true'
        with:
          title: "docs: sync with codebase changes"
          body: |
            **Updated:** ${{ steps.forge.outputs.updated_docs }}

            ${{ steps.forge.outputs.diff_summary }}
          branch: docs/auto-sync
          delete-branch: true
```

---

## What it produces

```
docs/
  .doc-map.json           # config — maps docs to source directories
  .last-sync              # git commit hash of last compilation
  INDEX.md                # master index with summaries of everything
  log.md                  # compilation changelog
  ARCHITECTURE.md         # compiled docs (user-defined)
  PRODUCT.md
  BUSINESS_RULES.md
  entities/               # auto-extracted from compiled docs
    booking-service.md
    payment-gateway.md
  concepts/               # auto-extracted cross-cutting themes
    authentication-flow.md
    fee-calculation.md
  synthesis/              # answers from /wf-query, saved back
    how-fees-work.md
```

Each compiled doc includes:
- **YAML frontmatter** with sources and compilation timestamp
- **Mermaid diagrams** for architecture, data flows, and state machines
- **Inline citations** like `(source: auth module)` — plain language, not file paths
- **No code snippets** — written for PMs, not engineers

---

## How it works

### Init: interview-first setup

`/wf-init` doesn't just scan directories. It asks:

1. *"What does this project do?"* (proposes answer from README)
2. *"Who's this wiki for, and what do they ask about?"*

Then scans the codebase and suggests docs informed by both your answers and the code structure — including custom docs like `INJECTION.md` that don't fit standard templates.

### Compile: two-pass, cost-optimized

1. **Triage (cheap model)** — "Did this doc drift?" Most pushes stop here (~$0.01).
2. **Recompile (expensive model)** — Only runs on drifted docs.

With `--force`, it does a deeper two-pass:
1. **Summarize** — Reads all source, extracts structured facts
2. **Compile** — Writes the doc from the summary

### Structured wiki output

After compilation, Wiki Forge reads all compiled docs and automatically extracts:
- **Entities** — concrete things (services, APIs, models, UI components)
- **Concepts** — abstract patterns (auth flow, booking lifecycle, fee rules)

Each gets its own wiki page. The INDEX.md links everything together.

### Query with persistence

`/wf-query "how does the booking flow work?"` reads the wiki, synthesizes an answer with citations, and offers to save it as a synthesis page. Knowledge compounds — the next query builds on previous answers.

### Health checks

For human-written docs (ADRs, decision logs), Wiki Forge doesn't rewrite — it checks for contradictions:

```
⚠ DECISIONS.md:
  - Decision #3 says "no database" but src/db/ directory now exists
  - Decision #7 references "XState FSM" but the cart now uses Zustand
```

---

## Configuration

### Doc map

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

### LLM providers (CLI / GitHub Action)

| Provider | Triage model | Compile model | Env var |
|---|---|---|---|
| `gemini` | gemini-2.5-flash | gemini-2.5-pro | `GEMINI_API_KEY` |
| `claude` | claude-haiku-4-5 | claude-sonnet-4-6 | `ANTHROPIC_API_KEY` |
| `openai` | gpt-4.1-mini | gpt-4.1 | `OPENAI_API_KEY` |
| `local` | claude -p | claude -p | (none needed) |

The `local` provider pipes prompts through the `claude` CLI. Use `--local-cmd` for other tools:

```bash
wiki-forge compile --provider local --local-cmd "codex -q"
```

---

## CLI Reference

```
wiki-forge <command> [flags]

Commands:
  init              Scaffold .doc-map.json (--interactive for guided setup)
  compile           Compile drifted docs (--force for full recompile)
  check             Report drift without writing
  health            Check human-written docs for contradictions
  index             Regenerate INDEX.md
  validate          Check config for missing sources
  install-commands  Install /wf-* slash commands for Claude Code

Flags:
  --provider <gemini|claude|openai|local>  LLM provider (default: gemini)
  --api-key <key>             API key (or set env var)
  --repo <path>               Repository root (default: cwd)
  --docs-dir <path>           Docs directory (default: docs)
  --force                     Recompile all docs
  --interactive, -i           Interactive setup (for init)
  --local-cmd <cmd>           CLI command for local provider (default: "claude -p")
```

---

## Examples

See [`examples/`](examples/) for:
- [`.doc-map.json`](examples/.doc-map.json) — starter config for a typical web app
- [`docs-sync.yml`](examples/docs-sync.yml) — GitHub Action workflow with auto-PR and diff preview

---

## License

MIT
