Compile documentation for this repository using the wiki-forge system.

$ARGUMENTS

Follow the UI patterns from @commands/ui-brand.md for all output formatting.

## Step 1: Read config

Read `docs/.doc-map.json` (or the docs directory specified in arguments). If it doesn't exist, tell the user to run `/wf-init` first.

If the user passed `--force`, recompile ALL docs from scratch. Otherwise, check git for what changed since last compile (read `docs/.last-sync` for the last commit hash, then `git diff --name-only {hash}..HEAD`).

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 wiki-forge ► COMPILING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Step 2: Compile each doc

For each compiled doc (type: "compiled") that needs updating:

1. Read all source files from the entry's `sources` and `context_files`
2. Show progress:
   ```
     ◆ Compiling ARCHITECTURE.md...
   ```
3. Write the doc following the style guide below
4. Show confirmation:
   ```
   ╔══════════════════════════════════════════════════════════════╗
   ║  REVIEW: ARCHITECTURE.md                                     ║
   ╚══════════════════════════════════════════════════════════════╝

     Summary: 3 sections, 2 Mermaid diagrams, ~850 words

     ## Sections:
     - Extension Architecture (flowchart)
     - Background Script Lifecycle (sequence diagram)
     - Storage Layer

   ──────────────────────────────────────────────────────────────
   → Write? (Y / n / preview / edit)
   ──────────────────────────────────────────────────────────────
   ```
5. After user confirms, write the file and show: `✓ ARCHITECTURE.md`

For docs with no changes: `⏭ ARCHITECTURE.md — no changes`

For health-check docs: read the doc and source code, report contradictions or confirm healthy.

Show running progress:
```
  ✓ ARCHITECTURE.md
  ✓ PRODUCT.md
  ◆ Compiling DATA.md...
  ○ INJECTION.md

  Progress: ████████████░░░░ 3/4
```

## Step 3: Extract entities & concepts

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 wiki-forge ► EXTRACTING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

After all main docs are compiled, read them all and identify:
- **Entities**: concrete things — services, APIs, data models, databases, UI components
- **Concepts**: abstract patterns — authentication flow, booking lifecycle, fee calculation

For each, write a short wiki page (~200 words) in `docs/entities/{slug}.md` or `docs/concepts/{slug}.md`.

## Step 4: Generate INDEX.md

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 wiki-forge ► INDEXING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Write `docs/INDEX.md` with:
- Header with generation timestamp
- **Compiled Documents**: each doc with a one-sentence summary
- **Entities**: list all entity pages
- **Concepts**: list all concept pages

## Step 5: Update log + last-sync

Append to `docs/log.md` with timestamp, what was compiled, entity/concept counts.
Write current `git rev-parse HEAD` to `docs/.last-sync`.

## Completion

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 wiki-forge ► DONE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ✓ 4 docs compiled
  ✓ 6 entity pages, 3 concept pages
  ✓ INDEX.md generated
  ✓ log.md updated

  ▶ Next: /wf-query "how does injection work?"
```

## Style guide for compiled docs

**Format:**
- YAML frontmatter: `description` (one sentence), `sources` (list), `compiled_at` (ISO timestamp)
- Open with a 2-3 sentence summary paragraph
- Use ## for major sections, ### for subsections

**Audience:**
- Write for product managers and designers, not engineers
- Explain WHAT the system does and WHY, not HOW it's implemented
- No raw code snippets or function signatures. Source tracking lives in frontmatter only.

**Content:**
- Be specific: name features, state numbers, describe concrete behavior
- Use bullet lists for rules and constraints, tables for comparisons
- Each section should be independently readable

**Diagrams:**
Include Mermaid diagrams where they clarify structure or flow:
- Architecture: `flowchart` showing services/components and connections
- Data flows: `sequenceDiagram` showing request paths
- State machines: `stateDiagram-v2` for lifecycle states
- Only include diagrams that add clarity

**Citations:**
When stating a specific fact from source code, add: `(source: auth module)`, `(source: booking rules)`. Use plain-language module names, not file paths.

**If the doc map has a `style` field**, use that instead of this default.
