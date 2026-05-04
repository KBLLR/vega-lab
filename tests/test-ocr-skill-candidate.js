#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generateSkillCandidateFromOcrEvidence } from "../src/server/ocr-tools.js";

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vega-ocr-skill-"));
  const repoPath = path.join(root, "fixtures", "demo-repo");
  await fs.mkdir(path.join(root, "data"), { recursive: true });
  await fs.mkdir(path.join(root, "public"), { recursive: true });
  await fs.mkdir(repoPath, { recursive: true });
  await fs.writeFile(path.join(root, "data", "skill-extractions.json"), "[]\n", "utf8");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.ok(String(url).endsWith("/v1/ocr/image"), "Expected OCR image route to be used");
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          status: "ok",
          text: "The screenshot shows a repo UI with reusable skill-mining controls.",
          evidence_refs: ["ocr:image:demo-screenshot"],
          model_used: "mock-ocr",
        };
      },
    };
  };

  try {
    const baseArgs = {
      local_repo_path: repoPath,
      name: "demo-repo",
      author: "local",
      description: "Repository intelligence workflow demo.",
      image: "data:image/png;base64,QUFBQQ==",
      target_topic: "repo intelligence",
      skip_synthesis: true,
    };

    const dryRun = await generateSkillCandidateFromOcrEvidence(root, baseArgs);
    assert.equal(dryRun.review_state, "pending");
    assert.equal(dryRun.visibility, "internal");
    assert.equal(dryRun.skillCandidate.review_state, "pending");
    assert.equal(dryRun.skillCandidate.visibility, "internal");
    assert.ok(dryRun.evidencePack.evidence_refs.includes("ocr:image:demo-screenshot"));
    assert.ok(!dryRun.artifacts, "Default workflow must not write review artifacts");
    assert.equal(await exists(path.join(root, "data", "review")), false, "Default workflow must not create data/review");

    const written = await generateSkillCandidateFromOcrEvidence(root, {
      ...baseArgs,
      writeArtifact: true,
    });
    assert.ok(written.artifacts.evidencePack.startsWith("data/review/evidence-packs/"));
    assert.ok(written.artifacts.skillCandidate.startsWith("data/review/skill-candidates/"));
    assert.ok(await exists(path.join(root, written.artifacts.evidencePack)));
    assert.ok(await exists(path.join(root, written.artifacts.skillCandidate)));
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("OCR skill candidate workflow test failed");
  console.error(error);
  process.exit(1);
});
