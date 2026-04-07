Initialize a wiki-forge documentation wiki for this repository.

## What you'll do

1. Scan the repository structure (top-level and one level deep, skip node_modules/dist/build/.git)
2. Show the user what directories you found
3. Suggest documentation pages based on what exists:

| Directory patterns found | Suggest this doc |
|---|---|
| src/, lib/, server/, backend/ | **ARCHITECTURE.md** — System architecture: services, APIs, data flows |
| src/app/, src/pages/, src/components/, src/screens/, app/, pages/ | **PRODUCT.md** — User-facing screens, flows, features |
| src/types/, src/models/, src/db/, prisma/, drizzle/, schema/ | **DATA.md** — Data models, entities, relationships |
| src/lib/, src/utils/, src/middleware/, src/services/, lib/ | **BUSINESS_RULES.md** — Validation rules, business logic, constraints |
| src/api/, src/routes/, src/controllers/, api/, routes/ | **API.md** — Endpoints, authentication, request/response formats |
| (any source dir exists) | **DECISIONS.md** — Architectural decision records *(health-check type)* |

4. For each suggestion, ask the user: **Include? [Y/n]** — let them accept, skip, or modify
5. Ask if they want to add any custom docs not in the suggestions
6. Ask which directory to use for the wiki (default: `docs/`)

## What you'll write

Create `{docs_dir}/.doc-map.json`:

```json
{
  "docs": {
    "ARCHITECTURE.md": {
      "description": "System architecture: services, APIs, data flows, and infrastructure",
      "type": "compiled",
      "sources": ["src/"],
      "context_files": ["package.json", "tsconfig.json"]
    }
  }
}
```

Each entry has:
- **description** — tells the LLM what this doc is about (be specific to this codebase)
- **type** — `"compiled"` (LLM writes it) or `"health-check"` (human writes it, LLM checks for contradictions)
- **sources** — directories/files to read when compiling this doc
- **context_files** — always-included files for broader understanding

Also create the directory structure:
```
{docs_dir}/
  .doc-map.json
  entities/
  concepts/
  synthesis/
```

After writing, tell the user to run `/wf-compile --force` to generate the docs.
