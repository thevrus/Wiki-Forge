Run health checks on human-written documentation.

Follow the UI patterns from @commands/ui-brand.md for all output formatting.

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 wiki-forge ► HEALTH CHECK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Steps

1. Find the docs directory — look for `.doc-map.json` in `docs/`, `wiki/`, or the repo root. If not found, tell the user to run `/wf-init` first.

2. For each doc entry with `"type": "health-check"`:
   a. Read the existing document
   b. Read the source code from the entry's `sources` directories
   c. Compare the documentation against the code

3. Check for:
   - **Factual errors**: features described that no longer exist or work differently
   - **Stale numbers**: limits, fees, defaults, or thresholds that changed in code
   - **Broken flows**: user flows or state transitions that no longer match
   - **Missing information**: significant new features or rules not documented

4. For each doc, report:
   - `✓ {doc_name} — healthy`
   - `⚠ {doc_name}` with a bulleted list of specific issues and suggested fixes

5. Show completion:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 wiki-forge ► DONE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ✓ 1 healthy, ⚠ 1 with issues
```

## Important

This command does NOT rewrite the docs. It only identifies contradictions. The human decides what to fix.
