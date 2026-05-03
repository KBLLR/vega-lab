# Vega Labs Profile

Vega Labs is the Core-X repository observatory. It watches GitHub stars, owned repositories, model-zoo state, and technology signals to generate reviewable intelligence for the ecosystem.

## Purpose

- Discover high-value repositories and libraries.
- Mine reusable SKILL.md, RULES.md, and WORKFLOWS.md candidates.
- Identify technologies that should influence Core-X architecture.
- Recommend adoption, ignore, service, template, house, or shared-component paths.
- Maintain owned repositories through draft-only action items and Ops kits.

## Audiences

- Core-X maintainers deciding what to build or adopt.
- House operators looking for reusable skills or weak spots.
- Local MLX/runtime maintainers checking model availability and evidence tooling.
- Future public readers after summaries pass review.

## Boundaries

- Outputs default to internal and pending review.
- Raw repo notes stay internal unless reviewed.
- Generated SKILL candidates do not become house skills automatically.
- Technology alerts and house ideas are recommendations, not authority.
- Vega Labs must not open PRs, deploy, merge, publish, or create houses without explicit human action.

## Runtime Dependency

Local chat and reasoning use `/bus/v1/responses` through the MLX Gateway. Visual and document evidence uses OCR at `/bus/v1/ocr/*`, which delegates to `mlx-vision` for image/PDF/table/diagram extraction. OCR is not a general chat runtime.
