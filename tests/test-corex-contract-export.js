#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildCorexContractArtifacts, runExport } from "../scripts/export-corex-contracts.js";

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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vega-corex-contract-export-"));

  const repo = {
    name: "demo-repo",
    author: "example",
    description: "A deterministic repo intelligence demo.",
    url: "https://github.com/example/demo-repo",
    stars: 120,
    forks: 7,
    open_issues: 2,
    primary_language: "TypeScript",
    topics: ["agent", "workflow"],
    license: "MIT",
  };

  await writeJson(path.join(root, "data", "data.json"), [repo]);
  await writeJson(path.join(root, "data", "my-repos.json"), []);
  await writeJson(path.join(root, "data", "repo-signals.json"), [{
    nwo: "example/demo-repo",
    description: repo.description,
    adoptionScore: 82,
    adoptionKind: "tool",
    capabilities: ["agent-workflows", "developer-tooling"],
    houseSkills: ["repo-discovery", "skill-extraction"],
  }]);
  await writeJson(path.join(root, "data", "skill-extractions.json"), [{
    nwo: "example/demo-repo",
    summary: "Useful agent workflow repository.",
    capabilities: ["agent-workflows"],
    houseSkills: ["skill-extraction"],
    flows: ["research-queue-flow"],
    adoptionKind: "tool",
  }]);

  try {
    process.chdir(root);
    const result = await buildCorexContractArtifacts({ projectRoot: root, dryRun: true, limit: 1, createdAt: "2026-06-12T00:00:00.000Z" });
    assert.equal(result.selected_count, 1);
    assert.equal(result.artifacts[0].sourceSnapshot.review_status, "pending");
    assert.equal(result.artifacts[0].sourceSnapshot.secret_scan.status, "skipped");
    assert.equal(result.artifacts[0].knowledgeArtifact.review_status, "pending");
    assert.equal(result.artifacts[0].knowledgeArtifact.snapshot_id, result.artifacts[0].sourceSnapshot.id);
    assert.ok(!JSON.stringify(result).includes("README body text"), "Export must not include README/source bodies");

    const outDir = path.join(root, "data", "review");
    await runExport(["--limit=1", `--project-root=${root}`, `--out-dir=${outDir}`]);
    assert.ok(await exists(path.join(outDir, "source-snapshots", "example-demo-repo.json")));
    assert.ok(await exists(path.join(outDir, "knowledge-refinery", "example-demo-repo.json")));
  } finally {
    process.chdir(originalCwd);
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("Core-X contract export test failed");
  console.error(error);
  process.exit(1);
});
