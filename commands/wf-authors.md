Generate an AUTHORS.md page from git history showing who owns what in the codebase.

Follow the UI patterns from @commands/ui-brand.md for all output formatting.

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 wiki-forge ► AUTHORS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Steps

1. Find the docs directory — look for `.doc-map.json` in `docs/`, `wiki/`, or the repo root.

2. Read `.doc-map.json` to get the list of source directories.

3. For each source directory in the doc map, run git commands to extract:
   - **Contributors**: `git log --all --format="%aN|%aE|%aI" -- <paths>`
   - **Recent changes**: `git log --since="90 days ago" --format="%aN|%aI|%s" --name-only -- <paths>`

4. Build author profiles by aggregating commit counts, last-active dates, and primary areas across all source directories.

5. Write `AUTHORS.md` to the docs directory with this structure:

```markdown
---
generated_at: "{ISO timestamp}"
---

# Codebase Authors

## Alice Chen
Primary areas: src/services/, src/api/
Active through: 2026-03-28 (34 commits)

## Bruno Silva
Primary areas: src/ui/, src/components/
Active through: 2026-02-14 (87 commits)

## Last Touched

| Module | Author | Date |
|---|---|---|
| src/billing/refund.ts | Alice Chen | 2026-03-28 |
| src/ui/onboarding.tsx | Bruno Silva | 2026-02-14 |
```

6. Show the user the generated AUTHORS.md contents.

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 wiki-forge ► DONE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ✓ AUTHORS.md generated ({N} contributors, {N} recent changes)
```
