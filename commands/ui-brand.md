Visual patterns for wiki-forge slash commands. Reference this file from all /wf-* commands.

## Stage Banners

Use for major transitions.

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 wiki-forge ► {STAGE NAME}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Stage names: `INTERVIEW`, `SCANNING`, `SUGGESTING`, `COMPILING`, `EXTRACTING`, `INDEXING`, `STATUS`, `CHECKING`, `BRIEF`, `TICKET`, `QA`, `DONE`

## Selection Box

For doc suggestions. Show all options with checkmarks, single confirmation.

```
╔══════════════════════════════════════════════════════════════╗
║  SELECT DOCS                                                 ║
╚══════════════════════════════════════════════════════════════╝

  ✓  1. ARCHITECTURE.md — "System overview and WXT config"
  ✓  2. PRODUCT.md — "Popup UI, rule editor, code editor"
  ✓  3. DATA.md — "Rule model, storage, URL matching"
  ✓  4. INJECTION.md — "CSS/JS injection via Chrome API"

──────────────────────────────────────────────────────────────
→ All included. Drop any? (numbers to remove, or Enter)
──────────────────────────────────────────────────────────────
```

## Progress Display

During compilation, show per-doc progress:

```
  ◆ Compiling ARCHITECTURE.md...
  ✓ ARCHITECTURE.md (23s)
  ◆ Compiling PRODUCT.md...
  ✓ PRODUCT.md (18s)
  ○ DATA.md
  ○ INJECTION.md

  Progress: ████████░░░░░░░░ 2/4
```

## Confirmation Box

Before writing files:

```
╔══════════════════════════════════════════════════════════════╗
║  REVIEW: ARCHITECTURE.md                                     ║
╚══════════════════════════════════════════════════════════════╝

  Summary: 3 sections, 2 Mermaid diagrams, 847 words

  ## Sections:
  - Extension Architecture (flowchart diagram)
  - Background Script Lifecycle (sequence diagram)
  - Storage Layer

──────────────────────────────────────────────────────────────
→ Write? (Y / n / preview / edit)
──────────────────────────────────────────────────────────────
```

## Status Symbols

```
✓  Complete / Written / Healthy
✗  Error / Missing / Failed
◆  In progress
○  Pending
⚡ Drifted
⚠  Warning / Health issue
```

## Completion Block

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

## Anti-Patterns

- Don't ask one-by-one confirmations — batch them
- Don't show raw file paths to the user — use doc names
- Don't skip the stage banner on major transitions
- Don't use random emoji — stick to the status symbols above
