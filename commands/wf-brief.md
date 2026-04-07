Generate a weekly brief summarizing what shipped, who built it, and what's at risk.

$ARGUMENTS

Follow the UI patterns from @commands/ui-brand.md for all output formatting.

## Arguments

Parse optional flags:
- `--weekly` (default) — last 7 days
- `--daily` — last 24 hours
- `--days N` — last N days
- `--since YYYY-MM-DD` — since a specific date

If no argument, default to `--weekly`.

---

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 wiki-forge ► BRIEF
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Steps

### Step 1: Gather sources

Read these (skip any that don't exist):
1. `docs/.doc-map.json` — configured docs and sources
2. `docs/.last-sync` — last compiled commit
3. `docs/.doc-hashes.json` — current drift state
4. `docs/INDEX.md` — compiled wiki index
5. `brain/ROADMAP.md` — current priorities
6. `brain/NORTH_STAR.md` — mission context
7. All files in `docs/entities/` and `docs/concepts/`

### Step 2: Gather git activity

Run these git commands scoped to the time window:

```bash
# Commits in the time window
git log --since="{date}" --format="%H|%an|%ae|%ci|%s" --no-merges

# Files changed with stats
git log --since="{date}" --stat --no-merges

# Authors ranked by commit count
git shortlog --since="{date}" -sne --no-merges

# Any new tags/releases
git tag --sort=-creatordate | head -5
```

### Step 3: Cross-reference with wiki

For each significant commit/PR:
- Match changed files against `docs/.doc-map.json` sources to identify which docs are affected
- Check if any entity or concept pages reference the changed files
- Flag docs that drifted but haven't been recompiled

### Step 4: Detect risks

Check for:
- **Drifted docs** — files changed since last compile (use .doc-hashes.json)
- **Undocumented areas** — source directories with commits but no doc coverage in .doc-map.json
- **Single-author risk** — entities where only one person has committed in the last 90 days
- **Stale areas** — docs whose sources haven't been touched in 60+ days (might be outdated)

### Step 5: Generate the brief

Output a Markdown brief with this structure:

```markdown
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 wiki-forge ► BRIEF ({period})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## What Shipped

| What | Who | When | Docs affected |
|------|-----|------|---------------|
| {commit summary} | {author} | {date} | {doc names or "—"} |

  {N} commits by {M} contributors

## Team Activity

| Author | Commits | Areas |
|--------|---------|-------|
| {name} | {count} | {source dirs} |

## Doc Health

  ✓ {N} docs up to date
  ⚡ {N} docs drifted — recompile needed
  ○ {N} docs never compiled

## Risks & Warnings

  ⚠ {description of each risk found}

  Examples:
  ⚠ payment-gateway: only Alice has committed (bus factor = 1)
  ⚠ ARCHITECTURE.md drifted: 5 files changed since last compile
  ⚠ src/legacy/ has 12 commits but no doc coverage

## Current Priorities
  {From brain/ROADMAP.md "Now" section, if it exists}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 wiki-forge ► DONE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ▶ Next: /wf-compile (if drifted) or /wf-query (if up to date)
```

### Step 6: Offer to save

```
──────────────────────────────────────────────────────
→ Save brief to docs/briefs/{date}.md? (Y / n)
──────────────────────────────────────────────────────
```

If yes, create `docs/briefs/` directory if needed and write the brief as a dated file (e.g., `docs/briefs/2026-04-07.md`).

---

## Rules

- This command is read-only until the user confirms saving.
- Group commits by logical change, not individual commits — if 3 commits are all "fix payment retry", show them as one line.
- Use doc names (not file paths) in the "Docs affected" column.
- If brain/ROADMAP.md doesn't exist, skip the "Current Priorities" section.
- If there are no commits in the time window, say so clearly and suggest a wider window.
- Keep the brief scannable — a CEO should understand it in 30 seconds.
- Don't include merge commits or CI bot commits.
