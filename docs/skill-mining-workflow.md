# Skill Mining Workflow

Vega Labs turns repository evidence into reviewable Core-X skills, rules, and flows.

## Inputs

- Starred repository snapshots.
- Owned/collaborative repository snapshots.
- Repo signals, research queue state, and adoption candidates.
- README/package/workflow/deployment/test evidence.
- OCR evidence from screenshots, diagrams, tables, and PDFs.
- Model-zoo and technology-alert evidence when relevant.

## Flow

1. Discover a candidate repo from stars, Mine, News, or the research queue.
2. Analyze repo metadata, health, topics, dependencies, and adoption fit through typed tools.
3. Use OCR only for visual/document evidence; chat and reasoning continue through `/bus/v1/responses`.
4. Extract a canonical skill record with capabilities, house skills, rules, flows, Codex mission, Claude mission, and MLX mission.
5. Generate an OCR evidence pack and SKILL candidate only as internal/pending review output.
6. Generate an Ops kit or action item only when evidence supports it.
7. Keep the result internal/pending until a human accepts, dismisses, or publishes it.

## Output Contract

Skill candidates must include source repo/url, evidence refs, summary, tags, confidence, recommended action, review state, visibility, derived_from, created_at, and generated_by.

Generated OCR review artifacts may be written only when explicitly requested and only under:

- `data/review/evidence-packs/`
- `data/review/skill-candidates/`

No OCR-derived artifact is public by default. Vega Labs must not publish, open PRs, create houses, or mutate registries from OCR output without a separate reviewed execution step.
