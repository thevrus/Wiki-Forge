import ora, { type Ora } from "ora"
import pc from "picocolors"

// ── Branded header ───────────────────────────────────────────────────

export function header(mode: string, provider: string, repo: string): void {
  console.log()
  console.log(
    `${pc.bold(pc.cyan("wiki-forge"))} ${pc.dim("·")} ${pc.white(mode)}`,
  )
  console.log(`${pc.dim("provider")} ${provider}`)
  console.log(`${pc.dim("repo    ")} ${repo}`)
  console.log()
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

  function printLine(symbol: string, color: (s: string) => string, msg: string) {
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
  return ora({ text, color: "cyan", spinner: "dots", discardStdin: false }).start()
}

// ── Static progress (for non-spinner use) ────────────────────────────

export function progress(current: number, total: number, text: string): string {
  return formatProgress(current, total, text)
}

// ── Status lines ─────────────────────────────────────────────────────

export function success(text: string): void {
  console.log(`  ${pc.green("✓")} ${text}`)
}

export function warn(text: string): void {
  console.log(`  ${pc.yellow("⚠")} ${text}`)
}

export function error(text: string): void {
  console.log(`  ${pc.red("✗")} ${text}`)
}

export function skip(text: string): void {
  console.log(`  ${pc.dim("⏭")} ${pc.dim(text)}`)
}

export function drift(text: string): void {
  console.log(`  ${pc.magenta("⚡")} ${text}`)
}

export function info(text: string): void {
  console.log(`  ${pc.dim("·")} ${text}`)
}

// ── Section headers ──────────────────────────────────────────────────

export function section(title: string): void {
  console.log()
  console.log(`  ${pc.bold(pc.white(title))}`)
}

// ── Summary ──────────────────────────────────────────────────────────

export function summary(lines: string[]): void {
  console.log()
  console.log(pc.dim("  ─".repeat(20)))
  for (const line of lines) {
    console.log(`  ${line}`)
  }
  console.log()
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

/** Print gather warnings (truncated files) — call AFTER spinner stops */
export function gatherWarnings(truncatedFiles: string[]): void {
  if (truncatedFiles.length > 0) {
    warn(
      `${truncatedFiles.length} file(s) truncated: ${pc.dim(truncatedFiles.slice(0, 3).join(", "))}${truncatedFiles.length > 3 ? "..." : ""}`,
    )
  }
}
