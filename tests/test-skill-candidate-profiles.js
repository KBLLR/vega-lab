#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildSkillCandidateIngestion,
  candidateContentChecksum,
  validateSkillCandidate,
} from "../scripts/build-skill-candidates.js";
import {
  buildSourceSnapshotFromEvidence,
  stablePrettyStringify,
} from "../scripts/source-snapshot-resolver.js";

const COMMIT_A = "a".repeat(40);
const COMMIT_B = "b".repeat(40);
const TREE_A = "c".repeat(40);
const TREE_B = "d".repeat(40);
const PROFILE_SCHEMA_SRC = new URL("../config/skill-candidate-profiles/schema.json", import.meta.url);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function writeProfileSchema(projectRoot) {
  const target = path.join(projectRoot, "config", "skill-candidate-profiles", "schema.json");
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(PROFILE_SCHEMA_SRC, target);
}

async function writeProfile(projectRoot, profile, name = `${profile.profile_id}.json`) {
  await writeProfileSchema(projectRoot);
  await writeJson(path.join(projectRoot, "config", "skill-candidate-profiles", name), profile);
}

async function seedVegaCaches(projectRoot, repo) {
  await writeJson(path.join(projectRoot, "data", "data.json"), [repo]);
  await writeJson(path.join(projectRoot, "data", "my-repos.json"), []);
  await writeJson(path.join(projectRoot, "data", "repo-signals.json"), [{
    nwo: "example/agent-toolkit",
    description: repo.description,
    adoptionScore: 88,
    adoptionKind: "tool",
    capabilities: ["agent-workflows", "developer-tooling"],
    houseSkills: ["skill-extraction"],
  }]);
  await writeJson(path.join(projectRoot, "data", "skill-extractions.json"), [{
    nwo: "example/agent-toolkit",
    summary: "Reusable MCP agent workflow primitives.",
    capabilities: ["agent-workflows"],
    houseSkills: ["skill-extraction"],
    flows: ["research-queue-flow"],
    adoptionKind: "tool",
  }]);
}

async function writeImmutableSnapshot(projectRoot, repo, { commitSha = COMMIT_A, treeSha = TREE_A } = {}) {
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
        blob_sha: "e".repeat(40),
        content_sha256: "sha256:35a528211dbf54569e622969c569685ea27156d37373637c4751ded08e9d3f4e",
        size: 52,
        text_preview: "# Agent Toolkit\n\nDeterministic agent workflow toolkit.",
      },
      {
        kind: "license",
        path: "LICENSE",
        blob_sha: "f".repeat(40),
        content_sha256: "sha256:2c73f0eec270c48d35dbe2f0b742d3a45eb1fda715d9c98a5d271610000784f7",
        size: 38,
        text_preview: "MIT License\n\nPermission is hereby granted...",
      },
      {
        kind: "manifest",
        path: "package.json",
        blob_sha: "1".repeat(40),
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

function profileFixture(overrides = {}) {
  const profile = {
    schema_version: "vega.skill-candidate-profile.v1",
    profile_id: "agent-toolkit-ingestion-review",
    source: {
      repository: "example/agent-toolkit",
      commit: COMMIT_A,
    },
    candidate: {
      suggested_skill_id: "agent-toolkit-ingestion-review",
      name: "Agent Toolkit Ingestion Review",
      description: "Reference and governance skill for reviewing external agent workflow systems without executing upstream runtime flows.",
      lane: "agent-workflows",
      scope: "shared",
      runtime: "markdown-prompt",
      required_tools_services: {
        tools: ["vega-lab:source-snapshot", "vega-lab:skill-candidates"],
        services: [],
      },
      compatibility_assumptions: [
        "Reference and governance markdown only; no upstream code execution is part of this candidate.",
        "Candidate relies on pinned Vega source snapshot evidence.",
      ],
      evidence_summary: "Pinned evidence shows an agent workflow toolkit. The safe Core-X use is a governance and reference checklist.",
      duplicate_matches: [],
      conflict_findings: [{
        kind: "runtime-scope",
        severity: "warning",
        summary: "Executable integration is out of scope for this candidate.",
        source_refs: ["README.md"],
      }],
      risk_findings: [{
        kind: "runtime-adapter-review",
        severity: "warning",
        summary: "Runtime adapter work requires separate review.",
        source_refs: ["package.json"],
      }],
    },
    policy: {
      purpose: "Use this skill as a Core-X review guide for evaluating external agent workflow systems.",
      when_to_use: [
        "Review pinned source evidence for agent workflow patterns.",
        "Draft bounded review notes with provenance.",
      ],
      when_not_to_use: [
        "Do not run upstream commands.",
        "Do not mutate Core-X registries.",
      ],
      relationship_to_vega: "Vega remains the evaluator and review layer. The upstream repository is reference material only.",
      safe_evaluation_workflow: [
        "Confirm immutable source snapshot identity.",
        "Inspect pinned evidence only.",
        "Produce a pending review note.",
        "Stop before install, apply, publish, upload, service start, credential use, or registry mutation.",
      ],
      immutable_provenance_requirements: [
        "Repository must be example/agent-toolkit.",
        `Commit must be ${COMMIT_A}.`,
      ],
      license_requirements: [
        "License evidence must come from the pinned source snapshot.",
      ],
      local_first_policy: "Default to offline review of pinned evidence.",
      network_restrictions: [
        "Do not fetch or scrape through the upstream runtime.",
      ],
      credential_restrictions: [
        "Do not request, echo, store, or infer credentials.",
      ],
      human_approval_gates: [
        "Human review is required before approving the candidate.",
      ],
      allowed_outputs: [
        "Reference checklist",
        "Risk findings",
      ],
      failure_conditions: [
        "Source repository or commit does not match the pinned profile.",
      ],
      prohibited_actions: [
        "Install upstream dependencies.",
        "Run upstream CLI commands.",
        "Mutate Core-X registries.",
      ],
      source_attribution: [
        "Repository: example/agent-toolkit",
        `Commit: ${COMMIT_A}`,
      ],
    },
  };
  return { ...profile, ...overrides };
}

async function buildFirstCandidate(projectRoot, corexRoot) {
  const result = await buildSkillCandidateIngestion({
    projectRoot,
    corexRoot,
    outDir: path.join(projectRoot, "data", "review"),
    dryRun: true,
    limit: 1,
    createdAt: "2026-06-13T00:00:00.000Z",
  });
  assert.equal(result.candidates.length, 1);
  return { result, candidate: result.candidates[0] };
}

async function withFixture(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vega-skill-profile-"));
  const projectRoot = path.join(root, "vega-lab");
  const corexRoot = path.join(root, "core-x");
  const repo = {
    name: "agent-toolkit",
    author: "example",
    description: "A deterministic agent workflow toolkit.",
    url: "https://github.com/example/agent-toolkit",
    stars: 700,
    forks: 40,
    primary_language: "TypeScript",
    topics: ["agent", "workflow", "mcp"],
    license: "MIT",
  };
  try {
    await seedVegaCaches(projectRoot, repo);
    await fs.mkdir(path.join(corexRoot, "skills"), { recursive: true });
    await writeImmutableSnapshot(projectRoot, repo);
    await callback({ root, projectRoot, corexRoot, repo });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function assertRejectsCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}

async function main() {
  await withFixture(async ({ projectRoot, corexRoot }) => {
    const { result, candidate } = await buildFirstCandidate(projectRoot, corexRoot);
    assert.equal(result.checks.skill_candidate_profile_count, 0);
    assert.equal(candidate.suggested_skill_id, "vega-example-agent-toolkit");
    assert.equal(candidate.candidate_profile, undefined);
    assert.equal(candidate.policy, undefined);
    assert.equal(validateSkillCandidate(candidate).valid, true);
  });

  await withFixture(async ({ projectRoot, corexRoot }) => {
    await writeProfile(projectRoot, profileFixture());
    const { result, candidate } = await buildFirstCandidate(projectRoot, corexRoot);
    assert.equal(result.checks.skill_candidate_profile_count, 1);
    assert.equal(candidate.candidate_id, "vega.skill-candidate:example-agent-toolkit");
    assert.equal(candidate.suggested_skill_id, "agent-toolkit-ingestion-review");
    assert.equal(candidate.name, "Agent Toolkit Ingestion Review");
    assert.equal(candidate.candidate_profile.profile_id, "agent-toolkit-ingestion-review");
    assert.match(candidate.candidate_profile.profile_digest, /^sha256:[a-f0-9]{64}$/);
    assert.ok(candidate.provenance_references.some((ref) => ref.startsWith("vega:skill-candidate-profile:agent-toolkit-ingestion-review:sha256:")));
    assert.equal(candidate.policy.relationship_to_vega.includes("Vega remains the evaluator"), true);
    assert.match(candidate.draft_skill_md, /## Explicit Prohibitions/);
    assert.match(candidate.draft_skill_md, /## Source Attribution/);
    assert.equal(candidate.content_checksum, candidateContentChecksum(candidate));
    assert.equal(validateSkillCandidate(candidate).valid, true);

    const tamperedDigest = clone(candidate);
    tamperedDigest.candidate_profile.profile_digest = `sha256:${"0".repeat(64)}`;
    const tamperedDigestValidation = validateSkillCandidate(tamperedDigest);
    assert.equal(tamperedDigestValidation.valid, false);
    assert.ok(tamperedDigestValidation.blockers.some((blocker) => blocker.kind === "checksum"));

    const tamperedSource = clone(candidate);
    tamperedSource.candidate_profile.source.commit = COMMIT_B;
    tamperedSource.content_checksum = candidateContentChecksum(tamperedSource);
    const tamperedSourceValidation = validateSkillCandidate(tamperedSource);
    assert.equal(tamperedSourceValidation.valid, false);
    assert.ok(tamperedSourceValidation.blockers.some((blocker) => blocker.kind === "profile_source_binding"));
  });

  await withFixture(async ({ projectRoot, corexRoot }) => {
    const profile = profileFixture();
    await writeProfile(projectRoot, profile);
    const first = await buildFirstCandidate(projectRoot, corexRoot);
    const firstChecksum = first.candidate.content_checksum;
    const firstDigest = first.candidate.candidate_profile.profile_digest;

    const changedProfile = clone(profile);
    changedProfile.policy.purpose = "Changed profile purpose for deterministic checksum coverage.";
    await writeProfile(projectRoot, changedProfile);
    const second = await buildFirstCandidate(projectRoot, corexRoot);
    assert.notEqual(second.candidate.candidate_profile.profile_digest, firstDigest);
    assert.notEqual(second.candidate.content_checksum, firstChecksum);
  });

  await withFixture(async ({ projectRoot, corexRoot, repo }) => {
    await writeProfile(projectRoot, profileFixture());
    await writeImmutableSnapshot(projectRoot, repo, { commitSha: COMMIT_B, treeSha: TREE_B });
    const { result, candidate } = await buildFirstCandidate(projectRoot, corexRoot);
    assert.equal(result.checks.skill_candidate_profile_count, 1);
    assert.equal(candidate.suggested_skill_id, "vega-example-agent-toolkit");
    assert.equal(candidate.candidate_profile, undefined);
  });

  await withFixture(async ({ projectRoot, corexRoot }) => {
    const invalid = profileFixture();
    delete invalid.policy;
    await writeProfile(projectRoot, invalid);
    await assertRejectsCode(buildFirstCandidate(projectRoot, corexRoot), "invalid_skill_candidate_profile");
  });

  await withFixture(async ({ projectRoot, corexRoot }) => {
    const first = profileFixture();
    const second = profileFixture({
      source: { repository: "example/agent-toolkit", commit: COMMIT_B },
      candidate: {
        ...profileFixture().candidate,
        suggested_skill_id: "agent-toolkit-ingestion-review-b",
      },
    });
    await writeProfile(projectRoot, first, "first.json");
    await writeProfile(projectRoot, second, "second.json");
    await assertRejectsCode(buildFirstCandidate(projectRoot, corexRoot), "invalid_skill_candidate_profile");
  });

  await withFixture(async ({ projectRoot, corexRoot }) => {
    const first = profileFixture();
    const second = profileFixture({
      profile_id: "agent-toolkit-ingestion-review-b",
      source: { repository: "example/agent-toolkit", commit: COMMIT_B },
    });
    await writeProfile(projectRoot, first, "first.json");
    await writeProfile(projectRoot, second, "second.json");
    await assertRejectsCode(buildFirstCandidate(projectRoot, corexRoot), "invalid_skill_candidate_profile");
  });
}

main().catch((error) => {
  console.error("Skill candidate profile test failed");
  console.error(error);
  process.exit(1);
});
