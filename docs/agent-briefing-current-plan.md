# Vega-Lab Agent Briefing — Current Plan

## Identity

Vega-Lab is Core-X's local-first repository observatory, capability refinery, and draft-only repository operations center. It runs local-first OpenResponses through the Core-X Gateway, utilizing text analytics and OCR-based visual evidence (diagrams, tables, screenshots, PDFs) to identify and package capability candidates.

## Original Purpose

Originally named `git-stars`, Vega-Lab existed to help David track:
- Personal owned and collaborative repositories.
- Starred repositories of interest.
- External research/technology signals worth turning into Core-X skills, flows, tools, or research briefs.
- Repository health and basic maintenance needs.

## Updated Purpose

Vega-Lab's original tracking capability now serves as the ingestion stage for Core-X's skills-orchestrator pattern. Repository discovery and star events feed a review-gated pipeline:
```text
source/repo discovery
-> source snapshot / repo pack (Repomix-style)
-> knowledge refinement (Skill Seekers-style, drift/conflict checks)
-> reviewed capability proposal (skills, flows, tools, docs, house-capabilities)
-> human-approved promotion into Core-X registries or house folders
```

## What Vega-Lab Owns

- **Watched-source triage:** Curation and priority scoring of owned, starred, and watched repositories.
- **Source snapshot records:** Ignore-aware metadata snapshots and token estimates of source packages.
- **Knowledge-refinery artifacts:** Derivation of capabilities, risks, and potential drift/conflicts from source code and README analysis.
- **Draft capability proposals:** Scaffolding `SKILL.md`, `RULES.md`, `WORKFLOWS.md`, or tool descriptors for human review.
- **Non-mutating repository operations:** Drafting readiness checks, README updates, maintenance checklists, and internal Action Items.

## What Vega-Lab Does Not Own

- **Automatic promotion:** Direct mutation of Core-X registries, active skills, or house configurations.
- **PRs, commits, and deploys:** Vega-Lab must never autonomously push commits, merge, deploy, or create houses in other workspaces.
- **Shared resource custody:** Model weights/metadata belong to Model Zoo, asset storage to Warehouse, and archives to Anthology.

## Current Core-X Contracts

Vega-Lab outputs must conform to the following shared Core-X contracts:
- **Architecture doc:** `core-x/docs/architecture/vega-lab-skills-orchestrator.md`
- **Schemas:**
  - `core-x/schemas/corex.source-snapshot.schema.json`
  - `core-x/schemas/corex.knowledge-refinery-artifact.schema.json`
  - `core-x/schemas/corex.capability-promotion-proposal.schema.json`
- **Flows:**
  - `core-x/flows/vega/source-snapshot.flow.yaml`
  - `core-x/flows/vega/capability-promotion-review.flow.yaml`

## Repo / Star Tracking Status

- **GitHub CLI Integration:** Fully authenticated as user `KBLLR` (scopes: `gist`, `read:org`, `repo`, `workflow`). Remote API queries are active and safe.
- **Cache Locations:** Starred repositories cached in [data.json](../data/data.json); owned repositories cached in [my-repos.json](../data/my-repos.json) (both mirrored in `public/`).
- **Scoring Pipeline:** `house-model.js` computes an `adoptionScore` (0-100) based on repository stars, forks, license status, staleness, README presence, and capability keywords.

## Audio Lab Proof-House Status

Audio Lab is the first clean proof-house candidate for Vega-Lab's skills-orchestrator pattern. Its music, speech, and audio-asset pipelines are prime candidates for reusable capability extraction. However, this work is pending final owner approval for asset boundaries and privacy reviews. Do not modify Audio Lab source code or assets.

## Codex Parked Work

Codex release hygiene and automated workspace mutations are parked. Do not attempt Codex release tasks, do not push to origin, and do not stage unrelated dirty files at the repository root.

## What To Do Next

1. Run sync commands safely using authenticated credentials to update the starred and owned repository caches.
2. Generate draft capability proposals for high-scoring repositories (Adoption Score >= 80) and place them in the draft/review directories (`data/review/`).
3. Leverage the OCR engine (`/bus/v1/ocr/*`) for scanning repository screenshots, UI mockups, and architectural diagrams to extract skill candidates.

## What Not To Do

- **Do not push** changes to origin.
- **Do not mutate** Audio Lab, HY-Motion, or Rigging Palace.
- **Do not auto-apply** proposals to active registries or source directories.
- **Do not edit** generated json registries by hand.
- **Do not stage or commit** unrelated dirty files (e.g. `docs/ocr-runtime.md`, `pnpm-workspace.yaml`, or root-level changes).
