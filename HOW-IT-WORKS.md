# How it works

## Init: interview-first setup

`/wf-init` doesn't just scan directories. It asks:

1. *"What does this project do?"* (proposes answer from README)
2. *"Who's this wiki for, and what do they ask about?"*

Then scans the codebase and suggests docs informed by both your answers and the code structure — including custom docs like `INJECTION.md` that don't fit standard templates.

## Compile: two-pass, cost-optimized

1. **Triage (cheap model)** — "Did this doc drift?" Most pushes stop here.
2. **Recompile (expensive model)** — Only runs on drifted docs.

With `--force`, it does a deeper two-pass:
1. **Summarize** — Reads all source, extracts structured facts
2. **Compile** — Writes the doc from the summary

### Estimated cost per compile

| Repo size | Triage cost | Full recompile |
|---|---|---|
| Small (~10 files) | ~$0.01 | ~$0.10 |
| Medium (~100 files) | ~$0.05 | ~$0.50 |
| Large (~500 files) | ~$0.10 | ~$2.00 |

## Structured wiki output

After compilation, Wiki Forge reads all compiled docs and automatically extracts:
- **Entities** — concrete things (services, APIs, models, UI components)
- **Concepts** — abstract patterns (auth flow, booking lifecycle, fee rules)

Each gets its own wiki page. The INDEX.md links everything together.

## Query with persistence

`/wf-query "how does the booking flow work?"` reads the wiki and answers with citations back to specific docs.

## Health checks

For human-written docs (ADRs, decision logs), Wiki Forge doesn't rewrite — it checks for contradictions:

```
Warning: DECISIONS.md:
  - Decision #3 says "no database" but src/db/ directory now exists
  - Decision #7 references "XState FSM" but the cart now uses Zustand
```
