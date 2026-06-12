# Vega-Lab Skills Orchestrator

Vega-Lab is the Core-X observatory and capability refinery. Its job is to turn source evidence into reviewed local capability proposals.

## Pipeline

```text
source/repo discovery
-> source snapshot / repo pack
-> knowledge refinement
-> drift and conflict detection
-> skill / flow / tool proposal
-> review artifact
-> human approval
-> promotion into Core-X registry, docs, or house capability
```

## Vega-Lab Owns

- source discovery and triage
- repo/source snapshot records
- knowledge-refinery artifacts
- skill, flow, tool, doc, agent, and house-capability proposals
- technology alerts
- review-gated evidence packs

## Vega-Lab Does Not Own

- automatic promotion
- direct mutation of other houses
- automatic pull requests
- deployments
- public editorial publishing
- model metadata ownership
- Warehouse artifact custody

## External Patterns To Absorb

- Repomix: repo packing, ignore-aware snapshots, token estimates, secret-safety prechecks.
- Skill Seekers: source normalization, diagnostics, progressive disclosure, conflict detection, refinery outputs.
- AI Research Skills: later review for skillpack anatomy, bootstrap patterns, and research-skill distribution.

## Draft Output Locations

Generated review artifacts stay internal and pending. Existing OCR evidence and skill-candidate outputs remain under `data/review/**` only when explicitly requested.

Promotion into Core-X registries, docs, or house capabilities must happen in a separate reviewed execution step.

## Core-X Contract

The shared Core-X side is documented in:

- `core-x/docs/architecture/vega-lab-skills-orchestrator.md`
- `core-x/schemas/corex.source-snapshot.schema.json`
- `core-x/schemas/corex.knowledge-refinery-artifact.schema.json`
- `core-x/schemas/corex.capability-promotion-proposal.schema.json`
- `core-x/flows/vega/source-snapshot.flow.yaml`
- `core-x/flows/vega/capability-promotion-review.flow.yaml`
