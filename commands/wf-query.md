Answer a question about this codebase using the compiled wiki.

$ARGUMENTS

Follow the UI patterns from @commands/ui-brand.md for all output formatting.
Follow the style guide from @commands/wf-compile.md (Style guide section) when writing synthesis pages.

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
   - If the wiki doesn't cover the question, say so and suggest which source code to read

4. Ask: **Save as synthesis page? [Y/n]**
   - If yes: write to `docs/synthesis/{slug}.md` with frontmatter:
     ```yaml
     ---
     question: "the original question"
     sources: [list of docs referenced]
     created_at: "ISO timestamp"
     ---
     ```
   - Update INDEX.md to include the new synthesis page

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 wiki-forge ► DONE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ✓ Answer synthesized from {N} docs
  ✓ Saved to synthesis/{slug}.md
```

## Examples

- "How does authentication work?"
- "What are the business rules for booking?"
- "Compare the payment flow to the booking flow"
- "What features exist but aren't documented?"
