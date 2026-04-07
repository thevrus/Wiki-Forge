# Wiki Forge

**Your codebase already knows everything. Your team shouldn't have to read it to find out.**

Wiki Forge is a documentation compiler. It reads your source code and produces plain-language docs that PMs, designers, and new engineers can actually understand. When your code changes, it detects what drifted and rewrites only the affected sections. Automatically.

```
Your code ──→ Wiki Forge ──→ Up-to-date docs
  (source)     (compiler)      (compiled wiki)
```

---

## The Problem

You've seen this before:

- PM asks "how does the booking flow work?" Engineer stops coding to explain. Again.
- New hire reads the wiki. Half of it is wrong. Nobody knows which half.
- "We should update the docs" goes on the backlog. It stays there.
- The architecture doc references a service that was renamed six months ago.

Documentation rots because keeping it current is manual work that competes with shipping features. So it doesn't get done.

## The Fix

Treat docs like compiled artifacts. The code is the source of truth. The LLM is the compiler. The docs are the build output.

Every push to your default branch, Wiki Forge diffs your code against the last compilation, asks a cheap model "did anything meaningful change?", and only rewrites what drifted. A PR appears with the updates. You review and merge.

Your docs stay current because no human has to remember to update them.

**How it compares:**

| Approach | How it works | Downside |
|---|---|---|
| Write docs manually | Engineer authors and maintains | Goes stale immediately, competes with shipping |
| RAG / chatbot | Re-reads code on every question | Slow, expensive, no persistence, no review |
| **Wiki Forge** | Compiles once, updates incrementally | Docs are version-controlled, reviewed, and always current |

## Who is this for

- **Teams where PMs or designers need to understand the system** but can't (or shouldn't have to) read source code
- **Fast-moving codebases** where architecture and features change weekly
- **Onboarding-heavy teams** where new hires need to get up to speed quickly
- **Multi-service architectures** where no single person understands the whole system
- **Regulated industries** where you need an audit trail of what the system does

---

## For PMs and Designers

You don't need to read code, open GitHub, or install developer tools. Just open Claude Desktop and ask questions.

**Setup (one time, 2 minutes):**

1. Your engineer gives you a config snippet
2. Open Claude Desktop → Settings → Developer → Edit Config
3. Paste the snippet, save, restart Claude Desktop
4. You'll see a hammer icon in the chat — that means it's connected

**Then just ask questions:**

- "How does the booking flow work?"
- "What happens when a non-member tries to refill a prescription?"
- "What are the differences between monthly and annual membership?"
- "What fees get added to the cart automatically?"
- "What screens does a user see when they first sign up?"

Claude reads the compiled documentation and answers in plain language. No engineer needed.

**How it stays current:**

Every time engineers push code changes, Wiki Forge automatically checks if any documentation drifted and updates it. You don't have to ask "is this still true?" — the CI pipeline already verified it.

**For engineers setting this up for your team**, see the [MCP Server](#mcp-server) section below for the config snippet to share with PMs.

---

## For Engineers: How to set it up

Three steps. Five minutes.

```bash
# 1. Go to your project
cd your-project

# 2. Create a config that maps your code to docs
npx wiki-forge init

# 3. Compile your docs
npx wiki-forge compile
```

That's it. You now have a `docs/` folder with plain-language documentation compiled from your source code.

To keep it updated automatically, add the GitHub Action below. Every push to your default branch will check for drift and open a PR if any docs need updating.

---

## Quick Start

### Option 1: GitHub Action (recommended)

Add to your workflow:

```yaml
# .github/workflows/docs-sync.yml
name: Docs Sync

on:
  push:
    branches: [main]  # change to match your default branch
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
          body: "Updated: ${{ steps.forge.outputs.updated_docs }}"
          branch: docs/auto-sync
          delete-branch: true
```

### Option 2: CLI

```bash
npx wiki-forge init                    # scaffold config
npx wiki-forge check                   # preview what would change (free, no writes)
npx wiki-forge compile                 # compile drifted docs
npx wiki-forge compile --force         # recompile everything from scratch
npx wiki-forge health                  # check human-written docs for contradictions
```

---

## Setup

### 1. Create a doc map

Run `wiki-forge init` or create `docs/.doc-map.json` manually:

```json
{
  "docs": {
    "ARCHITECTURE.md": {
      "description": "System architecture: services, APIs, data flows",
      "type": "compiled",
      "sources": ["src/api/", "src/services/"],
      "context_files": ["src/config.ts"]
    },
    "PRODUCT.md": {
      "description": "User-facing screens, flows, and features",
      "type": "compiled",
      "sources": ["src/app/", "src/components/"],
      "context_files": []
    },
    "DECISIONS.md": {
      "description": "Architectural decision records",
      "type": "health-check",
      "sources": ["src/"],
      "context_files": []
    }
  }
}
```

Each entry maps a documentation file to the source code that feeds it:

| Field | What it does |
|---|---|
| `description` | Tells the LLM what the doc is about |
| `type` | `"compiled"` = LLM writes it. `"health-check"` = human writes it, LLM checks for contradictions |
| `sources` | Directories/files the LLM reads to write the doc |
| `context_files` | Always-included files for broader understanding |

### 2. Set your API key

```bash
export GEMINI_API_KEY=your-key       # default provider
# or
export ANTHROPIC_API_KEY=your-key    # --provider claude
# or
export OPENAI_API_KEY=your-key       # --provider openai
```

### 3. Run

```bash
wiki-forge compile
```

That's it. Your docs are now in `docs/`.

---

## How It Works

### Two-pass compilation (cost optimized)

Most doc compilers recompile everything on every change. Wiki Forge uses two passes:

1. **Triage (cheap model)** — "Did this doc drift from the code?" Yes/no.
2. **Recompile (expensive model)** — Rewrites only the drifted sections.

This means most pushes cost ~$0.01 (triage only). Full recompiles happen only when needed.

### Force recompile (from scratch)

When you run `--force`, Wiki Forge does a deeper two-pass:

1. **Summarize (cheap model)** — Reads all source files, extracts every fact into structured bullet points.
2. **Compile (expensive model)** — Writes the doc from the summary, not from raw source.

This produces more thorough docs because the cheap model condenses 400K+ chars of source into ~20K chars of structured facts before the expensive model writes.

### Health checks

For human-curated docs (like architectural decision records), Wiki Forge doesn't rewrite — it checks. It reads the doc and the code, then flags contradictions:

```
⚠  DECISIONS.md:
   - Decision #3 says "no database" but src/db/ directory now exists
   - Decision #7 references "XState FSM" but the cart now uses Zustand
```

### Git-aware drift detection

Wiki Forge doesn't just check if files changed — it checks if the *meaning* changed. A reformatted file won't trigger a recompile. A new API endpoint will.

---

## Configuration

### Custom docs directory

```bash
wiki-forge init --docs-dir wiki          # use wiki/ instead of docs/
wiki-forge compile --docs-dir wiki
```

GitHub Action:

```yaml
- uses: thevrus/wiki-forge@v1
  with:
    api_key: ${{ secrets.GEMINI_API_KEY }}
    docs_dir: wiki
```

### LLM providers

| Provider | Triage model (default) | Compile model (default) | Env var |
|---|---|---|---|
| `gemini` | `gemini-2.5-flash` | `gemini-2.5-pro` | `GEMINI_API_KEY` |
| `claude` | `claude-haiku-4-5` | `claude-sonnet-4-6` | `ANTHROPIC_API_KEY` |
| `openai` | `gpt-4.1-mini` | `gpt-4.1` | `OPENAI_API_KEY` |

Override models:

```bash
wiki-forge compile --provider claude --api-key sk-ant-...
```

GitHub Action:

```yaml
- uses: thevrus/wiki-forge@v1
  with:
    api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    provider: claude
    triage_model: claude-haiku-4-5-20251001
    compile_model: claude-sonnet-4-6-20250514
```

### Doc types

| Type | What the LLM does | Use for |
|---|---|---|
| `compiled` | Writes and maintains the doc | Architecture, product, data models, business rules |
| `health-check` | Reads and flags contradictions | ADRs, decision logs, human-written docs |

---

## CLI Reference

```
wiki-forge <command> [flags]

Commands:
  init         Scaffold .doc-map.json with an example entry
  check        Triage only — report which docs drifted (no writes)
  compile      Full compilation — triage + recompile drifted docs
  health       Run health checks on health-check type docs only

Flags:
  --provider <gemini|claude|openai>   LLM provider (default: gemini)
  --api-key <key>                     API key (or set env var)
  --repo <path>                       Repository root (default: cwd)
  --docs-dir <path>                   Docs directory name (default: docs)
  --force                             Force recompile all docs
```

---

## What it produces

Each compiled doc starts with YAML frontmatter tracking its lineage:

```yaml
---
compiled_at: "2026-04-06T12:00:00Z"
compiler: gemini-2.5-pro
sources:
  - src/api/
  - src/services/auth.ts
---
```

The doc body is plain language — no file paths, no code blocks, no function names. Source tracking lives in frontmatter only. This makes docs readable by PMs, designers, and anyone who doesn't write code.

---

## Examples

See the [`examples/`](examples/) directory for:

- [`.doc-map.json`](examples/.doc-map.json) — Starter config for a typical web app
- [`docs-sync.yml`](examples/docs-sync.yml) — GitHub Action workflow with auto-PR

---

## MCP Server

Wiki Forge includes an MCP server so PMs and designers can query your compiled docs through Claude Desktop without touching code.

**Engineer setup:**

1. Build the MCP server binary from the `tools/` directory in your knowledge hub repo (or use the bundled one)
2. Share this config snippet with your PM:

```json
{
  "mcpServers": {
    "project-docs": {
      "command": "/path/to/repo-qa-server",
      "args": ["--repo", "/path/to/your/project"]
    }
  }
}
```

3. PM pastes it into Claude Desktop → Settings → Developer → Edit Config, restarts Claude Desktop

The MCP server exposes read-only tools: `ask_docs` (read compiled docs), `search_code` (grep the codebase), `read_file`, `list_docs`, and `list_structure`. Claude will prefer `ask_docs` first, falling back to code search only when the docs don't cover the question.

---

## Roadmap

- [ ] `--save` query persistence (ask a question, save the answer as a wiki page)
- [ ] Built-in MCP server (`wiki-forge serve`)
- [ ] Remote MCP server (Cloudflare Worker — one URL, zero install for PMs)
- [ ] Watch mode for local development
- [ ] Interactive init (`wiki-forge init --interactive`)
- [ ] Schema validation (`wiki-forge validate`)
- [ ] Cross-doc backlinks and auto-generated index
- [ ] Compilation changelog (`_log.md`)
- [ ] Cost tracking (tokens used per compilation)

---

## License

MIT
