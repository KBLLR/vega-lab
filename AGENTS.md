# Vega Labs Agents

## Paradigm

- House ID: `vega-lab`
- Legacy alias: `git-stars`
- Role: Local-first repository intelligence, skill mining, technology alerting, and repo ops center
- Status/Type: active · ui · lab
- Runtime contract: OpenResponses only
- Authority: draft-only for automations and cross-repo maintenance

## Product Truth

- UI entry: `src/main.tsx`
- Runtime shell: `src/App.tsx`
- MCP/OpenResponses tools: `src/mcp-server/index.js`
- Orchestrator: `orchestrators/vega-lab.orchestrator.json`
- House manifest: `house.manifest.json`
- Function manifest: `functions.manifest.json`

## Local Runtime

- Local mode defaults to `/bus`
- Vite proxies `/bus` to `http://127.0.0.1:8090`
- The gateway must expose OpenResponses chat at `/v1/responses`
- The gateway must expose OCR at `/v1/ocr/*` for screenshots, PDFs, diagrams, tables, and visual skill evidence
- Web mode is for deployed testing only

## Data

- Raw starred repos: `data/data.json` and `public/data.json`
- Owned/collab repos: `data/my-repos.json` and `public/my-repos.json`
- Derived intelligence: `repo-signals.json`, `research-queue.json`, `skill-extractions.json`, `mine-health.json`, `repo-inspections.json`, `action-items.json`, `automation-runs.json`, `ops-digest.json`, `weekly-research-review.json`, `template-kits.json`, `repo-ops-kits.json`
- Every derived artifact must be mirrored in both `data/` and `public/`
- Template sources live under `templates/` and must stay draft-only until an explicit execution step writes into another repo.

## Skills

- `repo-discovery`: search, filter, compare, similar repos
- `repo-research`: research queue, summaries, status tracking
- `skill-extraction`: canonical skills, rules, flows, mission briefs
- `repo-adoption`: house/tool/service/template/ignore classification
- `mine-execution`: owned-repo inspection, maintenance, deployment/test/readme actions

## Runtime / Dev

- Install: `pnpm install`
- Dev: `pnpm run dev`
- Data refresh: `GITHUB_TOKEN=<your_pat> pnpm run build:data && GITHUB_TOKEN=<your_pat> pnpm run sync:mine && pnpm run generate:stats && pnpm run test:data`
- CI data refresh requires the repository secret `GH_PAT`; it must be a personal GitHub token with access to public stars plus owned/private/collaborative repositories.
- Tests: `pnpm test`
- Build: `pnpm run build`

## Rules

- Preserve the visual design direction unless the user explicitly asks for design changes.
- Prefer typed tools and durable JSON artifacts over prompt-only behavior.
- Use OCR only for visual/document evidence extraction; do not treat OCR as a general chat or orchestration runtime.
- Keep old `git-stars:*` local storage and agent aliases readable for one migration cycle, but write new state under `vega-lab:*`.
- Active mission targets are Codex, Claude, and local MLX. Jules is historical template vocabulary, not a Vega Lab target.
- Automations may draft action items, Ops kits, and mission briefs only. Do not open PRs, merge, deploy, or mutate other repositories without explicit human approval.
- Public-facing summaries, SKILL candidates, technology alerts, and house ideas must pass human review before publication or adoption.

## Current Operating Plan (2026-06-12)

- **Observatory Restored:** Re-emphasize star/repo tracking alongside the skills-orchestrator pattern. Vega-Lab tracks personal owned, starred, and external watched repos to feed capability refinery flows.
- **Review Gates Enforced:** Raw repo signals, source snapshots, and knowledge refinery artifacts must be generated as internal/draft files under `data/review/` or `data/` and mirrored to `public/`. Auto-promotion of capabilities is prohibited; promotion requires a distinct reviewed execution step.
- **Parked Work Boundary:** Codex release hygiene and external repo mutations are parked. Do not modify or push changes to other houses or the main repository root.
- **Evidence Curation:** Utilize OCR at `/v1/ocr/*` solely for visual evidence extraction from screenshots and diagrams. Do not use OCR as a general dialogue runtime.
- **Reference Docs:** Refer to [agent-briefing-current-plan.md](docs/agent-briefing-current-plan.md) and [repo-star-observatory-audit-2026-06-12.md](docs/repo-star-observatory-audit-2026-06-12.md) for identity, contracts, and architecture definitions.
