Answer a question about this codebase using the compiled wiki.

$ARGUMENTS

Follow the UI patterns from @commands/ui-brand.md for all output formatting.

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 wiki-forge ► QUERY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Steps

1. Find the docs directory — look for `.doc-map.json` in `docs/`, `wiki/`, or the repo root. Read `INDEX.md` to understand what's available.

2. Based on the question, read the relevant docs, entity pages, and concept pages.

3. Synthesize an answer:
   - Cite sources: `(source: PRODUCT.md)`, `(source: entities/booking-service.md)`
   - Be specific and factual — name concrete features, rules, and behaviors
   - If the wiki doesn't cover the question, read the source code directly and answer from that

## Examples

- "How does authentication work?"
- "What are the business rules for booking?"
- "Compare the payment flow to the booking flow"
- "What changed since the last compilation?"
