Validate and enrich a ticket description against the codebase and brain.

$ARGUMENTS

Follow the UI patterns from @commands/ui-brand.md for all output formatting.

## Arguments

The user provides a ticket description as a string, e.g.:
- `/wf-ticket "add retry logic to payment flow"`
- `/wf-ticket "users can't update their email after signup"`
- `/wf-ticket "migrate billing from Stripe to internal system"`

If no argument, ask: *"Describe the ticket in one sentence."*

---

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 wiki-forge ► TICKET
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
7. `brain/ROADMAP.md` — current priorities
8. All files in `brain/DECISIONS/` — active ADRs

If no `docs/.doc-map.json` exists, show:
```
  ✗ No compiled wiki found. Run /wf-compile first — ticket validation needs a wiki to validate against.
```

### Step 2: Identify affected entities

From the ticket description, identify:
- Which **entities** (services, APIs, data models) are involved
- Which **concepts** (flows, patterns, rules) apply
- Which **source directories** contain the relevant code

Show what was found:

```
  ── Affected Entities ──────────────────────────────

  ◆ payment-gateway     (docs/entities/payment-gateway.md)
  ◆ subscription-service (docs/entities/subscription-service.md)
  ○ billing-rules        (docs/concepts/fee-calculation.md)
```

### Step 3: Validate the ticket

Check the ticket description against the wiki and brain:

**Terminology check** — Does the ticket use the correct terms from `brain/GLOSSARY.md`? If the user wrote "subscription" but the codebase calls it "membership", flag it.

**Architecture check** — Does the proposed change align with how the system actually works? If the ticket says "add retry to the payment API" but retries are handled by a background worker, flag the mismatch.

**ADR check** — Does the ticket conflict with any active decisions in `brain/DECISIONS/`? If ADR-003 says "no synchronous retries" and the ticket wants synchronous retries, flag the conflict.

**Scope check** — Are there entities or concepts the ticket doesn't mention but should? If changing payment flow also affects refund flow, flag the missing scope.

**Roadmap check** — Does this align with current priorities from `brain/ROADMAP.md`? Not a blocker, just context.

### Step 4: Suggest the right assignee

From the compiled docs and git history, identify who has the most commits in the affected source directories. Show the top 2-3 contributors.

```
  ── Suggested Assignees ────────────────────────────

  1. Alice Chen — 34 commits in src/billing/ (last active: 2 days ago)
  2. Bob Kim — 12 commits in src/payments/ (last active: 1 week ago)
```

### Step 5: Output the enriched ticket

```
╔══════════════════════════════════════════════════════════════╗
║  ENRICHED TICKET                                              ║
╚══════════════════════════════════════════════════════════════╝

  Title: {corrected title using canonical terminology}

  ── Description ────────────────────────────────────
  {original description, cleaned up with correct terms}

  ── Context ────────────────────────────────────────
  Affected entities: {list}
  Affected concepts: {list}
  Source directories: {list}

  ── Validation ─────────────────────────────────────
  ✓ Terminology matches glossary
  ⚠ Scope: refund flow may also be affected (see concepts/fee-calculation.md)
  ✗ Conflicts with ADR-003: no synchronous retries

  ── Suggested Assignee ─────────────────────────────
  Alice Chen (34 commits in affected areas)

  ── Edge Cases ─────────────────────────────────────
  - What happens if payment fails mid-retry?
  - Does this affect the free tier differently?
  - Rate limiting implications?

──────────────────────────────────────────────────────────────
→ Copy to clipboard? (Y / n)
──────────────────────────────────────────────────────────────
```

### Step 6: Completion

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 wiki-forge ► DONE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ✓ Ticket validated against wiki + brain
  ✓ {N} entities identified, {M} edge cases surfaced

  ▶ Next: /wf-qa "{ticket title}" to generate test brief
```

---

## Rules

- This command is read-only. It does NOT create tickets in any external system.
- Use canonical terms from GLOSSARY.md in all output — never echo back incorrect terminology without correction.
- Validation symbols: `✓` = passes, `⚠` = warning (not blocking), `✗` = conflict (needs resolution before building).
- Edge cases should be genuinely useful, not generic. Derive them from the actual entity pages and business rules, not boilerplate.
- If the wiki has never been compiled, this command cannot run — it needs entity/concept pages to validate against.
- Keep output scannable — a PM should read the enriched ticket in under 60 seconds.
