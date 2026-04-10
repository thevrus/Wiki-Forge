#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { parseArgs } from "./config"
import { createSources, type WikiSource } from "./sources"
import { handleSearch } from "./tools/search"
import { handleStatus } from "./tools/status"
import { handleWho } from "./tools/who"
import { handleWhy } from "./tools/why"

const config = parseArgs(process.argv.slice(2))
const sources: WikiSource[] = createSources(config.repos)

const server = new McpServer({
  name: "wiki-forge",
  version: "0.1.0",
})

// ── Tools ────────────────────────────────────────────────────────────
// @ts-expect-error — MCP SDK overload resolution hits TS recursion limit with Zod v3.25
server.tool(
  "wiki_forge_why",
  "Returns decision context for a source file — why it exists in its current form, " +
    "linked PRs/tickets, non-obvious patterns, and who has context.",
  {
    file: z
      .string()
      .describe("Path to the source file (e.g. src/payments/stripe.ts)"),
  },
  async ({ file }) => ({
    content: [{ type: "text" as const, text: await handleWhy(sources, file) }],
  }),
)

server.tool(
  "wiki_forge_who",
  "Returns context holders for a file or directory — who wrote this code, " +
    "ownership percentages, last active dates, and bus factor warnings.",
  {
    file: z
      .string()
      .describe("Path to a file or directory (e.g. src/payments/)"),
  },
  async ({ file }) => ({
    content: [{ type: "text" as const, text: await handleWho(sources, file) }],
  }),
)

server.tool(
  "wiki_forge_search",
  "Searches across all compiled wiki pages for a topic, feature, or keyword. " +
    "Returns matching pages with excerpts. No LLM calls — just text search.",
  {
    query: z
      .string()
      .describe("Search query (e.g. 'payment retry' or 'auth flow')"),
  },
  async ({ query }) => ({
    content: [
      { type: "text" as const, text: await handleSearch(sources, query) },
    ],
  }),
)

server.tool(
  "wiki_forge_status",
  "Returns the wiki health dashboard — coverage metrics, knowledge risk, " +
    "bus factor analysis, and action items.",
  async () => ({
    content: [{ type: "text" as const, text: await handleStatus(sources) }],
  }),
)

// ── Start ────────────────────────────────────────────────────────────

const transport = new StdioServerTransport()
await server.connect(transport)
