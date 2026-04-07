---
title: "Roadmap"
slug: roadmap
category: brain
icon: "🗺️"
description: "Phased build plan — vault → graph → agent layer → hook. Don't build the graph until the vault is trusted."
---

# Roadmap

## Now

- [ ] Commit & publish v0.2.0 (hashing, diff-only recompile, brain/, /wf-status, frontmatter enrichment)
- [x] `/wf-brief` — leadership summary slash command

## Phase 1 — The Vault (weeks 1–6)

*Goal: make the `brain/` folder irreplaceable*

- [x] `brain-init` — scaffolds brain/ with templates
- [x] `/wf-brain init` — interactive brain setup with interview
- [x] `/wf-brain claude` — auto-generate CLAUDE.md from brain + wiki
- [ ] Git hook — captures every commit, links to ticket ID from branch name
- [ ] PR parser — extracts decisions from PR descriptions and review comments → brain/DECISIONS/
- [ ] Basic backlink engine — decision A references decision B
- [x] `/wf-ticket` — PM ticket validation against codebase + brain
- [x] `/wf-qa` — QA test brief generation from entity + business rules

**Validate before Phase 2:** Find 5 engineering teams. Give them Phase 1. Ask:
1. Did the git hook capture decisions you'd have lost?
2. Did you trust the output without editing?
3. Would removing this after 3 months feel painful?

## Phase 2 — The Graph (weeks 6–12)

*Goal: make the connections visible and addictive*

- [ ] Local graph view (VS Code extension or simple web UI)
- [ ] Decision timeline — who decided what and when
- [ ] `git blame` overlay — hover any function, see the decision behind it
- [ ] Slack bot — "save this to brain?" on any message
- [ ] `wiki-forge site` — static site generation (Starlight/Fumadocs)

## Phase 3 — The Agent Layer (weeks 12–16)

*Goal: make AI agents dependent on it*

- [ ] MCP server exposing brain/ to Claude Code, Cursor, Copilot
- [ ] Auto-generates CLAUDE.md from accumulated brain (upgrade current slash command → always-on)
- [ ] Query tool: "why does this function exist?" answered from decision history
- [ ] Claude Project auto-sync (push docs/ to Claude Project via API)

## Phase 4 — The Hook (weeks 16–20)

*Goal: make removal painful*

- [ ] CI check — PR must reference a decision or ticket
- [ ] Stale detection — flags code changed without a linked decision
- [ ] Onboarding mode — new hire asks questions, brain answers
- [ ] Linear/Jira integration — webhook-driven context injection on ticket lifecycle
- [ ] Passive brain filling loop (Slack decisions → brain/DECISIONS/, ticket close → learning captured)

## Icebox

- Enterprise tier ($499/mo) — on-premise, SSO, private LLM routing
- Cloud tier ($49/mo) — hosted compile, web dashboard
- Grafana/Datadog integration — metrics auto-captured into brain/METRICS.md
- Multi-repo support — cross-repo entity resolution, shared brain/
- Custom LLM routing — local models (Ollama) for air-gapped environments
