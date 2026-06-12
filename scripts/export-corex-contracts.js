#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const GENERATED_BY = "vega-lab:export-corex-contracts";
const TOOL = {
  tool_id: "vega.export_corex_contracts",
  name: "Vega Core-X Contract Exporter",
  version: "0.1.0",
};

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function slug(value) {
  return String(value || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "unknown";
}

function repoNwo(repo) {
  return repo?.nwo || [repo?.author, repo?.name].filter(Boolean).join("/") || "unknown/unknown";
}

function sourceUri(repo) {
  return repo?.url || `https://github.com/${repoNwo(repo)}`;
}

function repoKey(value) {
  return String(value || "").trim().toLowerCase();
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    limit: 25,
    all: false,
    dryRun: false,
    scope: "all",
    projectRoot,
    outDir: path.join(projectRoot, "data", "review"),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--all") {
      options.all = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
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
    } else if (arg === "--out-dir") {
      options.outDir = path.resolve(options.projectRoot, argv[index + 1] || options.outDir);
      index += 1;
    } else if (arg.startsWith("--out-dir=")) {
      options.outDir = path.resolve(options.projectRoot, arg.slice("--out-dir=".length));
    } else if (arg === "--project-root") {
      options.projectRoot = path.resolve(argv[index + 1] || options.projectRoot);
      if (options.outDir === path.join(projectRoot, "data", "review")) {
        options.outDir = path.join(options.projectRoot, "data", "review");
      }
      index += 1;
    } else if (arg.startsWith("--project-root=")) {
      options.projectRoot = path.resolve(arg.slice("--project-root=".length));
      if (options.outDir === path.join(projectRoot, "data", "review")) {
        options.outDir = path.join(options.projectRoot, "data", "review");
      }
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(options.limit) || options.limit < 1) {
    options.limit = 25;
  }

  return options;
}

async function readJson(root, relativePath, fallback = []) {
  for (const prefix of ["data", "public"]) {
    const filePath = path.join(root, prefix, relativePath);
    try {
      return JSON.parse(await fs.readFile(filePath, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return fallback;
}

function indexByNwo(items) {
  const map = new Map();
  for (const item of toArray(items)) {
    const nwo = repoKey(item?.nwo || repoNwo(item));
    if (nwo) map.set(nwo, item);
  }
  return map;
}

function repoScope(repo, mineSet) {
  return mineSet.has(repoKey(repoNwo(repo))) ? "mine" : "starred";
}

function selectRepos(repos, signalsByNwo, mineSet, options) {
  const scope = String(options.scope || "all").toLowerCase();
  const sorted = toArray(repos)
    .map((repo) => ({ repo, signal: signalsByNwo.get(repoKey(repoNwo(repo))) || null, scope: repoScope(repo, mineSet) }))
    .filter((entry) => scope === "all" || entry.scope === scope)
    .sort((a, b) => {
      const signalScore = (b.signal?.adoptionScore || 0) - (a.signal?.adoptionScore || 0);
      if (signalScore !== 0) return signalScore;
      const stars = (b.repo?.stars || 0) - (a.repo?.stars || 0);
      if (stars !== 0) return stars;
      return repoNwo(a.repo).localeCompare(repoNwo(b.repo));
    });

  return options.all ? sorted : sorted.slice(0, options.limit);
}

function tokenEstimate(repo, signal, extraction) {
  const text = [
    repo?.name,
    repo?.author,
    repo?.description,
    toArray(repo?.topics).join(" "),
    repo?.primary_language,
    signal?.adoptionKind,
    toArray(signal?.capabilities).join(" "),
    extraction?.summary,
  ].filter(Boolean).join(" ");
  return Math.ceil(text.length / 4);
}

function buildSourceSnapshot({ repo, signal, extraction, scope, createdAt }) {
  const nwo = repoNwo(repo);
  const id = `vega:source-snapshot:${slug(nwo)}`;
  const artifactRef = `data/review/source-snapshots/${slug(nwo)}.json`;

  return {
    id,
    source_type: "repository",
    source_uri: sourceUri(repo),
    source_ref: nwo,
    created_at: createdAt,
    created_by: GENERATED_BY,
    tool: TOOL,
    include_patterns: ["repo metadata", "repo signals", "skill extraction summary"],
    exclude_patterns: ["raw source files", "README body", "private file contents", "tokens", "secrets"],
    token_estimate: {
      tokens: tokenEstimate(repo, signal, extraction),
      method: "metadata-character-estimate/4",
      confidence: "estimated",
    },
    secret_scan: {
      status: "skipped",
      tool: "metadata-only-export:no-source-content",
      findings_count: 0,
      redaction_applied: false,
      report_ref: null,
    },
    provenance: {
      source_refs: [
        `${scope}:repo:${nwo}`,
        "vega:data/data.json|data/my-repos.json",
        "vega:data/repo-signals.json",
        "vega:data/skill-extractions.json",
      ],
      derived_from: ["vega repo/star cache", "vega repo signals", "vega skill extractions"],
      commit: null,
      license: repo?.license || null,
    },
    artifact_ref: artifactRef,
    review_status: "pending",
    metadata: {
      nwo,
      name: repo?.name || null,
      author: repo?.author || null,
      scope,
      description: repo?.description || null,
      stars: repo?.stars || 0,
      forks: repo?.forks || 0,
      open_issues: repo?.open_issues || 0,
      primary_language: repo?.primary_language || null,
      topics: toArray(repo?.topics),
      last_updated: repo?.last_updated || repo?.last_updated_at || null,
      adoption_score: signal?.adoptionScore ?? null,
      adoption_kind: signal?.adoptionKind || extraction?.adoptionKind || null,
      private: repo?.private === true,
    },
  };
}

function riskRecords(repo, signal, extraction) {
  const risks = [];
  const nwo = repoNwo(repo);
  if (repo?.private) {
    risks.push({ summary: "Repository is private; keep analysis internal and metadata-only.", severity: "blocking", source_refs: [`repo:${nwo}`] });
  }
  if (!repo?.license || repo.license === "None") {
    risks.push({ summary: "License is missing or unspecified; adoption requires manual license review.", severity: "warning", source_refs: [`repo:${nwo}`] });
  }
  if ((signal?.adoptionKind || extraction?.adoptionKind) === "ignore") {
    risks.push({ summary: "Vega classified this repository as ignore; do not promote without explicit review.", severity: "warning", source_refs: [`signal:${nwo}`] });
  }
  return risks;
}

function conflictRecords(repo, signal, extraction) {
  const conflicts = [];
  const nwo = repoNwo(repo);
  const capabilities = unique([...toArray(signal?.capabilities), ...toArray(extraction?.capabilities)]);
  if (capabilities.includes("frontend-ui") && capabilities.includes("developer-tooling")) {
    conflicts.push({ summary: "Capability overlaps existing frontend and developer-tooling lanes; promotion target must be specific.", kind: "capability_overlap", source_refs: [`repo:${nwo}`] });
  }
  if (repo?.license && /agpl/i.test(repo.license)) {
    conflicts.push({ summary: "AGPL license detected; adoption may conflict with distribution goals.", kind: "license", source_refs: [`repo:${nwo}`] });
  }
  return conflicts;
}

function buildKnowledgeArtifact({ repo, signal, extraction, snapshot, scope, createdAt }) {
  const nwo = repoNwo(repo);
  const capabilities = unique([...toArray(signal?.capabilities), ...toArray(extraction?.capabilities)]);
  const houseSkills = unique([...toArray(signal?.houseSkills), ...toArray(extraction?.houseSkills)]);
  const adoptionKind = signal?.adoptionKind || extraction?.adoptionKind || "ignore";
  const summary = extraction?.summary || signal?.description || repo?.description || `Repository metadata for ${nwo}.`;

  return {
    id: `vega:knowledge-refinery:${slug(nwo)}`,
    snapshot_id: snapshot.id,
    summary: `${nwo}: ${summary}`,
    entities: [
      { name: nwo, kind: "repository", source_refs: [`repo:${nwo}`] },
      ...houseSkills.map((skill) => ({ name: skill, kind: "house-skill", source_refs: [`skill-extraction:${nwo}`] })),
    ],
    capabilities: capabilities.map((capability) => ({
      id: `vega.capability.${slug(capability)}`,
      label: capability,
      description: `Detected Vega capability from repo metadata/signals: ${capability}`,
      source_refs: [`repo:${nwo}`, `signal:${nwo}`],
    })),
    risks: riskRecords(repo, signal, extraction),
    conflicts: conflictRecords(repo, signal, extraction),
    extracted_skills: houseSkills.map((skill) => ({
      id: `vega.skill-candidate.${slug(nwo)}.${slug(skill)}`,
      name: skill,
      source_repo: nwo,
      review_status: "pending",
    })),
    extracted_flows: toArray(extraction?.flows).map((flow) => ({
      id: `vega.flow-candidate.${slug(nwo)}.${slug(flow)}`,
      name: flow,
      source_repo: nwo,
      review_status: "pending",
    })),
    confidence: Math.max(0.35, Math.min(0.9, ((signal?.adoptionScore || 50) / 100))),
    provenance: {
      source_refs: [`repo:${nwo}`, `snapshot:${snapshot.id}`],
      evidence_refs: [
        snapshot.artifact_ref,
        `vega:data/repo-signals.json#${nwo}`,
        `vega:data/skill-extractions.json#${nwo}`,
      ],
      derived_from: [snapshot.id, "vega repo signals", "vega skill extractions"],
    },
    review_status: "pending",
    metadata: {
      nwo,
      scope,
      adoption_kind: adoptionKind,
      adoption_score: signal?.adoptionScore ?? null,
      primary_language: repo?.primary_language || null,
      topics: toArray(repo?.topics),
      generated_by: GENERATED_BY,
      created_at: createdAt,
    },
  };
}

async function writeArtifacts(outDir, pairs) {
  const snapshotDir = path.join(outDir, "source-snapshots");
  const refineryDir = path.join(outDir, "knowledge-refinery");
  await fs.mkdir(snapshotDir, { recursive: true });
  await fs.mkdir(refineryDir, { recursive: true });

  for (const pair of pairs) {
    const safeName = slug(pair.nwo);
    await fs.writeFile(path.join(snapshotDir, `${safeName}.json`), `${JSON.stringify(pair.sourceSnapshot, null, 2)}\n`, "utf8");
    await fs.writeFile(path.join(refineryDir, `${safeName}.json`), `${JSON.stringify(pair.knowledgeArtifact, null, 2)}\n`, "utf8");
  }
}

export async function buildCorexContractArtifacts(options = {}) {
  const root = options.projectRoot || projectRoot;
  const createdAt = options.createdAt || new Date().toISOString();
  const starredRepos = await readJson(root, "data.json", []);
  const myRepos = await readJson(root, "my-repos.json", []);
  const repoSignals = await readJson(root, "repo-signals.json", []);
  const skillExtractions = await readJson(root, "skill-extractions.json", []);

  const signalsByNwo = indexByNwo(repoSignals);
  const extractionsByNwo = indexByNwo(skillExtractions);
  const mineSet = new Set(toArray(myRepos).map((repo) => repoKey(repoNwo(repo))));
  const allReposByNwo = new Map();

  for (const repo of [...toArray(myRepos), ...toArray(starredRepos)]) {
    const nwo = repoKey(repoNwo(repo));
    if (nwo && !allReposByNwo.has(nwo)) allReposByNwo.set(nwo, repo);
  }

  const selected = selectRepos([...allReposByNwo.values()], signalsByNwo, mineSet, options);
  const artifacts = selected.map(({ repo, signal, scope }) => {
    const extraction = extractionsByNwo.get(repoKey(repoNwo(repo))) || null;
    const sourceSnapshot = buildSourceSnapshot({ repo, signal, extraction, scope, createdAt });
    const knowledgeArtifact = buildKnowledgeArtifact({ repo, signal, extraction, snapshot: sourceSnapshot, scope, createdAt });
    return { nwo: repoNwo(repo), sourceSnapshot, knowledgeArtifact };
  });

  return {
    generated_by: GENERATED_BY,
    created_at: createdAt,
    dry_run: options.dryRun === true,
    selected_count: artifacts.length,
    available_count: allReposByNwo.size,
    outputs: {
      source_snapshots: path.relative(root, path.join(options.outDir || path.join(root, "data", "review"), "source-snapshots")),
      knowledge_refinery: path.relative(root, path.join(options.outDir || path.join(root, "data", "review"), "knowledge-refinery")),
    },
    artifacts,
  };
}

export async function runExport(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const result = await buildCorexContractArtifacts(options);

  if (!options.dryRun) {
    await writeArtifacts(options.outDir, result.artifacts);
  }

  const summary = {
    generated_by: result.generated_by,
    created_at: result.created_at,
    dry_run: result.dry_run,
    selected_count: result.selected_count,
    available_count: result.available_count,
    outputs: result.outputs,
  };
  console.log(JSON.stringify(summary, null, 2));
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runExport().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
