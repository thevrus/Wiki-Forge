Regenerate the INDEX.md master index from existing compiled docs.

Follow the UI patterns from @commands/ui-brand.md for all output formatting.

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 wiki-forge ► INDEXING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Steps

1. Find the docs directory — look for `.doc-map.json` in `docs/`, `wiki/`, or the repo root.

2. Read each compiled doc file from the docs directory.

3. Write `INDEX.md` with this structure:

```markdown
---
generated_at: "{ISO timestamp}"
---

# Wiki Index

This wiki is compiled from the codebase by Wiki Forge.

## Compiled Documents

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — {one-sentence summary of actual content}

## Health-Checked Documents

- **[DECISIONS.md](DECISIONS.md)** *(human-written)* — {one-sentence summary}

## Entities

- [booking service](entities/booking-service.md)

## Concepts

- [authentication flow](concepts/authentication-flow.md)

```

4. Summaries must be specific — read each doc and summarize what it actually contains, not the description from the doc map.

5. List all `.md` files in `entities/`, `concepts/`, and `synthesis/` directories.

6. Show the user the generated INDEX.md contents.

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 wiki-forge ► DONE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ✓ INDEX.md generated ({N} docs, {N} entities, {N} concepts)
```
