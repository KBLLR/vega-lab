// Observatory model tests: status/provenance presentation, honest dataset states,
// attention ranking, next-step derivation, draft-only invariants, and the
// synthetic fixture's labeling and determinism.
//
// Runs under Node's built-in TypeScript type stripping (Node >= 22.18).
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  isAcceptedByHuman,
  presentActionItemStatus,
  presentActionRun,
  presentCandidate,
  presentResearchStatus,
  presentWorkflowStage,
} from "../src/lib/review-status.ts";
import {
  loadDataset,
  deskSelectionKey,
  requestedDataMode,
  snapshotFreshness,
  summarizeDataState,
} from "../src/lib/observatory-data.ts";
import { buildAttentionQueue, deriveNextStep, NEXT_STEP_PROMPTS } from "../src/lib/attention.ts";
import { inferActionFromPrompt, VEGA_WORKFLOW_STAGES } from "../src/lib/action-bridge.ts";
import { candidateReceipts } from "../src/lib/candidate-receipts.ts";
import { buildDossierRisks } from "../src/lib/dossier.ts";
import {
  buildSyntheticObservatory,
  FIXTURE_PATH,
  serializeFixture,
} from "../scripts/build-synthetic-fixtures.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

function response(status, body, contentType = "application/json") {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name.toLowerCase() === "content-type" ? contentType : null) },
    text: async () => body,
  };
}

function fakeFetch(routes) {
  return async (url) => {
    const route = routes[url];
    if (!route) return response(404, "Not found", "text/plain");
    if (route instanceof Error) throw route;
    return route;
  };
}

// ---------------------------------------------------------------- status model

await test("machine-produced records never present as accepted", () => {
  for (const status of ["queued", "running", "succeeded", "failed", "blocked", "cancelled"]) {
    const presentation = presentActionRun({ status, review_state: "pending" });
    assert.equal(presentation.isHumanDecision, false, status);
    assert.notEqual(presentation.status, "accepted", status);
    assert.equal(presentation.provenance, "generated-draft");
  }
  const succeeded = presentActionRun({ status: "succeeded", review_state: "pending" });
  assert.equal(succeeded.status, "pending-review");
  assert.equal(succeeded.label, "Completed");
});

await test("action item statuses map to explicit draft and decision states", () => {
  assert.equal(presentActionItemStatus("open").status, "draft");
  assert.equal(presentActionItemStatus("open").provenance, "generated-draft");
  assert.equal(presentActionItemStatus("reviewing").status, "in-review");
  assert.equal(presentActionItemStatus("reviewing").isHumanDecision, false);
  assert.ok(isAcceptedByHuman(presentActionItemStatus("accepted")));
  assert.ok(isAcceptedByHuman(presentActionItemStatus("done")));
  assert.equal(presentActionItemStatus("dismissed").status, "dismissed");
  assert.equal(presentActionItemStatus("bogus").status, "unavailable");
});

await test("research statuses map to queue states", () => {
  assert.equal(presentResearchStatus(undefined).status, "untracked");
  assert.equal(presentResearchStatus("queued").status, "queued");
  assert.equal(presentResearchStatus("researching").status, "in-review");
  assert.equal(presentResearchStatus("dismissed").status, "dismissed");
});

await test("candidate approval requires a checksum-matching review envelope", () => {
  const candidate = { candidate_id: "vega-candidate:x", content_checksum: `sha256:${"a".repeat(64)}`, review_status: "pending" };
  assert.equal(presentCandidate(candidate).status, "pending-review");
  assert.equal(presentCandidate(candidate).isHumanDecision, false);

  const approved = { schema_version: "corex.vega-skill-review.v1", review_id: "review-x", candidate_id: "vega-candidate:x", candidate_checksum: candidate.content_checksum, status: "approved", reviewer: { id: "david" }, reviewed_at: "2026-11-05T00:00:00Z" };
  assert.equal(presentCandidate(candidate, approved).status, "accepted");
  assert.ok(isAcceptedByHuman(presentCandidate(candidate, approved)));

  const otherRevision = { ...approved, candidate_checksum: `sha256:${"b".repeat(64)}` };
  assert.equal(presentCandidate(candidate, otherRevision).status, "stale");
  assert.equal(isAcceptedByHuman(presentCandidate(candidate, otherRevision)), false);
  assert.equal(presentCandidate(candidate, { ...approved, schema_version: undefined }).status, "blocked");
  assert.equal(presentCandidate(candidate, { ...approved, reviewer: {} }).status, "blocked");
  assert.equal(presentCandidate(candidate, { ...approved, candidate_checksum: "sha256:aaa" }).status, "blocked");

  const selfApproved = { ...candidate, review_status: "approved" };
  assert.equal(presentCandidate(selfApproved).status, "blocked");
  assert.equal(isAcceptedByHuman(presentCandidate(selfApproved)), false);

  assert.equal(presentCandidate(candidate, { ...approved, status: "rejected" }).status, "dismissed");
  assert.equal(presentCandidate(candidate, { ...approved, status: "changes-requested" }).status, "in-review");
});

await test("candidate evidence comes only from matching repository receipts", () => {
  const candidate = { schema_version: "corex.vega-skill-candidate.v1", candidate_id: "c1", content_checksum: `sha256:${"a".repeat(64)}`, name: "Draft", source_repository: { nwo: "example/project" }, source_snapshot_identity: { snapshot_id: "snap-1" }, evidence_summary: "Pinned source", provenance_references: ["snapshot:snap-1"] };
  const run = { action_kind: "candidate.validate", repo: { nwo: "example/project" }, run_id: "run-1", result: { candidate, validation: { valid: true } } };
  assert.equal(candidateReceipts([run, run], "example/project").length, 1);
  assert.equal(candidateReceipts([run], "other/project").length, 0);
  assert.equal(candidateReceipts([{ ...run, result: { candidate: { ...candidate, source_repository: { nwo: "other/project" } } } }], "example/project").length, 0);
  assert.equal(candidateReceipts([run], "example/project")[0].validation, "Receipt reports valid");
});

await test("synthetic desk selection does not overwrite live selection", () => {
  assert.notEqual(deskSelectionKey("fixture"), deskSelectionKey("live"));
  assert.equal(deskSelectionKey("live"), "vega-lab:desk-selection");
});

await test("locked workflow stages are human gates", () => {
  const locked = presentWorkflowStage("locked");
  assert.equal(locked.status, "locked");
  assert.equal(locked.label, "Human gate");
  assert.equal(presentWorkflowStage("pending").status, "untracked");
  assert.ok(VEGA_WORKFLOW_STAGES.some((stage) => stage.locked && stage.id === "corex.apply"));
  assert.ok(VEGA_WORKFLOW_STAGES.filter((stage) => stage.locked).every((stage) => !stage.actionKind));
});

// ---------------------------------------------------------------- data states

await test("dataset loader reports ready, empty, missing, invalid", async () => {
  const fetchImpl = fakeFetch({
    "/ready.json": response(200, "[1,2]"),
    "/empty.json": response(200, "[]"),
    "/bad.json": response(200, "{not json"),
    "/object.json": response(200, "{\"a\":1}"),
  });
  assert.equal((await loadDataset(["/ready.json"], "array", fetchImpl)).state, "ready");
  assert.equal((await loadDataset(["/empty.json"], "array", fetchImpl)).state, "empty");
  assert.equal((await loadDataset(["/nope.json"], "array", fetchImpl)).state, "missing");
  assert.equal((await loadDataset(["/bad.json"], "array", fetchImpl)).state, "invalid");
  assert.equal((await loadDataset(["/object.json"], "array", fetchImpl)).state, "invalid");
  const fallback = await loadDataset(["/nope.json", "/ready.json"], "array", fetchImpl);
  assert.equal(fallback.state, "ready");
  assert.equal(fallback.source, "/ready.json");
});

await test("Vite SPA HTML fallback is reported as missing, not as data or a crash", async () => {
  const fetchImpl = fakeFetch({ "/data.json": response(200, "<!doctype html><html></html>", "text/html") });
  const result = await loadDataset(["/data.json"], "array", fetchImpl);
  assert.equal(result.state, "missing");
  assert.deepEqual(result.data, []);
  assert.match(result.detail, /HTML/);
  const noHeader = fakeFetch({ "/data.json": response(200, "  <html>", "") });
  assert.equal((await loadDataset(["/data.json"], "array", noHeader)).state, "missing");
});

await test("offline network errors degrade to missing with the error detail", async () => {
  const fetchImpl = fakeFetch({ "/data.json": new Error("Failed to fetch") });
  const result = await loadDataset(["/data.json"], "object", fetchImpl);
  assert.equal(result.state, "missing");
  assert.equal(result.data, null);
  assert.match(result.detail, /Failed to fetch/);
});

await test("snapshot freshness marks old snapshots stale", () => {
  const now = Date.parse("2026-11-05T00:00:00Z");
  assert.equal(snapshotFreshness("2026-11-03T00:00:00Z", now).freshness, "fresh");
  assert.equal(snapshotFreshness("2026-10-01T00:00:00Z", now).freshness, "stale");
  assert.equal(snapshotFreshness(undefined, now).freshness, "unknown");
  assert.equal(snapshotFreshness("1970-01-01T00:00:00.000Z", now).freshness, "unknown");
});

await test("fixtures are opt-in only", () => {
  assert.equal(requestedDataMode(""), "live");
  assert.equal(requestedDataMode("?fixtures=1"), "live");
  assert.equal(requestedDataMode("?fixtures=synthetic"), "fixture");
});

await test("overall data state is honest", () => {
  const ready = { label: "a", state: "ready", count: 1, detail: "" };
  const missing = { label: "b", state: "missing", count: null, detail: "" };
  const empty = { label: "c", state: "empty", count: 0, detail: "" };
  const fixture = { label: "d", state: "fixture", count: 1, detail: "" };
  assert.equal(summarizeDataState([missing], [missing]), "unavailable");
  assert.equal(summarizeDataState([empty], [missing]), "empty");
  assert.equal(summarizeDataState([ready], [missing]), "partial");
  assert.equal(summarizeDataState([ready], [ready]), "ready");
  assert.equal(summarizeDataState([fixture], [fixture]), "fixture");
});

// ---------------------------------------------------------------- attention + next step

await test("every prepared next-step prompt routes to its typed action", () => {
  for (const [actionKind, prompt] of Object.entries(NEXT_STEP_PROMPTS)) {
    const inferred = inferActionFromPrompt(prompt, "mlx");
    assert.ok(inferred, `no action inferred for ${actionKind}`);
    assert.equal(inferred.actionKind, actionKind, `prompt for ${actionKind} routed to ${inferred.actionKind}`);
  }
});

const fixture = await buildSyntheticObservatory();
const attentionInput = {
  starred: fixture.starredRepos,
  mine: fixture.myRepos,
  signals: fixture.repoSignals,
  queue: fixture.researchQueue,
  actionItems: fixture.actionItems,
  runs: fixture.actionRuns,
  mineHealth: fixture.mineHealth,
};
const queue = buildAttentionQueue(attentionInput);
const byNwo = new Map(queue.map((entry) => [entry.nwo, entry]));

await test("attention queue ranks blocked and in-review work first with reasons", () => {
  assert.ok(queue.length > 0);
  const top = queue[0];
  assert.equal(top.band, "decide");
  assert.ok(top.reasons.length > 0);
  for (let index = 1; index < queue.length; index += 1) {
    assert.ok(queue[index - 1].priority >= queue[index].priority);
  }
  const blocked = byNwo.get("synthetic-upstream/doc-layout-ocr");
  assert.ok(blocked.blockedRun);
  assert.equal(blocked.nextStep.kind, "resolve-blocker");
  assert.equal(blocked.nextStep.requiresHuman, true);
  assert.equal(blocked.nextStep.prompt, undefined, "blockers are resolved by people, not re-run from a button");
  const reviewing = byNwo.get("synthetic-upstream/skill-refinery");
  assert.equal(reviewing.nextStep.kind, "continue-review");
});

await test("dismissed and ignorable repos stay out of the attention queue", () => {
  assert.equal(byNwo.has("synthetic-upstream/md-slides-lite"), false);
});

await test("a fully receipted workflow ends at a human gate, never at an apply button", () => {
  const packKit = byNwo.get("synthetic-upstream/repo-pack-kit");
  assert.equal(packKit.nextStep.kind, "run-action");
  assert.equal(packKit.nextStep.actionKind, "dossier.generate");
  const withDossier = buildAttentionQueue({
    ...attentionInput,
    runs: [
      ...attentionInput.runs,
      { ...attentionInput.runs[0], run_id: "synthetic-run-099", action_kind: "dossier.generate", action_id: "dossier.generate", completed_at: "2026-11-01T10:00:00.000Z" },
    ],
  }).find((entry) => entry.nwo === "synthetic-upstream/repo-pack-kit");
  assert.equal(withDossier.nextStep.kind, "human-gate");
  assert.equal(withDossier.nextStep.requiresHuman, true);
  assert.equal(withDossier.nextStep.actionKind, undefined);
  assert.ok(withDossier.stages.filter((stage) => stage.state === "locked").length >= 5);
});

await test("next steps never target locked stages or non-draft writes", () => {
  const lockedIds = new Set(VEGA_WORKFLOW_STAGES.filter((stage) => stage.locked).map((stage) => stage.id));
  for (const entry of queue) {
    const step = entry.nextStep;
    if (step.actionKind) {
      assert.equal(lockedIds.has(step.actionKind), false);
      assert.ok(Object.keys(NEXT_STEP_PROMPTS).includes(step.actionKind));
    }
    if (step.requiresHuman) assert.equal(step.actionKind, undefined);
  }
});

await test("untracked starred repos get a queue-research next step", () => {
  const step = deriveNextStep({
    source: "starred",
    signal: { adoptionKind: "tool", adoptionScore: 70 },
    queueItem: null,
    activeActions: [],
    blockedRun: null,
    stages: [],
  });
  assert.equal(step.kind, "queue-research");
  assert.equal(step.actionKind, "review.queue");
  assert.equal(step.writesDraft, true);
});

await test("owned repos surface their highest-priority open draft", () => {
  const legacy = byNwo.get("example-observatory/legacy-dashboard");
  assert.equal(legacy.source, "owned");
  assert.equal(legacy.nextStep.kind, "review-draft");
  assert.ok(legacy.nextStep.actionItemId);
  const notes = byNwo.get("example-observatory/observatory-notes");
  assert.equal(notes.visibility, "private");
});

await test("dossier risks surface license, privacy, blockers and the heuristic caveat", () => {
  const notes = byNwo.get("example-observatory/observatory-notes");
  const privateRisks = buildDossierRisks({ repo: notes.repo, signal: notes.signal, inspection: null, blockedRun: null });
  assert.ok(privateRisks.some((risk) => /Private repository/.test(risk.text) && risk.provenance === "source-fact"));
  const ocr = byNwo.get("synthetic-upstream/doc-layout-ocr");
  const ocrRisks = buildDossierRisks({ repo: ocr.repo, signal: ocr.signal, inspection: null, blockedRun: ocr.blockedRun });
  assert.equal(ocrRisks[0].severity, "blocking");
  assert.ok(ocrRisks.some((risk) => /No license declared/.test(risk.text)));
  assert.ok(ocrRisks.some((risk) => /Heuristic scores are not findings/.test(risk.text)));
  const unknown = buildDossierRisks({ repo: null, signal: null, inspection: null, blockedRun: null });
  assert.ok(unknown.some((risk) => /Source facts are unknown/.test(risk.text)));
});

// ---------------------------------------------------------------- synthetic fixture

await test("synthetic fixture is labeled, deterministic, and contains no approvals", async () => {
  assert.equal(fixture.meta.synthetic, true);
  assert.match(fixture.meta.label, /SYNTHETIC/);
  for (const repo of [...fixture.starredRepos, ...fixture.myRepos]) {
    assert.match(repo.description, /^Synthetic fixture:/, repo.name);
    assert.ok(["synthetic-upstream", "example-observatory"].includes(repo.author));
  }
  for (const run of fixture.actionRuns) {
    assert.equal(run.review_state, "pending");
    assert.equal(run.visibility, "internal");
  }
  assert.equal(fixture.actionItems.some((item) => item.status === "accepted" || item.status === "done"), false);
  const onDisk = await fs.readFile(FIXTURE_PATH, "utf8");
  assert.equal(onDisk, serializeFixture(await buildSyntheticObservatory()), "fixture drifted; run node scripts/build-synthetic-fixtures.js");
  assert.equal(path.relative(projectRoot, FIXTURE_PATH).startsWith(path.join("tests", "fixtures")), true);
});

console.log(`\n${passed} observatory model tests passed`);
