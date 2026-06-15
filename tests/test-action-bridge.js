#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { executeVegaAction, listVegaActionRuns } from "../src/server/action-bridge.js";

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

async function main() {
  const root = await createFixtureRoot();
  const repo = { name: "agent-toolkit", author: "example" };

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

  const candidate = await executeVegaAction(root, {
    action_kind: "candidate.build",
    repo,
    write: true,
  });
  assert.equal(candidate.status, "succeeded");
  assert.equal(candidate.result.candidate.review_status, "pending");
  assert.ok(candidate.artifacts.some((artifact) => artifact.kind === "skill-candidate"));
  assert.ok(candidate.artifacts.every((artifact) => !String(artifact.path || "").startsWith("/")));

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

  const runs = await listVegaActionRuns(root);
  assert.ok(runs.length >= 6);
  assert.ok(runs.every((run) => run.visibility === "internal"));
  assert.ok(runs.every((run) => run.review_state === "pending"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
