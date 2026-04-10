/**
 * Deterministic post-LLM validation: extract backtick-quoted identifiers
 * from compiled docs and verify they exist in the source code.
 */

import matter from "gray-matter"

export type ClaimResult = {
  /** Total backtick-quoted identifiers found in the doc body */
  total: number
  /** Identifiers that were found in the source code */
  verified: number
  /** Identifiers that could NOT be found in the source */
  unverified: string[]
  /** Ratio of verified to total (0-1). 1 = all claims verified. */
  score: number
}

/** Tokens to ignore — common markdown/code artifacts, not real claims */
const IGNORE = new Set([
  "true", "false", "null", "undefined", "string", "number", "boolean",
  "object", "any", "void", "never", "unknown",
  "GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS",
  "async", "await", "import", "export", "default", "const", "let", "var",
  "function", "class", "interface", "type", "enum", "return",
  "if", "else", "for", "while", "switch", "case", "break", "continue",
  "pending", "confirmed", "completed", "cancelled", "active", "inactive",
  "Yes", "No", "yes", "no",
])

/** Minimum length for a token to be considered a claim */
const MIN_TOKEN_LENGTH = 3

/**
 * Extract backtick-quoted tokens from markdown body.
 * Skips code blocks (``` ... ```) and only looks at inline backticks.
 */
export function extractClaims(markdown: string): string[] {
  const { content: body } = matter(markdown)

  // Remove code blocks first so we don't extract from them
  const withoutCodeBlocks = body.replace(/```[\s\S]*?```/g, "")

  // Match inline backtick content
  const matches = withoutCodeBlocks.match(/`([^`]+)`/g) ?? []

  const seen = new Set<string>()
  const claims: string[] = []

  for (const match of matches) {
    const token = match.slice(1, -1).trim()

    // Skip empty, too short, or ignored tokens
    if (token.length < MIN_TOKEN_LENGTH) continue
    if (IGNORE.has(token)) continue

    // Skip pure numbers, operators, or punctuation
    if (/^[\d.+\-*/%=<>!&|^~?:,;()[\]{}]+$/.test(token)) continue

    // Normalize: strip trailing () for function calls
    const normalized = token.replace(/\(\)$/, "")
    if (normalized.length < MIN_TOKEN_LENGTH) continue

    // Deduplicate
    if (seen.has(normalized)) continue
    seen.add(normalized)

    claims.push(normalized)
  }

  return claims
}

/**
 * Verify extracted claims against source code content.
 * Returns verification results with score.
 */
export function verifyClaims(
  claims: string[],
  sourceContent: string,
): ClaimResult {
  if (claims.length === 0) {
    return { total: 0, verified: 0, unverified: [], score: 1 }
  }

  const unverified: string[] = []
  let verified = 0

  for (const claim of claims) {
    // Check if the claim appears anywhere in the source code
    if (sourceContent.includes(claim)) {
      verified++
    } else {
      // Try common variations: snake_case ↔ camelCase won't match,
      // but partial matches (e.g. "handleBooking" in "handleBookingRequest") should
      const found = sourceContent.includes(claim.split("/").pop()!) // try filename only for paths
        || sourceContent.includes(claim.split(".").pop()!) // try extension-stripped
      if (found && claim.includes("/")) {
        verified++ // file path with matching filename
      } else {
        unverified.push(claim)
      }
    }
  }

  return {
    total: claims.length,
    verified,
    unverified,
    score: claims.length > 0 ? verified / claims.length : 1,
  }
}

/**
 * Full pipeline: extract claims from a compiled doc and verify against source.
 */
export function verifyDocClaims(
  compiledDoc: string,
  sourceContent: string,
): ClaimResult {
  const claims = extractClaims(compiledDoc)
  return verifyClaims(claims, sourceContent)
}
