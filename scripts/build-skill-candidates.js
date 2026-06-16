#!/usr/bin/env node

import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import { buildCorexContractArtifacts } from "./export-corex-contracts.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const GENERATED_BY = "vega-lab:build-skill-candidates";
const CANDIDATE_SCHEMA_VERSION = "corex.vega-skill-candidate.v1";
const PROFILE_SCHEMA_VERSION = "vega.skill-candidate-profile.v1";
const REVIEW_SCHEMA_VERSION = "corex.vega-skill-review.v1";
const CONTRACTS_ROOT = path.join(projectRoot, "contracts", "corex");
const PROFILE_CONFIG_DIRNAME = path.join("config", "skill-candidate-profiles");
const TOOL = {
  tool_id: "vega.build_skill_candidates",
  name: "Vega Skill Candidate Ingestion",
  version: "0.1.0",
};
const CANDIDATE_CHECKSUM_FIELDS = [
  "schema_version",
  "candidate_id",
  "suggested_skill_id",
  "name",
  "description",
  "source_repository",
  "source_snapshot_identity",
  "provenance_references",
  "suggested_corex_lane",
  "suggested_scope",
  "required_tools_services",
  "license_status",
  "compatibility_assumptions",
  "evidence_summary",
  "duplicate_matches",
  "conflict_findings",
  "risk_findings",
  "candidate_profile",
  "policy",
];

const SECRET_PATTERNS = [
  new RegExp(["BEGIN", "[A-Z ]*", "PRIVATE", "KEY"].join(" "), "i"),
  new RegExp("\\b" + "ghp" + "_[A-Za-z0-9_]{20,}\\b"),
  new RegExp("\\b" + "sk" + "-[A-Za-z0-9_-]{20,}\\b"),
  /\bapi[_-]?key\b\s*[:=]/i,
  /\bsecret\b\s*[:=]/i,
  /\btoken\b\s*[:=]/i,
];

const LOCAL_PATH_PATTERNS = [
  /file:\/\/\/Users\//i,
  /\/Users\/[A-Za-z0-9_.-]+/,
  new RegExp("core-x-" + "kbllr_0"),
];

const UNSAFE_EXEC_PATTERNS = [
  /curl\s+[^|]+\|\s*(bash|sh)/i,
  /wget\s+[^|]+\|\s*(bash|sh)/i,
  /rm\s+-rf\s+\//i,
  /chmod\s+\+x/i,
  /postinstall/i,
];

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value)))];
}

function slug(value) {
  return String(value || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "unknown";
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function existingDir(dirPath) {
  try {
    return fsSync.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function detectCorexRoot(root) {
  const candidates = [];
  if (process.env.COREX_ROOT) candidates.push(path.resolve(process.env.COREX_ROOT));
  candidates.push(path.resolve(root, "..", "..", "core-x"));

  try {
    const gitMarker = fsSync.readFileSync(path.join(root, ".git"), "utf8").trim();
    const match = /^gitdir:\s*(.+)$/i.exec(gitMarker);
    if (match) {
      const gitDir = path.resolve(root, match[1]);
      const commonGitDir = path.dirname(path.dirname(gitDir));
      const originalHouseRoot = path.dirname(commonGitDir);
      candidates.push(path.resolve(originalHouseRoot, "..", "..", "core-x"));
    }
  } catch {
    // Non-worktree checkouts usually have a .git directory instead of a marker file.
  }

  return candidates.find((candidate) => existingDir(candidate)) || candidates[0];
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function readContractSchema(name) {
  return JSON.parse(fsSync.readFileSync(path.join(CONTRACTS_ROOT, name), "utf8"));
}

const ajv = new Ajv2020({
  allErrors: true,
  coerceTypes: false,
  strict: true,
  useDefaults: false,
});
const candidateSchema = readContractSchema("corex.vega-skill-candidate.v1.schema.json");
const reviewSchema = readContractSchema("corex.vega-skill-review.v1.schema.json");
const validateCandidateSchema = ajv.compile(candidateSchema);
const validateReviewSchema = ajv.compile(reviewSchema);

function schemaErrors(validator) {
  return (validator.errors || []).map((error) => {
    const pathText = error.instancePath ? `${error.instancePath} ` : "";
    return `${pathText}${error.message}`;
  });
}

export function candidateContentChecksum(candidate) {
  const payload = {};
  for (const field of CANDIDATE_CHECKSUM_FIELDS) {
    payload[field] = Object.hasOwn(candidate, field) ? candidate[field] : null;
  }
  return `sha256:${sha256(stableStringify(payload))}`;
}

export function validateSkillReview(review) {
  const valid = validateReviewSchema(review);
  return {
    valid: valid === true,
    schema_errors: valid ? [] : schemaErrors(validateReviewSchema),
  };
}

function repoNwoFromArtifact(pair) {
  return pair?.nwo
    || pair?.sourceSnapshot?.metadata?.nwo
    || pair?.knowledgeArtifact?.metadata?.nwo
    || pair?.sourceSnapshot?.source_ref
    || "unknown/unknown";
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    limit: 25,
    all: false,
    dryRun: false,
    emitDraftFolders: false,
    scope: "all",
    projectRoot,
    outDir: path.join(projectRoot, "data", "review"),
    corexRoot: process.env.COREX_ROOT || null,
    createdAt: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--all") {
      options.all = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--emit-draft-folders") {
      options.emitDraftFolders = true;
    } else if (arg === "--limit") {
      options.limit = Number.parseInt(argv[index + 1] || "", 10);
      index += 1;
    } else if (arg.startsWith("--limit=")) {
      options.limit = Number.parseInt(arg.slice("--limit=".length), 10);
    } else if (arg === "--scope") {
      options.scope = argv[index + 1] || options.scope;
      index += 1;
    } else if (arg.startsWith("--scope=")) {
      options.scope = arg.slice("--scope=".length);
    } else if (arg === "--project-root") {
      options.projectRoot = path.resolve(argv[index + 1] || options.projectRoot);
      index += 1;
    } else if (arg.startsWith("--project-root=")) {
      options.projectRoot = path.resolve(arg.slice("--project-root=".length));
    } else if (arg === "--out-dir") {
      options.outDir = path.resolve(argv[index + 1] || options.outDir);
      index += 1;
    } else if (arg.startsWith("--out-dir=")) {
      options.outDir = path.resolve(arg.slice("--out-dir=".length));
    } else if (arg === "--corex-root") {
      options.corexRoot = path.resolve(argv[index + 1] || "");
      index += 1;
    } else if (arg.startsWith("--corex-root=")) {
      options.corexRoot = path.resolve(arg.slice("--corex-root=".length));
    } else if (arg === "--created-at") {
      options.createdAt = argv[index + 1] || null;
      index += 1;
    } else if (arg.startsWith("--created-at=")) {
      options.createdAt = arg.slice("--created-at=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(options.limit) || options.limit < 1) options.limit = 25;
  if (!options.corexRoot) options.corexRoot = detectCorexRoot(options.projectRoot);
  options.outDir = path.resolve(options.outDir);
  return options;
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function readJsonFiles(dirPath) {
  const results = [];
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        results.push(...await readJsonFiles(fullPath));
      } else if (entry.name.endsWith(".json")) {
        const value = await readJson(fullPath, null);
        if (value) results.push({ filePath: fullPath, value });
      }
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return results;
}

function relativePath(root, filePath) {
  return path.relative(root, filePath).replaceAll(path.sep, "/");
}

function profileConfigDir(root) {
  return path.join(root, PROFILE_CONFIG_DIRNAME);
}

function profileSchemaPath(root) {
  return path.join(profileConfigDir(root), "schema.json");
}

function sourceSnapshotCommit(snapshot) {
  const immutableCommit = snapshot?.metadata?.immutable?.resolved_commit_sha;
  if (/^[a-f0-9]{40}$/i.test(String(immutableCommit || ""))) return String(immutableCommit).toLowerCase();
  const sourceRef = String(snapshot?.source_ref || "");
  const match = /@([a-f0-9]{40})$/i.exec(sourceRef);
  return match ? match[1].toLowerCase() : "";
}

function profileSourceKey(repository, commit) {
  return `${String(repository || "").toLowerCase()}@${String(commit || "").toLowerCase()}`;
}

function profileError(message, code = "invalid_skill_candidate_profile") {
  return Object.assign(new Error(message), { code });
}

async function loadSkillCandidateProfiles(root) {
  const dir = profileConfigDir(root);
  if (!await pathExists(dir)) {
    return { entries: [], bySource: new Map(), count: 0 };
  }

  const schemaPath = profileSchemaPath(root);
  const schema = await readJson(schemaPath, null);
  if (!schema) {
    throw profileError(`Skill candidate profile schema is missing: ${relativePath(root, schemaPath)}`, "missing_skill_candidate_profile_schema");
  }

  const profileAjv = new Ajv2020({
    allErrors: true,
    coerceTypes: false,
    strict: true,
    useDefaults: false,
  });
  const validateProfile = profileAjv.compile(schema);
  const profileIdToRef = new Map();
  const targetSkillIdToRef = new Map();
  const sourceToRef = new Map();
  const entries = [];

  for (const record of await readJsonFiles(dir)) {
    if (path.resolve(record.filePath) === path.resolve(schemaPath)) continue;
    const profile = record.value;
    const valid = validateProfile(profile);
    const ref = relativePath(root, record.filePath);
    if (!valid) {
      const errors = schemaErrors(validateProfile).join("; ");
      throw profileError(`Invalid skill candidate profile ${ref}: ${errors}`);
    }

    const scanText = textForScanning(profile);
    const blockers = [
      ...patternFindings(LOCAL_PATH_PATTERNS, scanText, "absolute_local_path"),
      ...patternFindings(SECRET_PATTERNS, scanText, "secret_or_credential"),
    ];
    if (blockers.length > 0) {
      throw profileError(`Unsafe skill candidate profile ${ref}: ${blockers.map((blocker) => blocker.kind).join(", ")}`);
    }

    if (profileIdToRef.has(profile.profile_id)) {
      throw profileError(`Duplicate skill candidate profile id ${profile.profile_id}: ${profileIdToRef.get(profile.profile_id)} and ${ref}`);
    }
    profileIdToRef.set(profile.profile_id, ref);

    const targetSkillId = profile.candidate.suggested_skill_id;
    if (targetSkillIdToRef.has(targetSkillId)) {
      throw profileError(`Duplicate skill candidate target ${targetSkillId}: ${targetSkillIdToRef.get(targetSkillId)} and ${ref}`);
    }
    targetSkillIdToRef.set(targetSkillId, ref);

    const sourceKey = profileSourceKey(profile.source.repository, profile.source.commit);
    if (sourceToRef.has(sourceKey)) {
      throw profileError(`Duplicate skill candidate source binding ${sourceKey}: ${sourceToRef.get(sourceKey)} and ${ref}`);
    }
    sourceToRef.set(sourceKey, ref);

    const entry = {
      profile,
      profile_ref: ref,
      profile_digest: `sha256:${sha256(stableStringify(profile))}`,
    };
    entries.push(entry);
  }

  return {
    entries,
    bySource: new Map(entries.map((entry) => [
      profileSourceKey(entry.profile.source.repository, entry.profile.source.commit),
      entry,
    ])),
    count: entries.length,
  };
}

function profileForPair(profileIndex, pair) {
  const snapshot = pair.sourceSnapshot;
  const nwo = repoNwoFromArtifact(pair);
  const commit = sourceSnapshotCommit(snapshot);
  if (!nwo || !commit) return null;
  return profileIndex.bySource.get(profileSourceKey(nwo, commit)) || null;
}

async function loadExistingSkillIndex(corexRoot) {
  const skillIds = new Set();
  const skillRecords = [];
  if (!corexRoot || !await pathExists(corexRoot)) {
    return { available: false, skillIds, skillRecords };
  }

  const skillsRoot = path.join(corexRoot, "skills");
  try {
    const entries = await fs.readdir(skillsRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const id = entry.name;
      skillIds.add(id);
      const skillDir = path.join(skillsRoot, id);
      const manifest = await readJson(path.join(skillDir, "manifest.json"), null);
      const skillMdPath = path.join(skillDir, "SKILL.md");
      let heading = id;
      try {
        const skillText = await fs.readFile(skillMdPath, "utf8");
        const firstHeading = skillText.split("\n").find((line) => /^#\s+/.test(line));
        if (firstHeading) heading = firstHeading.replace(/^#\s+/, "").trim();
      } catch {
        // Keep directory id as the fallback name.
      }
      const record = {
        skill_id: manifest?.skill_id || manifest?.id || id,
        name: manifest?.name || heading,
        tools: toArray(manifest?.tools),
        flows: toArray(manifest?.flows),
        source_ref: path.relative(corexRoot, skillDir),
      };
      skillIds.add(record.skill_id);
      skillRecords.push(record);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  return { available: true, skillIds, skillRecords };
}

async function loadExistingCandidates(projectRootValue, outDir) {
  const dirs = [
    path.join(projectRootValue, "data", "review", "skill-candidates"),
    path.join(outDir, "skill-candidates"),
  ];
  const byId = new Map();
  for (const dir of dirs) {
    for (const record of await readJsonFiles(dir)) {
      const id = record.value?.candidate_id || record.value?.id;
      if (id && !byId.has(id)) byId.set(id, record.value);
    }
  }
  return [...byId.values()];
}

function inferLane(knowledgeArtifact, snapshot) {
  const text = [
    knowledgeArtifact?.summary,
    snapshot?.metadata?.primary_language,
    toArray(snapshot?.metadata?.topics).join(" "),
    toArray(knowledgeArtifact?.capabilities).map((capability) => capability.label || capability.id).join(" "),
  ].join(" ").toLowerCase();

  if (/3d|webgl|graphics|shader|vision|image|avatar|render/.test(text)) return "visual-runtime";
  if (/agent|workflow|orchestr|automation|mcp|tool/.test(text)) return "agent-workflows";
  if (/research|paper|dataset|benchmark|evaluation/.test(text)) return "research-intelligence";
  if (/frontend|react|vite|ui|component/.test(text)) return "frontend-ui";
  if (/deploy|infra|devops|database|server|cli/.test(text)) return "developer-tooling";
  return "core-capability";
}

function inferScope(snapshot, knowledgeArtifact) {
  if (snapshot?.metadata?.private === true) return "house-local";
  if (knowledgeArtifact?.metadata?.adoption_kind === "house") return "house-local";
  return "shared";
}

function inferRequiredToolsAndServices(lane, knowledgeArtifact) {
  const tools = ["vega-lab:mcp", "vega-lab:repo-signals", "vega-lab:source-snapshot"];
  const services = [];
  if (lane === "agent-workflows") tools.push("core-x:openresponses", "core-x:event-bus");
  if (lane === "research-intelligence") services.push("mlx-rag");
  if (lane === "visual-runtime") services.push("mlx-vision", "ocr");
  if (toArray(knowledgeArtifact?.extracted_flows).length > 0) tools.push("core-x:flows");
  return { tools: unique(tools), services: unique(services) };
}

function licenseStatus(license) {
  const value = String(license || "").trim();
  if (!value || /^none$/i.test(value)) {
    return {
      status: "unknown",
      identifier: null,
      source: "repository-metadata",
      notes: ["Missing or unspecified license; requires manual review before adoption."],
    };
  }
  if (/agpl/i.test(value)) {
    return {
      status: "incompatible",
      identifier: value,
      source: "repository-metadata",
      notes: ["AGPL-style license detected; promotion may conflict with distribution goals."],
    };
  }
  if (/(gpl|lgpl)/i.test(value)) {
    return {
      status: "restricted",
      identifier: value,
      source: "repository-metadata",
      notes: ["GPL-family license detected; adoption scope must be reviewed."],
    };
  }
  if (/(mit|apache|bsd|isc|mpl|unlicense|cc0)/i.test(value)) {
    return {
      status: "compatible",
      identifier: value,
      source: "repository-metadata",
      notes: [`License appears adoption-friendly: ${value}.`],
    };
  }
  return {
    status: "review-required",
    identifier: value,
    source: "repository-metadata",
    notes: [`License requires manual compatibility review: ${value}.`],
  };
}

function licenseStatusFromSnapshot(snapshot) {
  const license = snapshot?.metadata?.immutable?.license_status;
  if (!license?.status) return null;
  return {
    status: license.status,
    identifier: license.identifier || null,
    source: license.source || null,
    notes: toArray(license.notes),
  };
}

function isImmutableSourceSnapshot(snapshot) {
  const immutable = snapshot?.metadata?.immutable || {};
  return snapshot?.source_type === "repository"
    && immutable.provider === "github"
    && /^[a-f0-9]{40}$/i.test(String(immutable.resolved_commit_sha || ""))
    && /^[a-f0-9]{40}$/i.test(String(immutable.resolved_tree_sha || ""))
    && /^sha256:[a-f0-9]{64}$/i.test(String(immutable.evidence_digest || ""))
    && String(snapshot?.source_ref || "").endsWith(`@${immutable.resolved_commit_sha}`)
    && toArray(immutable.evidence_manifest?.evidence).some((item) => item.kind === "readme")
    && toArray(immutable.evidence_manifest?.evidence).some((item) => item.kind === "license");
}

function textForScanning(candidateInput) {
  return stableStringify(candidateInput);
}

function patternFindings(patterns, text, kind, severity = "blocking") {
  return patterns
    .filter((pattern) => pattern.test(text))
    .map((pattern) => ({
      kind,
      severity,
      summary: `${kind} indicator matched pattern ${String(pattern)}`,
    }));
}

function tokenSimilarity(a, b) {
  const aTokens = new Set(slug(a).split("-").filter((token) => token.length > 2));
  const bTokens = new Set(slug(b).split("-").filter((token) => token.length > 2));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  const overlap = [...aTokens].filter((token) => bTokens.has(token)).length;
  return overlap / Math.max(aTokens.size, bTokens.size);
}

function duplicateMatches(candidate, existingSkillIndex, existingCandidates) {
  const matches = [];
  if (existingSkillIndex.skillIds.has(candidate.candidate_id) || existingSkillIndex.skillIds.has(candidate.suggested_skill_id)) {
    matches.push({
      kind: "duplicate_id",
      target: candidate.suggested_skill_id,
      confidence: 1,
      source: "core-x/skills",
    });
  }

  for (const skill of existingSkillIndex.skillRecords) {
    const score = Math.max(
      tokenSimilarity(candidate.name, skill.name),
      tokenSimilarity(candidate.suggested_skill_id, skill.skill_id),
    );
    if (score >= 0.45) {
      matches.push({
        kind: "similar_existing_capability",
        target: skill.skill_id,
        label: skill.name,
        confidence: Number(score.toFixed(2)),
        source: skill.source_ref,
      });
    }
  }

  for (const existing of existingCandidates) {
    if (existing.candidate_id === candidate.candidate_id) {
      matches.push({
        kind: "duplicate_id",
        target: existing.candidate_id,
        confidence: 1,
        source: "vega:data/review/skill-candidates",
      });
    }
  }

  return matches;
}

function conflictFindings(candidate, knowledgeArtifact, existingSkillIndex) {
  const findings = [];
  for (const conflict of toArray(knowledgeArtifact?.conflicts)) {
    findings.push({
      kind: conflict.kind || "unknown",
      severity: conflict.kind === "license" ? "blocking" : "warning",
      summary: conflict.summary || "Knowledge refinery conflict requires review.",
      source_refs: toArray(conflict.source_refs),
    });
  }

  if (!existingSkillIndex.available) {
    findings.push({
      kind: "missing_reference_index",
      severity: "warning",
      summary: "Core-X skill index was not available; duplicate detection is partial.",
      source_refs: ["core-x/skills"],
    });
  }

  if (candidate.suggested_corex_lane === "visual-runtime" && !candidate.required_tools_services.services.includes("mlx-vision")) {
    findings.push({
      kind: "wrong_model_service_lane",
      severity: "blocking",
      summary: "Visual runtime candidates must declare the MLX Vision service lane.",
      source_refs: candidate.provenance_references,
    });
  }

  if (["unknown", "incompatible", "restricted", "review-required"].includes(candidate.license_status.status)) {
    findings.push({
      kind: "license",
      severity: ["incompatible", "restricted"].includes(candidate.license_status.status) ? "blocking" : "warning",
      summary: toArray(candidate.license_status.notes).join(" ") || "License requires review.",
      source_refs: candidate.provenance_references,
    });
  }

  if (candidate.provenance_references.length === 0) {
    findings.push({
      kind: "missing_provenance",
      severity: "blocking",
      summary: "Candidate is missing provenance references.",
      source_refs: [],
    });
  }

  if (!isImmutableSourceSnapshot(knowledgeArtifact?.sourceSnapshot || candidate.__sourceSnapshot)) {
    findings.push({
      kind: "missing_immutable_source_snapshot",
      severity: "blocking",
      summary: "Candidate was generated from metadata-only cache; resolve a pinned commit/tree/evidence source snapshot before promotion.",
      source_refs: [candidate.source_snapshot_identity?.artifact_ref, candidate.source_snapshot_identity?.source_ref].filter(Boolean),
    });
  }

  const scanText = textForScanning(candidate);
  findings.push(...patternFindings(LOCAL_PATH_PATTERNS, scanText, "absolute_local_path"));
  findings.push(...patternFindings(SECRET_PATTERNS, scanText, "secret_or_credential"));
  findings.push(...patternFindings(UNSAFE_EXEC_PATTERNS, scanText, "unsafe_executable_script", "warning"));

  return findings;
}

function riskFindings(candidate, knowledgeArtifact) {
  const risks = toArray(knowledgeArtifact?.risks).map((risk) => ({
    kind: risk.severity === "blocking" ? "blocking_risk" : "adoption_risk",
    severity: risk.severity || "warning",
    summary: risk.summary || "Knowledge refinery risk requires review.",
    source_refs: toArray(risk.source_refs),
  }));

  if (candidate.duplicate_matches.length > 0) {
    risks.push({
      kind: "duplicate_review",
      severity: "warning",
      summary: "Candidate overlaps existing skills or pending candidates; review before promotion.",
      source_refs: candidate.duplicate_matches.map((match) => match.source).filter(Boolean),
    });
  }
  return risks;
}

function buildEvidenceSummary(knowledgeArtifact, snapshot) {
  const capabilities = toArray(knowledgeArtifact?.capabilities)
    .map((capability) => capability.label || capability.id)
    .filter(Boolean)
    .slice(0, 6);
  const risks = toArray(knowledgeArtifact?.risks).map((risk) => risk.summary).filter(Boolean).slice(0, 3);
  return [
    knowledgeArtifact?.summary || snapshot?.metadata?.description || `Repository metadata for ${snapshot?.source_ref}.`,
    capabilities.length > 0 ? `Capabilities: ${capabilities.join(", ")}.` : "Capabilities: no explicit capabilities detected.",
    risks.length > 0 ? `Review risks: ${risks.join(" ")}` : "Review risks: no blocking metadata risk detected.",
  ].join(" ");
}

function markdownList(values) {
  return toArray(values).map((value) => `- ${value}`);
}

function markdownNumberedList(values) {
  return toArray(values).map((value, index) => `${index + 1}. ${value}`);
}

function firstRefMatching(candidate, pattern) {
  return toArray(candidate?.provenance_references).find((ref) => pattern.test(String(ref || ""))) || null;
}

function draftSkillMarkdown(candidate) {
  if (candidate.policy) {
    const policy = candidate.policy;
    const treeRef = firstRefMatching(candidate, /^github:[^:]+\/[^:]+:tree:/);
    const evidenceRef = firstRefMatching(candidate, /^vega:evidence:/);
    return [
      `# ${candidate.name}`,
      "",
      "## Purpose",
      policy.purpose,
      "",
      "## When to Use",
      ...markdownList(policy.when_to_use),
      "",
      "## When Not to Use",
      ...markdownList(policy.when_not_to_use),
      "",
      "## Relationship to Vega",
      policy.relationship_to_vega,
      "",
      "## Safe Evaluation Workflow",
      ...markdownNumberedList(policy.safe_evaluation_workflow),
      "",
      "## Immutable Provenance Requirements",
      ...markdownList(policy.immutable_provenance_requirements),
      "",
      "## License Requirements",
      ...markdownList(policy.license_requirements),
      "",
      "## Local-First Policy",
      policy.local_first_policy,
      "",
      "## Network Restrictions",
      ...markdownList(policy.network_restrictions),
      "",
      "## Credential Restrictions",
      ...markdownList(policy.credential_restrictions),
      "",
      "## Human Approval Gates",
      ...markdownList(policy.human_approval_gates),
      "",
      "## Allowed Outputs",
      ...markdownList(policy.allowed_outputs),
      "",
      "## Failure and Refusal Conditions",
      ...markdownList(policy.failure_conditions),
      "",
      "## Explicit Prohibitions",
      ...markdownList(policy.prohibited_actions),
      "",
      "## Source Attribution",
      ...markdownList(policy.source_attribution),
      `- Candidate profile: ${candidate.candidate_profile?.profile_id || "unknown"}`,
      `- Profile digest: ${candidate.candidate_profile?.profile_digest || "unknown"}`,
      `- Repository: ${candidate.source_repository.nwo}`,
      `- Source ref: ${candidate.source_snapshot_identity.source_ref}`,
      `- Snapshot: ${candidate.source_snapshot_identity.snapshot_id}`,
      treeRef ? `- Tree reference: ${treeRef}` : null,
      evidenceRef ? `- Evidence reference: ${evidenceRef}` : null,
      "",
      "## Review Gate",
      "- Status: pending",
      "- This is a draft candidate only. Do not promote without human approval.",
      "- This profile does not approve, install, execute, publish, or mutate Core-X state.",
      "",
    ].filter((line) => line !== null).join("\n");
  }

  return [
    `# ${candidate.name}`,
    "",
    "## Purpose",
    candidate.description,
    "",
    "## Source",
    `- Repository: ${candidate.source_repository.nwo}`,
    `- Snapshot: ${candidate.source_snapshot_identity.snapshot_id}`,
    "",
    "## Suggested Core-X Placement",
    `- Lane: ${candidate.suggested_corex_lane}`,
    `- Scope: ${candidate.suggested_scope}`,
    "",
    "## Evidence Summary",
    candidate.evidence_summary,
    "",
    "## Review Gate",
    "- Status: pending",
    "- This is a draft candidate only. Do not promote without human approval.",
    "",
  ].join("\n");
}

function buildCandidate({ pair, existingSkillIndex, existingCandidates, profileEntry = null, createdAt }) {
  const snapshot = pair.sourceSnapshot;
  const knowledgeArtifact = pair.knowledgeArtifact;
  const nwo = repoNwoFromArtifact(pair);
  const safeRepo = slug(nwo);
  const profile = profileEntry?.profile || null;
  const lane = profile?.candidate?.lane || inferLane(knowledgeArtifact, snapshot);
  const scope = profile?.candidate?.scope || inferScope(snapshot, knowledgeArtifact);
  const immutableSnapshot = isImmutableSourceSnapshot(snapshot);
  const license = licenseStatusFromSnapshot(snapshot) || licenseStatus(snapshot?.provenance?.license || snapshot?.metadata?.license || null);
  const required = profile?.candidate?.required_tools_services || inferRequiredToolsAndServices(lane, knowledgeArtifact);
  const suggestedSkillId = profile?.candidate?.suggested_skill_id || `vega-${safeRepo}`;
  const provenanceReferences = unique([
    snapshot?.artifact_ref,
    `vega:data/repo-signals.json#${nwo}`,
    `vega:data/skill-extractions.json#${nwo}`,
    profileEntry ? `vega:skill-candidate-profile:${profile.profile_id}:${profileEntry.profile_digest}` : null,
    profileEntry ? profileEntry.profile_ref : null,
    ...toArray(snapshot?.provenance?.source_refs),
    ...toArray(snapshot?.provenance?.derived_from),
    snapshot?.provenance?.evidence_digest ? `vega:evidence:${snapshot.provenance.evidence_digest}` : null,
    ...toArray(knowledgeArtifact?.provenance?.source_refs),
    ...toArray(knowledgeArtifact?.provenance?.evidence_refs),
  ]);

  const base = {
    schema_version: CANDIDATE_SCHEMA_VERSION,
    candidate_id: `vega.skill-candidate:${safeRepo}`,
    suggested_skill_id: suggestedSkillId,
    name: profile?.candidate?.name || `${snapshot?.metadata?.name || nwo} Core-X Skill Candidate`,
    description: profile?.candidate?.description || knowledgeArtifact?.summary || snapshot?.metadata?.description || `Review-gated skill candidate for ${nwo}.`,
    source_repository: {
      nwo,
      uri: snapshot?.source_uri || `https://github.com/${nwo}`,
      scope: snapshot?.metadata?.scope || "unknown",
      private: snapshot?.metadata?.private === true,
    },
    source_snapshot_identity: {
      snapshot_id: snapshot?.id || null,
      source_ref: snapshot?.source_ref || nwo,
      artifact_ref: snapshot?.artifact_ref || null,
    },
    provenance_references: provenanceReferences,
    suggested_corex_lane: lane,
    suggested_scope: scope,
    required_tools_services: required,
    license_status: license,
    compatibility_assumptions: profile?.candidate?.compatibility_assumptions || (immutableSnapshot
      ? [
        "Generated from Vega metadata plus a pinned immutable GitHub source snapshot.",
        "Candidate identity binds resolved commit, tree, README digest, license digest, consumed manifest digests, and aggregate evidence digest.",
        "No third-party source code or long README bodies are copied into this candidate.",
        "Promotion requires human review and a separate Core-X registry/docs change.",
      ]
      : [
        "Generated from Vega metadata, repo signals, and skill extraction cache only.",
        "No third-party source code or long README bodies are copied into this candidate.",
        "Promotion is blocked until a pinned immutable source snapshot is resolved.",
      ]),
    evidence_summary: profile?.candidate?.evidence_summary || buildEvidenceSummary(knowledgeArtifact, snapshot),
    duplicate_matches: [],
    conflict_findings: [],
    risk_findings: [],
    review_status: "pending",
    created_at: createdAt,
    generated_by: GENERATED_BY,
    tool: TOOL,
  };

  if (profileEntry) {
    base.candidate_profile = {
      schema_version: PROFILE_SCHEMA_VERSION,
      profile_id: profile.profile_id,
      profile_ref: profileEntry.profile_ref,
      profile_digest: profileEntry.profile_digest,
      source: {
        repository: profile.source.repository,
        commit: profile.source.commit,
      },
      runtime: profile.candidate.runtime,
    };
    base.policy = profile.policy;
  }

  base.duplicate_matches = duplicateMatches(base, existingSkillIndex, existingCandidates);
  base.duplicate_matches = unique([
    ...base.duplicate_matches.map((match) => stableStringify(match)),
    ...toArray(profile?.candidate?.duplicate_matches).map((match) => stableStringify(match)),
  ]).map((match) => JSON.parse(match));
  base.__sourceSnapshot = snapshot;
  base.conflict_findings = conflictFindings(base, knowledgeArtifact, existingSkillIndex);
  base.conflict_findings = [
    ...base.conflict_findings,
    ...toArray(profile?.candidate?.conflict_findings),
  ];
  delete base.__sourceSnapshot;
  base.risk_findings = riskFindings(base, knowledgeArtifact);
  base.risk_findings = [
    ...base.risk_findings,
    ...toArray(profile?.candidate?.risk_findings),
  ];
  base.content_checksum = candidateContentChecksum(base);
  base.draft_skill_md = draftSkillMarkdown(base);
  return base;
}

export function validateSkillCandidate(candidate) {
  const schemaValid = validateCandidateSchema(candidate);
  const scanText = textForScanning(candidate || {});
  const blockers = [
    ...patternFindings(LOCAL_PATH_PATTERNS, scanText, "absolute_local_path"),
    ...patternFindings(SECRET_PATTERNS, scanText, "secret_or_credential"),
    ...toArray(candidate?.conflict_findings)
      .filter((finding) => finding.severity === "blocking")
      .map((finding) => ({ ...finding })),
    ...toArray(candidate?.risk_findings)
      .filter((finding) => finding.severity === "blocking")
      .map((finding) => ({ ...finding })),
  ];
  const computedChecksum = candidate ? candidateContentChecksum(candidate) : "";
  const checksumOk = candidate?.content_checksum === computedChecksum;
  if (!checksumOk) {
    blockers.push({ kind: "checksum", severity: "blocking", summary: "Candidate checksum does not match canonical content." });
  }
  if (candidate?.review_status !== "pending") {
    blockers.push({ kind: "review_gate", severity: "blocking", summary: "Skill candidates must start as pending." });
  }
  if (candidate?.source_repository?.private === true && candidate?.visibility === "public") {
    blockers.push({ kind: "privacy", severity: "blocking", summary: "Private repository candidates cannot be public." });
  }
  if (candidate?.candidate_profile) {
    const profileRepo = String(candidate.candidate_profile.source?.repository || "").toLowerCase();
    const candidateRepo = String(candidate.source_repository?.nwo || "").toLowerCase();
    const profileCommit = String(candidate.candidate_profile.source?.commit || "").toLowerCase();
    const sourceRef = String(candidate.source_snapshot_identity?.source_ref || "").toLowerCase();
    if (profileRepo !== candidateRepo || !sourceRef.endsWith(`@${profileCommit}`)) {
      blockers.push({
        kind: "profile_source_binding",
        severity: "blocking",
        summary: "Candidate profile source binding does not match candidate repository and immutable source snapshot.",
      });
    }
  }

  return {
    valid: schemaValid === true && blockers.length === 0,
    schema_errors: schemaValid ? [] : schemaErrors(validateCandidateSchema),
    missing: schemaErrors(validateCandidateSchema).filter((error) => /required property/.test(error)),
    blockers,
    checksum_ok: checksumOk,
    computed_checksum: computedChecksum,
    warnings: toArray(candidate?.conflict_findings).filter((finding) => finding.severity !== "blocking"),
  };
}

export function buildReviewEnvelope(candidate, options = {}) {
  const reviewer = options.reviewer || {};
  return {
    schema_version: REVIEW_SCHEMA_VERSION,
    review_id: options.reviewId || `review-${slug(candidate?.candidate_id || candidate?.suggested_skill_id || "unknown")}`,
    candidate_id: candidate.candidate_id,
    candidate_checksum: candidate.content_checksum,
    status: options.status || "approved",
    reviewer: {
      id: reviewer.id || options.reviewerId || "compat-test@local",
      ...(reviewer.display_name || options.reviewerDisplayName
        ? { display_name: reviewer.display_name || options.reviewerDisplayName }
        : {}),
    },
    reviewed_at: options.reviewedAt || new Date().toISOString(),
    notes: toArray(options.notes),
    resolved_findings: toArray(options.resolvedFindings),
  };
}

export function applyReviewEnvelope(candidate, review) {
  const status = review?.status === "approved"
    ? "approved"
    : review?.status === "rejected"
      ? "rejected"
      : "pending";
  return {
    ...candidate,
    review_status: status,
  };
}

export function buildPromotionProposal(candidate, options = {}) {
  const safeId = slug(candidate?.candidate_id || candidate?.suggested_skill_id || "unknown");
  const review = options.review || null;
  return {
    id: `vega.capability-promotion:${safeId}`,
    artifact_id: candidate.candidate_id,
    target_kind: "skill",
    target_path: `core-x/skills/${candidate.suggested_skill_id}/SKILL.md`,
    rationale: `Promote ${candidate.name} after review because Vega detected reusable capability evidence from ${candidate.source_repository.nwo}.`,
    expected_value: candidate.evidence_summary,
    risk_level: candidate.conflict_findings.some((finding) => finding.severity === "blocking") ? "high" : "medium",
    required_reviewers: ["core-x-maintainer", "skill-owner"],
    promotion_status: options.promotionStatus || "pending_review",
    rollback_notes: "No registry mutation is performed by Vega. If promoted later, revert the separate Core-X registry/docs commit.",
    provenance: {
      source_refs: candidate.provenance_references,
      evidence_refs: [candidate.source_snapshot_identity.artifact_ref].filter(Boolean),
      derived_from: [candidate.candidate_id, candidate.source_snapshot_identity.snapshot_id].filter(Boolean),
      review_artifact_ref: options.reviewArtifactRef || review?.review_id || `data/review/skill-candidates/${slug(candidate.candidate_id)}.json`,
    },
    metadata: {
      generated_by: GENERATED_BY,
      created_at: options.createdAt || candidate.created_at || new Date().toISOString(),
      candidate_id: candidate.candidate_id,
      candidate_checksum: candidate.content_checksum,
      ...(review?.review_id ? { review_id: review.review_id } : {}),
      review_status: review?.status || "pending",
      visibility: "internal",
    },
  };
}

async function writeCandidateArtifacts(outDir, candidates, options = {}) {
  const candidateDir = path.join(outDir, "skill-candidates");
  const proposalDir = path.join(outDir, "capability-promotions");
  await fs.mkdir(candidateDir, { recursive: true });
  await fs.mkdir(proposalDir, { recursive: true });

  for (const candidate of candidates) {
    const safeName = slug(candidate.candidate_id);
    const candidateRef = path.join(candidateDir, `${safeName}.json`);
    await fs.writeFile(candidateRef, `${JSON.stringify(candidate, null, 2)}\n`, "utf8");
    const proposal = buildPromotionProposal(candidate, {
      createdAt: options.createdAt,
      reviewArtifactRef: path.relative(options.projectRoot || projectRoot, candidateRef),
    });
    await fs.writeFile(path.join(proposalDir, `${safeName}.json`), `${JSON.stringify(proposal, null, 2)}\n`, "utf8");

    if (options.emitDraftFolders) {
      const draftDir = path.join(outDir, "skill-drafts", safeName);
      await fs.mkdir(path.join(draftDir, "references"), { recursive: true });
      await fs.writeFile(path.join(draftDir, "SKILL.md"), candidate.draft_skill_md, "utf8");
      await fs.writeFile(path.join(draftDir, "references", "SOURCELOG.md"), [
        `# Source Log: ${candidate.name}`,
        "",
        `- Repository: ${candidate.source_repository.nwo}`,
        `- Snapshot: ${candidate.source_snapshot_identity.snapshot_id}`,
        ...candidate.provenance_references.map((ref) => `- ${ref}`),
        "",
      ].join("\n"), "utf8");
      await fs.writeFile(path.join(draftDir, "references", "EVIDENCE.md"), [
        `# Evidence: ${candidate.name}`,
        "",
        candidate.evidence_summary,
        "",
        "## Risks",
        ...candidate.risk_findings.map((finding) => `- ${finding.severity}: ${finding.summary}`),
        "",
      ].join("\n"), "utf8");
    }
  }
}

export async function buildSkillCandidateIngestion(options = {}) {
  const root = options.projectRoot || projectRoot;
  const outDir = options.outDir || path.join(root, "data", "review");
  const createdAt = options.createdAt || new Date().toISOString();
  const corexRoot = options.corexRoot || detectCorexRoot(root);
  const contractResult = await buildCorexContractArtifacts({
    projectRoot: root,
    outDir,
    limit: options.limit,
    all: options.all,
    scope: options.scope,
    dryRun: true,
    createdAt,
  });
  const existingSkillIndex = await loadExistingSkillIndex(corexRoot);
  const existingCandidates = await loadExistingCandidates(root, outDir);
  const profileIndex = await loadSkillCandidateProfiles(root);
  const candidates = contractResult.artifacts.map((pair) => buildCandidate({
    pair,
    existingSkillIndex,
    existingCandidates,
    profileEntry: profileForPair(profileIndex, pair),
    createdAt,
  }));
  const proposals = candidates.map((candidate) => buildPromotionProposal(candidate, { createdAt }));

  return {
    generated_by: GENERATED_BY,
    created_at: createdAt,
    dry_run: options.dryRun === true,
    selected_count: candidates.length,
    available_count: contractResult.available_count,
    outputs: {
      skill_candidates: path.relative(root, path.join(outDir, "skill-candidates")),
      capability_promotions: path.relative(root, path.join(outDir, "capability-promotions")),
      skill_drafts: path.relative(root, path.join(outDir, "skill-drafts")),
    },
    source_artifacts: contractResult.artifacts,
    candidates,
    proposals,
    checks: {
      corex_skill_index_available: existingSkillIndex.available,
      existing_skill_count: existingSkillIndex.skillRecords.length,
      existing_candidate_count: existingCandidates.length,
      skill_candidate_profile_count: profileIndex.count,
    },
  };
}

export async function listSkillCandidates(options = {}) {
  const result = await buildSkillCandidateIngestion({ ...options, dryRun: true });
  return {
    count: result.candidates.length,
    candidates: result.candidates,
    checks: result.checks,
  };
}

export async function getSkillCandidate(candidateId, options = {}) {
  const result = await buildSkillCandidateIngestion({ ...options, dryRun: true, all: options.all ?? true, limit: options.limit ?? 250 });
  return result.candidates.find((candidate) => candidate.candidate_id === candidateId || candidate.suggested_skill_id === candidateId) || null;
}

export async function proposeSkillPromotion(candidateId, options = {}) {
  const candidate = await getSkillCandidate(candidateId, options);
  if (!candidate) return null;
  const validation = validateSkillCandidate(candidate);
  const proposal = buildPromotionProposal(candidate, {
    createdAt: options.createdAt,
    review: options.review,
    promotionStatus: options.promotionStatus,
  });

  if (options.write === true) {
    const root = options.projectRoot || projectRoot;
    const outDir = options.outDir || path.join(root, "data", "review");
    const proposalDir = path.join(outDir, "capability-promotions");
    await fs.mkdir(proposalDir, { recursive: true });
    await fs.writeFile(path.join(proposalDir, `${slug(candidate.candidate_id)}.json`), `${JSON.stringify(proposal, null, 2)}\n`, "utf8");
  }

  return { candidate, validation, proposal, wrote: options.write === true };
}

export async function runBuildSkillCandidates(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const result = await buildSkillCandidateIngestion(options);

  if (!options.dryRun) {
    await writeCandidateArtifacts(options.outDir, result.candidates, {
      projectRoot: options.projectRoot,
      createdAt: result.created_at,
      emitDraftFolders: options.emitDraftFolders,
    });
  }

  const summary = {
    generated_by: result.generated_by,
    created_at: result.created_at,
    dry_run: result.dry_run,
    selected_count: result.selected_count,
    available_count: result.available_count,
    outputs: result.outputs,
    checks: result.checks,
    candidates: result.candidates.map((candidate) => ({
      candidate_id: candidate.candidate_id,
      suggested_skill_id: candidate.suggested_skill_id,
      source_repository: candidate.source_repository.nwo,
      suggested_corex_lane: candidate.suggested_corex_lane,
      suggested_scope: candidate.suggested_scope,
      license_status: candidate.license_status.status,
      duplicate_matches: candidate.duplicate_matches.length,
      conflict_findings: candidate.conflict_findings.length,
      risk_findings: candidate.risk_findings.length,
      profile_id: candidate.candidate_profile?.profile_id || null,
      profile_digest: candidate.candidate_profile?.profile_digest || null,
      review_status: candidate.review_status,
      content_checksum: candidate.content_checksum,
    })),
  };
  console.log(JSON.stringify(summary, null, 2));
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runBuildSkillCandidates().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
