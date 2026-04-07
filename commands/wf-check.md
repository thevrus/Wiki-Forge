Check which documentation has drifted from the codebase without making any changes.

Run:
```bash
wiki-forge check --provider local --repo .
```

If wiki-forge is not globally installed:
```bash
bunx wiki-forge check --provider local --repo .
```

After the check completes, summarize which docs have drifted and why. Suggest running `/wf-compile` to update them.
