Validate the wiki-forge doc-map configuration. No LLM calls — just filesystem checks.

## Steps

1. Read `docs/.doc-map.json`. If it doesn't exist, tell the user to run `/wf-init` first.

2. Validate the JSON structure. Each entry must have:
   - `description` (non-empty string)
   - `type` ("compiled" or "health-check")
   - `sources` (array of strings)
   - `context_files` (array of strings)

3. For each entry, check:
   - Do all `sources` directories/files exist?
   - Do all `context_files` exist?
   - Is the `description` meaningful (not empty)?

4. Report results:
   - **✅ {doc_name}** — all sources exist
   - **✗ {doc_name}**: Source "{path}" does not exist
   - **⚠ {doc_name}**: Context file "{path}" does not exist

5. Summarize: "N errors, N warnings" and suggest fixes for each.

## Important

This command is read-only. No files are written. No LLM calls are made. It only checks the configuration.
