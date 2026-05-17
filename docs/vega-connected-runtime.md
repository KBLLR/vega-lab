# Vega Connected Runtime

Vega Labs serves as the repository intelligence and capability discovery layer for the Core-X ecosystem. 
It connects GitHub starred repos to local metadata, extracts signals, and generates review-gated SKILL candidates, technology alerts, and house ideas.

## Responsibilities
- **Starred Repo Sync:** Pulls repositories starred by the user or from public lists.
- **Repo Signal Extraction:** Analyzes normalized metadata and READMEs for capabilities.
- **Technology Watch:** Generates technology alerts based on discovered dependencies and trends.
- **Review-gated Artifacts:** Creates draft SKILL candidates and House Idea candidates.
- **Ops/Research Briefs:** Drafts internal reports on repository integrations.

## Out of Scope
Vega Labs **does not** own:
- **Canonical Archive:** Anthology handles canonical archiving.
- **Public Publishing:** Le Belle Epoch handles public editorial surfaces.
- **Asset Custody:** Warehouse manages asset custody and provenance.
- **Runtime Task Execution:** Spacebot handles agentic execution.
- **Design System:** Brand Foundry manages ecosystem design.
- **Model Metadata:** The `model-zoo` manages model registries.

## Integration Principles
- All generated outputs must default to `review_state: pending` and `visibility: internal`.
- Vega does not autopublish or automatically create branches/PRs.
- Outputs are isolated in `data/review/` and ignored by default to prevent accidental commits of generated data.

## Agentic Handoff Contract
While Vega Labs generates insights and artifact candidates, it delegates execution to the Core-X agentic layer (e.g., Spacebot). 

The handoff occurs via the **Scaffolding Bridge**:
1. Human operator reviews and accepts a `vega.skill-candidate` in the Vega Labs dashboard.
2. The `scaffold-bridge` processes the accepted artifact and writes an execution manifest to `data/scaffold-manifests/`.
3. An event trigger (`vega.scaffold.manifest.created`) notifies the agentic layer.
4. **Spacebot** executes the `vega-adoption-flow`, consuming the manifest to run the `app-scaffolding` skill and commit the resulting codebase.

This separation of concerns ensures Vega Labs remains a read/observe/analyze surface, while Spacebot acts as the trusted executor.
