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
export function compileProgress(
  current: number,
  total: number,
  text: string,
  detail?: string,
): CompileSpinner {
  const spinner = ora({
    text: formatProgress(current, total, text, detail),
    color: "cyan",
    spinner: "dots",
  }).start()

  // Update elapsed time every 5 seconds so user knows it's alive
  const startTime = Date.now()
  const timer = setInterval(() => {
    const elapsed = Math.round((Date.now() - startTime) / 1000)
    const timeStr =
      elapsed >= 60
        ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
        : `${elapsed}s`
    spinner.text = formatProgress(
      current,
      total,
      text,
      detail ? `${detail} · ${timeStr}` : timeStr,
    )
  }, 5000)

  return {
    update(newText: string, newDetail?: string) {
      spinner.text = formatProgress(current, total, newText, newDetail)
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

// ── Simple spinner (no progress bar) ─────────────────────────────────

export function spin(text: string): Ora {
  return ora({ text, color: "cyan", spinner: "dots" }).start()
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

export function gatherReport(
  fileCount: number,
  totalSize: number,
  truncatedFiles: string[],
  skipped: number,
): void {
  const sizeKb = Math.round(totalSize / 1024)
  info(
    `${pc.cyan(`${fileCount}`)} files read ${pc.dim(`(${sizeKb}KB)`)}${skipped > 0 ? pc.dim(` · ${skipped} skipped`) : ""}`,
  )
  if (truncatedFiles.length > 0) {
    warn(
      `${truncatedFiles.length} file(s) truncated: ${pc.dim(truncatedFiles.slice(0, 3).join(", "))}${truncatedFiles.length > 3 ? "..." : ""}`,
    )
  }
}
