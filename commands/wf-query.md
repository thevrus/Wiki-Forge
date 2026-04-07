Answer a question about this codebase using the compiled wiki.

$ARGUMENTS

## Steps

1. Read `docs/INDEX.md` to understand what documentation is available.

2. Based on the user's question, read the relevant docs, entity pages, and concept pages.

3. Synthesize an answer:
   - Cite which docs the answer came from: `(source: PRODUCT.md)`, `(source: entities/booking-service.md)`
   - Be specific and factual — name concrete features, rules, and behaviors
   - If the wiki doesn't cover the question, say so and suggest which source code to read

4. Ask the user: **Save this answer as a synthesis page? [Y/n]**
   - If yes: write the answer to `docs/synthesis/{slug}.md` with frontmatter:
     ```yaml
     ---
     question: "the original question"
     sources: [list of docs referenced]
     created_at: "ISO timestamp"
     ---
     ```
   - Update `docs/INDEX.md` to include the new synthesis page

## Examples of good questions

- "How does authentication work?"
- "What are the business rules for booking?"
- "What has changed since the last compilation?"
- "Compare the payment flow to the booking flow"
- "What features exist but aren't documented?"
