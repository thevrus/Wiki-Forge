import { describe, expect, test } from "bun:test"
import { extractClaims, verifyClaims, verifyDocClaims } from "./claims"

describe("extractClaims", () => {
  test("extracts backtick-quoted identifiers", () => {
    const doc = `---
title: "Test"
slug: test
category: compiled
description: "Test"
---

## Overview

The system uses \`handleBooking()\` to create appointments.
The constant \`SLOT_DURATION_MIN = 30\` defines time slots.`
    const claims = extractClaims(doc)
    expect(claims).toContain("handleBooking")
    expect(claims).toContain("SLOT_DURATION_MIN = 30")
  })

  test("skips content inside code blocks", () => {
    const doc = `---
title: "Test"
slug: test
category: compiled
description: "Test"
---

## Overview

Uses \`realClaim\` in the codebase.

\`\`\`typescript
const insideCodeBlock = "should not be extracted"
\`\`\`
`
    const claims = extractClaims(doc)
    expect(claims).toContain("realClaim")
    expect(claims).not.toContain("insideCodeBlock")
  })

  test("ignores common keywords", () => {
    const doc = `---
title: "Test"
slug: test
category: compiled
description: "Test"
---

## Overview

Returns \`true\` or \`false\`. Uses \`async\` functions with \`string\` type.
The \`BookingService\` handles requests.`
    const claims = extractClaims(doc)
    expect(claims).not.toContain("true")
    expect(claims).not.toContain("false")
    expect(claims).not.toContain("async")
    expect(claims).not.toContain("string")
    expect(claims).toContain("BookingService")
  })

  test("deduplicates claims", () => {
    const doc = `---
title: "Test"
slug: test
category: compiled
description: "Test"
---

## Overview

The \`BookingService\` manages bookings. The \`BookingService\` also handles cancellations.`
    const claims = extractClaims(doc)
    expect(claims.filter((c) => c === "BookingService")).toHaveLength(1)
  })

  test("strips trailing () from function calls", () => {
    const doc = `---
title: "Test"
slug: test
category: compiled
description: "Test"
---

## Overview

Call \`processPayment()\` to charge the customer.`
    const claims = extractClaims(doc)
    expect(claims).toContain("processPayment")
    expect(claims).not.toContain("processPayment()")
  })

  test("extracts file paths", () => {
    const doc = `---
title: "Test"
slug: test
category: compiled
description: "Test"
---

## Architecture

The main router is in \`src/routers/auth.ts\`.`
    const claims = extractClaims(doc)
    expect(claims).toContain("src/routers/auth.ts")
  })

  test("skips backtick tokens inside markdown tables", () => {
    const doc = `---
title: "Test"
slug: test
category: compiled
description: "Test"
---

## Dependencies

| Dependency | Why | Risk |
| :--- | :--- | :--- |
| \`expo-router\` | Manages navigation | High |
| \`expo-image-picker\` | Photo selection | Medium |

The \`BookingService\` handles requests.`
    const claims = extractClaims(doc)
    expect(claims).not.toContain("expo-router")
    expect(claims).not.toContain("expo-image-picker")
    expect(claims).toContain("BookingService")
  })

  test("returns empty array for doc with no backticks", () => {
    const doc = `---
title: "Test"
slug: test
category: compiled
description: "Test"
---

## Overview

This document has no code references at all.`
    const claims = extractClaims(doc)
    expect(claims).toEqual([])
  })
})

describe("verifyClaims", () => {
  const source = `
--- src/booking.ts ---
export function handleBooking(data: BookingData) {
  const SLOT_DURATION_MIN = 30
  return createAppointment(data)
}

--- src/auth.ts ---
export class AuthService {
  validateToken(token: string) { return true }
}
`

  test("verifies claims that exist in source", () => {
    const result = verifyClaims(
      ["handleBooking", "SLOT_DURATION_MIN", "AuthService"],
      source,
    )
    expect(result.verified).toBe(3)
    expect(result.unverified).toEqual([])
    expect(result.score).toBe(1)
  })

  test("identifies unverified claims", () => {
    const result = verifyClaims(
      ["handleBooking", "NonExistentFunction", "FAKE_CONSTANT"],
      source,
    )
    expect(result.verified).toBe(1)
    expect(result.unverified).toContain("NonExistentFunction")
    expect(result.unverified).toContain("FAKE_CONSTANT")
    expect(result.score).toBeCloseTo(1 / 3, 2)
  })

  test("returns score 1 for empty claims", () => {
    const result = verifyClaims([], source)
    expect(result.score).toBe(1)
    expect(result.total).toBe(0)
  })

  test("matches file paths by filename", () => {
    const result = verifyClaims(["src/booking.ts"], source)
    expect(result.verified).toBe(1)
  })
})

describe("verifyDocClaims", () => {
  test("end-to-end: extracts and verifies", () => {
    const doc = `---
title: "Booking"
slug: booking
category: compiled
description: "Booking system"
---

## Business Rules

The \`handleBooking()\` function creates appointments with \`SLOT_DURATION_MIN = 30\` minute slots.
Uses \`FakeInventedThing\` for processing.`

    const source = `
export function handleBooking() {}
const SLOT_DURATION_MIN = 30
`
    const result = verifyDocClaims(doc, source)
    expect(result.total).toBe(3)
    expect(result.verified).toBe(2)
    expect(result.unverified).toContain("FakeInventedThing")
    expect(result.score).toBeCloseTo(2 / 3, 2)
  })
})
