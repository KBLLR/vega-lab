#!/usr/bin/env node
// Builds the clearly labeled SYNTHETIC observatory fixture used for cloud previews,
// screenshots, and UI tests. It never touches the network, GitHub, the Gateway, or
// real repository data. Repositories below are invented; derived intelligence is
// produced by running the real house-model pipeline (`buildDerivedHouseData`) over
// them with a frozen clock so output is deterministic.
//
// Output: tests/fixtures/synthetic-observatory/observatory.json
// Usage:  node scripts/build-synthetic-fixtures.js [--check]

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildDerivedHouseData } from "../src/server/house-model.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const FIXTURE_PATH = path.join(projectRoot, "tests", "fixtures", "synthetic-observatory", "observatory.json");
export const FIXTURE_ANCHOR = "2026-11-01T09:00:00.000Z";
const OWNER = "example-observatory";
const STARRED_OWNER = "synthetic-upstream";

function daysBefore(days) {
  return new Date(Date.parse(FIXTURE_ANCHOR) - days * 86_400_000).toISOString();
}

function repo(overrides) {
  return {
    author: STARRED_OWNER,
    stars: 0,
    forks: 0,
    open_issues: 0,
    license: "MIT",
    languages: [{ language: "TypeScript", percentage: "100" }],
    topics: [],
    private: false,
    has_readme: true,
    ...overrides,
    url: `https://github.com/${overrides.author || STARRED_OWNER}/${overrides.name}`,
  };
}

export const SYNTHETIC_STARRED = [
  repo({
    name: "repo-pack-kit",
    description: "Synthetic fixture: ignore-aware repository packer with token accounting and a secret precheck for agent context.",
    stars: 4820, forks: 310, open_issues: 41,
    date: daysBefore(12), last_updated: daysBefore(3),
    topics: ["agent", "llm", "cli", "mcp", "tooling"],
  }),
  repo({
    name: "skill-refinery",
    description: "Synthetic fixture: multi-source knowledge refinery that turns docs and repos into structured agent skills with conflict detection.",
    stars: 2310, forks: 180, open_issues: 22,
    date: daysBefore(20), last_updated: daysBefore(9),
    languages: [{ language: "Python", percentage: "92" }, { language: "Shell", percentage: "8" }],
    topics: ["skills", "agent", "rag", "workflow"],
  }),
  repo({
    name: "doc-layout-ocr",
    description: "Synthetic fixture: OCR and layout analysis for PDFs, tables, and diagrams with a local vision model.",
    stars: 960, forks: 74, open_issues: 18,
    date: daysBefore(41), last_updated: daysBefore(55),
    languages: [{ language: "Python", percentage: "100" }],
    topics: ["ocr", "vision", "pdf", "mlx"],
    license: "None",
  }),
  repo({
    name: "webgpu-particles",
    description: "Synthetic fixture: WebGPU particle and instancing playground for interactive 3D UI experiments.",
    stars: 1540, forks: 95, open_issues: 9,
    date: daysBefore(70), last_updated: daysBefore(130),
    topics: ["webgpu", "threejs", "3d", "frontend"],
  }),
  repo({
    name: "tiny-audio-transport",
    description: "Synthetic fixture: minimal audio transport bar and waveform component library.",
    stars: 210, forks: 12, open_issues: 3,
    date: daysBefore(160), last_updated: daysBefore(420),
    languages: [{ language: "JavaScript", percentage: "100" }],
    topics: ["audio", "ui", "react"],
  }),
  repo({
    name: "md-slides-lite",
    description: "Synthetic fixture: markdown to slides converter.",
    stars: 88, forks: 4, open_issues: 1,
    date: daysBefore(300), last_updated: daysBefore(700),
    languages: [{ language: "JavaScript", percentage: "100" }],
    topics: ["markdown"],
    has_readme: false,
  }),
];

export const SYNTHETIC_MINE = [
  repo({
    author: OWNER,
    name: "observatory-notes",
    description: "Synthetic fixture: owned research notebook with agent workflow drafts.",
    stars: 3, forks: 0, open_issues: 2,
    date: daysBefore(400), last_updated: daysBefore(6),
    topics: ["agent", "workflow", "research"],
    private: true,
    is_owner: true,
    key_files: { packageManagers: ["pnpm"], workflows: [], deploymentConfigs: [] },
  }),
  repo({
    author: OWNER,
    name: "legacy-dashboard",
    description: "Synthetic fixture: owned dashboard prototype without a README.",
    stars: 1, forks: 0, open_issues: 0,
    date: daysBefore(800), last_updated: daysBefore(510),
    topics: ["dashboard", "ui"],
    has_readme: false,
    license: "None",
    is_owner: true,
    key_files: { packageManagers: ["npm"], workflows: [], deploymentConfigs: ["vercel.json"] },
  }),
  repo({
    author: OWNER,
    name: "starter-template",
    description: "Synthetic fixture: reusable Vite + React starter template with CI.",
    stars: 7, forks: 2, open_issues: 0,
    date: daysBefore(200), last_updated: daysBefore(40),
    topics: ["template", "vite", "react", "frontend"],
    is_owner: true,
    key_files: { packageManagers: ["pnpm"], workflows: ["ci.yml"], deploymentConfigs: [] },
  }),
];

const SYNTHETIC_RESEARCH_QUEUE = [
  {
    nwo: `${STARRED_OWNER}/repo-pack-kit`,
    status: "researching",
    priority: "high",
    notes: "Synthetic fixture note: compare with the Core-X source-snapshot contract before drafting a candidate.",
    createdAt: daysBefore(10),
    updatedAt: daysBefore(2),
  },
  {
    nwo: `${STARRED_OWNER}/skill-refinery`,
    status: "queued",
    priority: "normal",
    notes: "Synthetic fixture note: refinery pattern; check license and overlap with existing skills.",
    createdAt: daysBefore(8),
    updatedAt: daysBefore(8),
  },
  {
    nwo: `${STARRED_OWNER}/md-slides-lite`,
    status: "dismissed",
    priority: "low",
    notes: "Synthetic fixture note: dismissed — no README and no reuse path.",
    createdAt: daysBefore(90),
    updatedAt: daysBefore(60),
  },
];

function receipt(runIndex, actionKind, nwo, status, minutesAfter, extra = {}) {
  const at = new Date(Date.parse(FIXTURE_ANCHOR) + minutesAfter * 60_000).toISOString();
  return {
    schema_version: "vega.action-result.v1",
    run_id: `synthetic-run-${String(runIndex).padStart(3, "0")}`,
    action_id: actionKind,
    action_kind: actionKind,
    status,
    review_state: "pending",
    visibility: "internal",
    repo: { nwo, name: nwo.split("/")[1], author: nwo.split("/")[0] },
    requested_at: at,
    started_at: at,
    completed_at: at,
    confirmation_ref: null,
    input_digest: `sha256:synthetic-${runIndex}`,
    warnings: [],
    steps: [],
    artifacts: [],
    ...extra,
  };
}

const PACK_KIT = `${STARRED_OWNER}/repo-pack-kit`;
const DOC_OCR = `${STARRED_OWNER}/doc-layout-ocr`;

// Synthetic durable-action receipts. None of them represents a human approval:
// every receipt stays review_state=pending / visibility=internal, as the bridge enforces.
export const SYNTHETIC_ACTION_RUNS = [
  receipt(1, "repo.inspect", PACK_KIT, "succeeded", 1),
  receipt(2, "snapshot.resolve", PACK_KIT, "succeeded", 2, {
    artifacts: [{ kind: "source-snapshot", path: "data/review/source-snapshots/synthetic-repo-pack-kit.json" }],
  }),
  receipt(3, "candidate.build", PACK_KIT, "succeeded", 3, {
    candidate_id: "vega-candidate:synthetic-upstream:repo-pack-kit",
    artifacts: [{ kind: "skill-candidate", path: "data/review/skill-candidates/synthetic-repo-pack-kit.json" }],
  }),
  receipt(4, "candidate.validate", PACK_KIT, "succeeded", 4, {
    candidate_id: "vega-candidate:synthetic-upstream:repo-pack-kit",
  }),
  receipt(5, "review.queue", PACK_KIT, "succeeded", 5),
  receipt(6, "repo.inspect", DOC_OCR, "succeeded", 6),
  receipt(7, "snapshot.resolve", DOC_OCR, "blocked", 7, {
    warnings: ["Synthetic fixture: license is not declared upstream; snapshot write requires an explicit license decision."],
    error: { code: "license_unknown", message: "Synthetic fixture: license unknown — snapshot blocked pending review.", retryable: false },
  }),
];

export async function buildSyntheticObservatory() {
  const realNow = Date.now;
  Date.now = () => Date.parse(FIXTURE_ANCHOR);
  try {
    const inputs = {
      starredRepos: SYNTHETIC_STARRED,
      myRepos: SYNTHETIC_MINE,
      researchQueue: SYNTHETIC_RESEARCH_QUEUE,
      repoOpsKits: [],
    };
    const firstPass = buildDerivedHouseData({ ...inputs, actionItems: [] });
    // Demonstrate explicit human-review outcomes without inventing approvals:
    // one draft is under review and one was dismissed. Nothing is accepted.
    // Outcomes are fed back as existing items so the pipeline (and the ops
    // digest counts) reflect them exactly as a real update_action_item would.
    const reviewOutcomes = {
      "vega-lab:adoption:synthetic-upstream-skill-refinery": "reviewing",
      "vega-lab:readme:example-observatory-legacy-dashboard": "dismissed",
    };
    const existing = firstPass.actionItems
      .filter((item) => reviewOutcomes[item.id])
      .map((item) => ({ ...item, status: reviewOutcomes[item.id], updatedAt: daysBefore(1) }));
    const derived = buildDerivedHouseData({ ...inputs, actionItems: existing });
    const actionItems = derived.actionItems;
    return {
      meta: {
        synthetic: true,
        label: "SYNTHETIC FIXTURE — invented repositories for previews and tests. Not real data, metrics, findings, or approvals.",
        generated_by: "scripts/build-synthetic-fixtures.js",
        pipeline: "src/server/house-model.js#buildDerivedHouseData",
        clock_anchor: FIXTURE_ANCHOR,
      },
      starredRepos: SYNTHETIC_STARRED,
      myRepos: SYNTHETIC_MINE,
      repoSignals: derived.repoSignals,
      researchQueue: derived.researchQueue,
      skillExtractions: derived.skillExtractions,
      mineHealth: derived.mineHealth,
      repoInspections: derived.repoInspections,
      actionItems,
      opsDigest: { ...derived.opsDigest, generatedAt: FIXTURE_ANCHOR },
      weeklyResearchReview: { ...derived.weeklyResearchReview, generatedAt: FIXTURE_ANCHOR },
      actionRuns: SYNTHETIC_ACTION_RUNS,
    };
  } finally {
    Date.now = realNow;
  }
}

export function serializeFixture(fixture) {
  return `${JSON.stringify(fixture, null, 2)}\n`;
}

async function main() {
  const check = process.argv.includes("--check");
  const next = serializeFixture(await buildSyntheticObservatory());
  if (check) {
    const current = await fs.readFile(FIXTURE_PATH, "utf8").catch(() => "");
    if (current !== next) {
      console.error(`Synthetic fixture is out of date: ${path.relative(projectRoot, FIXTURE_PATH)}. Run: node scripts/build-synthetic-fixtures.js`);
      process.exit(1);
    }
    console.log("Synthetic fixture is up to date.");
    return;
  }
  await fs.mkdir(path.dirname(FIXTURE_PATH), { recursive: true });
  await fs.writeFile(FIXTURE_PATH, next, "utf8");
  console.log(`Wrote ${path.relative(projectRoot, FIXTURE_PATH)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
