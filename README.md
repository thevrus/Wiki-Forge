<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg" />
    <source media="(prefers-color-scheme: light)" srcset="assets/logo.svg" />
    <img src="assets/logo.svg" alt="Wiki Forge" width="400" />
  </picture>
</p>

<p align="center">
  <strong>Your codebase remembers. Even when your team forgets.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/local--first-blue?style=flat-square" alt="Local-first" />
  <img src="https://img.shields.io/badge/works%20offline-blue?style=flat-square" alt="Works offline" />
  <img src="https://img.shields.io/badge/your%20code%20stays%20yours-blue?style=flat-square" alt="Your code stays yours" />
</p>

Wiki Forge is a decision provenance engine. It compiles your source code, git history, and PRs into a living knowledge base — not just docs, but the *why* behind every engineering decision. When code changes, it detects drift and rewrites only what changed.

<p align="center">
  <img src="assets/architecture.svg" alt="Wiki Forge Architecture — inputs, two-pass compilation, three output layers" width="680" />
</p>

---

## Why

Software engineering has 23-25% annual turnover. Each departure costs 4-8 weeks of delivery time — not because the code is lost, but because the *context* behind it is. Why was this module built this way? What incident prompted the retry logic? Who knows how the payment flow actually works?

Wiki Forge treats institutional memory as a compiled artifact. The code + git history is the source of truth, the LLM is the compiler, and three types of output serve three audiences:

| Output | Audience | What it contains |
|---|---|---|
| **Wiki pages** | PMs, designers, new engineers | Business rules, architecture, decision context |
| **AI context files** | Claude Code, Cursor, Copilot | CLAUDE.md, AGENTS.md, llms.txt |
| **Knowledge risk reports** | Engineering managers | Bus factor per module, onboarding readiness |

| | Manual Docs | RAG / Chatbot | Google Code Wiki | **Wiki Forge** |
|---|---|---|---|---|
| Output you own | :white_check_mark: | :x: | :x: | :white_check_mark: |
| Version-controlled | :white_check_mark: | :x: | :x: | :white_check_mark: |
| Works offline / air-gapped | :white_check_mark: | :x: | :x: | :white_check_mark: |
| Decision archaeology | :x: | :x: | :x: | :white_check_mark: |
| Auto-updates | :x: | :white_check_mark: | :white_check_mark: | :white_check_mark: |
| Reviewable as a PR | :white_check_mark: | :x: | :x: | :white_check_mark: |
| Cost | time | per query | freemium | per compile |

## Your code stays yours

With `--provider local`, Wiki Forge pipes prompts through your local
`claude` or `ollama` CLI. Nothing leaves your machine.

| Provider | Where your code goes |
|---|---|
| `gemini` / `claude` / `openai` | API call to vendor |
| `local` | Stays on your machine, always |

---

## Three ways to use it

### 1. GitHub Action (for CI/CD)

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

### 2. Claude Code slash commands

```bash
npx wiki-forge install-commands
```

That's it. No cloning, no config. Now open any project in Claude Code and type `/wf-init`.

Then in any project:

```
/wf-init                     # interview + scan → creates .doc-map.json
/wf-compile --force          # compile all docs from scratch
/wf-compile                  # incremental — only recompile drifted docs
/wf-check                    # preview what drifted (read-only)
/wf-health                   # check human-written docs for contradictions
/wf-query "how do fees work" # ask questions, save answers as wiki pages
/wf-brief                    # weekly shipping brief for leadership
```

No API key needed — Claude Code is the LLM.

### 3. MCP server (for AI assistants)

Give Claude direct access to your compiled wiki. One server, reads whatever repos it's pointed at:

```bash
# Local repo (engineer with git checkout)
claude mcp add wiki-forge -- wiki-forge-mcp --repo ./docs

# Remote repo (PM, no git needed)
claude mcp add wiki-forge -- wiki-forge-mcp --github acme/platform

# Multi-repo
claude mcp add wiki-forge -- wiki-forge-mcp --repo /path/to/repo1/docs --repo /path/to/repo2/docs
```

Claude gets four tools:

| Tool | What it does |
|---|---|
| `wiki_forge_why` | "Why is this file this way?" — maps source file to wiki page, returns decision context |
| `wiki_forge_who` | "Who has context?" — returns ranked contributors with ownership % and bus factor |
| `wiki_forge_search` | Search the compiled wiki by keyword — returns matching pages with excerpts |
| `wiki_forge_status` | Brain health dashboard — coverage metrics, knowledge risk, action items |

No LLM calls, no database, no accounts. The MCP server reads markdown files — the compiled wiki is the product, the server is just the read layer. Works across all Claude surfaces: Claude Code, Cowork, Desktop.

### 4. CLI (standalone)

```bash
npx wiki-forge init --provider gemini          # LLM analyzes your codebase, suggests docs
npx wiki-forge init --provider ollama          # or use a local model
npx wiki-forge init                            # pattern-based (no LLM needed)
```

Then compile:

```bash
npx wiki-forge compile --provider gemini --force    # full compile from scratch
npx wiki-forge compile --provider gemini            # incremental — only drifted docs
npx wiki-forge check --provider gemini              # see what drifted, no writes
npx wiki-forge status                               # drift dashboard (no LLM, no writes)
npx wiki-forge report --provider gemini             # brain health report
npx wiki-forge report --provider gemini --weekly    # weekly shipping brief
```

Or just run the interactive wizard:

```bash
npx wiki-forge
```

Works with any LLM: `--provider gemini|claude|openai|ollama|local`. See [Configuration & CLI reference](./CONFIGURATION.md) for all flags.

---

## What it produces

```
docs/
  .doc-map.json           # config — maps docs to source directories
  INDEX.md                # master index with summaries
  _status.md              # brain health dashboard
  ARCHITECTURE.md         # compiled docs (user-defined)
  entities/               # auto-extracted services, APIs, models
  concepts/               # auto-extracted cross-cutting themes
  _reports/               # weekly engineering digests
```

Each compiled doc includes YAML frontmatter, Mermaid diagrams, inline citations, and is written for PMs — not engineers.

**[How it works](./HOW-IT-WORKS.md)** — init interview, two-pass compilation, structured output, queries, health checks

**[Configuration & CLI reference](./CONFIGURATION.md)** — doc map schema, LLM providers, all commands and flags

---

## Examples

See [`examples/`](examples/) for:
- [`.doc-map.json`](examples/.doc-map.json) — starter config for a typical web app
- [`docs-sync.yml`](examples/docs-sync.yml) — GitHub Action workflow with auto-PR and diff preview

---

## Used by

Using Wiki Forge? [Open a PR](https://github.com/thevrus/wiki-forge/pulls) to add your project here.

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

[MIT](./LICENSE)
