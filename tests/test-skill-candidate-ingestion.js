#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildSkillCandidateIngestion,
  getSkillCandidate,
  listSkillCandidates,
  proposeSkillPromotion,
  runBuildSkillCandidates,
  validateSkillCandidate,
} from "../scripts/build-skill-candidates.js";

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
    assert.equal(candidate.candidate_id, "vega.skill-candidate:example-agent-toolkit");
    assert.equal(candidate.review_status, "pending");
    assert.equal(candidate.source_repository.nwo, "example/agent-toolkit");
    assert.equal(candidate.suggested_corex_lane, "agent-workflows");
    assert.equal(candidate.license_status.status, "compatible");
    assert.ok(candidate.duplicate_matches.some((match) => match.kind === "duplicate_id"));
    assert.ok(candidate.content_checksum.startsWith("sha256:"));
    assert.ok(!JSON.stringify(candidate).includes("README body"));
    assert.ok(!JSON.stringify(candidate).includes("/Users/"));

    const validation = validateSkillCandidate(candidate);
    assert.equal(validation.valid, true);

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
    assert.equal(promotion.wrote, false);

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
