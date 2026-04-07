Run health checks on human-written documentation (type: "health-check" in doc-map).

This checks for contradictions between the documentation and the current codebase without rewriting anything.

Run:
```bash
wiki-forge health --provider local --repo .
```

If wiki-forge is not globally installed:
```bash
bunx wiki-forge health --provider local --repo .
```

After the check, list each issue found with its severity. Suggest specific fixes for each contradiction.
