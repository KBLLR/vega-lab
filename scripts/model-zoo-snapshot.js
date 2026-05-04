#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const modelZooRoot = path.resolve(process.env.MODEL_ZOO_ROOT || path.join(projectRoot, "..", "..", "model-zoo"));
const snapshotName = "model-zoo-text-models.json";

const WEIGHT_FILE_PATTERN = /\.(safetensors|gguf|bin|npz)$/i;
const HIDDEN_MODEL_TERMS = ["llasa", "nsfw", "abliterated", "utena"];

function visibilityForStatus(status) {
  if (status === "local-loadable") return { visibilityClass: "loadable_local", normalSelectable: true, reason: null };
  if (status === "local-incomplete") {
    return {
      visibilityClass: "incomplete_local",
      normalSelectable: false,
      reason: "Local directory exists but required model files are incomplete.",
    };
  }
  return {
    visibilityClass: "candidate_download",
    normalSelectable: false,
    reason: "Known by model-zoo but not downloaded locally.",
  };
}

function isHiddenModelId(id) {
  const lowered = String(id || "").toLowerCase();
  return HIDDEN_MODEL_TERMS.some((term) => lowered.includes(term));
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(targetPath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(targetPath, "utf8"));
  } catch {
    return fallback;
  }
}

async function listDirectories(targetPath) {
  try {
    const entries = await fs.readdir(targetPath, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

async function inspectLocalTextModel(directoryName) {
  const relativePath = path.join("models", "text", directoryName);
  const absolutePath = path.join(modelZooRoot, relativePath);
  const entries = await fs.readdir(absolutePath, { withFileTypes: true }).catch(() => []);
  const fileNames = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const hasWeights = fileNames.some((fileName) => WEIGHT_FILE_PATTERN.test(fileName));
  const hasConfig = fileNames.includes("config.json");
  const hasTokenizer = fileNames.some((fileName) => fileName.startsWith("tokenizer"));

  return {
    id: `text/${directoryName}`,
    runtimeId: `text/${directoryName}`,
    label: directoryName,
    source: "model-zoo-local",
    localPath: relativePath,
    downloaded: hasWeights,
    loadable: hasWeights && hasConfig,
    status: hasWeights && hasConfig ? "local-loadable" : "local-incomplete",
    ...visibilityForStatus(hasWeights && hasConfig ? "local-loadable" : "local-incomplete"),
    capabilities: [],
    aliases: [directoryName],
    evidence: [
      `Local model-zoo directory: ${relativePath}`,
      hasWeights ? "Weights present" : "No local weight file found",
      hasConfig ? "config.json present" : "config.json missing",
      hasTokenizer ? "Tokenizer files present" : "Tokenizer files not detected",
    ],
  };
}

function isTextGenerationModel(model) {
  const id = String(model?.id || "").toLowerCase();
  const category = String(model?.category || "").toLowerCase();
  const type = String(model?.type || "").toLowerCase();
  const task = String(model?.task || "").toLowerCase();
  const backend = String(model?.serving?.backend || "").toLowerCase();
  const localPath = String(model?.local?.path || "").toLowerCase();
  const modality = Array.isArray(model?.modality) ? model.modality.map(String).join(",").toLowerCase() : "";

  if (isHiddenModelId(id)) return false;
  if (type === "embedding" || task.includes("embedding")) return false;
  if (backend === "mlx-audio" || task.includes("speech") || task.includes("audio")) return false;
  if (category === "text" && (task.includes("generation") || type === "llm" || type === "text-generation")) return true;
  if (backend === "mlx-llm") return true;
  return localPath.startsWith("models/text/") && modality.includes("text");
}

function runtimeIdForRegistryModel(model) {
  const id = String(model?.id || "");
  if (id.startsWith("text/")) return id;
  const localPath = String(model?.local?.path || "");
  if (localPath.startsWith("models/text/")) return `text/${path.basename(localPath)}`;
  const repoId = String(model?.source?.repo_id || "").trim();
  if (repoId) return `text/${repoId.split("/").pop()}`;
  return id ? `text/${id.split("/").pop()?.replace(/^.*__/, "")}` : "";
}

function mergeModelRecord(recordsById, model) {
  const runtimeId = runtimeIdForRegistryModel(model);
  if (!runtimeId) return;

  const existing = recordsById.get(runtimeId) || {
    id: runtimeId,
    runtimeId,
    label: runtimeId.replace(/^text\//, ""),
    source: "model-zoo-candidate",
    localPath: model?.local?.path || "",
    downloaded: false,
    loadable: false,
    status: "registry-candidate",
    ...visibilityForStatus("registry-candidate"),
    capabilities: [],
    aliases: [],
    evidence: [],
  };

  const aliases = new Set(existing.aliases || []);
  [model?.id, model?.source?.repo_id].filter(Boolean).forEach((alias) => aliases.add(String(alias)));

  const capabilities = new Set(existing.capabilities || []);
  if (Array.isArray(model?.capabilities)) {
    model.capabilities.filter(Boolean).forEach((capability) => capabilities.add(String(capability)));
  }

  recordsById.set(runtimeId, {
    ...existing,
    localPath: existing.localPath || model?.local?.path || "",
    sourceId: model?.source?.repo_id || existing.sourceId,
    sourceUrl: model?.source_url || existing.sourceUrl,
    backend: model?.serving?.backend || existing.backend,
    task: model?.task || existing.task,
    type: model?.type || existing.type,
    memoryRequirementsMb: model?.memory_requirements_mb || existing.memoryRequirementsMb,
    capabilities: [...capabilities].sort(),
    aliases: [...aliases].sort(),
    evidence: [
      ...(existing.evidence || []),
      `Registry entry: ${model?.id}`,
      model?.source?.repo_id ? `Source repo: ${model.source.repo_id}` : null,
      model?.local?.path ? `Registry local path: ${model.local.path}` : null,
    ].filter(Boolean),
  });
}

async function buildSnapshot() {
  const localRecords = new Map();
  const textModelsRoot = path.join(modelZooRoot, "models", "text");

  for (const directoryName of await listDirectories(textModelsRoot)) {
    if (isHiddenModelId(directoryName)) continue;
    const record = await inspectLocalTextModel(directoryName);
    localRecords.set(record.id, record);
  }

  const registry = await readJson(path.join(modelZooRoot, "registry.json"), { models: {} });
  const registryModels = Array.isArray(registry?.models)
    ? registry.models
    : Object.values(registry?.models || {});

  for (const model of registryModels.filter(isTextGenerationModel)) {
    mergeModelRecord(localRecords, model);
  }

  for (const record of localRecords.values()) {
    if (!record.localPath) continue;
    const absoluteLocalPath = path.join(modelZooRoot, record.localPath);
    const localDirectoryExists = await exists(absoluteLocalPath);
    if (!localDirectoryExists && record.status !== "registry-candidate") {
      record.status = "registry-candidate";
      record.source = "model-zoo-candidate";
      record.downloaded = false;
      record.loadable = false;
      Object.assign(record, visibilityForStatus("registry-candidate"));
    }
    if (record.status === "local-loadable" || record.status === "local-incomplete") {
      record.source = "model-zoo-local";
      Object.assign(record, visibilityForStatus(record.status));
    }
  }

  const models = [...localRecords.values()]
    .filter((record) => !isHiddenModelId(record.id) && !isHiddenModelId(record.runtimeId))
    .map((record) => ({
      ...record,
      evidence: [...new Set(record.evidence || [])],
    }))
    .sort((a, b) => {
      const rank = { "local-loadable": 0, "local-incomplete": 1, "registry-candidate": 2 };
      return (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || a.id.localeCompare(b.id);
    });

  return {
    schema: "vega-lab:model-zoo-text-models@1",
    generatedAt: new Date().toISOString(),
    source: "local-model-zoo",
    rootHint: "MODEL_ZOO_ROOT or ../../model-zoo from Vega Lab",
    counts: {
      total: models.length,
      localLoadable: models.filter((model) => model.status === "local-loadable").length,
      localIncomplete: models.filter((model) => model.status === "local-incomplete").length,
      registryCandidates: models.filter((model) => model.status === "registry-candidate").length,
    },
    models,
  };
}

async function writeSnapshot(snapshot) {
  const targets = [
    path.join(projectRoot, "data", snapshotName),
    path.join(projectRoot, "public", snapshotName),
  ];

  await Promise.all(targets.map(async (targetPath) => {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  }));
}

const snapshot = await buildSnapshot();
await writeSnapshot(snapshot);

console.log(
  `Wrote ${snapshotName}: ${snapshot.counts.localLoadable} loadable, `
  + `${snapshot.counts.localIncomplete} incomplete, ${snapshot.counts.registryCandidates} registry candidates.`,
);
