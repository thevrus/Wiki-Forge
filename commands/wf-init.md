Initialize a wiki-forge documentation wiki for this repository.

## Phase 1: Understand the project

Read the README (if it exists) and package.json first. Then ask **just 2 questions** (wait for each answer):

1. **Propose a one-sentence summary** based on the README. Ask: "Is this right, or would you tweak it?"

2. **"Who's this wiki for, and what do they usually ask you about the codebase?"**
   - Let them answer freely. This single answer tells you: audience, writing style, and which docs to generate.
   - If the answer is short ("everyone", "all"), that's fine — use your best judgment from the code.

## Phase 2: Scan the codebase

Now scan the repo structure:
- Read the top-level and one-level-deep directories (skip node_modules, dist, build, .git)
- Read package.json, README, and any config files for context
- Identify the tech stack, framework, and project type

## Phase 3: Suggest docs

Based on BOTH the interview answers AND the directory structure, suggest documentation pages. For each suggestion, explain WHY this doc matters for the audience they described.

Show ALL suggestions at once as a numbered list. Include custom docs informed by the interview — don't just use the standard templates.

Standard templates to consider (only if relevant):
- ARCHITECTURE.md — Always
- PRODUCT.md — When there's UI
- BUSINESS_RULES.md — When there's validation, pricing, limits
- DATA.md — When there are data models, schemas, databases
- API.md — When there are API endpoints
- DECISIONS.md (health-check) — When the user mentions decisions or trade-offs
- Custom docs based on interview answers (e.g. INJECTION.md, BILLING.md)

Format the full list like:

```
Here's what I'd generate (all included by default):

  1. 📄 ARCHITECTURE.md — "How Layer is structured: WXT, background script, popup, storage"
  2. 📄 PRODUCT.md — "User-facing features: popup, rule editor, code editor"
  3. 📄 DATA.md — "Rule model, browser storage, URL pattern matching"
  4. 📄 INJECTION.md — "How CSS/JS gets injected via Chrome scripting API"

Drop any? (type numbers to remove, or Enter to keep all)
```

**ONE confirmation, not one per doc.** Default is keep all. User only types if they want to remove something.

## Phase 4: Write

After confirmation, immediately write everything — no additional questions about directory (default: `docs/`) or style preferences. Keep it fast.

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
  synthesis/
```

End with: **"Setup complete. Run `/wf-compile --force` to generate your wiki."**
