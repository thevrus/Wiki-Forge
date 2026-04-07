Check which documentation has drifted from the codebase without making any changes.

Follow the UI patterns from @commands/ui-brand.md for all output formatting.

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 wiki-forge ► CHECKING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Steps

1. Find the docs directory — look for `.doc-map.json` in `docs/`, `wiki/`, or the repo root. If not found, tell the user to run `/wf-init` first.

2. Read `.last-sync` to get the last compiled commit hash. If it doesn't exist, compare against the initial commit.

3. Run `git diff --name-only {last_sync}..HEAD` to get changed files.

4. For each doc entry in the map:
   - Check if any of its `sources` or `context_files` overlap with the changed files
   - If yes: read the current doc and the relevant source code. Determine if the changes are meaningful (not just formatting/comments) or if they affect behavior described in the doc.
   - Report: `⚡ {doc_name} — drifted` with a one-line reason, or `✅ {doc_name} — up to date`

5. Show completion:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 wiki-forge ► DONE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ⚡ 2 docs drifted, ✓ 2 up to date

  ▶ Next: /wf-compile
```

## Important

This command is read-only. Do NOT write any files.
