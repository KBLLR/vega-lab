# House Idea Candidates

When Vega Labs analyzes a repository and detects a cohesive set of capabilities that could form a standalone user experience, it generates a House Idea candidate.

## Output Structure
Generated as internal artifacts in `data/review/house-ideas/<slug>.json` and `.md`.

Must include:
- `proposed_house_name`
- `purpose`
- `capabilities`
- `source_inspiration`
- `relation_to_existing_houses`
- `merge_duplicate_risk`
- `internal_value`
- `external_value`
- `build_complexity`
- `recommended_action`: Enums including `ignore`, `watch`, `skill_only`, `integrate_existing_house`, `propose_new_house`.
- `review_state` (always `pending`)
- `visibility` (always `internal`)

## Safety Rules
- Vega will **never** automatically create the folder structure for a new house.
- Vega will **never** mutate the Core-X registries.
- Candidates remain as reviewable text/JSON until manually approved and scaffolded by a developer or Spacebot.
