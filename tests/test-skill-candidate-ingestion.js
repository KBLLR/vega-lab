#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  applyReviewEnvelope,
  buildReviewEnvelope,
  buildSkillCandidateIngestion,
  candidateContentChecksum,
  getSkillCandidate,
  listSkillCandidates,
  proposeSkillPromotion,
  runBuildSkillCandidates,
  validateSkillReview,
  validateSkillCandidate,
} from "../scripts/build-skill-candidates.js";
import {
  buildSourceSnapshotFromEvidence,
  stablePrettyStringify,
} from "../scripts/source-snapshot-resolver.js";

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
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
  const originalCwd = process.cwd();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vega-skill-candidate-"));
  const corexRoot = path.join(root, "core-x");
  const projectRoot = path.join(root, "vega-lab");

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

    await fs.mkdir(path.join(corexRoot, "skills", "vega-example-agent-toolkit"), { recursive: true });
    await fs.writeFile(
      path.join(corexRoot, "skills", "vega-example-agent-toolkit", "SKILL.md"),
      "# Example Agent Toolkit\n\nExisting reviewed skill.\n",
      "utf8",
    );

    const metadataOnly = await buildSkillCandidateIngestion({
      projectRoot,
      corexRoot,
      outDir: path.join(projectRoot, "data", "review"),
      dryRun: true,
      limit: 1,
      createdAt: "2026-06-13T00:00:00.000Z",
    });
    assert.ok(metadataOnly.candidates[0].conflict_findings.some((finding) => finding.kind === "missing_immutable_source_snapshot"));
    assert.equal(validateSkillCandidate(metadataOnly.candidates[0]).valid, false);

    await writeImmutableSnapshot(projectRoot, repo);

    process.chdir(projectRoot);
    const outDir = path.join(projectRoot, "data", "review");
    const result = await buildSkillCandidateIngestion({
      projectRoot,
      corexRoot,
      outDir,
      dryRun: true,
      limit: 1,
      createdAt: "2026-06-13T00:00:00.000Z",
    });

    assert.equal(result.selected_count, 1);
    assert.equal(result.candidates.length, 1);
    assert.equal(result.proposals.length, 1);
    assert.equal(result.checks.corex_skill_index_available, true);

    const candidate = result.candidates[0];
    assert.equal(candidate.schema_version, "corex.vega-skill-candidate.v1");
    assert.equal(candidate.candidate_id, "vega.skill-candidate:example-agent-toolkit");
    assert.equal(candidate.review_status, "pending");
    assert.equal(candidate.source_repository.nwo, "example/agent-toolkit");
    assert.match(candidate.source_snapshot_identity.source_ref, /example\/agent-toolkit@[a-f0-9]{40}/);
    assert.ok(candidate.provenance_references.some((ref) => /^github:example\/agent-toolkit@[a-f0-9]{40}$/.test(ref)));
    assert.ok(candidate.provenance_references.some((ref) => /^github:example\/agent-toolkit:tree:[a-f0-9]{40}$/.test(ref)));
    assert.ok(candidate.provenance_references.some((ref) => /^vega:evidence:sha256:[a-f0-9]{64}$/.test(ref)));
    assert.equal(candidate.suggested_corex_lane, "agent-workflows");
    assert.equal(candidate.license_status.status, "compatible");
    assert.match(candidate.license_status.source, /^pinned-license-file:/);
    assert.deepEqual(Object.keys(candidate.required_tools_services).sort(), ["services", "tools"]);
    assert.ok(candidate.duplicate_matches.some((match) => match.kind === "duplicate_id"));
    assert.ok(candidate.content_checksum.startsWith("sha256:"));
    assert.equal(candidate.content_checksum, candidateContentChecksum(candidate));
    assert.ok(!JSON.stringify(candidate).includes("README body"));
    assert.ok(!JSON.stringify(candidate).includes("/Users/"));

    const validation = validateSkillCandidate(candidate);
    assert.equal(validation.valid, true);
    assert.equal(validation.checksum_ok, true);

    const invalid = validateSkillCandidate({
      ...candidate,
      description: "bad /Users/" + "davidcaballero/private-path",
    });
    assert.equal(invalid.valid, false);
    assert.ok(invalid.blockers.some((blocker) => blocker.kind === "absolute_local_path"));

    const listed = await listSkillCandidates({
      projectRoot,
      corexRoot,
      outDir,
      limit: 1,
      createdAt: "2026-06-13T00:00:00.000Z",
    });
    assert.equal(listed.count, 1);

    const fetched = await getSkillCandidate(candidate.candidate_id, {
      projectRoot,
      corexRoot,
      outDir,
      limit: 1,
      createdAt: "2026-06-13T00:00:00.000Z",
    });
    assert.equal(fetched.candidate_id, candidate.candidate_id);

    const promotion = await proposeSkillPromotion(candidate.candidate_id, {
      projectRoot,
      corexRoot,
      outDir,
      limit: 1,
      createdAt: "2026-06-13T00:00:00.000Z",
    });
    assert.equal(promotion.proposal.target_kind, "skill");
    assert.equal(promotion.proposal.promotion_status, "pending_review");
    assert.equal(promotion.proposal.metadata.candidate_id, candidate.candidate_id);
    assert.equal(promotion.proposal.metadata.candidate_checksum, candidate.content_checksum);
    assert.equal(promotion.wrote, false);

    const review = buildReviewEnvelope(candidate, {
      reviewId: "review-vega-example-agent-toolkit",
      reviewerId: "compat-test@local",
      reviewedAt: "2026-06-13T00:10:00.000Z",
      notes: ["Test approval."],
    });
    assert.equal(validateSkillReview(review).valid, true);
    assert.equal(review.candidate_id, candidate.candidate_id);
    assert.equal(review.candidate_checksum, candidate.content_checksum);
    const approvedCandidate = applyReviewEnvelope(candidate, review);
    assert.equal(approvedCandidate.review_status, "approved");
    assert.equal(approvedCandidate.content_checksum, candidate.content_checksum);

    const approvedProposal = await proposeSkillPromotion(candidate.candidate_id, {
      projectRoot,
      corexRoot,
      outDir,
      limit: 1,
      createdAt: "2026-06-13T00:00:00.000Z",
      review,
    });
    assert.equal(approvedProposal.proposal.metadata.review_id, review.review_id);

    await runBuildSkillCandidates([
      "--limit=1",
      `--project-root=${projectRoot}`,
      `--corex-root=${corexRoot}`,
      `--out-dir=${outDir}`,
      "--created-at=2026-06-13T00:00:00.000Z",
    ]);
    assert.ok(await exists(path.join(outDir, "skill-candidates", "vega-skill-candidate-example-agent-toolkit.json")));
    assert.ok(await exists(path.join(outDir, "capability-promotions", "vega-skill-candidate-example-agent-toolkit.json")));
  } finally {
    process.chdir(originalCwd);
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("Skill candidate ingestion test failed");
  console.error(error);
  process.exit(1);
});
