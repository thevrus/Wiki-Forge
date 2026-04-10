import { describe, expect, test } from "bun:test"
import { validateCompiledOutput } from "./output"

const VALID_DOC = `---
title: "Test Doc"
slug: test-doc
category: compiled
description: "A test document for validation"
sources: ["src/"]
compiled_at: "2026-04-07T00:00:00Z"
---

## Overview

This is a valid compiled document with enough content to pass validation checks.
It has proper frontmatter and a reasonable body length.`

describe("validateCompiledOutput", () => {
  test("accepts valid doc with all frontmatter", () => {
    const result = validateCompiledOutput(VALID_DOC)
    expect(result.valid).toBe(true)
    expect(result.warnings).toEqual([])
  })

  test("strips markdown code fences wrapping the output", () => {
    const wrapped = "```markdown\n" + VALID_DOC + "\n```"
    const result = validateCompiledOutput(wrapped)
    expect(result.valid).toBe(true)
    expect(result.cleaned).not.toContain("```markdown")
  })

  test("strips yaml code fences wrapping the output", () => {
    const wrapped = "```yaml\n" + VALID_DOC + "\n```"
    const result = validateCompiledOutput(wrapped)
    expect(result.valid).toBe(true)
    expect(result.cleaned).not.toContain("```yaml")
  })

  test("rejects doc with missing frontmatter", () => {
    const noFrontmatter =
      "## Just a heading\n\nSome content here that is long enough to pass."
    const result = validateCompiledOutput(noFrontmatter)
    expect(result.valid).toBe(false)
    expect(result.warnings).toContain("Missing YAML frontmatter (---)")
  })

  test("warns on missing required fields", () => {
    const partialFrontmatter = `---
title: "Test"
---

## Overview

This document has partial frontmatter, missing slug, category, and description fields.`
    const result = validateCompiledOutput(partialFrontmatter)
    expect(result.warnings.some((w) => w.includes("slug"))).toBe(true)
    expect(result.warnings.some((w) => w.includes("category"))).toBe(true)
    expect(result.warnings.some((w) => w.includes("description"))).toBe(true)
  })

  test("rejects suspiciously short body", () => {
    const shortBody = `---
title: "Test"
slug: test
category: compiled
description: "Test"
---

Short.`
    const result = validateCompiledOutput(shortBody)
    expect(result.valid).toBe(false)
    expect(result.warnings.some((w) => w.includes("suspiciously short"))).toBe(
      true,
    )
  })

  test("rejects LLM refusal responses", () => {
    const refusal = `---
title: "Test"
slug: test
category: compiled
description: "Test"
---

## Overview

I don't have access to the source code, so I cannot generate documentation for this project.
Please provide the actual source files.`
    const result = validateCompiledOutput(refusal)
    expect(result.valid).toBe(false)
    expect(result.warnings.some((w) => w.includes("LLM refusal"))).toBe(true)
  })

  test("rejects 'no changes detected' from diff recompile", () => {
    const noChanges = `---
title: "Test"
slug: test
category: compiled
description: "Test"
---

## Overview

*(No changes detected in the source code or diff. The document structure and content remain unchanged.)*`
    const result = validateCompiledOutput(noChanges)
    expect(result.valid).toBe(false)
    expect(result.warnings.some((w) => w.includes("no changes detected"))).toBe(
      true,
    )
  })

  test("rejects doc with no ## sections", () => {
    const noSections = `---
title: "Test"
slug: test
category: compiled
description: "Test"
---

This document has no sections at all, just a paragraph. It provides a high-level overview of the system architecture and shared dependencies used across the monorepo.`
    const result = validateCompiledOutput(noSections)
    expect(result.valid).toBe(false)
    expect(result.warnings.some((w) => w.includes("no ## sections"))).toBe(true)
  })

  test("warns on invalid Mermaid diagram type", () => {
    const badMermaid =
      VALID_DOC + "\n\n```mermaid\ninvalidDiagram\n  A --> B\n```"
    const result = validateCompiledOutput(badMermaid)
    expect(result.warnings.some((w) => w.includes("Mermaid"))).toBe(true)
  })

  test("accepts valid Mermaid diagrams", () => {
    const goodMermaid =
      VALID_DOC + "\n\n```mermaid\nflowchart TD\n  A --> B\n```"
    const result = validateCompiledOutput(goodMermaid)
    expect(result.warnings.filter((w) => w.includes("Mermaid"))).toEqual([])
  })

  test("rejects code-review output instead of documentation", () => {
    const codeReview = `---
title: "Test"
slug: test
category: compiled
description: "Test"
---

## High-Level Analysis

The codebase demonstrates good separation of concerns.

### State Management
**Suggestion:** Consider using Zustand for global state.

### Performance
**Improvement:** Use React.memo to prevent unnecessary re-renders.

### Summary Checklist
| Area | Recommendation | Priority |
| State | Implement Zustand | High |`
    const result = validateCompiledOutput(codeReview)
    expect(result.valid).toBe(false)
    expect(result.warnings.some((w) => w.includes("code review"))).toBe(true)
  })

  test("allows single review-like word without rejection", () => {
    const doc = `---
title: "Config"
slug: config
category: compiled
description: "Configuration docs"
---

## Overview

The config module validates user input. The team's suggestion was to use Zod for schema validation, which is now implemented.`
    const result = validateCompiledOutput(doc)
    expect(result.valid).toBe(true)
  })

  test("warns on placeholder phrases", () => {
    const doc = `---
title: "Test"
slug: test
category: compiled
description: "Test"
---

## Architecture
The codebase uses Express for routing and Prisma for data access.

## Business Rules
No specific business rules were found in the provided source code.`
    const result = validateCompiledOutput(doc)
    expect(result.valid).toBe(true)
    expect(result.warnings.some((w) => w.includes("placeholder"))).toBe(true)
  })

  test("warns when no section has substantial content", () => {
    const shallow = `---
title: "Test"
slug: test
category: compiled
description: "Test"
---

## Overview
Short overview.

## Architecture
Uses Express.`
    const result = validateCompiledOutput(shallow)
    expect(result.valid).toBe(true)
    expect(result.warnings.some((w) => w.includes("substantial"))).toBe(true)
  })

  test("missing fields are warnings, not rejections, if body is fine", () => {
    const missingSlug = `---
title: "Test Doc"
category: compiled
description: "A test doc"
---

## Overview

This document is valid but missing the slug field in frontmatter. It should still be accepted with real content.`
    const result = validateCompiledOutput(missingSlug)
    expect(result.valid).toBe(true)
    expect(result.warnings.some((w) => w.includes("slug"))).toBe(true)
  })
})
