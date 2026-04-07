Initialize a wiki-forge documentation wiki for this repository.

## Phase 1: Understand the project

Before scanning anything, interview the user. Ask these questions ONE AT A TIME (wait for each answer):

1. **"What does this project do in one sentence?"**
   - If a README exists, read it first and propose an answer. Let them correct it.

2. **"Who needs to understand this codebase but can't read the code?"**
   - Examples: PMs, designers, new engineers, QA, clients, investors
   - This determines the writing style

3. **"What questions do those people ask you most often?"**
   - Examples: "How does X work?", "What are the rules for Y?", "What changed recently?"
   - These become the docs

4. **"What parts of the codebase are the most confusing or undocumented?"**
   - These get priority in the doc map

5. **"Are there business rules or constraints that aren't obvious from the code?"**
   - Fees, limits, eligibility, approval flows, edge cases
   - These go into BUSINESS_RULES.md

6. **"Anything that should NOT be documented?"**
   - Internal tools, deprecated code, sensitive logic

## Phase 2: Scan the codebase

Now scan the repo structure:
- Read the top-level and one-level-deep directories (skip node_modules, dist, build, .git)
- Read package.json, README, and any config files for context
- Identify the tech stack, framework, and project type

## Phase 3: Suggest docs

Based on BOTH the interview answers AND the directory structure, suggest documentation pages. For each suggestion, explain WHY this doc matters for the audience they described.

Format each suggestion like:

```
📄 PRODUCT.md
   "User-facing screens, flows, and features in the popup UI"
   Sources: src/components/, src/popup/
   Why: You mentioned PMs ask "what does the extension do?" — this answers that.
   Include? [Y/n/edit]
```

Standard suggestions to consider (only if relevant):

| Doc | When to suggest |
|---|---|
| ARCHITECTURE.md | Always — system overview |
| PRODUCT.md | When there's UI (components, pages, screens) |
| BUSINESS_RULES.md | When there's validation, pricing, limits, or constraints |
| DATA.md | When there are data models, schemas, databases |
| API.md | When there are API endpoints or routes |
| DECISIONS.md (health-check) | When the user mentions past decisions or trade-offs |

Also suggest custom docs based on the interview. If they said "people always ask about the billing flow," suggest a **BILLING.md** — don't force it into a generic category.

## Phase 4: Customize

After the user confirms their selection:

1. Ask: **"What directory for the wiki?"** (default: `docs/`)
2. Ask: **"Any style preferences?"** — e.g. "more technical", "include code examples", "keep it very short". Store this in the `style` field.

## Phase 5: Write

Create `{docs_dir}/.doc-map.json` with the confirmed docs. Each entry should have:
- **description** — specific to THIS project, informed by the interview (not generic)
- **type** — `"compiled"` or `"health-check"`
- **sources** — directories that feed this doc
- **context_files** — always-included files (package.json, config files)
- **style** (optional, top-level) — if the user gave style preferences

Also create:
```
{docs_dir}/
  .doc-map.json
  entities/
  concepts/
  synthesis/
```

End with: **"Setup complete. Run `/wf-compile --force` to generate your wiki."**
