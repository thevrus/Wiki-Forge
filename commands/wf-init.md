Initialize a wiki-forge documentation wiki for this repository.

Follow the UI patterns from @commands/ui-brand.md for all output formatting.

## Phase 1: Understand the project

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 wiki-forge ► INTERVIEW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Read the README (if it exists) and package.json first. Then ask **just 2 questions** (wait for each answer):

1. **Propose a one-sentence summary** based on the README. Ask: "Is this right, or would you tweak it?"

2. **"Who's this wiki for, and what do they usually ask you about the codebase?"**
   - Let them answer freely. This single answer tells you: audience, writing style, and which docs to generate.
   - If the answer is short ("everyone", "all"), that's fine — use your best judgment from the code.

## Phase 2: Scan the codebase

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 wiki-forge ► SCANNING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

- Read the top-level and one-level-deep directories (skip node_modules, dist, build, .git)
- Read package.json, README, and any config files for context
- Identify the tech stack, framework, and project type

## Phase 3: Suggest docs

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 wiki-forge ► SUGGESTING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Based on BOTH the interview answers AND the directory structure, suggest documentation pages.

Standard templates to consider (only if relevant):
- ARCHITECTURE.md — Always
- PRODUCT.md — When there's UI
- BUSINESS_RULES.md — When there's validation, pricing, limits
- DATA.md — When there are data models, schemas, databases
- API.md — When there are API endpoints
- DECISIONS.md (health-check) — When the user mentions decisions or trade-offs
- Custom docs based on interview answers (e.g. INJECTION.md, BILLING.md)

Display using the selection box pattern:

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

**ONE confirmation, not one per doc.** Default is keep all.

## Phase 4: Write

After confirmation, immediately write everything. Default directory: `docs/`.

Create `{docs_dir}/.doc-map.json` with the confirmed docs. Each entry should have:
- **description** — specific to THIS project, informed by the interview (not generic)
- **type** — `"compiled"` or `"health-check"`
- **sources** — directories that feed this doc
- **context_files** — always-included files (package.json, config files)

Also create the directory structure:
```
{docs_dir}/
  .doc-map.json
  entities/
  concepts/
```

Show completion:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 wiki-forge ► DONE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ✓ Created docs/.doc-map.json with {N} docs

  ▶ Next: /wf-compile --force
```
