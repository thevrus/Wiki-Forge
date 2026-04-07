Show a dashboard of the current wiki-forge state for this repository.

Follow the UI patterns from @commands/ui-brand.md for all output formatting.

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 wiki-forge ► STATUS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Steps

1. Find the docs directory — look for `.doc-map.json` in `docs/`, `wiki/`, or the repo root. If not found, show:
   ```
   ✗ No .doc-map.json found. Run /wf-init to get started.
   ```

2. Read `.doc-map.json` and gather:
   - Number of compiled docs and health-check docs
   - List of all configured docs with their source directories

3. Read `.last-sync` to get the last compiled commit hash. Run `git log -1 --format="%H %ci" {hash}` to get the date. If missing, note "never compiled".

4. Read `.doc-hashes.json` if it exists. For each doc, compute current file hashes and compare against stored hashes to detect drift. Count changed/added/removed files per doc.

5. Count entity and concept pages in `entities/` and `concepts/` directories.

6. Display the dashboard:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 wiki-forge ► STATUS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Config:     docs/.doc-map.json
  Last sync:  2026-04-07 14:30 (abc1234)
  Docs dir:   docs/

  ── Documents ──────────────────────────────────────

  ✓ ARCHITECTURE.md      — 0 files changed
  ⚡ PRODUCT.md           — 3 files changed
  ✓ DATA.md              — 0 files changed
  ⚠ DECISIONS.md         — health-check

  ── Wiki ───────────────────────────────────────────

  6 entity pages    (docs/entities/)
  3 concept pages   (docs/concepts/)

  ── Summary ────────────────────────────────────────

  4 docs configured (3 compiled, 1 health-check)
  1 doc drifted
  9 wiki pages total

  ▶ Next: /wf-compile
```

## Rules

- This command is read-only. Do NOT write any files.
- If a doc has never been compiled (no entry in `.doc-hashes.json`), show it as `○ {name} — not yet compiled`
- Align the status output for readability
- Show the `▶ Next:` suggestion based on state:
  - If docs are drifted: `/wf-compile`
  - If no drift: `/wf-query "your question here"`
  - If never compiled: `/wf-compile --force`
