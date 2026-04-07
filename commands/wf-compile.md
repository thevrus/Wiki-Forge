Compile documentation for this repository using wiki-forge.

$ARGUMENTS

Run the compilation using the local provider (uses Claude Code as the LLM — no API key needed):

```bash
wiki-forge compile --provider local --repo . $ARGUMENTS
```

If wiki-forge is not globally installed, run:
```bash
bunx wiki-forge compile --provider local --repo . $ARGUMENTS
```

Common flags:
- `--force` — recompile everything from scratch (use on first run or when docs are stale)
- `--docs-dir <name>` — custom docs directory (default: docs)

After compilation finishes:
1. Show which docs were compiled
2. List any health issues found
3. Show the generated INDEX.md contents
4. Tell the user they can browse the docs in `docs/` or open it in Obsidian
