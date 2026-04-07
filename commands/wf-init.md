Initialize wiki-forge for this repository.

Run the interactive setup wizard that scans the codebase and suggests which documentation to generate:

```bash
wiki-forge init --interactive --repo .
```

If wiki-forge is not globally installed, run:
```bash
bunx wiki-forge init --interactive --repo .
```

After the doc-map is created, tell the user to run `/wf-compile` to generate the docs.
