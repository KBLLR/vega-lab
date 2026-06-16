#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { executeVegaAction, listVegaActionRuns } from "../src/server/action-bridge.js";
import {
  buildSourceSnapshotFromEvidence,
  stablePrettyStringify,
} from "../scripts/source-snapshot-resolver.js";

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function createFixtureRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vega-action-bridge-"));
  const repo = {
    name: "agent-toolkit",
    author: "example",
    description: "Deterministic agent workflow toolkit.",
    stars: 1234,
    forks: 98,
    open_issues: 3,
    date: "2026-01-01T00:00:00.000Z",
    last_updated: "2026-06-01T00:00:00.000Z",
    primary_language: "TypeScript",
    language: "TypeScript",
    license: "MIT",
    languages: [{ language: "TypeScript", percentage: "100" }],
    topics: ["agent", "workflow", "mcp"],
    url: "https://github.com/example/agent-toolkit",
    has_readme: true,
  };

  await writeJson(path.join(root, "data", "data.json"), [repo]);
  await writeJson(path.join(root, "data", "my-repos.json"), []);
  await writeJson(path.join(root, "data", "research-queue.json"), []);
  await writeJson(path.join(root, "data", "action-items.json"), []);
  await writeJson(path.join(root, "data", "repo-ops-kits.json"), []);
  await writeJson(path.join(root, "data", "repo-signals.json"), [{
    nwo: "example/agent-toolkit",
    name: "agent-toolkit",
    author: "example",
    description: repo.description,
    scope: "starred",
    lastActivityAt: repo.last_updated,
    staleness: "active",
    researchStatus: "untracked",
    adoptionScore: 82,
    adoptionKind: "tool",
    reasons: ["Agent workflow toolkit with MCP topics."],
    houseSkills: ["repo-discovery", "skill-extraction", "repo-adoption"],
    capabilities: ["agent-workflows", "mcp-tooling"],
  }]);
  await writeJson(path.join(root, "data", "skill-extractions.json"), [{
    nwo: "example/agent-toolkit",
    name: "agent-toolkit",
    author: "example",
    summary: "Reusable agent workflow patterns for MCP-backed tools.",
    capabilities: ["agent-workflows", "mcp-tooling"],
    houseSkills: ["skill-extraction", "repo-adoption"],
    rules: ["Keep tool execution behind typed contracts."],
    flows: ["skill-extraction-flow"],
    adoptionKind: "tool",
    codexBrief: "Codex mission",
    claudeBrief: "Claude mission",
  }]);

  return root;
}

async function writeImmutableSnapshot(projectRoot, repo) {
  const commitSha = "a".repeat(40);
  const treeSha = "b".repeat(40);
  const snapshot = buildSourceSnapshotFromEvidence({
    repository: repo,
    githubRepo: {
      default_branch: "main",
      description: repo.description,
      language: repo.primary_language,
      license: { spdx_id: repo.license },
      topics: repo.topics,
      private: false,
    },
    requestedRef: "main",
    refType: "branch",
    commit: {
      sha: commitSha,
      tree_sha: treeSha,
      committed_at: "2026-06-12T00:00:00.000Z",
    },
    tree: {
      sha: treeSha,
      truncated: false,
    },
    evidence: [
      {
        kind: "readme",
        path: "README.md",
        blob_sha: "c".repeat(40),
        content_sha256: "sha256:35a528211dbf54569e622969c569685ea27156d37373637c4751ded08e9d3f4e",
        size: 52,
        text_preview: "# Agent Toolkit\n\nDeterministic agent workflow toolkit.",
      },
      {
        kind: "license",
        path: "LICENSE",
        blob_sha: "d".repeat(40),
        content_sha256: "sha256:2c73f0eec270c48d35dbe2f0b742d3a45eb1fda715d9c98a5d271610000784f7",
        size: 38,
        text_preview: "MIT License\n\nPermission is hereby granted...",
      },
      {
        kind: "manifest",
        path: "package.json",
        blob_sha: "e".repeat(40),
        content_sha256: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
        size: 28,
        text_preview: "{\"name\":\"agent-toolkit\"}",
      },
    ],
  });
  const snapshotPath = path.join(projectRoot, snapshot.artifact_ref);
  await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
  await fs.writeFile(snapshotPath, stablePrettyStringify(snapshot), "utf8");
  await writeJson(path.join(projectRoot, "data", "review", "source-snapshots", "index.json"), {
    entries: {
      "example/agent-toolkit": {
        nwo: "example/agent-toolkit",
        artifact_ref: snapshot.artifact_ref,
        snapshot_id: snapshot.id,
        resolved_commit_sha: snapshot.metadata.immutable.resolved_commit_sha,
        resolved_tree_sha: snapshot.metadata.immutable.resolved_tree_sha,
        evidence_contract_version: snapshot.metadata.immutable.evidence_contract_version,
        evidence_digest: snapshot.metadata.immutable.evidence_digest,
      },
    },
  });
  return snapshot;
}

async function main() {
  const root = await createFixtureRoot();
  const repo = { name: "agent-toolkit", author: "example" };

  await assert.rejects(
    () => executeVegaAction(root, {
      action_kind: "repo.inspect",
      repo,
      extra: true,
    }),
    /Unknown request field/,
  );

  await assert.rejects(
    () => executeVegaAction(root, {
      action_kind: "repo.inspect",
      repo: { name: "../agent-toolkit", author: "example" },
    }),
    /Invalid repository identity/,
  );

  const inspect = await executeVegaAction(root, {
    action_kind: "repo.inspect",
    repo,
  });
  assert.equal(inspect.status, "succeeded");
  assert.equal(inspect.review_state, "pending");
  assert.equal(inspect.visibility, "internal");
  assert.equal(inspect.result.adoption_fit.kind, "tool");

  const queued = await executeVegaAction(root, {
    action_kind: "review.queue",
    repo,
    write: true,
    parameters: { status: "queued", notes: "Fixture queue item." },
  });
  assert.equal(queued.status, "succeeded");
  assert.equal(queued.result.item.status, "queued");
  assert.ok(await exists(path.join(root, "data", "research-queue.json")));

  const ops = await executeVegaAction(root, {
    action_kind: "ops-kit.generate",
    repo,
    parameters: { target: "mlx", artifactKind: "readme" },
  });
  assert.equal(ops.status, "succeeded");
  assert.equal(ops.result.artifacts.length, 1);
  assert.equal(ops.result.artifacts[0].kind, "readme");

  const mission = await executeVegaAction(root, {
    action_kind: "mission.generate",
    repo,
    parameters: { target: "mlx" },
  });
  assert.equal(mission.status, "succeeded");
  assert.match(mission.result.mission, /Local MLX Mission/);

  const snapshotWithoutConfirmation = await executeVegaAction(root, {
    action_kind: "snapshot.resolve",
    repo,
    write: true,
  });
  assert.equal(snapshotWithoutConfirmation.status, "blocked");
  assert.equal(snapshotWithoutConfirmation.error_code, "confirmation_required");
  assert.ok(snapshotWithoutConfirmation.artifacts.some((artifact) => artifact.kind === "action-run"));

  const blockedCandidate = await executeVegaAction(root, {
    action_kind: "candidate.build",
    repo,
    write: true,
  });
  assert.equal(blockedCandidate.status, "blocked");
  assert.equal(blockedCandidate.error_code, "candidate_validation_blocked");
  assert.ok(!blockedCandidate.artifacts.some((artifact) => artifact.kind === "skill-candidate"));

  await writeImmutableSnapshot(root, {
    ...repo,
    description: "Deterministic agent workflow toolkit.",
    primary_language: "TypeScript",
    license: "MIT",
    topics: ["agent", "workflow", "mcp"],
    url: "https://github.com/example/agent-toolkit",
  });

  const candidate = await executeVegaAction(root, {
    action_kind: "candidate.build",
    repo,
    write: true,
  });
  assert.equal(candidate.status, "succeeded");
  assert.equal(candidate.action_id, "candidate.build");
  assert.match(candidate.run_id, /^vega-action-candidate-build-/);
  assert.match(candidate.input_digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(candidate.requested_at.length > 0, true);
  assert.deepEqual(candidate.warnings, []);
  assert.equal(candidate.result.candidate.review_status, "pending");
  assert.ok(candidate.artifacts.some((artifact) => artifact.kind === "skill-candidate"));
  assert.ok(candidate.artifacts.some((artifact) => artifact.kind === "action-run"));
  assert.ok(candidate.artifacts.every((artifact) => !String(artifact.path || "").startsWith("/")));
  assert.equal(await exists(path.join(root, "data", "review", "capability-promotion-proposals")), false);

  const validation = await executeVegaAction(root, {
    action_kind: "candidate.validate",
    candidate_id: candidate.result.candidate.candidate_id,
  });
  assert.equal(validation.status, "succeeded");
  assert.equal(validation.result.candidate.candidate_id, candidate.result.candidate.candidate_id);

  const dossier = await executeVegaAction(root, {
    action_kind: "dossier.generate",
    candidate_id: candidate.result.candidate.candidate_id,
    write: true,
  });
  assert.equal(dossier.status, "succeeded");
  assert.equal(dossier.result.file_count, 12);
  assert.ok(dossier.artifacts.some((artifact) => artifact.path.endsWith("11-checksums.json")));
  assert.ok(dossier.artifacts.some((artifact) => artifact.path.endsWith("03-promotion-boundary.md")));
  assert.ok(!dossier.artifacts.some((artifact) => artifact.path.includes("promotion-proposal")));

  const runs = await listVegaActionRuns(root);
  assert.ok(runs.length >= 6);
  assert.ok(runs.every((run) => run.visibility === "internal"));
  assert.ok(runs.every((run) => run.review_state === "pending"));
  assert.ok(runs.every((run) => run.run_id));
  assert.ok(runs.every((run) => run.input_digest));
  assert.ok(runs.every((run) => run.artifacts.some((artifact) => artifact.kind === "action-run")));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
