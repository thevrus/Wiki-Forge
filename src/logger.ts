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

// ── Spinners ─────────────────────────────────────────────────────────

export function spin(text: string): Ora {
  return ora({ text, color: "cyan" }).start()
}

// ── Progress ─────────────────────────────────────────────────────────

export function progress(current: number, total: number, text: string): string {
  const pct = Math.round((current / total) * 100)
  const bar = progressBar(current, total, 20)
  return `${pc.dim(`[${current}/${total}]`)} ${bar} ${text} ${pc.dim(`${pct}%`)}`
}

function progressBar(current: number, total: number, width: number): string {
  const filled = Math.round((current / total) * width)
  const empty = width - filled
  return pc.cyan("█".repeat(filled)) + pc.dim("░".repeat(empty))
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
