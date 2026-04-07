import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { DocMapSchema, loadDocMap, resolveConfig } from "./config"

const TMP = join(import.meta.dir, "../.test-tmp-config")

beforeEach(() => {
  mkdirSync(TMP, { recursive: true })
})

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true })
})

describe("DocMapSchema", () => {
  test("parses valid doc map", () => {
    const input = {
      docs: {
        "ARCHITECTURE.md": {
          description: "System overview",
          type: "compiled",
          sources: ["src/"],
          context_files: ["package.json"],
        },
      },
    }
    const result = DocMapSchema.parse(input)
    expect(result.docs["ARCHITECTURE.md"]?.type).toBe("compiled")
    expect(result.docs["ARCHITECTURE.md"]?.sources).toEqual(["src/"])
  })

  test("parses health-check type", () => {
    const input = {
      docs: {
        "DECISIONS.md": {
          description: "ADRs",
          type: "health-check",
          sources: ["brain/DECISIONS/"],
          context_files: [],
        },
      },
    }
    const result = DocMapSchema.parse(input)
    expect(result.docs["DECISIONS.md"]?.type).toBe("health-check")
  })

  test("rejects invalid type", () => {
    const input = {
      docs: {
        "BAD.md": {
          description: "Bad",
          type: "invalid",
          sources: [],
          context_files: [],
        },
      },
    }
    expect(() => DocMapSchema.parse(input)).toThrow()
  })

  test("rejects missing required fields", () => {
    const input = {
      docs: {
        "BAD.md": {
          description: "Missing sources",
          type: "compiled",
        },
      },
    }
    expect(() => DocMapSchema.parse(input)).toThrow()
  })

  test("accepts optional style field", () => {
    const input = {
      docs: {},
      style: "Write in pirate speak",
    }
    const result = DocMapSchema.parse(input)
    expect(result.style).toBe("Write in pirate speak")
  })
})

describe("loadDocMap", () => {
  test("loads and parses a valid doc map file", () => {
    const docMap = {
      docs: {
        "TEST.md": {
          description: "Test doc",
          type: "compiled",
          sources: ["src/"],
          context_files: [],
        },
      },
    }
    const path = join(TMP, ".doc-map.json")
    writeFileSync(path, JSON.stringify(docMap))
    const result = loadDocMap(path)
    expect(result.docs["TEST.md"]?.description).toBe("Test doc")
  })

  test("throws on invalid JSON", () => {
    const path = join(TMP, "bad.json")
    writeFileSync(path, "not json")
    expect(() => loadDocMap(path)).toThrow()
  })

  test("throws on missing file", () => {
    expect(() => loadDocMap(join(TMP, "nonexistent.json"))).toThrow()
  })
})

describe("resolveConfig", () => {
  test("uses provided repoRoot and docsDir", () => {
    const config = resolveConfig("/fake/repo", "/fake/repo/wiki")
    expect(config.repoRoot).toBe("/fake/repo")
    expect(config.docsDir).toBe("/fake/repo/wiki")
    expect(config.docMapPath).toBe("/fake/repo/wiki/.doc-map.json")
    expect(config.lastSyncPath).toBe("/fake/repo/wiki/.last-sync")
  })

  test("defaults docsDir to {repoRoot}/docs", () => {
    const config = resolveConfig("/fake/repo")
    expect(config.docsDir).toBe("/fake/repo/docs")
  })
})
