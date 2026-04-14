// Detect prompt-injection patterns in source content before it is embedded
// in a compile prompt. Detect-only — legitimate files (security tests, this
// file, docs *about* injection) can contain these patterns.

export type InjectionFinding = {
  file: string
  pattern: string
  line: number
  snippet: string
}

const INJECTION_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  {
    name: "ignore-instructions",
    regex: /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  },
  {
    name: "disregard-instructions",
    regex:
      /disregard\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts)/i,
  },
  { name: "new-instructions", regex: /^\s*new\s+instructions\s*:/im },
  {
    name: "system-prompt-override",
    regex: /^\s*(system|assistant)\s*:\s*you\s+are/im,
  },
  { name: "role-reassignment", regex: /you\s+are\s+now\s+(a|an)\s+/i },
  {
    name: "delimiter-injection",
    regex: /<\|(im_start|im_end|endoftext|system)\|>/i,
  },
  {
    name: "fake-source-boundary",
    regex: /^---\s+[^\n]+\.(ts|js|tsx|jsx|py|rb|go|rs|java|md)\s+---\s*$/im,
  },
  {
    name: "prompt-tag-injection",
    regex: /<\/?(system|user|assistant|prompt|instructions)>/i,
  },
]

const MAX_SNIPPET_LEN = 120

export function scanForInjection(
  file: string,
  content: string,
): InjectionFinding[] {
  const findings: InjectionFinding[] = []

  for (const { name, regex } of INJECTION_PATTERNS) {
    const match = content.match(regex)
    if (!match || match.index == null) continue

    const line = content.slice(0, match.index).split("\n").length
    const rawSnippet = match[0].trim()
    const snippet =
      rawSnippet.length > MAX_SNIPPET_LEN
        ? `${rawSnippet.slice(0, MAX_SNIPPET_LEN)}…`
        : rawSnippet

    findings.push({ file, pattern: name, line, snippet })
  }

  return findings
}
