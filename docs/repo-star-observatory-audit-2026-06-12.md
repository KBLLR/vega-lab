# Vega-Lab Repo/Star Observatory Audit — 2026-06-12

## Current Repo Tracking Surfaces

Owned and collaborative repositories are tracked locally using:
- **Cache File:** [my-repos.json](../data/my-repos.json) (and its public mirror [public/my-repos.json](../public/my-repos.json)).
- **Sync Script:** [my-repos.js](../scripts/my-repos.js), which queries the authenticated user's repositories, checks for README presence, maps package managers (`package.json`, lockfiles), and scans for CI workflows (`.github/workflows`) or deployment settings (`vercel.json`, `netlify.toml`).

## Current Star Tracking Surfaces

Starred repositories are tracked using:
- **Cache File:** [data.json](../data/data.json) (and public mirror [public/data.json](../public/data.json)).
- **Sync Implementation:** [github-sync.ts](../src/server/github-sync.ts), which queries the GitHub starred API endpoint, checks rate limits, paginates up to `maxPages`, and outputs internal artifacts per repository in `data/review/star-sync/`.

## GitHub / MCP / gh CLI Readiness

- **gh CLI Status:** Authenticated as user `KBLLR` (scopes: `gist`, `read:org`, `repo`, `workflow`). Keyring and `GH_TOKEN` environment variables are correctly configured and working.
- **MCP Server:** [index.js](../mcp-server/index.js) implements the `vega-lab-mcp` server, exposing typed tools for listing, searching, filtering, and performing skill extraction and repo ops.
- **OCR Engine Status:** Accessible at `/v1/ocr/*` or `/bus/v1/ocr/*`, utilizing `mlx-vision` for document and layout analysis of diagrams, tables, and screenshots.

## Existing Watchlists

- **Research Queue:** [research-queue.json](../data/research-queue.json) is used to track repositories flagged for deeper investigation.
- **Repo Signals:** [repo-signals.json](../data/repo-signals.json) caches computed scores, matched capabilities, and recommended adoption kinds.

## Missing Pieces

1. **Drift Detection:** Lack of automated diff checks between the local repository snapshot/pack state and remote updates.
2. **Schema Integration:** The sync scripts output raw repository objects and internal review logs but do not yet map directly to the newly introduced Core-X contracts like `corex.source-snapshot`.
3. **Approval Interface:** The UI contains panels for review and inbox elements, but requires a structured action loop to transition a candidate from "reviewed proposal" to "promoted registry item".

## Recommended Data Model

For unified tracking and refinery triage, the following data model is recommended:
```json
{
  "repo_id": "string (unique ID)",
  "source_kind": "string (owned | starred | watched | manual | internal-house)",
  "owner": "string (owner username)",
  "name": "string (repo name)",
  "url": "string (html URL)",
  "visibility": "string (public | private)",
  "primary_language": "string",
  "description": "string",
  "topics": ["string"],
  "updated_at": "string (ISO timestamp)",
  "last_seen_at": "string (ISO timestamp)",
  "local_interest_score": "number (0-100)",
  "corex_relevance": "string (high | medium | low)",
  "matched_house": "string (optional matched house ID)",
  "candidate_capabilities": ["string"],
  "risk_flags": ["string"],
  "review_status": "string (pending | accepted | dismissed)",
  "snapshot_status": "string (none | captured | stale)",
  "promotion_status": "string (none | proposed | promoted)"
}
```

## Recommended Next Sync Flow

```text
GitHub owned/starred repo sync
-> local repo/star cache (my-repos.json / data.json)
-> repo scoring (house-model.js)
-> source snapshot candidates (corex.source-snapshot.schema.json)
-> knowledge refinery artifacts (corex.knowledge-refinery-artifact.schema.json)
-> capability promotion proposals (corex.capability-promotion-proposal.schema.json)
-> human review (UI / CLI permit loop)
```

## Risks

- **API Rate Limiting:** Large-scale fetching of READMEs and sub-files (e.g. package.json) can trigger rate limits if unauthenticated (mitigated by using `gh` CLI auth).
- **Public/Private Boundaries:** Accidentally snapshotting private repository contents and writing them to public-facing documentation or shared registries.
- **Ecosystem Drift:** Re-extracting capabilities from repositories whose APIs or architectures have evolved, leading to broken/stale local skill files.

## Next Agent Mission

Integrate Vega-Lab's caching scripts (`github-sync.ts` and `my-repos.js`) with the Core-X schemas. Specifically, update the pipelines to generate `corex.source-snapshot` and `corex.knowledge-refinery-artifact` files under `data/review/` upon sync, ready for human-approved promotion.
