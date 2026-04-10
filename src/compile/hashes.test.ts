import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import {
  diffHashes,
  hashContent,
  loadHashes,
  saveHashes,
  updateHashesForDoc,
} from "./hashes"

const TMP = join(import.meta.dir, "../.test-tmp")

beforeEach(() => {
  mkdirSync(TMP, { recursive: true })
})

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true })
})

describe("hashContent", () => {
  test("returns a 16-char hex string", () => {
    const hash = hashContent("hello world")
    expect(hash).toHaveLength(16)
    expect(hash).toMatch(/^[0-9a-f]+$/)
  })

  test("same input produces same hash", () => {
    expect(hashContent("test")).toBe(hashContent("test"))
  })

  test("different input produces different hash", () => {
    expect(hashContent("a")).not.toBe(hashContent("b"))
  })
})

describe("diffHashes", () => {
  test("no changes when identical", () => {
    const hashes = { "a.ts": "abc123", "b.ts": "def456" }
    const result = diffHashes(hashes, hashes)
    expect(result.changed).toBe(false)
    expect(result.changedFiles).toEqual([])
    expect(result.addedFiles).toEqual([])
    expect(result.removedFiles).toEqual([])
  })

  test("detects changed files", () => {
    const prev = { "a.ts": "abc123" }
    const curr = { "a.ts": "xyz789" }
    const result = diffHashes(prev, curr)
    expect(result.changed).toBe(true)
    expect(result.changedFiles).toEqual(["a.ts"])
  })

  test("detects added files", () => {
    const prev = { "a.ts": "abc123" }
    const curr = { "a.ts": "abc123", "b.ts": "new" }
    const result = diffHashes(prev, curr)
    expect(result.changed).toBe(true)
    expect(result.addedFiles).toEqual(["b.ts"])
    expect(result.changedFiles).toEqual([])
  })

  test("detects removed files", () => {
    const prev = { "a.ts": "abc123", "b.ts": "def456" }
    const curr = { "a.ts": "abc123" }
    const result = diffHashes(prev, curr)
    expect(result.changed).toBe(true)
    expect(result.removedFiles).toEqual(["b.ts"])
  })

  test("detects all change types at once", () => {
    const prev = { "a.ts": "old", "b.ts": "keep", "c.ts": "gone" }
    const curr = { "a.ts": "new", "b.ts": "keep", "d.ts": "added" }
    const result = diffHashes(prev, curr)
    expect(result.changed).toBe(true)
    expect(result.changedFiles).toEqual(["a.ts"])
    expect(result.addedFiles).toEqual(["d.ts"])
    expect(result.removedFiles).toEqual(["c.ts"])
  })

  test("empty to populated is all added", () => {
    const result = diffHashes({}, { "a.ts": "hash" })
    expect(result.changed).toBe(true)
    expect(result.addedFiles).toEqual(["a.ts"])
  })

  test("populated to empty is all removed", () => {
    const result = diffHashes({ "a.ts": "hash" }, {})
    expect(result.changed).toBe(true)
    expect(result.removedFiles).toEqual(["a.ts"])
  })

  test("both empty means no changes", () => {
    const result = diffHashes({}, {})
    expect(result.changed).toBe(false)
  })
})

describe("updateHashesForDoc", () => {
  test("adds new doc hashes", () => {
    const all = { "A.md": { "a.ts": "hash1" } }
    const result = updateHashesForDoc(all, "B.md", { "b.ts": "hash2" })
    expect(result["A.md"]).toEqual({ "a.ts": "hash1" })
    expect(result["B.md"]).toEqual({ "b.ts": "hash2" })
  })

  test("replaces existing doc hashes", () => {
    const all = { "A.md": { "a.ts": "old" } }
    const result = updateHashesForDoc(all, "A.md", { "a.ts": "new" })
    expect(result["A.md"]).toEqual({ "a.ts": "new" })
  })

  test("mutates in place for concurrency safety", () => {
    const all = { "A.md": { "a.ts": "hash1" } }
    const result = updateHashesForDoc(all, "B.md", { "b.ts": "hash2" })
    expect(result).toBe(all) // same reference
    expect((all as Record<string, unknown>)["B.md"]).toEqual({
      "b.ts": "hash2",
    })
  })
})

describe("loadHashes / saveHashes", () => {
  test("returns empty object when no file exists", () => {
    const result = loadHashes(TMP)
    expect(result).toEqual({})
  })

  test("round-trips through save and load", () => {
    const hashes = {
      "ARCH.md": { "src/a.ts": "abc123", "src/b.ts": "def456" },
      "DATA.md": { "src/c.ts": "ghi789" },
    }
    saveHashes(TMP, hashes)
    const loaded = loadHashes(TMP)
    expect(loaded).toEqual(hashes)
  })

  test("saved file is valid JSON with hashes key", () => {
    saveHashes(TMP, { "A.md": { "x.ts": "hash" } })
    const raw = readFileSync(join(TMP, ".doc-hashes.json"), "utf-8")
    const parsed = JSON.parse(raw)
    expect(parsed.hashes).toBeDefined()
    expect(parsed.hashes["A.md"]).toEqual({ "x.ts": "hash" })
  })
})
