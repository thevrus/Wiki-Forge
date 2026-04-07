Run health checks on human-written documentation.

## Steps

1. Read `docs/.doc-map.json`. If it doesn't exist, tell the user to run `/wf-init` first.

2. For each doc entry with `"type": "health-check"`:
   a. Read the existing document
   b. Read the source code from the entry's `sources` directories
   c. Compare the documentation against the code

3. Check for:
   - **Factual errors**: features described that no longer exist or work differently
   - **Missing information**: significant new features or rules not documented
   - **Stale numbers**: limits, fees, defaults, or thresholds that changed in code
   - **Broken flows**: user flows or state transitions that no longer match

4. For each doc, report:
   - **✅ {doc_name} — healthy** if no issues found
   - **⚠ {doc_name}** with a bulleted list of specific issues

5. For each issue found, suggest a concrete fix: what to change in the doc and why.

## Important

This command does NOT rewrite the docs. It only identifies contradictions between human-written documentation and the current codebase. The human decides what to fix.
