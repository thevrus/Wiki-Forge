Check which documentation has drifted from the codebase without making any changes.

## Steps

1. Read `docs/.doc-map.json`. If it doesn't exist, tell the user to run `/wf-init` first.

2. Read `docs/.last-sync` to get the last compiled commit hash. If it doesn't exist, compare against the initial commit.

3. Run `git diff --name-only {last_sync}..HEAD` to get changed files.

4. For each doc entry in the map:
   - Check if any of its `sources` or `context_files` overlap with the changed files
   - If yes: read the current doc and the relevant source code. Determine if the changes are meaningful (not just formatting/comments) or if they affect behavior described in the doc.
   - Report: **⚡ {doc_name} — drifted** with a one-line reason, or **✅ {doc_name} — up to date**

5. Summarize: "N docs drifted, N up to date. Run `/wf-compile` to update."

## Important

This command is read-only. Do NOT write any files. Only report what has drifted and why.
