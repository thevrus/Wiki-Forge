/** Configuration for a single wiki-forge repo. */
export type RepoConfig = {
  /** Display name for this repo. */
  name: string
  /** Local filesystem path to the wiki directory (e.g. /path/to/repo/docs). */
  localPath?: string
  /** GitHub owner/repo (e.g. "acme/platform"). Used for remote mode. */
  github?: string
  /** GitHub token for API access. Defaults to GITHUB_TOKEN env var. */
  githubToken?: string
}

export type ServerConfig = {
  repos: RepoConfig[]
}

/**
 * Parse CLI args into ServerConfig.
 *
 * Usage:
 *   wiki-forge-mcp --repo /path/to/repo/docs
 *   wiki-forge-mcp --repo /path/to/repo/docs --repo /other/repo/docs
 *   wiki-forge-mcp --github acme/platform
 *   wiki-forge-mcp --github acme/platform --github acme/api
 */
export function parseArgs(argv: string[]): ServerConfig {
  const repos: RepoConfig[] = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]

    if (arg === "--repo" && argv[i + 1]) {
      const path = argv[++i]!
      const name = path.split("/").filter(Boolean).pop() ?? "repo"
      repos.push({ name, localPath: path })
    } else if (arg === "--github" && argv[i + 1]) {
      const gh = argv[++i]!
      const name = gh.split("/").pop() ?? "repo"
      repos.push({ name, github: gh, githubToken: process.env.GITHUB_TOKEN })
    }
  }

  // Default: look for docs/ or wiki/ in current directory
  if (repos.length === 0) {
    const cwd = process.cwd()
    repos.push({
      name: cwd.split("/").pop() ?? "repo",
      localPath: `${cwd}/docs`,
    })
  }

  return { repos }
}
