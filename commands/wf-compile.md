Compile documentation for this repository using the wiki-forge system.

$ARGUMENTS

## Step 1: Read the doc map

Read `docs/.doc-map.json` (or the docs directory specified in arguments). If it doesn't exist, tell the user to run `/wf-init` first.

If the user passed `--force`, recompile ALL docs from scratch. Otherwise, check git for what changed since last compile (read `docs/.last-sync` for the last commit hash, then `git diff --name-only {hash}..HEAD`).

## Step 2: For each doc entry in the map

### Compiled docs (type: "compiled")

**If --force or source files changed:**

1. Read all source files from the entry's `sources` and `context_files` directories
2. Tell the user: `📝 Compiling {doc_name}...`
3. Write the doc following the style guide below
4. Show the user a brief summary of what you wrote (2-3 bullet points)
5. Ask: **Write to {docs_dir}/{doc_name}? [Y/n/edit]**
   - Y: write the file
   - n: skip
   - edit: let the user give feedback, then revise and ask again

**If no source files changed:**
- Tell the user: `⏭ {doc_name} — no changes`

### Health-check docs (type: "health-check")

1. Read the existing doc and the source code
2. Compare for contradictions, stale info, missing features
3. Report issues or confirm healthy

## Step 3: Extract entities & concepts

After all main docs are compiled, read them all and identify:

- **Entities**: concrete things — services, APIs, data models, databases, UI components
- **Concepts**: abstract patterns — authentication flow, booking lifecycle, fee calculation

For each, write a short wiki page (~200 words) in `{docs_dir}/entities/{slug}.md` or `{docs_dir}/concepts/{slug}.md`.

Tell the user how many entity/concept pages you generated.

## Step 4: Generate INDEX.md

Write `{docs_dir}/INDEX.md` containing:
- Header with generation timestamp
- **Compiled Documents** section: each doc with a one-sentence summary
- **Health-Checked Documents** section (if any)
- **Entities** section: list all entity pages with links
- **Concepts** section: list all concept pages with links

## Step 5: Update log

Append to `{docs_dir}/log.md`:
```markdown
## {ISO timestamp}

- Recompiled **DOC_NAME** (reason)
- Generated N entity pages, N concept pages
- Health issues: (list or "none")
```

## Step 6: Write .last-sync

Write the current git commit hash to `{docs_dir}/.last-sync`:
```bash
git rev-parse HEAD
```

## Style guide for compiled docs

When writing documentation, follow these rules:

**Format:**
- YAML frontmatter: `description` (one sentence), `sources` (list), `compiled_at` (ISO timestamp)
- Open with a 2-3 sentence summary paragraph
- Use ## for major sections, ### for subsections

**Audience:**
- Write for product managers and designers, not engineers
- Explain WHAT the system does and WHY, not HOW it's implemented
- No raw code snippets. No function signatures. Source tracking lives in frontmatter only.

**Content:**
- Be specific: name features, state numbers, describe concrete behavior
- Use bullet lists for rules and constraints, tables for comparisons
- Each section should be independently readable

**Diagrams:**
Include Mermaid diagrams where they clarify structure or flow:
- Architecture: `flowchart` showing services/components and connections
- Data flows: `sequenceDiagram` showing request paths
- State machines: `stateDiagram-v2` for lifecycle states
- Only include diagrams that add clarity — not every section needs one

**Citations:**
When stating a specific fact derived from source code, add a brief inline citation: `(source: auth module)`, `(source: booking rules)`. Use plain-language module names, not file paths.

**If the doc map has a `style` field**, use that instead of this default style guide.
