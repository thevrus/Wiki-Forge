import type { DocEntry } from "../config"
import type { LLMProvider } from "../providers/types"
import { asyncPool } from "../utils"
import { hashContent } from "./hashes"
import type { SummaryCache } from "./summary-cache"

// ── Prompt version ────────────────────────────────────────────────────
// Bump when DEFAULT_STYLE or ONE_SHOT_EXAMPLE change in a way that affects
// output shape. Recorded in compiled doc frontmatter so we can A/B test
// prompt changes and identify docs generated with stale prompts.
export const STYLE_VERSION = 1

// ── One-shot example ──────────────────────────────────────────────────

export const ONE_SHOT_EXAMPLE = `
EXAMPLE of good output (for reference — do NOT copy this content, write about the actual code):

---
title: "Booking System"
slug: booking-system
category: compiled
description: "Appointment scheduling, availability checks, and cancellation rules"
compiled_at: "2026-04-07T00:00:00Z"
style_version: 1
---

The booking system handles appointment scheduling for pet grooming and veterinary services. Customers select a service, pick an available time slot, and confirm the booking. Staff can view and manage appointments through an admin dashboard.

Entry points: \`createBooking()\`, \`cancelBooking()\`, \`getAvailableSlots()\`.

---

## Architecture

\`\`\`mermaid
flowchart LR
    A[Client] -->|select slot| B[booking.ts]
    B -->|check| C[availability.ts]
    B -->|create| D[appointments DB]
    D -->|notify| E[notifications.ts]
    style B fill:#f0f0ff,stroke:#8250df,stroke-width:2px
\`\`\`

---

## Business Rules & Logic

### Cancellation Policy
- Customers can cancel up to 24 hours before the appointment at no charge
- Cancellations within 24 hours incur a 50% fee (\`LATE_CANCEL_FEE_PCT = 0.5\`)
- No-shows are charged the full amount
- Staff can waive fees via the admin panel (requires \`manager\` role)

### Availability
- Time slots are 30 minutes (\`SLOT_DURATION_MIN = 30\`)
- Maximum 3 concurrent appointments per location
- Blocked dates are configured in \`HOLIDAY_BLACKOUT_DATES\`

---

## Decisions

### 1. 30-minute fixed slots over variable-length

| | |
|---|---|
| **Decided** | Jan 2024 |
| **By** | Alice Chen |
| **Source** | PR #42 · BOOK-101 |
| **Context** | Variable-length slots caused overlapping bookings when staff edited durations. Fixed 30-min slots eliminated the bug entirely. Services that need more time simply book consecutive slots. |
| **Tradeoff** | Short services (15-min nail trims) waste half a slot. Accepted because scheduling correctness > utilization. |
| **Status** | ✅ Active |

---

## ⚠️ Non-obvious Patterns

### The redundant availability check in \`confirmBooking()\`

\`confirmBooking()\` re-checks slot availability even though the caller already validated it. This is intentional — a race condition between two concurrent bookings selecting the same slot was discovered during load testing (PR #67). The second check inside the database transaction closes the window. Removing it re-opens the race condition.

**Added:** PR #67 (Feb 2024) **By:** Alice Chen

---

## Data Model & Entities

- **Appointment**: customerId, serviceId, locationId, startTime, status (pending → confirmed → completed | cancelled | no-show)
- **Service**: name, durationMinutes, price, category
- **Location**: name, address, timezone, maxConcurrent

\`\`\`mermaid
stateDiagram-v2
    [*] --> pending
    pending --> confirmed: customer confirms
    confirmed --> completed: appointment finishes
    confirmed --> cancelled: cancel before start
    confirmed --> no_show: no arrival after 15 min
\`\`\`

---

## Context Holders

| Engineer | Context | Last active |
|----------|:-------:|-------------|
| Alice Chen | **72%** | 2 days ago |
| Bob Kim | **18%** | 1 week ago |

> ⚠️ **Bus factor: 1** — Alice holds 72% of context. Recommendation: pair a second engineer on the next booking task.

---

## Dependencies

\`\`\`mermaid
flowchart TD
    A[booking.ts] -->|imports| B[availability.ts]
    A -->|imports| C[appointments DB]
    A -->|imports| D[notifications.ts]
    E[External: Google Calendar] -.->|sync| B
\`\`\`

| Dependency | Why | Risk |
|-----------|-----|------|
| \`availability.ts\` | Slot checking | Shared module — changes affect booking |
| Google Calendar API | Optional calendar sync | External dependency, may fail |
`.trim()

// ── Style guide ───────────────────────────────────────────────────────

export const DEFAULT_STYLE = `
ACCURACY RULES (non-negotiable):
- ONLY state facts that are directly observable in the provided source code.
- NEVER guess, infer, or assume functionality that isn't in the code. If unsure, omit the claim.
- NEVER invent feature names, API endpoints, data fields, or behaviors.
- Precision over completeness. A short, accurate doc beats a long, hallucinated one.
- NEVER include a section unless you have real facts to put in it. If a section would be empty, DO NOT include it at all — no placeholders, no "no data available", no italicized notes. Just skip the section.

PURPOSE: This document is the BRAIN of the business — not just a tech overview.
Write for a mixed audience: engineers, PMs, designers, QA, new hires, and CEO.
Every section should answer: "What would someone new to this company need to know?"

STRUCTURE: Use the following section order. Include only sections you can fill with real content.
Use --- horizontal rules between major sections for visual separation.

1. **Opening paragraph** — 2-3 sentences: what this module does, why it matters, who uses it.
   Then list entry points: the key functions/routes/exports a developer would call.

2. **"Architecture"** — How the module fits into the system. Use a Mermaid flowchart if there are 3+ components.

3. **"Business Rules & Logic"** — THE MOST IMPORTANT when present. Pricing, validation, feature flags, rate limits, state machines, permissions. Look in: constants, validators, middleware, hooks, config, enums, error messages.

4. **"Decisions"** — WHY the code is shaped this way. Each decision gets a ### heading and a table:
   | | |
   |---|---|
   | **Decided** | date |
   | **By** | engineer name |
   | **Source** | PR #N · TICKET-N |
   | **Context** | What problem it solved, what alternatives were considered |
   | **Tradeoff** | What was sacrificed and why it was acceptable |
   | **Status** | ✅ Active / ⚠️ Under review / ❌ Superseded |
   Only include decisions you can back with a PR, ticket, or commit message from the provided context. Do NOT invent decisions.

5. **"⚠️ Non-obvious Patterns"** — Things that look wrong but are intentional. Code a new engineer might "fix" and break something. Each pattern: what it is, why it exists, who added it and when (PR reference). This section prevents costly mistakes.

6. **"Data Model & Entities"** — Key entities, relationships, fields. In plain language. Include a stateDiagram-v2 if there's a lifecycle (e.g. pending → confirmed → completed).

7. **"Context Holders"** — Table: | Engineer | Context % | Last active |
   Add a ⚠️ bus factor warning if one person holds >70% of context.

8. **"Dependencies"** — What this module depends on. Mermaid flowchart + table: | Dependency | Why | Risk |

9. **"Integrations & External Services"** — Third-party services, webhooks, data flows. Only if relevant.

SKIP sections that would be empty. 3 rich sections > 9 thin ones.

DEPTH RULES:
- Every claim must cite a specific thing from the code: a function name, constant, route, type, hook, or config key.
- "The system handles scheduling" is USELESS. "Users book calls via the /schedule/[petId] route, which renders a multi-step wizard (flea-tick-wizard.tsx)" is USEFUL.
- Name the actual functions, components, constants, types, routes, hooks, and config keys you see in the source code.
- If you cannot name specific things from the code, the section is empty — omit it entirely.

DO NOT restate contributor names, commit counts, or ticket lists as body content — those are already in the YAML frontmatter. The body should contain facts derived from the SOURCE CODE, not from git metadata.

FRONTMATTER: Every doc MUST start with YAML frontmatter:
---
title: "Human-readable page title"
slug: url-safe-lowercase-slug
category: compiled
description: "One-sentence summary"
compiled_at: "ISO timestamp"
---

CRITICAL: Output exactly ONE frontmatter block at the very start. Do NOT wrap it in \`\`\`yaml code fences. Do NOT output a second frontmatter block anywhere in the document.

FORMATTING:
- Open with a 2-3 sentence summary paragraph, then list entry points
- Use --- horizontal rules between major sections
- Use ## for major sections, ### for subsections
- Use tables for structured data (decisions, dependencies, context holders)
- Use bullet lists for rules/constraints
- No raw code snippets or function signatures — reference by name with backticks
- Each section should be independently readable

DIAGRAMS: Include Mermaid diagrams where they add clarity:
- Architecture: flowchart showing services/components and data flow
- State machines: stateDiagram-v2 for lifecycle states
- Dependencies: flowchart TD showing what imports what
Keep diagrams simple — 3-8 nodes. Complex diagrams hurt more than they help.

TONE: Write like a senior engineer explaining the system to a smart new hire. Direct, specific, no filler.
`.trim()

// ── Prompts ────────────────────────────────────────────────────────────

export function noSourcesMessage(entry: DocEntry): string {
  return `No source files found for sources: ${entry.sources.join(", ")}. Check that these directories exist.`
}

export function recompilePrompt(
  entry: DocEntry,
  currentDoc: string,
  diff: string,
  contextCode: string,
  style: string,
  authorContext: string,
  domain?: string,
): string {
  const timestamp = new Date().toISOString()
  return [
    "You are a documentation compiler. Update the existing document to reflect the code changes.",
    ...(domain ? [`Domain context: ${domain}`] : []),
    "ONLY state facts directly visible in the source code or diff. NEVER guess or infer behavior not shown.",
    "Preserve the document's structure. Only modify sections affected by the changes.",
    "Update the compiled_at timestamp in frontmatter. Preserve all other frontmatter fields (title, slug, category, contributors).",
    "Return ONLY the updated markdown content — no preamble, no fencing.",
    "",
    style,
    "",
    `COMPILE TARGET:`,
    entry.description,
    `Sources: ${entry.sources.join(", ")}`,
    `Timestamp: ${timestamp}`,
    "",
    `## Current documentation`,
    currentDoc,
    "",
    `## Code diff since last sync`,
    diff || "(no diff)",
    "",
    `## Relevant source code`,
    contextCode || "(no context)",
    "",
    `## Decision history & context`,
    authorContext || "(no git history context available)",
  ].join("\n")
}

// ── Hierarchical summarization ────────────────────────────────────────

/** Max bytes per batch when grouping small files together. */
export const BATCH_SIZE = 25_000

export type FileBatch = { label: string; content: string }

/** Group small files into batches; large files stay solo. */
export function batchFiles(
  files: Array<{ path: string; content: string }>,
): FileBatch[] {
  const batches: FileBatch[] = []
  let currentPaths: string[] = []
  let currentChunks: string[] = []
  let currentSize = 0

  for (const f of files) {
    const chunk = `--- ${f.path} ---\n${f.content}`
    if (currentSize + chunk.length > BATCH_SIZE && currentChunks.length > 0) {
      batches.push({
        label:
          currentPaths.length === 1
            ? currentPaths[0]!
            : `${currentPaths.length} files`,
        content: currentChunks.join("\n\n"),
      })
      currentPaths = []
      currentChunks = []
      currentSize = 0
    }
    currentPaths.push(f.path)
    currentChunks.push(chunk)
    currentSize += chunk.length
  }
  if (currentChunks.length > 0) {
    batches.push({
      label:
        currentPaths.length === 1
          ? currentPaths[0]!
          : `${currentPaths.length} files`,
      content: currentChunks.join("\n\n"),
    })
  }
  return batches
}

export function summarizeBatchPrompt(
  batch: FileBatch,
  description: string,
  domain?: string,
): string {
  return [
    `Extract facts from the source code below for: ${description}`,
    ...(domain ? [`Domain: ${domain}`] : []),
    "ONLY include facts visible in the code. Be exhaustive and SPECIFIC:",
    "- Name every exported function, hook, component, class, and type",
    "- Name every route, endpoint, and navigation path",
    "- Name every constant, config key, feature flag, and validation rule",
    "- Name every external service, API call, and integration",
    "- 'The system handles X' is NOT a fact. 'handleBooking() in booking.ts creates an Appointment with status pending' IS a fact.",
    "",
    batch.content,
    "",
    "Output structured bullet points. Group by: Business Rules, User Flows, Data Model, Integrations, Architecture.",
  ].join("\n")
}

export async function summarizeHierarchically(
  files: Array<{ path: string; content: string }>,
  description: string,
  triageProvider: LLMProvider,
  concurrency: number,
  domain?: string,
  onProgress?: (done: number, total: number) => void,
  summaryCache?: SummaryCache,
): Promise<{ text: string; cacheUpdated: boolean }> {
  const batches = batchFiles(files)
  const summaries: string[] = new Array(batches.length)
  let cacheUpdated = false

  await asyncPool(concurrency, batches, async (batch, idx) => {
    // Check summary cache by content hash
    const contentHash = hashContent(batch.content)
    if (summaryCache?.[contentHash]) {
      summaries[idx] = summaryCache[contentHash]
      onProgress?.(idx + 1, batches.length)
      return
    }

    const prompt = summarizeBatchPrompt(batch, description, domain)
    summaries[idx] = await triageProvider.generate(prompt)

    // Store in cache
    if (summaryCache) {
      summaryCache[contentHash] = summaries[idx]!
      cacheUpdated = true
    }
    onProgress?.(idx + 1, batches.length)
  })

  const text = summaries
    .filter(Boolean)
    .map((s, i) => {
      return `### ${batches[i]!.label}\n${s}`
    })
    .join("\n\n")

  return { text, cacheUpdated }
}

export function fullRecompileSystem(style: string, domain?: string): string {
  return [
    "You are a documentation compiler. You write knowledge base documents from structured fact summaries.",
    ...(domain ? [`Domain context: ${domain}`] : []),
    "ONLY include facts from the summary. NEVER add information not in the summary.",
    "If a section has no supporting data, OMIT it entirely. Never write placeholder text.",
    "NEVER suggest improvements, process changes, templates, or recommendations. ONLY document what exists.",
    "Return ONLY the markdown document starting with --- frontmatter. No preamble, no code fences.",
    "",
    style,
    "",
    ONE_SHOT_EXAMPLE,
  ].join("\n")
}

export function fullRecompilePrompt(
  entry: DocEntry,
  currentDoc: string,
  summary: string,
  authorContext: string,
  depGraph?: string,
): string {
  const timestamp = new Date().toISOString()
  return [
    `COMPILE TARGET:`,
    entry.description,
    `Sources: ${entry.sources.join(", ")}`,
    `Timestamp: ${timestamp}`,
    "",
    `## Current documentation (for structural reference)`,
    currentDoc || "(new document — create from scratch)",
    "",
    `## Source code summary (structured facts extracted from code)`,
    summary,
    "",
    `## Decision history & context`,
    authorContext || "(no git history context available)",
    ...(depGraph ? ["", depGraph] : []),
    "",
    "Synthesize the decision history into the document. For each significant behavior, explain:",
    "1. What the code does (brief)",
    "2. WHY it's this way — reference specific PRs, tickets, and review discussions",
    "3. Non-obvious patterns — things that look wrong but are intentional",
    "4. Who has context — from git blame ownership percentages",
    "",
    "Now write the complete knowledge base document. Start with the --- frontmatter block.",
  ].join("\n")
}

export function healthCheckPrompt(
  entry: DocEntry,
  currentDoc: string,
  sourceCode: string,
  domain?: string,
): string {
  return [
    "You are a documentation accuracy checker.",
    ...(domain ? [`Domain context: ${domain}`] : []),
    "Compare the documentation against the source code and identify issues.",
    "Focus on statements that a product manager might rely on that are now wrong.",
    "",
    "Check for:",
    "- Factual errors: features described that no longer exist or work differently",
    "- Missing information: significant new features or rules not covered",
    "- Stale numbers: limits, fees, defaults, or thresholds that changed",
    "- Broken flows: user flows or state transitions that no longer match the code",
    "",
    "Respond with a JSON object (no markdown fencing):",
    '{ "healthy": true/false, "issues": ["specific issue 1", "specific issue 2"] }',
    "",
    `COMPILE TARGET:`,
    entry.description,
    "",
    `## Current documentation`,
    currentDoc,
    "",
    `## Source code`,
    sourceCode,
  ].join("\n")
}

export function singlePassSystem(style: string, domain?: string): string {
  return [
    "You are a documentation compiler. You receive source code and produce a knowledge base document.",
    ...(domain ? [`Domain context: ${domain}`] : []),
    "This document is the BRAIN of the business — cover business rules, user flows, data models, AND architecture.",
    "Dig deep into constants, validation, feature flags, pricing, permissions, state machines, error handling.",
    "ONLY state facts directly visible in the source code. NEVER guess or assume. If a section has no supporting data, OMIT it entirely.",
    "",
    style,
    "",
    ONE_SHOT_EXAMPLE,
    "",
    "IMPORTANT: Write DOCUMENTATION, not a code review.",
    "Describe what the code DOES. Do NOT suggest what it SHOULD do.",
    "NEVER write suggestions, recommendations, improvements, or best practices.",
    "Return ONLY the markdown document starting with --- frontmatter. No preamble, no code fences.",
  ].join("\n")
}

export function singlePassPrompt(
  entry: DocEntry,
  currentDoc: string,
  sourceCode: string,
  authorContext: string,
  depGraph?: string,
): string {
  const timestamp = new Date().toISOString()
  return [
    `COMPILE TARGET:`,
    entry.description,
    `Sources: ${entry.sources.join(", ")}`,
    `Timestamp: ${timestamp}`,
    "",
    `## Current documentation (for structural reference)`,
    currentDoc || "(new document — create from scratch)",
    "",
    `## Source code`,
    sourceCode,
    authorContext,
    ...(depGraph ? ["", depGraph] : []),
    "",
    "Now write the complete knowledge base document. Start with the --- frontmatter block.",
  ].join("\n")
}
