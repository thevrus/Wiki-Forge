import { test, expect } from "bun:test"
import { buildDependencyGraph, serializeDependencyGraph } from "./dependency-graph"

test("extracts ES import dependencies", () => {
  const files = [
    { path: "src/app.ts", content: `import { handler } from './handler'\nimport { db } from './db'` },
    { path: "src/handler.ts", content: `import { validate } from './utils/validate'` },
    { path: "src/db.ts", content: `import pg from 'pg'\nconst pool = new pg.Pool()` },
    { path: "src/utils/validate.ts", content: `export function validate() {}` },
  ]

  const graph = buildDependencyGraph(files)

  expect(graph.get("src/app.ts")).toEqual(["src/handler.ts", "src/db.ts"])
  expect(graph.get("src/handler.ts")).toEqual(["src/utils/validate.ts"])
  expect(graph.has("src/db.ts")).toBe(false) // pg is external
  expect(graph.has("src/utils/validate.ts")).toBe(false) // no imports
})

test("extracts require() dependencies", () => {
  const files = [
    { path: "src/index.js", content: `const router = require('./router')` },
    { path: "src/router.js", content: `module.exports = {}` },
  ]

  const graph = buildDependencyGraph(files)
  expect(graph.get("src/index.js")).toEqual(["src/router.js"])
})

test("extracts dynamic import() dependencies", () => {
  const files = [
    { path: "src/cli.ts", content: `const mod = await import('./commands/init')` },
    { path: "src/commands/init.ts", content: `export async function runInit() {}` },
  ]

  const graph = buildDependencyGraph(files)
  expect(graph.get("src/cli.ts")).toEqual(["src/commands/init.ts"])
})

test("resolves index files", () => {
  const files = [
    { path: "src/app.ts", content: `import { createProviders } from './providers'` },
    { path: "src/providers/index.ts", content: `export function createProviders() {}` },
  ]

  const graph = buildDependencyGraph(files)
  expect(graph.get("src/app.ts")).toEqual(["src/providers/index.ts"])
})

test("ignores external packages", () => {
  const files = [
    { path: "src/app.ts", content: `import express from 'express'\nimport { z } from 'zod'\nimport { handler } from './handler'` },
    { path: "src/handler.ts", content: `export function handler() {}` },
  ]

  const graph = buildDependencyGraph(files)
  expect(graph.get("src/app.ts")).toEqual(["src/handler.ts"])
})

test("deduplicates imports", () => {
  const files = [
    { path: "src/app.ts", content: `import { a } from './util'\nimport { b } from './util'` },
    { path: "src/util.ts", content: `export const a = 1; export const b = 2;` },
  ]

  const graph = buildDependencyGraph(files)
  expect(graph.get("src/app.ts")).toEqual(["src/util.ts"])
})

test("serializes graph as readable text", () => {
  const files = [
    { path: "src/a.ts", content: `import { b } from './b'` },
    { path: "src/b.ts", content: `export const b = 1` },
  ]

  const graph = buildDependencyGraph(files)
  const text = serializeDependencyGraph(graph)

  expect(text).toContain("## Module Dependencies")
  expect(text).toContain("src/a.ts → src/b.ts")
})

test("returns empty string for no dependencies", () => {
  const files = [
    { path: "src/a.ts", content: `export const a = 1` },
  ]

  const graph = buildDependencyGraph(files)
  const text = serializeDependencyGraph(graph)

  expect(text).toBe("")
})

test("handles re-exports", () => {
  const files = [
    { path: "src/index.ts", content: `export { handler } from './handler'` },
    { path: "src/handler.ts", content: `export function handler() {}` },
  ]

  const graph = buildDependencyGraph(files)
  expect(graph.get("src/index.ts")).toEqual(["src/handler.ts"])
})
