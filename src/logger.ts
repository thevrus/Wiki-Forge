import * as clack from "@clack/prompts"
import ora, { type Ora } from "ora"
import pc from "picocolors"

// ── Branded header ───────────────────────────────────────────────────

export function header(mode: string, provider: string, repo: string): void {
  clack.intro(pc.bgCyan(pc.black(` wiki-forge ${mode} `)))
  clack.log.info(`${pc.dim("provider")}  ${provider}`)
  clack.log.info(`${pc.dim("repo    ")}  ${repo}`)
}

// ── Progress spinner ─────────────────────────────────────────────────

function progressBar(current: number, total: number, width: number): string {
  const filled = Math.round((current / total) * width)
  const empty = width - filled
  return pc.cyan("█".repeat(filled)) + pc.dim("░".repeat(empty))
}

function formatProgress(
  current: number,
  total: number,
  text: string,
  detail?: string,
): string {
  const pct = Math.round((current / total) * 100)
  const bar = progressBar(current, total, 20)
  const counter = pc.dim(`[${current}/${total}]`)
  const detailStr = detail ? pc.dim(` (${detail})`) : ""
  return `${counter} ${bar} ${text}${detailStr} ${pc.dim(`${pct}%`)}`
}

export type CompileSpinner = {
  /** Update the spinner text while LLM is working */
  update: (text: string, detail?: string) => void
  /** Stop with success */
  succeed: (text: string) => void
  /** Stop with failure */
  fail: (text: string) => void
  /** Stop spinner without status */
  stop: () => void
  /** The underlying ora instance */
  spinner: Ora
}

/**
 * Start a compile spinner with progress bar.
 * The spinner animates continuously so the user knows it's not stuck.
 *
 * Usage:
 *   const s = compileProgress(1, 6, "Compiling ARCHITECTURE.md", "590 changed")
 *   // ... LLM call ...
 *   s.succeed("ARCHITECTURE.md (32.1s)")
 */
function formatTime(seconds: number): string {
  if (seconds >= 60) {
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  }
  return `${seconds}s`
}

export function compileProgress(
  current: number,
  total: number,
  text: string,
  detail?: string,
  etaSeconds?: number,
): CompileSpinner {
  const etaStr = etaSeconds
    ? ` · ${pc.yellow(`~${formatTime(Math.round(etaSeconds))} remaining`)}`
    : ""

  const spinner = ora({
    text: formatProgress(current, total, text, detail) + etaStr,
    color: "cyan",
    spinner: "dots",
    discardStdin: false,
  }).start()

  // Update elapsed time every 5 seconds so user knows it's alive
  const startTime = Date.now()
  let currentDetail = detail
  const timer = setInterval(() => {
    const elapsed = Math.round((Date.now() - startTime) / 1000)
    const timeStr = formatTime(elapsed)
    const parts = currentDetail ? `${currentDetail} · ${timeStr}` : timeStr
    spinner.text = formatProgress(current, total, text, parts) + etaStr
  }, 5000)
  // Don't block process exit on Ctrl+C
  if (timer.unref) timer.unref()

  return {
    update(newText: string, newDetail?: string) {
      currentDetail = newDetail
      spinner.text = formatProgress(current, total, newText, newDetail) + etaStr
    },
    succeed(msg: string) {
      clearInterval(timer)
      spinner.succeed(`${pc.dim(`[${current}/${total}]`)} ${msg}`)
    },
    fail(msg: string) {
      clearInterval(timer)
      spinner.fail(`${pc.dim(`[${current}/${total}]`)} ${msg}`)
    },
    stop() {
      clearInterval(timer)
      spinner.stop()
    },
    spinner,
  }
}

// ── Shared compile tracker (single spinner for parallel workers) ─────

export type CompileTracker = {
  /** Register a doc as actively compiling. Returns a handle to update/finish it. */
  start(docPath: string, detail?: string): CompileHandle
  /** Tear down the tracker (stops spinner if running). */
  destroy(): void
}

export type CompileHandle = {
  update(text: string, detail?: string): void
  succeed(msg: string): void
  fail(msg: string): void
}

/**
 * Creates a single shared spinner that tracks multiple parallel compile jobs.
 * Workers call start() to register, then update/succeed/fail on their handle.
 * The spinner always shows overall progress + the most recently updated doc.
 */
export function createCompileTracker(total: number): CompileTracker {
  let completed = 0
  const active = new Map<string, { text: string; detail?: string }>()
  let spinner: Ora | null = null
  const startTime = Date.now()

  let timer: ReturnType<typeof setInterval> | null = null

  function refresh() {
    if (!spinner) return
    const entries = [...active.values()]
    // Show the most recently updated active doc
    const current = entries.length > 0 ? entries[entries.length - 1] : null
    const label = current?.text ?? "Waiting..."
    const detail = current?.detail
    const elapsed = Math.round((Date.now() - startTime) / 1000)
    const timeStr = formatTime(elapsed)
    const extra = active.size > 1 ? pc.dim(` (+${active.size - 1} more)`) : ""
    const detailParts = [detail, timeStr].filter(Boolean).join(" · ")
    spinner.text = formatProgress(completed, total, label, detailParts) + extra
  }

  function ensureSpinner() {
    if (!spinner) {
      spinner = ora({
        text: formatProgress(0, total, "Starting..."),
        color: "cyan",
        spinner: "dots",
        discardStdin: false,
      }).start()
      timer = setInterval(refresh, 5000)
      if (timer.unref) timer.unref()
    }
  }

  function printLine(
    symbol: string,
    color: (s: string) => string,
    msg: string,
  ) {
    // Pause spinner, print static line, resume
    if (spinner) spinner.stop()
    const counter = pc.dim(`[${completed}/${total}]`)
    console.log(`${color(symbol)} ${counter} ${msg}`)
    if (active.size > 0 && spinner) {
      spinner.start()
      refresh()
    }
  }

  return {
    start(docPath: string, detail?: string): CompileHandle {
      ensureSpinner()
      active.set(docPath, { text: docPath, detail })
      refresh()

      return {
        update(text: string, newDetail?: string) {
          active.set(docPath, { text, detail: newDetail })
          refresh()
        },
        succeed(msg: string) {
          active.delete(docPath)
          completed++
          printLine("✔", pc.green, msg)
        },
        fail(msg: string) {
          active.delete(docPath)
          completed++
          printLine("✖", pc.red, msg)
        },
      }
    },
    destroy() {
      if (timer) clearInterval(timer)
      if (spinner) spinner.stop()
      spinner = null
    },
  }
}

// ── Simple spinner (no progress bar) ─────────────────────────────────

export function spin(text: string): Ora {
  return ora({
    text,
    color: "cyan",
    spinner: "dots",
    discardStdin: false,
  }).start()
}

// ── Static progress (for non-spinner use) ────────────────────────────

export function progress(current: number, total: number, text: string): string {
  return formatProgress(current, total, text)
}

// ── Status lines (clack-style) ───────────────────────────────────────

export function success(text: string): void {
  clack.log.success(text)
}

export function warn(text: string): void {
  clack.log.warn(text)
}

export function error(text: string): void {
  clack.log.error(text)
}

export function skip(text: string): void {
  clack.log.info(pc.dim(text))
}

export function drift(text: string): void {
  clack.log.warn(pc.magenta(text))
}

export function info(text: string): void {
  clack.log.info(text)
}

export function message(text: string): void {
  clack.log.message(text)
}

// ── Section headers ──────────────────────────────────────────────────

export function section(title: string): void {
  clack.log.step(pc.bold(title))
}

// ── Summary ──────────────────────────────────────────────────────────

export function summary(lines: string[]): void {
  clack.note(lines.join("\n"), "Summary")
}

// ── Command header / footer ──────────────────────────────────────────

export function intro(text: string): void {
  clack.intro(pc.bgCyan(pc.black(` ${text} `)))
}

export function outro(text: string): void {
  clack.outro(text)
}

// ── Key-value pairs ──────────────────────────────────────────────────

export function keyValue(pairs: Record<string, string>): void {
  const maxKey = Math.max(...Object.keys(pairs).map((k) => k.length))
  for (const [key, value] of Object.entries(pairs)) {
    clack.log.info(`${pc.dim(key.padEnd(maxKey))}  ${value}`)
  }
}

// ── List display ─────────────────────────────────────────────────────

export function list(
  items: Array<{
    label: string
    detail?: string
    status?: "ok" | "warn" | "error" | "dim"
  }>,
): void {
  for (const item of items) {
    const detail = item.detail ? pc.dim(` — ${item.detail}`) : ""
    switch (item.status) {
      case "ok":
        clack.log.success(`${item.label}${detail}`)
        break
      case "warn":
        clack.log.warn(`${item.label}${detail}`)
        break
      case "error":
        clack.log.error(`${item.label}${detail}`)
        break
      case "dim":
        clack.log.info(pc.dim(`${item.label}${detail}`))
        break
      default:
        clack.log.message(`${item.label}${detail}`)
    }
  }
}

// ── Gather report ────────────────────────────────────────────────────

/** Format gather stats as a short string for embedding in spinner text */
export function gatherSummary(
  fileCount: number,
  totalSize: number,
  skipped: number,
): string {
  const sizeKb = Math.round(totalSize / 1024)
  return `${fileCount} files (${sizeKb}KB)${skipped > 0 ? ` · ${skipped} skipped` : ""}`
}

// ── Table display ───────────────────────────────────────────────────

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape stripping
const ANSI_RE = /\x1b\[[0-9;]*m/g

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "")
}

export type TableRow = Record<string, string>

export function table(
  headers: string[],
  rows: TableRow[],
  options?: { highlight?: (row: TableRow) => "ok" | "warn" | "dim" | null },
): void {
  if (rows.length === 0) return

  // Compute column widths
  const widths = headers.map((h) => h.length)
  for (const row of rows) {
    for (let i = 0; i < headers.length; i++) {
      const val = row[headers[i]!] ?? ""
      // Strip ANSI for width calc
      const plain = stripAnsi(val)
      widths[i] = Math.max(widths[i]!, plain.length)
    }
  }

  // Header
  const headerLine = headers
    .map((h, i) => pc.bold(h.padEnd(widths[i]!)))
    .join("  ")
  const sep = widths.map((w) => "─".repeat(w)).join("──")

  clack.log.message(headerLine)
  clack.log.message(pc.dim(sep))

  // Rows
  for (const row of rows) {
    const color = options?.highlight?.(row)
    const cells = headers.map((h, i) => {
      const val = row[h] ?? ""
      const plain = stripAnsi(val)
      const padded = val + " ".repeat(Math.max(0, widths[i]! - plain.length))
      return padded
    })
    let line = cells.join("  ")
    if (color === "dim") line = pc.dim(line)
    else if (color === "warn") line = pc.yellow(line)
    else if (color === "ok") line = pc.green(line)
    clack.log.message(line)
  }
}

/** Print gather warnings (truncated files) — call AFTER spinner stops */
export function gatherWarnings(truncatedFiles: string[]): void {
  if (truncatedFiles.length > 0) {
    warn(
      `${truncatedFiles.length} file(s) truncated: ${pc.dim(truncatedFiles.slice(0, 3).join(", "))}${truncatedFiles.length > 3 ? "..." : ""}`,
    )
  }
}
