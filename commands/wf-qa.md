Generate a QA test brief for a feature, ticket, or area of the codebase.

$ARGUMENTS

Follow the UI patterns from @commands/ui-brand.md for all output formatting.

## Arguments

The user provides a feature or ticket description:
- `/wf-qa "payment retry logic"`
- `/wf-qa "user email update flow"`
- `/wf-qa "new onboarding wizard"`

If no argument, ask: *"What feature or change should I generate a test brief for?"*

---

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 wiki-forge ► QA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Steps

### Step 1: Read context

Read these sources (skip any that don't exist):
1. `docs/.doc-map.json` — configured docs and source directories
2. `docs/INDEX.md` — compiled wiki index
3. All files in `docs/entities/` — entity pages
4. All files in `docs/concepts/` — concept pages
5. `brain/GLOSSARY.md` — canonical terminology
6. `brain/NORTH_STAR.md` — mission and principles
7. `brain/PRICING.md` — pricing tiers and limits
8. `brain/ICP.md` — who uses this and how
9. All files in `brain/DECISIONS/` — active ADRs

If no `docs/.doc-map.json` exists, show:
```
  ✗ No compiled wiki found. Run /wf-compile first — QA briefs need entity pages to generate from.
```

### Step 2: Identify scope

From the feature description, identify:
- Which **entities** are directly affected
- Which **concepts** contain relevant business rules
- Which **adjacent entities** could be affected by regression
- Which **user personas** from `brain/ICP.md` are impacted

Show scope:

```
  ── Test Scope ─────────────────────────────────────

  Direct:
  ◆ payment-gateway      (docs/entities/payment-gateway.md)
  ◆ retry-policy         (docs/concepts/retry-policy.md)

  Regression:
  ○ refund-flow          (docs/concepts/fee-calculation.md)
  ○ subscription-service (docs/entities/subscription-service.md)

  Personas affected:
  ○ Pro-tier user (pays monthly, uses API)
  ○ Free-tier user (limited retries)
```

### Step 3: Extract business rules

From the entity and concept pages, extract every business rule, constraint, and limit that applies to this feature. These become test assertions.

Examples of what to extract:
- "Free tier limited to 3 retries per day" (from PRICING.md)
- "Retries must be async, never block the request" (from ADR-003)
- "Failed payments trigger email notification" (from entities/payment-gateway.md)
- "Refund window is 30 days from purchase" (from concepts/fee-calculation.md)

### Step 4: Generate the brief

```
╔══════════════════════════════════════════════════════════════╗
║  QA BRIEF: {feature name}                                     ║
╚══════════════════════════════════════════════════════════════╝

  ── Business Rules to Validate ─────────────────────

  From entities/payment-gateway.md:
  □ {rule 1}
  □ {rule 2}

  From concepts/retry-policy.md:
  □ {rule 3}

  From brain/PRICING.md:
  □ {tier-specific rule}

  From brain/DECISIONS/ADR-003.md:
  □ {constraint from decision}

  ── Edge Cases ─────────────────────────────────────

  □ What happens when {boundary condition}?
  □ What happens when {concurrent operation}?
  □ What happens when {external dependency fails}?
  □ What happens for {different user tier/role}?
  □ What happens at {scale/rate limit boundary}?

  ── Regression Scope ───────────────────────────────

  These adjacent features should still work:
  □ {adjacent feature 1} — why it could break: {reason}
  □ {adjacent feature 2} — why it could break: {reason}

  ── What Changed ───────────────────────────────────

  {Summary of the code change, from entity/concept pages.
   Not a diff — a plain-language description of what's different
   from the previous behavior.}

  ── Test Data Suggestions ──────────────────────────

  - {specific test scenario with concrete values}
  - {specific test scenario with concrete values}
  - {boundary value test}

──────────────────────────────────────────────────────────────
→ Save to docs/qa/{slug}.md? (Y / n)
──────────────────────────────────────────────────────────────
```

### Step 5: Completion

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 wiki-forge ► DONE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ✓ QA brief generated
  ✓ {N} business rules, {M} edge cases, {K} regression checks

  ▶ Next: /wf-ticket "{feature}" to validate the ticket
```

---

## Rules

- This command is read-only until the user confirms saving.
- Every business rule MUST cite its source (entity page, concept page, brain doc, or ADR). No invented rules.
- Edge cases must be specific to this feature, not generic QA boilerplate. "What happens when the server crashes?" is useless. "What happens when the retry count exceeds the free-tier limit of 3?" is useful.
- Regression scope must explain WHY each adjacent feature could break, not just list them.
- Test data suggestions should include concrete values, not placeholders.
- Use `□` (empty checkbox) for all test items so the brief is usable as a checklist.
- If brain/ docs don't exist, still generate the brief from entity/concept pages alone — brain/ enriches but isn't required.
- Keep the brief actionable — a QA engineer should be able to start testing immediately after reading it.
