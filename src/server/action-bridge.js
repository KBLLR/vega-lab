import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  buildMissionBriefForTarget,
  findRepoInspection,
  findSkillExtraction,
  generateDerivedHouseData,
  generateRepoOpsKit,
  loadHouseDatasets,
  resolveRepoRecord,
  updateResearchQueue,
} from "./house-model.js";
import {
  buildPromotionProposal,
  buildSkillCandidateIngestion,
  getSkillCandidate,
  validateSkillCandidate,
} from "../../scripts/build-skill-candidates.js";
import {
  checkSourceSnapshot,
  resolveSourceSnapshot,
  slug,
  stablePrettyStringify,
} from "../../scripts/source-snapshot-resolver.js";

const ACTION_SCHEMA_VERSION = "vega.action-result.v1";
const REVIEW_STATE = "pending";
const VISIBILITY = "internal";
const ACTION_KINDS = new Set([
  "repo.inspect",
  "snapshot.resolve",
  "candidate.build",
  "candidate.validate",
  "dossier.generate",
  "review.queue",
  "ops-kit.generate",
  "mission.generate",
]);

function now() {
  return new Date().toISOString();
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function nwoFromRepo(repo) {
  if (!repo) return "";
  if (repo.nwo) return String(repo.nwo);
  return [repo.author, repo.name].filter(Boolean).join("/");
}

function normalizeRepoInput(repo = {}) {
  const nwo = nwoFromRepo(repo);
  const [authorFromNwo, nameFromNwo] = nwo.split("/");
  return {
    name: repo.name || nameFromNwo,
    author: repo.author || authorFromNwo,
    nwo,
  };
}

function normalizeRequest(request = {}) {
  const actionKind = String(request.action_kind || "");
  if (!ACTION_KINDS.has(actionKind)) {
    throw Object.assign(new Error(`Unsupported Vega action kind: ${actionKind || "missing"}`), {
      code: "unsupported_action_kind",
      retryable: false,
    });
  }
  return {
    action_kind: actionKind,
    repo: normalizeRepoInput(request.repo || {}),
    candidate_id: request.candidate_id || request.parameters?.candidate_id || null,
    parameters: request.parameters && typeof request.parameters === "object" ? request.parameters : {},
    write: request.write === true,
  };
}

function actionId(request) {
  const target = request.candidate_id || request.repo?.nwo || `${request.repo?.author || ""}/${request.repo?.name || ""}`;
  return `vega-action-${slug(`${request.action_kind}-${target || "unknown"}`)}-${Date.now()}`;
}

function relativeToRoot(root, filePath) {
  return path.relative(root, filePath).replaceAll(path.sep, "/");
}

function reviewRoot(root) {
  return path.join(root, "data", "review");
}

function safeReviewPath(root, ...segments) {
  const base = reviewRoot(root);
  const target = path.resolve(base, ...segments);
  if (!target.startsWith(path.resolve(base) + path.sep) && target !== path.resolve(base)) {
    throw Object.assign(new Error("Refusing to write outside data/review"), {
      code: "unsafe_review_path",
      retryable: false,
    });
  }
  return target;
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeText(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, "utf8");
}

function createStep(id, label) {
  const started = now();
  return {
    id,
    label,
    status: "running",
    started_at: started,
  };
}

function finishStep(step, detail = "") {
  step.status = "succeeded";
  step.completed_at = now();
  if (detail) step.detail = detail;
  return step;
}

function failStep(step, detail = "") {
  step.status = "failed";
  step.completed_at = now();
  if (detail) step.detail = detail;
  return step;
}

async function loadContext(root) {
  const datasets = await loadHouseDatasets(root);
  const derived = await generateDerivedHouseData(root, datasets);
  return {
    datasets,
    derived,
    repos: [...datasets.myRepos, ...datasets.starredRepos],
  };
}

function resolveRepoOrThrow(request, context) {
  const repo = resolveRepoRecord(request.repo, {
    starredRepos: context.datasets.starredRepos,
    myRepos: context.datasets.myRepos,
  });
  if (!repo) {
    throw Object.assign(new Error(`Repository not found: ${request.repo.nwo || request.repo.name}`), {
      code: "repo_not_found",
      retryable: false,
    });
  }
  return repo;
}

function actionRepo(repo) {
  return {
    nwo: nwoFromRepo(repo),
    name: repo.name,
    author: repo.author,
  };
}

async function persistRun(root, run) {
  const filePath = safeReviewPath(root, "action-runs", `${slug(run.action_id)}.json`);
  await writeJson(filePath, run);
  run.artifacts.push({
    kind: "action-run",
    path: relativeToRoot(root, filePath),
    checksum: `sha256:${sha256(JSON.stringify(run))}`,
  });
}

async function runRepoInspect(root, request, run) {
  const step = createStep("repo.inspect", "Load repo metadata, signals, skill extraction, and inspection");
  run.steps.push(step);
  const context = await loadContext(root);
  const repo = resolveRepoOrThrow(request, context);
  const nwo = nwoFromRepo(repo);
  const signal = context.derived.repoSignals.find((item) => item.nwo?.toLowerCase() === nwo.toLowerCase()) || null;
  const extraction = findSkillExtraction(context.derived.skillExtractions, nwo);
  const inspection = findRepoInspection(context.derived.repoInspections, nwo);
  run.repo = actionRepo(repo);
  run.result = {
    repo,
    signal,
    extraction,
    inspection,
    adoption_fit: {
      kind: signal?.adoptionKind || extraction?.adoptionKind || "ignore",
      score: signal?.adoptionScore ?? null,
      reasons: signal?.reasons || [],
      first_action: "Queue for research, resolve immutable source snapshot, then build a pending skill candidate if evidence is strong.",
    },
  };
  finishStep(step, `Loaded ${nwo}`);
}

async function runReviewQueue(root, request, run) {
  const context = await loadContext(root);
  const repo = resolveRepoOrThrow(request, context);
  const nwo = nwoFromRepo(repo);
  const step = createStep("review.queue", "Persist repository in the research queue");
  run.steps.push(step);
  const item = await updateResearchQueue(root, {
    nwo,
    status: String(request.parameters.status || "queued"),
    notes: String(request.parameters.notes || "Queued from Vega action bridge."),
    priority: String(request.parameters.priority || "normal"),
  });
  const signal = context.derived.repoSignals.find((entry) => entry.nwo?.toLowerCase() === nwo.toLowerCase()) || null;
  const extraction = findSkillExtraction(context.derived.skillExtractions, nwo);
  run.repo = actionRepo(repo);
  run.result = {
    item,
    signal,
    extraction,
    adoption_fit: {
      kind: signal?.adoptionKind || extraction?.adoptionKind || "ignore",
      score: signal?.adoptionScore ?? null,
      reasons: signal?.reasons || [],
    },
    durable_state: "data/research-queue.json",
  };
  finishStep(step, `Queued ${nwo}`);
}

async function runOpsKit(root, request, run) {
  const context = await loadContext(root);
  const repo = resolveRepoOrThrow(request, context);
  const step = createStep("ops-kit.generate", "Generate draft-only repo ops kit");
  run.steps.push(step);
  const kit = await generateRepoOpsKit(root, {
    name: repo.name,
    author: repo.author,
    target: request.parameters.target || "mlx",
  });
  run.repo = actionRepo(repo);
  const artifactKind = request.parameters.artifactKind || request.parameters.artifact_kind || null;
  run.result = artifactKind
    ? {
        ...kit,
        artifacts: kit.artifacts.filter((artifact) => artifact.kind === artifactKind),
      }
    : kit;
  finishStep(step, `Generated ${kit.artifacts.length} draft artifacts`);
}

async function runMission(root, request, run) {
  const context = await loadContext(root);
  const repo = resolveRepoOrThrow(request, context);
  const nwo = nwoFromRepo(repo);
  const extraction = findSkillExtraction(context.derived.skillExtractions, nwo);
  if (!extraction) {
    throw Object.assign(new Error(`No skill extraction exists for ${nwo}`), {
      code: "missing_skill_extraction",
      retryable: false,
    });
  }
  const step = createStep("mission.generate", "Generate model-targeted mission brief");
  run.steps.push(step);
  const target = request.parameters.target || "mlx";
  run.repo = actionRepo(repo);
  run.result = {
    target,
    mission: buildMissionBriefForTarget(extraction, target),
    extraction,
  };
  finishStep(step, `Generated ${target} mission`);
}

async function runSnapshot(root, request, run) {
  const context = await loadContext(root);
  const repo = resolveRepoOrThrow(request, context);
  const step = createStep("snapshot.resolve", request.write ? "Resolve and cache immutable source snapshot" : "Check cached immutable source snapshot");
  run.steps.push(step);
  run.repo = actionRepo(repo);
  const result = request.write
    ? await resolveSourceSnapshot(repo, { projectRoot: root, ref: request.parameters.ref || null, write: true })
    : await checkSourceSnapshot(repo, { projectRoot: root });
  run.result = result.snapshot
    ? {
        ok: true,
        cache_hit: result.cache_hit,
        wrote: result.wrote,
        snapshot_id: result.snapshot.id,
        artifact_ref: result.snapshot.artifact_ref,
        commit: result.snapshot.metadata?.immutable?.resolved_commit_sha,
        tree: result.snapshot.metadata?.immutable?.resolved_tree_sha,
        evidence_digest: result.snapshot.metadata?.immutable?.evidence_digest,
      }
    : result;
  if (result.snapshot?.artifact_ref) {
    run.artifacts.push({ kind: "source-snapshot", path: result.snapshot.artifact_ref });
  }
  finishStep(step, result.snapshot ? `Snapshot ${result.snapshot.id}` : `Snapshot check ${result.ok ? "ok" : "blocked"}`);
}

async function findCandidateForRequest(root, request) {
  const candidateId = request.candidate_id;
  if (candidateId) {
    return getSkillCandidate(candidateId, {
      projectRoot: root,
      limit: Number(request.parameters.limit || 250),
      all: true,
    });
  }

  const nwo = request.repo?.nwo || [request.repo?.author, request.repo?.name].filter(Boolean).join("/");
  const result = await buildSkillCandidateIngestion({
    projectRoot: root,
    limit: Number(request.parameters.limit || 250),
    all: true,
    dryRun: true,
  });
  return result.candidates.find((candidate) => candidate.source_repository?.nwo?.toLowerCase() === nwo.toLowerCase()) || null;
}

async function writeCandidateAndProposal(root, candidate, run) {
  const safeId = slug(candidate.candidate_id);
  const candidatePath = safeReviewPath(root, "skill-candidates", `${safeId}.json`);
  await writeJson(candidatePath, candidate);
  run.artifacts.push({
    kind: "skill-candidate",
    path: relativeToRoot(root, candidatePath),
    checksum: candidate.content_checksum,
  });

  const proposal = buildPromotionProposal(candidate, {
    reviewArtifactRef: relativeToRoot(root, candidatePath),
  });
  const proposalPath = safeReviewPath(root, "capability-promotions", `${safeId}.json`);
  await writeJson(proposalPath, proposal);
  run.artifacts.push({
    kind: "capability-promotion-proposal",
    path: relativeToRoot(root, proposalPath),
    checksum: `sha256:${sha256(JSON.stringify(proposal))}`,
  });
  return proposal;
}

async function runCandidateBuild(root, request, run) {
  const step = createStep("candidate.build", "Build deterministic review-gated skill candidate");
  run.steps.push(step);
  const candidate = await findCandidateForRequest(root, request);
  if (!candidate) {
    throw Object.assign(new Error("No skill candidate matched the selected repository or candidate id."), {
      code: "candidate_not_found",
      retryable: false,
    });
  }
  run.repo = {
    nwo: candidate.source_repository.nwo,
  };
  run.candidate_id = candidate.candidate_id;
  const validation = validateSkillCandidate(candidate);
  let proposal = buildPromotionProposal(candidate);
  if (request.write !== false) {
    proposal = await writeCandidateAndProposal(root, candidate, run);
  }
  run.result = {
    candidate,
    validation,
    proposal,
    wrote: request.write !== false,
  };
  finishStep(step, `${candidate.candidate_id} (${validation.valid ? "valid" : "blocked"})`);
}

async function runCandidateValidate(root, request, run) {
  const step = createStep("candidate.validate", "Validate candidate schema, checksum, provenance, and safety findings");
  run.steps.push(step);
  const candidate = await findCandidateForRequest(root, request);
  if (!candidate) {
    throw Object.assign(new Error("No skill candidate matched the selected repository or candidate id."), {
      code: "candidate_not_found",
      retryable: false,
    });
  }
  run.repo = {
    nwo: candidate.source_repository.nwo,
  };
  run.candidate_id = candidate.candidate_id;
  run.result = {
    candidate,
    validation: validateSkillCandidate(candidate),
  };
  finishStep(step, candidate.candidate_id);
}

async function checksumWrittenFiles(files) {
  const checksums = {};
  for (const filePath of files) {
    checksums[path.basename(filePath)] = `sha256:${sha256(await fs.readFile(filePath, "utf8"))}`;
  }
  return checksums;
}

async function runDossier(root, request, run) {
  const step = createStep("dossier.generate", "Generate complete internal human approval packet");
  run.steps.push(step);
  const candidate = await findCandidateForRequest(root, request);
  if (!candidate) {
    throw Object.assign(new Error("No skill candidate matched the selected repository or candidate id."), {
      code: "candidate_not_found",
      retryable: false,
    });
  }

  const validation = validateSkillCandidate(candidate);
  const proposal = buildPromotionProposal(candidate);
  const safeId = slug(candidate.candidate_id);
  const packetDir = safeReviewPath(root, "approval-packets", safeId);
  const snapshot = candidate.source_snapshot_identity?.artifact_ref
    ? await readJson(path.join(root, candidate.source_snapshot_identity.artifact_ref), null)
    : null;

  const files = [
    ["00-DECISION-SUMMARY.md", [
      `# Decision Summary: ${candidate.name}`,
      "",
      `- Candidate: ${candidate.candidate_id}`,
      `- Suggested skill: ${candidate.suggested_skill_id}`,
      `- Review state: pending`,
      `- Visibility: internal`,
      `- Validation: ${validation.valid ? "valid" : "blocked"}`,
      "",
      "No approval is granted by this packet. It exists for human review only.",
      "",
    ].join("\n")],
    ["01-candidate.json", stablePrettyStringify(candidate)],
    ["02-validation.json", stablePrettyStringify(validation)],
    ["03-promotion-proposal.json", stablePrettyStringify(proposal)],
    ["04-source-snapshot.json", stablePrettyStringify(snapshot || { missing: candidate.source_snapshot_identity?.artifact_ref || null })],
    ["05-evidence.md", [
      `# Evidence: ${candidate.name}`,
      "",
      candidate.evidence_summary,
      "",
      "## Provenance",
      ...candidate.provenance_references.map((ref) => `- ${ref}`),
      "",
    ].join("\n")],
    ["06-risks-and-conflicts.md", [
      `# Risks and Conflicts: ${candidate.name}`,
      "",
      "## Conflicts",
      ...(candidate.conflict_findings.length ? candidate.conflict_findings.map((finding) => `- ${finding.severity}: ${finding.summary}`) : ["- None reported."]),
      "",
      "## Risks",
      ...(candidate.risk_findings.length ? candidate.risk_findings.map((finding) => `- ${finding.severity}: ${finding.summary}`) : ["- None reported."]),
      "",
    ].join("\n")],
    ["07-duplicate-analysis.md", [
      `# Duplicate Analysis: ${candidate.name}`,
      "",
      ...(candidate.duplicate_matches.length ? candidate.duplicate_matches.map((match) => `- ${match.kind}: ${match.target} (${match.confidence})`) : ["- No duplicate matches reported."]),
      "",
    ].join("\n")],
    ["08-license-review.md", [
      `# License Review: ${candidate.name}`,
      "",
      `- Status: ${candidate.license_status.status}`,
      `- Identifier: ${candidate.license_status.identifier || "unknown"}`,
      ...(candidate.license_status.notes || []).map((note) => `- ${note}`),
      "",
    ].join("\n")],
    ["09-operator-checklist.md", [
      `# Operator Checklist: ${candidate.name}`,
      "",
      "- [ ] Confirm source snapshot is immutable and current.",
      "- [ ] Confirm license compatibility.",
      "- [ ] Confirm duplicate/conflict findings are acceptable.",
      "- [ ] Confirm proposed Core-X lane and scope.",
      "- [ ] Approve separately before any Core-X promotion transaction.",
      "",
    ].join("\n")],
    ["10-reproduction.md", [
      `# Reproduction: ${candidate.name}`,
      "",
      "```bash",
      "npm run resolve:source-snapshots -- --check --repo " + candidate.source_repository.nwo,
      "npm run build:skill-candidates -- --dry-run --all",
      "```",
      "",
    ].join("\n")],
  ];

  const written = [];
  for (const [name, content] of files) {
    const filePath = path.join(packetDir, name);
    await writeText(filePath, content);
    written.push(filePath);
  }
  const checksums = await checksumWrittenFiles(written);
  const checksumPath = path.join(packetDir, "11-checksums.json");
  await writeJson(checksumPath, {
    schema_version: "vega.approval-packet-checksums.v1",
    candidate_id: candidate.candidate_id,
    candidate_checksum: candidate.content_checksum,
    files: checksums,
  });
  written.push(checksumPath);

  run.repo = {
    nwo: candidate.source_repository.nwo,
  };
  run.candidate_id = candidate.candidate_id;
  run.result = {
    candidate_id: candidate.candidate_id,
    validation,
    packet_path: relativeToRoot(root, packetDir),
    file_count: written.length,
  };
  run.artifacts.push(...written.map((filePath) => ({
    kind: "approval-packet-file",
    path: relativeToRoot(root, filePath),
  })));
  finishStep(step, `Wrote ${written.length} packet files`);
}

export async function executeVegaAction(rootDir, rawRequest = {}) {
  const root = path.resolve(rootDir);
  const request = normalizeRequest(rawRequest);
  const started = now();
  const run = {
    schema_version: ACTION_SCHEMA_VERSION,
    action_id: actionId(request),
    action_kind: request.action_kind,
    status: "running",
    review_state: REVIEW_STATE,
    visibility: VISIBILITY,
    started_at: started,
    completed_at: started,
    steps: [],
    artifacts: [],
  };

  try {
    switch (request.action_kind) {
      case "repo.inspect":
        await runRepoInspect(root, request, run);
        break;
      case "review.queue":
        await runReviewQueue(root, request, run);
        break;
      case "ops-kit.generate":
        await runOpsKit(root, request, run);
        break;
      case "mission.generate":
        await runMission(root, request, run);
        break;
      case "snapshot.resolve":
        await runSnapshot(root, request, run);
        break;
      case "candidate.build":
        await runCandidateBuild(root, request, run);
        break;
      case "candidate.validate":
        await runCandidateValidate(root, request, run);
        break;
      case "dossier.generate":
        await runDossier(root, request, run);
        break;
      default:
        throw new Error(`Unhandled action kind: ${request.action_kind}`);
    }
    run.status = "succeeded";
  } catch (error) {
    const activeStep = run.steps.find((step) => step.status === "running");
    if (activeStep) failStep(activeStep, error.message);
    run.status = "failed";
    run.error = {
      code: error.code || "action_failed",
      message: error.message,
      retryable: error.retryable !== false,
    };
  } finally {
    run.completed_at = now();
    await persistRun(root, run);
  }

  return run;
}

export async function listVegaActionRuns(rootDir, { limit = 25 } = {}) {
  const dir = safeReviewPath(path.resolve(rootDir), "action-runs");
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const runs = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const value = await readJson(path.join(dir, entry.name), null);
    if (value) runs.push(value);
  }
  return runs
    .sort((left, right) => String(right.completed_at || "").localeCompare(String(left.completed_at || "")))
    .slice(0, limit);
}
