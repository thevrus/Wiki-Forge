import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { RepoConfig } from "./config"

/** A wiki file with its path and content. */
export type WikiFile = {
  path: string
  content: string
  repo: string
}

// ── Source interface ──────────────────────────────────────────────────

export interface WikiSource {
  /** List all .md files in the wiki. */
  list(): Promise<WikiFile[]>
  /** Read a specific file by path. Returns null if not found. */
  read(path: string): Promise<string | null>
  /** Name of the source repo. */
  readonly name: string
}

// ── Cache TTL (30 seconds) ───────────────────────────────────────────

const CACHE_TTL_MS = 30_000

type CacheEntry = { files: WikiFile[]; ts: number }

// ── Local filesystem source ──────────────────────────────────────────

export class LocalSource implements WikiSource {
  readonly name: string
  private dir: string
  private cache: CacheEntry | null = null

  constructor(config: RepoConfig) {
    this.name = config.name
    this.dir = config.localPath ?? ""
  }

  async list(): Promise<WikiFile[]> {
    if (this.cache && Date.now() - this.cache.ts < CACHE_TTL_MS) {
      return this.cache.files
    }
    if (!existsSync(this.dir)) return []
    const files = this.walk(this.dir)
    this.cache = { files, ts: Date.now() }
    return files
  }

  async read(path: string): Promise<string | null> {
    const fullPath = join(this.dir, path)
    try {
      return readFileSync(fullPath, "utf-8")
    } catch {
      return null
    }
  }

  private walk(dir: string, prefix = ""): WikiFile[] {
    const files: WikiFile[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        // Skip hidden dirs and node_modules
        if (entry.name.startsWith(".") || entry.name === "node_modules")
          continue
        files.push(...this.walk(join(dir, entry.name), rel))
      } else if (entry.name.endsWith(".md")) {
        try {
          const content = readFileSync(join(dir, entry.name), "utf-8")
          files.push({ path: rel, content, repo: this.name })
        } catch {
          // skip unreadable files
        }
      }
    }
    return files
  }
}

// ── GitHub API source ────────────────────────────────────────────────

export class GitHubSource implements WikiSource {
  readonly name: string
  private owner: string
  private repo: string
  private token: string
  private branch: string
  private cache: CacheEntry | null = null

  constructor(config: RepoConfig) {
    this.name = config.name
    const [owner, repo] = (config.github ?? "").split("/")
    this.owner = owner ?? ""
    this.repo = repo ?? ""
    this.token = config.githubToken ?? process.env.GITHUB_TOKEN ?? ""
    this.branch = "main"
  }

  async list(): Promise<WikiFile[]> {
    if (this.cache && Date.now() - this.cache.ts < CACHE_TTL_MS) {
      return this.cache.files
    }
    if (!this.token || !this.owner || !this.repo) return []

    try {
      const res = await fetch(
        `https://api.github.com/repos/${this.owner}/${this.repo}/git/trees/${this.branch}?recursive=1`,
        { headers: this.headers() },
      )
      if (!res.ok) return []

      const data = (await res.json()) as {
        tree: Array<{ path: string; type: string }>
      }

      const mdFiles = data.tree.filter(
        (f) =>
          f.type === "blob" &&
          f.path.startsWith("docs/") &&
          f.path.endsWith(".md"),
      )

      // Fetch files in parallel (concurrency 5)
      const paths = mdFiles
        .slice(0, 100)
        .map((f) => f.path.replace(/^docs\//, ""))
      const files: WikiFile[] = []
      const CONCURRENCY = 5
      let idx = 0
      const workers = Array.from(
        { length: Math.min(CONCURRENCY, paths.length) },
        async () => {
          while (idx < paths.length) {
            const i = idx++
            const content = await this.read(paths[i]!)
            if (content) {
              files.push({ path: paths[i]!, content, repo: this.name })
            }
          }
        },
      )
      await Promise.all(workers)

      this.cache = { files, ts: Date.now() }
      return files
    } catch {
      return []
    }
  }

  async read(path: string): Promise<string | null> {
    if (!this.token || !this.owner || !this.repo) return null

    try {
      const res = await fetch(
        `https://api.github.com/repos/${this.owner}/${this.repo}/contents/docs/${path}?ref=${this.branch}`,
        {
          headers: {
            ...this.headers(),
            Accept: "application/vnd.github.raw+json",
          },
        },
      )
      if (!res.ok) return null
      return await res.text()
    } catch {
      return null
    }
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    }
  }
}

// ── Factory ──────────────────────────────────────────────────────────

export function createSource(config: RepoConfig): WikiSource {
  if (config.github) return new GitHubSource(config)
  return new LocalSource(config)
}

/** Create sources for all configured repos. */
export function createSources(configs: RepoConfig[]): WikiSource[] {
  return configs.map(createSource)
}
