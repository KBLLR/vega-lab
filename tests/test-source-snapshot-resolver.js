#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildSkillCandidateIngestion } from "../scripts/build-skill-candidates.js";
import {
  checkSourceSnapshot,
  resolveSourceSnapshot,
  runResolveSourceSnapshots,
  stablePrettyStringify,
} from "../scripts/source-snapshot-resolver.js";

const COMMIT_A = "a".repeat(40);
const COMMIT_B = "b".repeat(40);
const TREE_A = "c".repeat(40);
const TREE_B = "d".repeat(40);

class FixtureGitHubClient {
  constructor() {
    this.branchSha = COMMIT_A;
    this.private = false;
    this.truncatedTree = false;
    this.rateLimit = false;
    this.files = new Map([
      [COMMIT_A, new Map([
        ["README.md", "# Skill Seekers\n\nResearch workflow and skill discovery patterns."],
        ["LICENSE", "MIT License\n\nPermission is hereby granted..."],
        ["package.json", "{\"name\":\"skill-seekers\",\"version\":\"1.0.0\"}"],
      ])],
      [COMMIT_B, new Map([
        ["README.md", "# Skill Seekers\n\nResearch workflow, prompt routing, and capability discovery patterns."],
        ["LICENSE", "MIT License\n\nPermission is hereby granted..."],
        ["package.json", "{\"name\":\"skill-seekers\",\"version\":\"1.1.0\"}"],
      ])],
    ]);
  }

  async getRepository() {
    return {
      default_branch: "main",
      description: "Skill discovery patterns for agent teams.",
      language: "Python",
      license: { spdx_id: "MIT" },
      topics: ["agents", "skills", "research"],
      private: this.private,
    };
  }

  async resolveRef({ ref }) {
    if (this.rateLimit) {
      const error = new Error("rate limited");
      error.status = 403;
      error.headers = { "x-ratelimit-remaining": "0" };
      throw error;
    }
    if (/^[a-f0-9]{40}$/i.test(ref)) return { sha: ref, ref_type: "commit" };
    return { sha: this.branchSha, ref_type: "branch" };
  }

  async getCommit({ commitSha }) {
    if (commitSha === COMMIT_A) return { sha: COMMIT_A, tree_sha: TREE_A, committed_at: "2026-06-01T00:00:00.000Z" };
    if (commitSha === COMMIT_B) return { sha: COMMIT_B, tree_sha: TREE_B, committed_at: "2026-06-02T00:00:00.000Z" };
    const error = new Error("missing commit");
    error.status = 404;
    throw error;
  }

  async getTree({ treeSha }) {
    return { sha: treeSha, truncated: this.truncatedTree };
  }

  async getContent({ filePath, ref }) {
    const files = this.files.get(ref);
    const text = files?.get(filePath);
    if (!text) {
      const error = new Error("not found");
      error.status = 404;
      throw error;
    }
    return {
      path: filePath,
      blob_sha: `${filePath.length.toString(16).padStart(40, "0")}`,
      size: Buffer.byteLength(text),
      content: Buffer.from(text, "utf8"),
    };
  }
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function seedVegaCaches(projectRoot) {
  const repo = {
    nwo: "yusufkaraaslan/Skill_Seekers",
    name: "Skill_Seekers",
    author: "yusufkaraaslan",
    description: "Skill discovery patterns for agent teams.",
    url: "https://github.com/yusufkaraaslan/Skill_Seekers",
    stars: 99,
    forks: 7,
    primary_language: "Python",
    topics: ["agents", "skills", "research"],
    license: "MIT",
  };
  await writeJson(path.join(projectRoot, "data", "data.json"), [repo]);
  await writeJson(path.join(projectRoot, "data", "my-repos.json"), []);
  await writeJson(path.join(projectRoot, "data", "repo-signals.json"), [{
    nwo: "yusufkaraaslan/Skill_Seekers",
    adoptionScore: 91,
    adoptionKind: "tool",
    capabilities: ["agent-workflows", "research-intelligence"],
    houseSkills: ["skill-extraction"],
  }]);
  await writeJson(path.join(projectRoot, "data", "skill-extractions.json"), [{
    nwo: "yusufkaraaslan/Skill_Seekers",
    summary: "Agent team skill discovery and routing workflow patterns.",
    capabilities: ["agent-workflows"],
    houseSkills: ["skill-extraction"],
    flows: ["skill-discovery"],
    adoptionKind: "tool",
  }]);
  return repo;
}

async function firstCandidate(projectRoot, corexRoot) {
  const result = await buildSkillCandidateIngestion({
    projectRoot,
    corexRoot,
    outDir: path.join(projectRoot, "data", "review"),
    dryRun: true,
    limit: 1,
    createdAt: "2026-06-13T00:00:00.000Z",
  });
  assert.equal(result.candidates.length, 1);
  return result.candidates[0];
}

async function assertRejectsCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vega-source-snapshots-"));
  const projectRoot = path.join(root, "vega-lab");
  const corexRoot = path.join(root, "core-x");
  const client = new FixtureGitHubClient();
  const repo = await seedVegaCaches(projectRoot);
  await fs.mkdir(path.join(corexRoot, "skills"), { recursive: true });

  try {
    const first = await resolveSourceSnapshot(repo, { projectRoot, client, write: false });
    const second = await resolveSourceSnapshot(repo, { projectRoot, client, write: false });
    assert.equal(stablePrettyStringify(first.snapshot), stablePrettyStringify(second.snapshot));
    assert.equal(first.snapshot.metadata.immutable.resolved_commit_sha, COMMIT_A);
    assert.equal(first.snapshot.metadata.immutable.resolved_tree_sha, TREE_A);
    assert.match(first.snapshot.metadata.immutable.evidence_digest, /^sha256:[a-f0-9]{64}$/);
    assert.ok(first.snapshot.metadata.immutable.evidence_manifest.evidence.some((item) => item.kind === "readme" && item.path === "README.md"));
    assert.ok(first.snapshot.metadata.immutable.evidence_manifest.evidence.some((item) => item.kind === "license" && item.path === "LICENSE"));
    assert.equal(first.snapshot.metadata.immutable.license_status.status, "compatible");

    const metadataOnly = await firstCandidate(projectRoot, corexRoot);
    assert.ok(metadataOnly.conflict_findings.some((finding) => finding.kind === "missing_immutable_source_snapshot"));

    const writtenA = await resolveSourceSnapshot(repo, { projectRoot, client });
    assert.equal(writtenA.wrote, true);
    const checkA = await checkSourceSnapshot(repo, { projectRoot });
    assert.equal(checkA.ok, true);

    const candidateA1 = await firstCandidate(projectRoot, corexRoot);
    const candidateA2 = await firstCandidate(projectRoot, corexRoot);
    assert.equal(candidateA1.content_checksum, candidateA2.content_checksum);
    assert.ok(!candidateA1.conflict_findings.some((finding) => finding.kind === "missing_immutable_source_snapshot"));
    assert.match(candidateA1.source_snapshot_identity.source_ref, new RegExp(`@${COMMIT_A}$`));

    client.branchSha = COMMIT_B;
    await resolveSourceSnapshot(repo, { projectRoot, client });
    const candidateB = await firstCandidate(projectRoot, corexRoot);
    assert.notEqual(candidateB.content_checksum, candidateA1.content_checksum);
    assert.match(candidateB.source_snapshot_identity.source_ref, new RegExp(`@${COMMIT_B}$`));

    const snapshotPath = path.join(projectRoot, candidateB.source_snapshot_identity.artifact_ref);
    const corrupted = JSON.parse(await fs.readFile(snapshotPath, "utf8"));
    corrupted.metadata.immutable.evidence_manifest.evidence[0].content_sha256 = `sha256:${"0".repeat(64)}`;
    await fs.writeFile(snapshotPath, stablePrettyStringify(corrupted), "utf8");
    const corruptedCheck = await checkSourceSnapshot(repo, { projectRoot });
    assert.equal(corruptedCheck.ok, false);
    assert.ok(corruptedCheck.blockers.includes("evidence digest does not match evidence manifest"));

    const emptyProject = path.join(root, "empty-vega");
    const miss = await checkSourceSnapshot(repo, { projectRoot: emptyProject });
    assert.equal(miss.ok, false);
    assert.deepEqual(miss.blockers, ["offline cache miss"]);

    const missingEvidence = new FixtureGitHubClient();
    missingEvidence.files.get(COMMIT_A).delete("LICENSE");
    await assertRejectsCode(resolveSourceSnapshot(repo, { projectRoot, client: missingEvidence, write: false }), "missing_required_evidence");

    const privateClient = new FixtureGitHubClient();
    privateClient.private = true;
    await assertRejectsCode(resolveSourceSnapshot(repo, { projectRoot, client: privateClient, write: false }), "repository_unavailable");

    const truncatedClient = new FixtureGitHubClient();
    truncatedClient.truncatedTree = true;
    await assertRejectsCode(resolveSourceSnapshot(repo, { projectRoot, client: truncatedClient, write: false }), "tree_truncated");

    const secretClient = new FixtureGitHubClient();
    secretClient.files.get(COMMIT_A).set("README.md", "to" + "ken=super-secret-value");
    await assertRejectsCode(resolveSourceSnapshot(repo, { projectRoot, client: secretClient, write: false }), "secret_evidence");

    const rateLimitedClient = new FixtureGitHubClient();
    rateLimitedClient.rateLimit = true;
    await assertRejectsCode(resolveSourceSnapshot(repo, { projectRoot, client: rateLimitedClient, write: false }), "rate_limit_or_forbidden");

    const report = await runResolveSourceSnapshots([
      "--check",
      "--repo=yusufkaraaslan/Skill_Seekers",
      `--project-root=${emptyProject}`,
    ]);
    assert.equal(report.check, true);
    assert.equal(report.failed_count, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("Source snapshot resolver test failed");
  console.error(error);
  process.exit(1);
});
