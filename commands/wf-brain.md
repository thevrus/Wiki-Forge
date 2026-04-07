Manage the brain/ business knowledge layer for this repository.

$ARGUMENTS

Follow the UI patterns from @commands/ui-brand.md for all output formatting.

## Subcommands

Parse the first argument to determine the subcommand:
- `init` — scaffold brain/ templates (default if no argument)
- `claude` — auto-generate CLAUDE.md from brain + wiki
- `audit` — check brain docs for contradictions with code (future)

If no argument is given, run `init`.

---

## Subcommand: init

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 wiki-forge ► BRAIN INIT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Step 1: Interview

Read the README and package.json. Ask **one question**:

> "What does this company/product do, and who pays for it?"

Use their answer + the README to understand the business context.

### Step 2: Select brain docs

Based on the answer, suggest which brain docs to create. Show the selection box:

```
╔══════════════════════════════════════════════════════════════╗
║  SELECT BRAIN DOCS                                           ║
╚══════════════════════════════════════════════════════════════╝

  ✓  1. NORTH_STAR.md — mission, vision, core metric
  ✓  2. POSITIONING.md — differentiators, alternatives, moat
  ✓  3. ICP.md — ideal customer profile, personas
  ✓  4. PRICING.md — pricing model, tiers, revenue
  ✓  5. ROADMAP.md — now/next/later priorities
  ✓  6. METRICS.md — key numbers and dashboards
  ✓  7. GLOSSARY.md — shared vocabulary
  ✓  8. COMPETITORS.md — competitive landscape

──────────────────────────────────────────────────────────────
→ All included. Drop any? (numbers to remove, or Enter)
──────────────────────────────────────────────────────────────
```

For side projects or solo devs, suggest dropping PRICING, METRICS, COMPETITORS.
For companies, suggest all 8.

### Step 3: Create brain/ and pre-fill

Create `brain/` directory at the repo root.

For each selected doc:
1. Start from the template structure (see templates below)
2. **Pre-fill what you can** from the README, package.json, and interview answer
3. Mark unfilled sections with `<!-- TODO: fill this in -->`

Also create `brain/DECISIONS/` directory for future ADRs.

### Step 4: Wire into doc-map

If `docs/.doc-map.json` exists, add `brain/` files to `context_files` for every compiled doc. This ensures compiled docs include business context.

If it doesn't exist, tell the user to run `/wf-init` first.

### Step 5: Completion

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 wiki-forge ► DONE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ✓ Created brain/ with {N} docs
  ✓ Wired brain/ into docs/.doc-map.json

  Fill in the brain docs — they feed into every compilation.

  ▶ Next: /wf-brain claude
```

---

## Subcommand: claude

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 wiki-forge ► GENERATE CLAUDE.md
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Auto-generate a `CLAUDE.md` file that makes Claude Code product-aware.

### Step 1: Read all sources

Read these in order (skip any that don't exist):
1. `brain/NORTH_STAR.md` — mission, principles
2. `brain/POSITIONING.md` — what we are, what we're not
3. `brain/ICP.md` — who we're building for
4. `brain/GLOSSARY.md` — terminology
5. `brain/ROADMAP.md` — current priorities
6. `brain/DECISIONS/` — all ADR files
7. `docs/INDEX.md` — compiled wiki index
8. `docs/.doc-map.json` — documentation structure
9. Existing `CLAUDE.md` — preserve any manual instructions

### Step 2: Generate CLAUDE.md

Write a `CLAUDE.md` at the repo root with these sections:

```markdown
# {Project Name}

## What This Is
<!-- One paragraph from NORTH_STAR + POSITIONING -->

## Who It's For
<!-- From ICP — who uses this and what they need -->

## Architecture
<!-- From compiled wiki — key services, data flow, tech stack -->

## Business Rules
<!-- From brain + compiled docs — pricing, limits, validation rules -->

## Glossary
<!-- From GLOSSARY.md — terms that have specific meaning here -->

## Current Priorities
<!-- From ROADMAP.md — what's being worked on NOW -->

## Decisions
<!-- From DECISIONS/ — active architectural decisions that constrain implementation -->

## Style & Conventions
<!-- Preserve any existing CLAUDE.md conventions (build commands, test patterns, etc.) -->
```

### Step 3: Show and confirm

Show a summary of what was generated:

```
╔══════════════════════════════════════════════════════════════╗
║  REVIEW: CLAUDE.md                                           ║
╚══════════════════════════════════════════════════════════════╝

  Sections: 8
  Sources: 5 brain docs, 3 wiki docs, 1 existing CLAUDE.md
  Words: ~450

──────────────────────────────────────────────────────────────
→ Write? (Y / n / preview)
──────────────────────────────────────────────────────────────
```

### Important rules

- **Preserve existing CLAUDE.md content.** If there's already a CLAUDE.md with build commands, test instructions, or conventions, keep those in the "Style & Conventions" section. Never delete manual instructions.
- **Be concise.** CLAUDE.md is read on every conversation start. Keep it under 500 words.
- **No raw code.** This is context for Claude, not documentation. Use bullet points and short sentences.
- **Link don't repeat.** Reference brain/ and docs/ files instead of copying their full content: "See [brain/PRICING.md](brain/PRICING.md) for full pricing model."

### Completion

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 wiki-forge ► DONE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ✓ CLAUDE.md generated from {N} sources

  Claude Code is now product-aware.
```

---

## Brain doc templates

### NORTH_STAR.md
Mission, vision, core metric, principles, what we don't do.

### POSITIONING.md
One-line pitch, category, differentiators, alternatives, moat.

### ICP.md
Primary user, secondary users, anti-persona, jobs to be done, discovery channels.

### PRICING.md
Model, tiers, key decisions, revenue metrics.

### ROADMAP.md
Now (this week), next (this month), later (this quarter), icebox.

### METRICS.md
North star metric, product health table, business health table, where to find data.

### GLOSSARY.md
Term/definition/see-also table.

### COMPETITORS.md
Landscape overview, comparison table, market trends.
