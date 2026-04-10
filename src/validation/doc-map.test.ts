import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { validateDocMap } from "./doc-map"

const TMP = join(import.meta.dir, "../.test-tmp-validate")

beforeEach(() => {
  // Create a fake repo structure
  mkdirSync(join(TMP, "docs"), { recursive: true })
  mkdirSync(join(TMP, "src"), { recursive: true })
  writeFileSync(join(TMP, "src/index.ts"), "export const x = 1")
  writeFileSync(join(TMP, "package.json"), "{}")
})

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true })
})

describe("validateDocMap", () => {
  test("valid doc map returns no issues", () => {
    const docMap = {
      docs: {
        "ARCHITECTURE.md": {
          description: "System overview",
          type: "compiled",
          sources: ["src/"],
          context_files: ["package.json"],
        },
      },
    }
    writeFileSync(join(TMP, "docs/.doc-map.json"), JSON.stringify(docMap))
    const issues = validateDocMap(TMP)
    expect(issues).toEqual([])
  })

  test("missing doc-map.json returns error", () => {
    rmSync(join(TMP, "docs"), { recursive: true, force: true })
    mkdirSync(join(TMP, "docs"), { recursive: true })
    const issues = validateDocMap(TMP)
    expect(issues.length).toBe(1)
    expect(issues[0]?.severity).toBe("error")
  })

  test("invalid JSON returns error", () => {
    writeFileSync(join(TMP, "docs/.doc-map.json"), "not json")
    const issues = validateDocMap(TMP)
    expect(issues.length).toBe(1)
    expect(issues[0]?.severity).toBe("error")
  })

  test("missing source directory returns error", () => {
    const docMap = {
      docs: {
        "BAD.md": {
          description: "Bad",
          type: "compiled",
          sources: ["nonexistent/"],
          context_files: [],
        },
      },
    }
    writeFileSync(join(TMP, "docs/.doc-map.json"), JSON.stringify(docMap))
    const issues = validateDocMap(TMP)
    expect(issues.some((i) => i.severity === "error")).toBe(true)
  })

  test("empty description returns warning", () => {
    const docMap = {
      docs: {
        "EMPTY.md": {
          description: "",
          type: "compiled",
          sources: ["src/"],
          context_files: [],
        },
      },
    }
    writeFileSync(join(TMP, "docs/.doc-map.json"), JSON.stringify(docMap))
    const issues = validateDocMap(TMP)
    expect(issues.some((i) => i.severity === "warning")).toBe(true)
  })

  test("empty docs object returns warning", () => {
    writeFileSync(join(TMP, "docs/.doc-map.json"), JSON.stringify({ docs: {} }))
    const issues = validateDocMap(TMP)
    expect(issues.some((i) => i.message.includes("no entries"))).toBe(true)
  })

  test("missing context file returns warning", () => {
    const docMap = {
      docs: {
        "CTX.md": {
          description: "Context test",
          type: "compiled",
          sources: ["src/"],
          context_files: ["nonexistent.md"],
        },
      },
    }
    writeFileSync(join(TMP, "docs/.doc-map.json"), JSON.stringify(docMap))
    const issues = validateDocMap(TMP)
    expect(
      issues.some(
        (i) => i.severity === "warning" && i.message.includes("Context file"),
      ),
    ).toBe(true)
  })
})
