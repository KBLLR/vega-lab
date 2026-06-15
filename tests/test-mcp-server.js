#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { generateDerivedHouseData } from "../src/server/house-model.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const serverPath = path.resolve(projectRoot, "src/mcp-server/index.js");
const researchQueueDataPath = path.resolve(projectRoot, "data/research-queue.json");
const researchQueuePublicPath = path.resolve(projectRoot, "public/research-queue.json");
const actionItemsDataPath = path.resolve(projectRoot, "data/action-items.json");
const actionItemsPublicPath = path.resolve(projectRoot, "public/action-items.json");
const repoOpsKitsDataPath = path.resolve(projectRoot, "data/repo-ops-kits.json");
const repoOpsKitsPublicPath = path.resolve(projectRoot, "public/repo-ops-kits.json");

async function ensureDataMirror() {
  const requiredFiles = [
    "data.json",
    "my-repos.json",
    "repo-signals.json",
    "research-queue.json",
    "skill-extractions.json",
    "mine-health.json",
    "repo-inspections.json",
    "action-items.json",
    "automation-runs.json",
    "ops-digest.json",
    "weekly-research-review.json",
    "template-kits.json",
    "repo-ops-kits.json",
  ];

  await fs.mkdir(path.resolve(projectRoot, "data"), { recursive: true });

  for (const fileName of requiredFiles) {
    const dataPath = path.resolve(projectRoot, "data", fileName);
    const publicPath = path.resolve(projectRoot, "public", fileName);

    try {
      await fs.access(dataPath);
    } catch {
      await fs.copyFile(publicPath, dataPath);
    }
  }
}

function parseTextPayload(result) {
  assert.ok(!("toolResult" in result), "Expected standard tool content result");
  assert.ok(Array.isArray(result.content) && result.content.length > 0, "Expected tool response content");
  const textBlock = result.content.find((entry) => entry.type === "text");
  assert.ok(textBlock && typeof textBlock.text === "string", "Expected tool response text");
  return JSON.parse(textBlock.text);
}

async function main() {
  console.log("Testing MCP Server...\n");
  await ensureDataMirror();
  const originalResearchQueue = JSON.parse(await fs.readFile(researchQueueDataPath, "utf8"));
  const originalActionItems = JSON.parse(await fs.readFile(actionItemsDataPath, "utf8"));
  const originalRepoOpsKits = JSON.parse(await fs.readFile(repoOpsKitsDataPath, "utf8"));

  const transport = new StdioClientTransport({
    command: "node",
    args: [serverPath],
    cwd: projectRoot,
    stderr: "pipe",
  });

  if (transport.stderr) {
    transport.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
    });
  }

  const client = new Client(
    {
      name: "vega-lab-test-client",
      version: "1.0.0",
    },
    {
      capabilities: {},
    },
  );

  try {
    await client.connect(transport);

    const listedTools = await client.listTools();
    const toolNames = new Set(listedTools.tools.map((tool) => tool.name));
    [
      "list_news_signals",
      "get_research_queue",
      "update_research_queue",
      "get_adoption_candidates",
      "extract_repo_skills",
      "list_template_kits",
      "generate_repo_mission",
      "generate_repo_ops_kit",
      "get_mine_health",
      "list_action_items",
      "update_action_item",
      "inspect_owned_repo",
      "get_repo_inspection",
      "generate_ops_digest",
      "generate_weekly_research_review",
      "draft_action_item",
      "get_runtime_health",
      "inspect_model_zoo",
      "ocr_health",
      "inspect_image_with_ocr",
      "inspect_pdf_with_ocr",
      "extract_repo_visual_evidence",
      "extract_skill_evidence_from_pdf",
      "generate_skill_candidate_from_ocr_evidence",
      "list_skill_candidates",
      "get_skill_candidate",
      "validate_skill_candidate",
      "propose_skill_promotion",
    ].forEach((toolName) => {
      assert.ok(toolNames.has(toolName), `Expected MCP tool to exist: ${toolName}`);
    });

    const skillCandidatesResult = parseTextPayload(await client.callTool({
      name: "list_skill_candidates",
      arguments: { limit: 1, scope: "all" },
    }));
    assert.ok(skillCandidatesResult.count >= 1, "Skill candidate listing should return at least one candidate");
    const skillCandidate = skillCandidatesResult.candidates[0];
    assert.equal(skillCandidate.schema_version, "corex.vega-skill-candidate.v1", "MCP candidate should use canonical v1 schema");
    assert.ok(skillCandidate.content_checksum.startsWith("sha256:"), "MCP candidate should expose a content checksum");

    const skillValidationResult = parseTextPayload(await client.callTool({
      name: "validate_skill_candidate",
      arguments: { candidate_id: skillCandidate.candidate_id, limit: 1 },
    }));
    assert.equal(skillValidationResult.validation.valid, false, "Metadata-only MCP candidate validation should be blocked before promotion");
    assert.equal(skillValidationResult.validation.checksum_ok, true, "MCP candidate checksum should match canonical content");
    assert.ok(
      skillValidationResult.validation.blockers.some((blocker) => blocker.kind === "missing_immutable_source_snapshot"),
      "MCP validation should expose the immutable source snapshot precondition",
    );

    const skillProposalResult = parseTextPayload(await client.callTool({
      name: "propose_skill_promotion",
      arguments: { candidate_id: skillCandidate.candidate_id, limit: 1 },
    }));
    assert.equal(skillProposalResult.proposal.metadata.candidate_id, skillCandidate.candidate_id);
    assert.equal(skillProposalResult.proposal.metadata.candidate_checksum, skillCandidate.content_checksum);
    assert.equal(skillProposalResult.wrote, false, "MCP proposal should not write unless explicitly requested");

    const runtimeHealth = parseTextPayload(await client.callTool({
      name: "get_runtime_health",
      arguments: {},
    }));
    assert.equal(runtimeHealth.houseId, "vega-lab", "Runtime health should expose the Vega Lab house id");
    assert.equal(runtimeHealth.runtimeContract, "openresponses", "Runtime health should expose OpenResponses as the contract");
    assert.equal(runtimeHealth.localBus.target, "http://127.0.0.1:8090", "Runtime health should expose the local MLX gateway target");
    assert.equal(runtimeHealth.localBus.responsesEndpoint, "/bus/v1/responses", "Runtime health should expose the local OpenResponses route");
    assert.equal(runtimeHealth.localBus.ocrEndpoint, "/bus/v1/ocr/extract", "Runtime health should expose OCR extraction route");
    assert.ok(Array.isArray(runtimeHealth.ocr.capabilityLanes), "Runtime health should expose OCR capability lanes");
    assert.equal(typeof runtimeHealth.datasets.actionItems, "number", "Runtime health should include action item count");
    assert.equal(typeof runtimeHealth.datasets.templateKits, "number", "Runtime health should include template kit count");
    assert.equal(typeof runtimeHealth.datasets.repoOpsKits, "number", "Runtime health should include repo ops kit count");

    const statsResult = parseTextPayload(await client.callTool({
      name: "get_statistics",
      arguments: {},
    }));
    assert.ok(typeof statsResult === "object" && statsResult !== null, "Statistics payload should be an object");

    const modelZooResult = parseTextPayload(await client.callTool({
      name: "inspect_model_zoo",
      arguments: { profile: "balanced-32gb" },
    }));
    assert.equal(modelZooResult.profile, "balanced-32gb", "Model-zoo inspection should report the requested local profile");
    assert.ok(Array.isArray(modelZooResult.recommendedText), "Model-zoo inspection should return recommended text models");
    assert.ok(Array.isArray(modelZooResult.recommendedOcr), "Model-zoo inspection should return OCR/VLM models");
    assert.ok(
      !modelZooResult.recommendedText.some((model) => /llasa|nsfw|abliterated|utena/i.test(model.id)),
      "Model-zoo inspection should not recommend hidden model classes",
    );

    const newsResult = parseTextPayload(await client.callTool({
      name: "list_news_signals",
      arguments: { scope: "watched", limit: 5 },
    }));
    assert.ok(Array.isArray(newsResult.signals) && newsResult.signals.length > 0, "News signals should return results");

    const targetSignal = newsResult.signals[0];
    const [author, name] = String(targetSignal.nwo || "").split("/");
    assert.ok(author && name, "Signal should include a valid nwo");

    const queueBefore = parseTextPayload(await client.callTool({
      name: "get_research_queue",
      arguments: {},
    }));
    assert.ok(Array.isArray(queueBefore.queue), "Research queue should be an array");

    const updateOne = parseTextPayload(await client.callTool({
      name: "update_research_queue",
      arguments: {
        author,
        name,
        status: "queued",
        priority: "high",
        notes: "Automated MCP queue verification",
      },
    }));
    assert.equal(updateOne.updated, true, "Research queue update should report success");
    assert.equal(updateOne.item.nwo, `${author}/${name}`, "Updated queue item should match the target repo");

    const updateTwo = parseTextPayload(await client.callTool({
      name: "update_research_queue",
      arguments: {
        author,
        name,
        status: "researching",
        priority: "high",
        notes: "Automated MCP dedupe verification",
      },
    }));
    assert.equal(updateTwo.updated, true, "Second research queue update should report success");
    assert.equal(updateTwo.item.status, "researching", "Second update should overwrite the queue status");

    const queueAfter = parseTextPayload(await client.callTool({
      name: "get_research_queue",
      arguments: {},
    }));
    assert.ok(Array.isArray(queueAfter.queue), "Updated research queue should be an array");
    assert.ok(
      queueAfter.queue.length >= queueBefore.queue.length && queueAfter.queue.length <= queueBefore.queue.length + 1,
      "Research queue updates should not create duplicate entries",
    );
    const updatedItem = queueAfter.queue.find((item) => item.nwo === `${author}/${name}`);
    assert.ok(updatedItem, "Updated repository should be present in the research queue");
    assert.equal(updatedItem.status, "researching", "Queue item should retain the latest status");

    const researchSignals = parseTextPayload(await client.callTool({
      name: "list_news_signals",
      arguments: { scope: "research", limit: 10 },
    }));
    assert.ok(
      Array.isArray(researchSignals.signals) && researchSignals.signals.some((signal) => signal.nwo === `${author}/${name}`),
      "Research scope signals should surface queued repositories",
    );

    const extractionResult = parseTextPayload(await client.callTool({
      name: "extract_repo_skills",
      arguments: { author, name },
    }));
    assert.equal(extractionResult.nwo, `${author}/${name}`, "Skill extraction should match the target repo");
    assert.ok(Array.isArray(extractionResult.capabilities) && extractionResult.capabilities.length > 0, "Skill extraction should expose capabilities");
    assert.ok(Array.isArray(extractionResult.houseSkills), "Skill extraction should expose house skills");
    assert.ok(Array.isArray(extractionResult.rules), "Skill extraction should expose rules");
    assert.ok(Array.isArray(extractionResult.flows), "Skill extraction should expose flows");

    const ocrHealth = parseTextPayload(await client.callTool({
      name: "ocr_health",
      arguments: {},
    }));
    assert.equal(ocrHealth.title, "OCR service health", "OCR health tool should return OCR status");

    const imageEvidence = parseTextPayload(await client.callTool({
      name: "inspect_image_with_ocr",
      arguments: {},
    }));
    assert.equal(imageEvidence.title, "Image OCR", "Image OCR tool should return a typed missing-input draft when no image is supplied");

    const ocrSkillCandidate = parseTextPayload(await client.callTool({
      name: "generate_skill_candidate_from_ocr_evidence",
      arguments: {
        author,
        name,
        target_topic: "repo intelligence",
        skip_synthesis: true,
        writeArtifact: false,
      },
    }));
    assert.equal(ocrSkillCandidate.review_state, "pending", "OCR skill candidate workflow should stay pending");
    assert.equal(ocrSkillCandidate.visibility, "internal", "OCR skill candidate workflow should stay internal");
    assert.equal(ocrSkillCandidate.skillCandidate.review_state, "pending", "Generated SKILL candidate should be review-gated");
    assert.equal(ocrSkillCandidate.skillCandidate.visibility, "internal", "Generated SKILL candidate should not be public");
    assert.ok(ocrSkillCandidate.skillCandidate.draft_skill_md.includes("#"), "Generated SKILL candidate should include draft Markdown");
    assert.ok(!ocrSkillCandidate.artifacts, "Test path should avoid writing generated review artifacts");

    const templateKits = parseTextPayload(await client.callTool({
      name: "list_template_kits",
      arguments: {},
    }));
    assert.ok(Array.isArray(templateKits.kits), "Template kit listing should return kits");
    assert.ok(templateKits.kits.some((kit) => kit.id === "vega-lab:repo-ops-kit"), "Template kits should include the repo Ops kit");
    assert.ok(templateKits.kits.some((kit) => kit.id === "vega-lab:house-reference"), "Template kits should include house reference templates");

    const codexMission = parseTextPayload(await client.callTool({
      name: "generate_repo_mission",
      arguments: { author, name, target: "codex" },
    }));
    assert.equal(codexMission.target, "codex", "Codex mission should report its target");
    assert.equal(typeof codexMission.mission, "string", "Codex mission should be a string");
    assert.ok(codexMission.mission.length > 20, "Codex mission should be non-trivial");

    const claudeMission = parseTextPayload(await client.callTool({
      name: "generate_repo_mission",
      arguments: { author, name, target: "claude" },
    }));
    assert.equal(claudeMission.target, "claude", "Claude mission should report its target");
    assert.equal(typeof claudeMission.mission, "string", "Claude mission should be a string");
    assert.ok(claudeMission.mission.length > 20, "Claude mission should be non-trivial");

    const mlxMission = parseTextPayload(await client.callTool({
      name: "generate_repo_mission",
      arguments: { author, name, target: "mlx" },
    }));
    assert.equal(mlxMission.target, "mlx", "MLX mission should report its target");
    assert.equal(typeof mlxMission.mission, "string", "MLX mission should be a string");
    assert.ok(mlxMission.mission.includes("Local MLX"), "MLX mission should be explicitly local-targeted");

    const rejectedMission = parseTextPayload(await client.callTool({
      name: "generate_repo_mission",
      arguments: { author, name, target: "jules" },
    }));
    assert.ok(rejectedMission.error?.includes("Unsupported mission target"), "Unsupported mission targets such as Jules should be rejected");

    const adoptionResult = parseTextPayload(await client.callTool({
      name: "get_adoption_candidates",
      arguments: { limit: 5 },
    }));
    assert.ok(Array.isArray(adoptionResult.candidates) && adoptionResult.candidates.length > 0, "Adoption candidates should return ranked repos");
    if (adoptionResult.candidates.length > 1) {
      assert.ok(
        adoptionResult.candidates[0].adoptionScore >= adoptionResult.candidates[adoptionResult.candidates.length - 1].adoptionScore,
        "Adoption candidates should be ranked by descending score",
      );
    }

    const mineHealth = parseTextPayload(await client.callTool({
      name: "get_mine_health",
      arguments: {},
    }));
    assert.ok(Array.isArray(mineHealth.records) && mineHealth.records.length > 0, "Mine health should return owned-repo records");
    assert.ok(
      mineHealth.records.every((record) => Array.isArray(record.healthFlags) && Array.isArray(record.recommendedActions)),
      "Mine health records should include deterministic flags and actions",
    );

    const [mineAuthor, mineName] = String(mineHealth.records[0].nwo || "").split("/");
    assert.ok(mineAuthor && mineName, "Mine health should include a valid owned repo nwo");

    const repoInspection = parseTextPayload(await client.callTool({
      name: "inspect_owned_repo",
      arguments: { author: mineAuthor, name: mineName },
    }));
    assert.equal(repoInspection.nwo, `${mineAuthor}/${mineName}`, "Repo inspection should match the owned target repo");
    assert.ok(repoInspection.files && typeof repoInspection.files === "object", "Repo inspection should include file evidence");
    assert.ok(Array.isArray(repoInspection.findings), "Repo inspection should expose findings");

    const storedInspection = parseTextPayload(await client.callTool({
      name: "get_repo_inspection",
      arguments: { author: mineAuthor, name: mineName },
    }));
    assert.equal(storedInspection.nwo, `${mineAuthor}/${mineName}`, "Stored repo inspection should match the owned target repo");

    const repoOpsKit = parseTextPayload(await client.callTool({
      name: "generate_repo_ops_kit",
      arguments: { author: mineAuthor, name: mineName, target: "mlx" },
    }));
    assert.equal(repoOpsKit.nwo, `${mineAuthor}/${mineName}`, "Repo Ops kit should match the owned target repo");
    assert.equal(repoOpsKit.target, "mlx", "Repo Ops kit should default to the local MLX target when requested");
    const opsArtifactKinds = new Set(repoOpsKit.artifacts.map((artifact) => artifact.kind));
    ["readme", "agents", "maintenance", "deployment", "testing", "action-item"].forEach((kind) => {
      assert.ok(opsArtifactKinds.has(kind), `Repo Ops kit should include a ${kind} artifact`);
    });
    assert.ok(Array.isArray(repoOpsKit.evidence) && repoOpsKit.evidence.length > 0, "Repo Ops kit should include evidence");

    const actionList = parseTextPayload(await client.callTool({
      name: "list_action_items",
      arguments: { limit: 10 },
    }));
    assert.ok(Array.isArray(actionList.items), "Action item listing should return an array");

    if (actionList.items.length > 0) {
      const actionUpdate = parseTextPayload(await client.callTool({
        name: "update_action_item",
        arguments: {
          id: actionList.items[0].id,
          status: "reviewing",
          notes: "Automated MCP action status verification",
        },
      }));
      assert.equal(actionUpdate.updated, true, "Action item update should report success");
      assert.equal(actionUpdate.item.status, "reviewing", "Action item update should persist the requested status");
    }

    const draftedAction = parseTextPayload(await client.callTool({
      name: "draft_action_item",
      arguments: {
        author: mineAuthor,
        name: mineName,
        kind: "research",
        source: "manual",
      },
    }));
    assert.equal(draftedAction.drafted, true, "Draft action item should report success");
    assert.ok(draftedAction.item.id.startsWith("vega-lab:"), "Draft action item should use the Vega Lab namespace");

    const opsDigest = parseTextPayload(await client.callTool({
      name: "generate_ops_digest",
      arguments: {},
    }));
    assert.equal(typeof opsDigest.summary, "string", "Ops digest should contain a summary");
    assert.ok(Array.isArray(opsDigest.recommendedActions), "Ops digest should contain recommended actions");

    const weeklyReview = parseTextPayload(await client.callTool({
      name: "generate_weekly_research_review",
      arguments: {},
    }));
    assert.equal(typeof weeklyReview.summary, "string", "Weekly research review should contain a summary");
    assert.ok(Array.isArray(weeklyReview.brightStars), "Weekly research review should contain bright-star candidates");

    console.log("✅ MCP Server test completed");
  } finally {
    await client.close().catch(() => undefined);
    const restoredQueue = `${JSON.stringify(originalResearchQueue, null, 2)}\n`;
    await fs.writeFile(researchQueueDataPath, restoredQueue, "utf8");
    await fs.writeFile(researchQueuePublicPath, restoredQueue, "utf8");
    const restoredActions = `${JSON.stringify(originalActionItems, null, 2)}\n`;
    await fs.writeFile(actionItemsDataPath, restoredActions, "utf8");
    await fs.writeFile(actionItemsPublicPath, restoredActions, "utf8");
    const restoredRepoOpsKits = `${JSON.stringify(originalRepoOpsKits, null, 2)}\n`;
    await fs.writeFile(repoOpsKitsDataPath, restoredRepoOpsKits, "utf8");
    await fs.writeFile(repoOpsKitsPublicPath, restoredRepoOpsKits, "utf8");
    await generateDerivedHouseData(projectRoot);
  }
}

main().catch((error) => {
  console.error("❌ MCP Server test failed");
  console.error(error);
  process.exit(1);
});
