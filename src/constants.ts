// ── LLM Settings ─────────────────────────────────────────────────────

/** Temperature for all LLM calls. 0 = deterministic, no creativity. */
export const LLM_TEMPERATURE = 0

/** Max output tokens for LLM responses. */
export const LLM_MAX_TOKENS = 65_536

// ── Source Gathering ─────────────────────────────────────────────────

/** Max bytes per individual source file before truncation. */
export const SOURCE_FILE_CAP = 30_000

/** Max total bytes of all source files combined per doc. ~400KB ≈ 100K tokens, fits 128K context models. */
export const SOURCE_TOTAL_CAP = 400_000

/** Target max bytes per doc during init. Docs above this produce shallow output. */
export const SOURCE_BUDGET = 200_000

/** Min total bytes of source to attempt compilation. Below this the LLM just parrots metadata. */
export const SOURCE_MIN_USEFUL = 1_000

/** Max bytes for a git diff payload. */
export const DIFF_CAP = 100_000

// ── Compilation Concurrency ──────────────────────────────────────────

/** Max docs compiled in parallel for cloud providers (Claude, Gemini, OpenAI). */
export const DOC_CONCURRENCY_CLOUD = 3

/** Max docs compiled in parallel for Ollama. */
export const DOC_CONCURRENCY_OLLAMA = 2

/** Below this total source size (bytes), skip triage and stuff source directly into one LLM call. */
export const STUFF_THRESHOLD = 50_000

// ── Ollama ───────────────────────────────────────────────────────────

/** Timeout in minutes for Ollama requests (large context = slow). */
export const OLLAMA_TIMEOUT_MINUTES = 30

// ── Excluded Patterns ────────────────────────────────────────────────

/** File path patterns to exclude from source gathering. */
export const EXCLUDED_PATTERNS = [
  "node_modules",
  ".git",
  "generated",
  ".d.ts",
  "__tests__",
  "__mocks__",
  ".test.",
  ".spec.",
  ".stories.",
  "fixtures",
  "bun.lock",
  "yarn.lock",
  "package-lock",
  "pnpm-lock",
]

/** Binary / non-source extensions to skip when scanning all files. */
export const BINARY_EXTENSIONS = new Set([
  // Images
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "ico",
  "webp",
  "avif",
  "tiff",
  "svg",
  // Fonts
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  // Audio/video
  "mp3",
  "mp4",
  "wav",
  "ogg",
  "webm",
  "avi",
  "mov",
  "flac",
  "aac",
  // Archives
  "zip",
  "tar",
  "gz",
  "bz2",
  "xz",
  "7z",
  "rar",
  // Compiled / binary
  "exe",
  "dll",
  "so",
  "dylib",
  "o",
  "a",
  "class",
  "pyc",
  "pyo",
  "wasm",
  "map",
  "min.js",
  "min.css",
  "bundle.js",
  "chunk.js",
  // Data blobs
  "bin",
  "dat",
  "db",
  "sqlite",
  "sqlite3",
  // Certificates / keys
  "pem",
  "crt",
  "key",
  "p12",
  "pfx",
  // Docs (not source)
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  // Lock files
  "lock",
  // Source maps
  "map",
])

/** Source file extensions to scan. Shared between sources.ts and hashes.ts. */
export const SOURCE_EXTENSIONS = [
  // JavaScript/TypeScript
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  // Python
  "py",
  // Go
  "go",
  // Rust
  "rs",
  // Ruby
  "rb",
  "erb",
  // JVM
  "java",
  "kt",
  "kts",
  "scala",
  "groovy",
  // .NET
  "cs",
  "fs",
  "razor",
  // Swift
  "swift",
  // PHP
  "php",
  // Elixir/Erlang
  "ex",
  "exs",
  // Dart
  "dart",
  // Frontend frameworks
  "vue",
  "svelte",
  "astro",
  // Template engines
  "liquid",
  "hbs",
  "njk",
  "pug",
  "ejs",
  "templ",
  // Styles (business rules live here too)
  "css",
  "scss",
  "less",
  // Schema / query languages
  "graphql",
  "gql",
  "proto",
  "sql",
  // Infrastructure
  "tf",
  "hcl",
  // Systems languages
  "zig",
  "nim",
  "lua",
  "v",
  // Blockchain
  "sol",
  "move",
  // Data science
  "r",
  "jl",
  // Config/data
  "json",
  "yaml",
  "yml",
  "toml",
  "xml",
]
