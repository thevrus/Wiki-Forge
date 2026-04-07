Validate the doc-map.json configuration without calling any LLM.

Checks for:
- Missing source directories
- Missing context files
- Invalid doc types
- Empty descriptions

Run:
```bash
wiki-forge validate --repo .
```

If wiki-forge is not globally installed:
```bash
bunx wiki-forge validate --repo .
```

If there are errors, suggest fixes for each one.
