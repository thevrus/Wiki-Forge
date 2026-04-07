Regenerate the INDEX.md master index from existing compiled docs.

## Steps

1. Read `docs/.doc-map.json` to know which docs exist.

2. Read each compiled doc file from the docs directory.

3. Write `docs/INDEX.md` with this structure:

```markdown
---
generated_at: "{ISO timestamp}"
---

# Wiki Index

This wiki is compiled from the codebase by Wiki Forge. Each document reflects the current state of the code.

## Compiled Documents

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — {one-sentence summary of what this doc contains}
- **[PRODUCT.md](PRODUCT.md)** — {one-sentence summary}

## Health-Checked Documents

- **[DECISIONS.md](DECISIONS.md)** *(human-written, auto-checked)* — {one-sentence summary}

## Entities

- [booking service](entities/booking-service.md)
- [payment gateway](entities/payment-gateway.md)

## Concepts

- [authentication flow](concepts/authentication-flow.md)
- [fee calculation](concepts/fee-calculation.md)

## Synthesis

- [fees explained](synthesis/fees-explained.md)
```

4. The summaries should be specific and factual — not the description from the doc map, but an actual summary of what the compiled doc contains. Read each doc to write the summary.

5. List all `.md` files in `entities/`, `concepts/`, and `synthesis/` directories.

6. Show the user the generated INDEX.md contents.
