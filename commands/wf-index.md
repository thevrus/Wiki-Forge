Regenerate INDEX.md from existing compiled docs.

This reads all docs in the wiki and generates a master index with one-line LLM summaries for each document, plus listings of all entity, concept, and synthesis pages.

Run:
```bash
wiki-forge index --provider local --repo .
```

If wiki-forge is not globally installed:
```bash
bunx wiki-forge index --provider local --repo .
```

After generation, show the contents of the new INDEX.md.
