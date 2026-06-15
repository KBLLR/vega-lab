#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { Octokit } from "@octokit/rest";
import PQueue from "p-queue";

dotenv.config({ override: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

export const EVIDENCE_CONTRACT_VERSION = "vega.source-evidence.v1";
export const SNAPSHOT_TOOL = {
  tool_id: "vega.resolve_source_snapshot",
  name: "Vega Immutable Source Snapshot Resolver",
  version: "0.1.0",
};

const REQUIRED_EVIDENCE_GROUPS = ["readme", "license"];
const DEFAULT_EVIDENCE_CANDIDATES = {
  readme: ["README.md", "README", "README.rst", "README.txt", "docs/README.md"],
  license: ["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING", "COPYING.md", "NOTICE"],
  manifest: [
    "package.json",
    "pyproject.toml",
    "Cargo.toml",
    "deno.json",
    "bun.lockb",
    "go.mod",
    "requirements.txt",
    "SKILL.md",
  ],
};

const PRIVATE_KEY_PATTERN = new RegExp(["BEGIN", "[A-Z ]*", "PRIVATE", "KEY"].join(" "), "i");
const SECRET_PATTERNS = [
  PRIVATE_KEY_PATTERN,
  new RegExp("\\b" + "ghp" + "_[A-Za-z0-9_]{20,}\\b"),
  new RegExp("\\b" + "sk" + "-[A-Za-z0-9_-]{20,}\\b"),
  /\bapi[_-]?key\b\s*[:=]/i,
  /\bsecret\b\s*[:=]/i,
  /\btoken\b\s*[:=]/i,
];

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

export function slug(value) {
  return String(value || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "unknown";
}

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function sha256Text(value) {
  return `sha256:${sha256Bytes(Buffer.from(String(value), "utf8"))}`;
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function stablePrettyStringify(value) {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
  }
  return value;
}

function repoNwo(repo) {
  return repo?.nwo || [repo?.author, repo?.name].filter(Boolean).join("/") || repo?.full_name || "";
}

export function normalizeRepository(repository) {
  const nwo = repoNwo(repository);
  const [owner, name] = String(nwo).split("/");
  if (!owner || !name) {
    throw Object.assign(new Error(`Invalid repository reference: ${nwo || JSON.stringify(repository)}`), {
      code: "invalid_repository",
    });
  }
  return {
    ...repository,
    owner,
    name,
    nwo: `${owner}/${name}`,
    uri: repository?.url || repository?.html_url || `https://github.com/${owner}/${name}`,
  };
}

function metadataDigest(repository, githubRepo) {
  const normalized = normalizeRepository(repository);
  const metadata = {
    nwo: normalized.nwo,
    description: repository?.description || githubRepo?.description || null,
    primary_language: repository?.primary_language || githubRepo?.language || null,
    topics: toArray(repository?.topics || githubRepo?.topics).map(String).sort(),
    license: repository?.license || githubRepo?.license?.spdx_id || null,
    default_branch: githubRepo?.default_branch || repository?.default_branch || null,
    private: repository?.private === true || githubRepo?.private === true,
  };
  return {
    metadata,
    digest: sha256Text(stableStringify(metadata)),
  };
}

function evidenceDigestPayload(evidenceManifest) {
  return {
    evidence_contract_version: evidenceManifest.evidence_contract_version,
    repository: evidenceManifest.repository,
    normalized_repository_metadata_digest: evidenceManifest.normalized_repository_metadata_digest,
    evidence: evidenceManifest.evidence.map((item) => ({
      kind: item.kind,
      path: item.path,
      blob_sha: item.blob_sha,
      content_sha256: item.content_sha256,
      size: item.size,
    })),
    license: evidenceManifest.license,
  };
}

export function computeEvidenceDigest(evidenceManifest) {
  return sha256Text(stableStringify(evidenceDigestPayload(evidenceManifest)));
}

function scanSecretMaterial(text) {
  return SECRET_PATTERNS
    .filter((pattern) => pattern.test(text))
    .map((pattern) => String(pattern));
}

function detectLicense(content, fallback = null) {
  const text = String(content || "").toLowerCase();
  let identifier = null;
  if (/apache license[\s\S]{0,400}version 2\.0|apache-2\.0/.test(text)) identifier = "Apache-2.0";
  else if (/permission is hereby granted[\s\S]{0,1200}mit license|mit license/.test(text)) identifier = "MIT";
  else if (/gnu affero general public license|agpl/.test(text)) identifier = "AGPL-3.0";
  else if (/gnu general public license|gpl/.test(text)) identifier = "GPL-3.0";
  else if (/mozilla public license|mpl-2\.0/.test(text)) identifier = "MPL-2.0";
  else if (/isc license|permission to use, copy, modify, and\/or distribute this software/.test(text)) identifier = "ISC";
  else if (/bsd 3-clause|redistribution and use in source and binary forms/.test(text)) identifier = "BSD-3-Clause";
  else if (/unlicense/.test(text)) identifier = "Unlicense";
  else if (/creative commons zero|cc0/.test(text)) identifier = "CC0-1.0";
  else if (fallback && fallback !== "None" && fallback !== "NOASSERTION") identifier = fallback;

  if (!identifier) {
    return {
      status: "review-required",
      identifier: null,
      notes: ["Pinned license evidence was present but did not produce a confident SPDX-compatible identifier."],
    };
  }
  if (/agpl/i.test(identifier)) {
    return {
      status: "incompatible",
      identifier,
      notes: ["Pinned AGPL-style license evidence detected; promotion may conflict with distribution goals."],
    };
  }
  if (/(^gpl|lgpl)/i.test(identifier)) {
    return {
      status: "restricted",
      identifier,
      notes: ["Pinned GPL-family license evidence detected; adoption scope must be reviewed."],
    };
  }
  if (/(mit|apache|bsd|isc|mpl|unlicense|cc0)/i.test(identifier)) {
    return {
      status: "compatible",
      identifier,
      notes: [`Pinned license evidence appears adoption-friendly: ${identifier}.`],
    };
  }
  return {
    status: "review-required",
    identifier,
    notes: [`Pinned license evidence requires manual compatibility review: ${identifier}.`],
  };
}

function cacheRoot(projectRootValue, cacheDir = null) {
  return cacheDir
    ? path.resolve(cacheDir)
    : path.join(projectRootValue || projectRoot, "data", "review", "source-snapshots");
}

export function snapshotArtifactRef(nwo, commitSha, evidenceDigest) {
  const digest = String(evidenceDigest || "").replace(/^sha256:/, "");
  return `data/review/source-snapshots/${slug(nwo)}-${String(commitSha).slice(0, 12)}-${digest.slice(0, 12)}.json`;
}

function snapshotCachePath(projectRootValue, nwo, commitSha, evidenceDigest, cacheDir = null) {
  const artifactRef = snapshotArtifactRef(nwo, commitSha, evidenceDigest);
  const root = path.resolve(projectRootValue || projectRoot);
  if (cacheDir) {
    return path.join(cacheRoot(root, cacheDir), path.basename(artifactRef));
  }
  return path.join(root, artifactRef);
}

function indexPath(projectRootValue, cacheDir = null) {
  return path.join(cacheRoot(projectRootValue || projectRoot, cacheDir), "index.json");
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, stablePrettyStringify(data), "utf8");
}

export async function loadSourceSnapshotIndex(projectRootValue = projectRoot, options = {}) {
  const index = await readJson(indexPath(projectRootValue, options.cacheDir), { entries: {} });
  return index?.entries && typeof index.entries === "object" ? index : { entries: {} };
}

export async function findCachedSourceSnapshot(projectRootValue, nwo, options = {}) {
  const normalized = normalizeRepository({ nwo });
  const index = await loadSourceSnapshotIndex(projectRootValue, options);
  const entry = index.entries[normalized.nwo.toLowerCase()] || index.entries[normalized.nwo];
  if (!entry?.artifact_ref) return null;
  const root = path.resolve(projectRootValue || projectRoot);
  const filePath = options.cacheDir
    ? path.join(cacheRoot(root, options.cacheDir), path.basename(entry.artifact_ref))
    : path.join(root, entry.artifact_ref);
  const snapshot = await readJson(filePath, null);
  if (!snapshot) return null;
  const validation = validateSourceSnapshot(snapshot);
  if (!validation.valid) return null;
  return snapshot;
}

async function readIndexedSourceSnapshot(projectRootValue, nwo, options = {}) {
  const normalized = normalizeRepository({ nwo });
  const index = await loadSourceSnapshotIndex(projectRootValue, options);
  const entry = index.entries[normalized.nwo.toLowerCase()] || index.entries[normalized.nwo];
  if (!entry?.artifact_ref) return null;
  const root = path.resolve(projectRootValue || projectRoot);
  const filePath = options.cacheDir
    ? path.join(cacheRoot(root, options.cacheDir), path.basename(entry.artifact_ref))
    : path.join(root, entry.artifact_ref);
  return await readJson(filePath, null);
}

export async function loadSourceSnapshot(repository, commitSha, options = {}) {
  const normalized = normalizeRepository(repository);
  const root = path.resolve(options.projectRoot || projectRoot);
  const index = await loadSourceSnapshotIndex(root, options);
  const entry = index.entries[normalized.nwo.toLowerCase()] || index.entries[normalized.nwo];
  if (!entry || entry.resolved_commit_sha !== commitSha) return null;
  return await findCachedSourceSnapshot(root, normalized.nwo, options);
}

async function writeSourceSnapshotCache(snapshot, options = {}) {
  const root = path.resolve(options.projectRoot || projectRoot);
  const nwo = snapshot.metadata?.repository?.nwo || snapshot.metadata?.nwo || snapshot.source_ref.split("@")[0];
  const commitSha = snapshot.metadata?.immutable?.resolved_commit_sha;
  const evidenceDigest = snapshot.metadata?.immutable?.evidence_digest;
  const filePath = snapshotCachePath(root, nwo, commitSha, evidenceDigest, options.cacheDir);
  await writeJson(filePath, snapshot);

  const index = await loadSourceSnapshotIndex(root, options);
  const key = String(nwo).toLowerCase();
  index.entries[key] = {
    nwo,
    artifact_ref: snapshot.artifact_ref,
    snapshot_id: snapshot.id,
    resolved_commit_sha: commitSha,
    resolved_tree_sha: snapshot.metadata?.immutable?.resolved_tree_sha,
    evidence_contract_version: EVIDENCE_CONTRACT_VERSION,
    evidence_digest: evidenceDigest,
  };
  await writeJson(indexPath(root, options.cacheDir), index);
}

class OctokitGitHubClient {
  constructor({ token = process.env.GITHUB_TOKEN || process.env.GH_PAT || null, retries = 2, retryBaseMs = 500 } = {}) {
    this.octokit = new Octokit(token ? { auth: token } : undefined);
    this.retries = retries;
    this.retryBaseMs = retryBaseMs;
  }

  async retry(operation) {
    let attempt = 0;
    while (true) {
      try {
        return await operation();
      } catch (error) {
        const retryable = [429, 500, 502, 503, 504].includes(Number(error?.status));
        if (!retryable || attempt >= this.retries) throw error;
        const waitMs = this.retryBaseMs * (2 ** attempt);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        attempt += 1;
      }
    }
  }

  async getRepository({ owner, repo }) {
    const { data } = await this.retry(() => this.octokit.repos.get({ owner, repo }));
    return data;
  }

  async resolveRef({ owner, repo, ref }) {
    if (/^[a-f0-9]{40}$/i.test(ref)) return { sha: ref, ref_type: "commit" };
    try {
      const { data } = await this.retry(() => this.octokit.repos.getBranch({ owner, repo, branch: ref }));
      return { sha: data.commit.sha, ref_type: "branch" };
    } catch (branchError) {
      try {
        const { data } = await this.retry(() => this.octokit.git.getRef({ owner, repo, ref: `tags/${ref}` }));
        const object = data.object;
        if (object.type === "commit") return { sha: object.sha, ref_type: "tag" };
        if (object.type === "tag") {
          const tag = await this.retry(() => this.octokit.git.getTag({ owner, repo, tag_sha: object.sha }));
          return { sha: tag.data.object.sha, ref_type: "annotated_tag" };
        }
      } catch {
        // Preserve the original branch error below.
      }
      throw branchError;
    }
  }

  async getCommit({ owner, repo, commitSha }) {
    const { data } = await this.retry(() => this.octokit.git.getCommit({ owner, repo, commit_sha: commitSha }));
    return {
      sha: data.sha,
      tree_sha: data.tree?.sha || null,
      committed_at: data.committer?.date || data.author?.date || "1970-01-01T00:00:00.000Z",
    };
  }

  async getTree({ owner, repo, treeSha }) {
    const { data } = await this.retry(() => this.octokit.git.getTree({ owner, repo, tree_sha: treeSha }));
    return { sha: data.sha, truncated: data.truncated === true };
  }

  async getContent({ owner, repo, filePath, ref }) {
    const { data } = await this.retry(() => this.octokit.repos.getContent({ owner, repo, path: filePath, ref }));
    if (Array.isArray(data) || data.type !== "file") return null;
    const content = Buffer.from(data.content || "", data.encoding === "base64" ? "base64" : "utf8");
    return {
      path: data.path || filePath,
      blob_sha: data.sha || null,
      size: data.size ?? content.byteLength,
      content,
    };
  }
}

function rateLimitDetails(error) {
  const headers = error?.response?.headers || error?.headers || {};
  return {
    status: error?.status || null,
    remaining: headers["x-ratelimit-remaining"] || headers["X-RateLimit-Remaining"] || null,
    reset: headers["x-ratelimit-reset"] || headers["X-RateLimit-Reset"] || null,
    resource: headers["x-ratelimit-resource"] || headers["X-RateLimit-Resource"] || null,
  };
}

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function internalErrorCode(error) {
  if (!error || typeof error.status === "number") return null;
  const descriptor = Object.getOwnPropertyDescriptor(error, "code");
  return descriptor && Object.hasOwn(descriptor, "value") && typeof descriptor.value === "string"
    ? descriptor.value
    : null;
}

async function fetchFirstEvidence(client, normalized, commitSha, kind, candidates, required) {
  for (const candidatePath of candidates) {
    try {
      const content = await client.getContent({
        owner: normalized.owner,
        repo: normalized.name,
        filePath: candidatePath,
        ref: commitSha,
      });
      if (!content) continue;
      const secretMatches = scanSecretMaterial(content.content.toString("utf8"));
      if (secretMatches.length > 0) {
        fail("secret_evidence", `Secret-like material detected in ${candidatePath}`, { secretMatches });
      }
      return {
        kind,
        path: content.path || candidatePath,
        blob_sha: content.blob_sha,
        content_sha256: sha256Text(content.content),
        size: content.size,
        text_preview: content.content.toString("utf8", 0, Math.min(content.content.length, 2048)),
      };
    } catch (error) {
      if (internalErrorCode(error)) throw error;
      if (error?.status && error.status !== 404) throw error;
    }
  }
  if (required) {
    fail("missing_required_evidence", `Missing required ${kind} evidence for ${normalized.nwo}`, { kind });
  }
  return null;
}

async function fetchEvidence(client, normalized, commitSha, evidenceCandidates = DEFAULT_EVIDENCE_CANDIDATES) {
  const evidence = [];
  for (const [kind, candidates] of Object.entries(evidenceCandidates)) {
    const required = REQUIRED_EVIDENCE_GROUPS.includes(kind);
    if (kind === "manifest") {
      for (const candidatePath of candidates) {
        const item = await fetchFirstEvidence(client, normalized, commitSha, "manifest", [candidatePath], false);
        if (item) evidence.push(item);
      }
    } else {
      const item = await fetchFirstEvidence(client, normalized, commitSha, kind, candidates, required);
      if (item) evidence.push(item);
    }
  }
  return evidence;
}

function buildEvidenceManifest({ repository, githubRepo, requestedRef, refType, commit, tree, evidence }) {
  const normalized = normalizeRepository(repository);
  const { metadata, digest } = metadataDigest(repository, githubRepo);
  const licenseEvidence = evidence.find((item) => item.kind === "license") || null;
  const pinnedLicense = detectLicense(licenseEvidence?.text_preview, metadata.license);
  const license = {
    ...pinnedLicense,
    source: licenseEvidence
      ? `pinned-license-file:${licenseEvidence.path}@${licenseEvidence.blob_sha || licenseEvidence.content_sha256}`
      : "missing-pinned-license-evidence",
    evidence_ref: licenseEvidence
      ? `${licenseEvidence.path}:${licenseEvidence.blob_sha || licenseEvidence.content_sha256}`
      : null,
  };
  const manifest = {
    evidence_contract_version: EVIDENCE_CONTRACT_VERSION,
    repository: {
      provider: "github",
      nwo: normalized.nwo,
      requested_ref: requestedRef,
      ref_type: refType,
      resolved_commit_sha: commit.sha,
      resolved_tree_sha: tree.sha,
    },
    normalized_repository_metadata_digest: digest,
    evidence: evidence
      .map((item) => ({
        kind: item.kind,
        path: item.path,
        blob_sha: item.blob_sha,
        content_sha256: item.content_sha256,
        size: item.size,
      }))
      .sort((a, b) => `${a.kind}:${a.path}`.localeCompare(`${b.kind}:${b.path}`)),
    license,
  };
  return {
    ...manifest,
    evidence_digest: computeEvidenceDigest(manifest),
    normalized_repository_metadata: metadata,
  };
}

export function validateSourceSnapshot(snapshot) {
  const blockers = [];
  const immutable = snapshot?.metadata?.immutable || {};
  const evidenceManifest = immutable.evidence_manifest || {};
  if (snapshot?.source_type !== "repository") blockers.push("source_type is not repository");
  if (immutable.provider !== "github") blockers.push("provider is not github");
  if (!/^[a-f0-9]{40}$/i.test(String(immutable.resolved_commit_sha || ""))) blockers.push("resolved commit SHA missing or invalid");
  if (!/^[a-f0-9]{40}$/i.test(String(immutable.resolved_tree_sha || ""))) blockers.push("resolved tree SHA missing or invalid");
  if (immutable.evidence_contract_version !== EVIDENCE_CONTRACT_VERSION) blockers.push("evidence contract version mismatch");
  if (!/^sha256:[a-f0-9]{64}$/i.test(String(immutable.evidence_digest || ""))) blockers.push("evidence digest missing or invalid");
  if (evidenceManifest.evidence_contract_version) {
    const recomputed = computeEvidenceDigest(evidenceManifest);
    if (recomputed !== immutable.evidence_digest) blockers.push("evidence digest does not match evidence manifest");
  }
  if (!String(snapshot?.id || "").includes(String(immutable.resolved_commit_sha || "").slice(0, 12))) blockers.push("snapshot id does not bind commit");
  if (!String(snapshot?.id || "").includes(String(immutable.evidence_digest || "").replace(/^sha256:/, "").slice(0, 12))) blockers.push("snapshot id does not bind evidence digest");
  const evidence = toArray(immutable.evidence_manifest?.evidence);
  if (!evidence.some((item) => item.kind === "readme")) blockers.push("pinned README evidence missing");
  if (!evidence.some((item) => item.kind === "license")) blockers.push("pinned license evidence missing");
  if (String(snapshot?.provenance?.commit || "") !== String(immutable.resolved_commit_sha || "")) blockers.push("provenance commit mismatch");
  if (String(snapshot?.provenance?.tree || "") !== String(immutable.resolved_tree_sha || "")) blockers.push("provenance tree mismatch");
  if (!String(snapshot?.source_ref || "").endsWith(`@${immutable.resolved_commit_sha}`)) blockers.push("source ref does not bind resolved commit");
  if (!String(snapshot?.artifact_ref || "").endsWith(`${String(immutable.evidence_digest || "").replace(/^sha256:/, "").slice(0, 12)}.json`)) {
    blockers.push("artifact ref does not bind evidence digest");
  }
  return { valid: blockers.length === 0, blockers };
}

export function buildSourceSnapshotFromEvidence({ repository, githubRepo, requestedRef, refType, commit, tree, evidence }) {
  const normalized = normalizeRepository(repository);
  if (!commit?.sha) fail("missing_commit", `Commit could not be resolved for ${normalized.nwo}`);
  if (!tree?.sha) fail("missing_tree", `Tree could not be resolved for ${normalized.nwo}@${commit.sha}`);
  if (tree.truncated === true) fail("tree_truncated", `Tree response is truncated for ${normalized.nwo}@${commit.sha}`);
  const evidenceManifest = buildEvidenceManifest({ repository, githubRepo, requestedRef, refType, commit, tree, evidence });
  const evidenceDigest = evidenceManifest.evidence_digest;
  const digestBare = evidenceDigest.replace(/^sha256:/, "");
  const snapshotId = `vega:source-snapshot:${slug(normalized.nwo)}:${commit.sha.slice(0, 12)}:${tree.sha.slice(0, 12)}:${digestBare.slice(0, 12)}`;
  const artifactRef = snapshotArtifactRef(normalized.nwo, commit.sha, evidenceDigest);
  const contentSize = evidence.reduce((sum, item) => sum + Number(item.size || 0), 0);
  const snapshot = {
    id: snapshotId,
    source_type: "repository",
    source_uri: normalized.uri,
    source_ref: `${normalized.nwo}@${commit.sha}`,
    created_at: commit.committed_at || "1970-01-01T00:00:00.000Z",
    created_by: "vega-lab:resolve-source-snapshots",
    tool: SNAPSHOT_TOOL,
    include_patterns: evidenceManifest.evidence.map((item) => `${item.kind}:${item.path}`),
    exclude_patterns: ["raw repository tree beyond consumed evidence", "tokens", "secrets", "private file contents"],
    token_estimate: {
      tokens: Math.ceil(contentSize / 4),
      method: "pinned-evidence-bytes/4",
      confidence: "verified",
    },
    secret_scan: {
      status: "passed",
      tool: "vega-source-snapshot-secret-patterns",
      findings_count: 0,
      redaction_applied: false,
      report_ref: null,
    },
    provenance: {
      source_refs: [
        `github:${normalized.nwo}@${commit.sha}`,
        `github:${normalized.nwo}:tree:${tree.sha}`,
        `vega:evidence:${evidenceDigest}`,
      ],
      derived_from: [
        `${normalized.nwo}@${requestedRef}`,
        `commit:${commit.sha}`,
        `tree:${tree.sha}`,
      ],
      commit: commit.sha,
      tree: tree.sha,
      requested_ref: requestedRef,
      license: evidenceManifest.license.identifier,
      evidence_digest: evidenceDigest,
    },
    artifact_ref: artifactRef,
    review_status: "pending",
    metadata: {
      nwo: normalized.nwo,
      repository: {
        provider: "github",
        owner: normalized.owner,
        name: normalized.name,
        nwo: normalized.nwo,
        uri: normalized.uri,
      },
      immutable: {
        provider: "github",
        requested_ref: requestedRef,
        ref_type: refType,
        resolved_commit_sha: commit.sha,
        resolved_tree_sha: tree.sha,
        evidence_contract_version: EVIDENCE_CONTRACT_VERSION,
        evidence_digest: evidenceDigest,
        evidence_manifest: evidenceManifest,
        normalized_repository_metadata_digest: evidenceManifest.normalized_repository_metadata_digest,
        license_status: evidenceManifest.license,
      },
      ...evidenceManifest.normalized_repository_metadata,
    },
  };
  const validation = validateSourceSnapshot(snapshot);
  if (!validation.valid) {
    fail("invalid_source_snapshot", `Resolved source snapshot failed validation for ${normalized.nwo}`, { validation });
  }
  return snapshot;
}

export async function resolveSourceSnapshot(repository, options = {}) {
  const root = path.resolve(options.projectRoot || projectRoot);
  const normalized = normalizeRepository(repository);
  const client = options.client || new OctokitGitHubClient(options);
  const githubRepo = await client.getRepository({ owner: normalized.owner, repo: normalized.name });
  if (githubRepo?.private && !options.allowPrivate) {
    fail("repository_unavailable", `${normalized.nwo} is private or unavailable without explicit private handling.`);
  }
  const requestedRef = options.ref || repository.default_branch || githubRepo.default_branch || "HEAD";
  let ref;
  try {
    ref = await client.resolveRef({ owner: normalized.owner, repo: normalized.name, ref: requestedRef });
  } catch (error) {
    const code = Number(error?.status) === 403 ? "rate_limit_or_forbidden" : "ref_unavailable";
    fail(code, `Could not resolve ${normalized.nwo}@${requestedRef}`, { cause: error, rate_limit: rateLimitDetails(error) });
  }
  let commit;
  let tree;
  try {
    commit = await client.getCommit({ owner: normalized.owner, repo: normalized.name, commitSha: ref.sha });
    if (!commit?.sha) fail("missing_commit", `Missing commit for ${normalized.nwo}@${ref.sha}`);
    if (!commit?.tree_sha) fail("missing_tree", `Missing tree for ${normalized.nwo}@${commit.sha}`);
    const cached = await loadSourceSnapshot(normalized, commit.sha, { projectRoot: root, cacheDir: options.cacheDir });
    if (cached) {
      return { snapshot: cached, cache_hit: true, wrote: false, rate_limit: null };
    }
    tree = await client.getTree({ owner: normalized.owner, repo: normalized.name, treeSha: commit.tree_sha });
    if (tree?.truncated) fail("tree_truncated", `Tree response is truncated for ${normalized.nwo}@${commit.sha}`);
  } catch (error) {
    fail(internalErrorCode(error) || "commit_or_tree_unavailable", error.message, { cause: error, rate_limit: rateLimitDetails(error) });
  }
  let evidence;
  try {
    evidence = await fetchEvidence(client, normalized, commit.sha, options.evidenceCandidates || DEFAULT_EVIDENCE_CANDIDATES);
  } catch (error) {
    fail(internalErrorCode(error) || "evidence_unavailable", error.message, { cause: error, rate_limit: rateLimitDetails(error) });
  }
  const snapshot = buildSourceSnapshotFromEvidence({
    repository: normalized,
    githubRepo,
    requestedRef,
    refType: ref.ref_type,
    commit,
    tree,
    evidence,
  });
  if (options.write !== false) {
    await writeSourceSnapshotCache(snapshot, { projectRoot: root, cacheDir: options.cacheDir });
  }
  return { snapshot, cache_hit: false, wrote: options.write !== false, rate_limit: null };
}

export async function checkSourceSnapshot(repository, options = {}) {
  const root = path.resolve(options.projectRoot || projectRoot);
  const normalized = normalizeRepository(repository);
  const snapshot = await readIndexedSourceSnapshot(root, normalized.nwo, options);
  if (!snapshot) {
    return {
      ok: false,
      nwo: normalized.nwo,
      cache_hit: false,
      blockers: ["offline cache miss"],
    };
  }
  const validation = validateSourceSnapshot(snapshot);
  return {
    ok: validation.valid,
    nwo: normalized.nwo,
    cache_hit: true,
    blockers: validation.blockers,
    snapshot_id: snapshot.id,
    commit: snapshot.metadata?.immutable?.resolved_commit_sha,
    tree: snapshot.metadata?.immutable?.resolved_tree_sha,
    evidence_digest: snapshot.metadata?.immutable?.evidence_digest,
  };
}

async function readReposFromInput(filePath) {
  const payload = JSON.parse(await fs.readFile(filePath, "utf8"));
  if (Array.isArray(payload)) return payload.map((item) => typeof item === "string" ? { nwo: item } : item);
  if (Array.isArray(payload?.repositories)) return payload.repositories;
  if (Array.isArray(payload?.candidate_ids)) return payload.candidate_ids.map((candidateId) => ({
    nwo: String(candidateId).replace(/^vega\.skill-candidate:/, "").replace(/-/g, "/"),
  }));
  return [];
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    repos: [],
    input: null,
    limit: 25,
    concurrency: 2,
    check: false,
    ref: null,
    projectRoot,
    cacheDir: null,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repo") {
      options.repos.push({ nwo: argv[index + 1] });
      index += 1;
    } else if (arg.startsWith("--repo=")) {
      options.repos.push({ nwo: arg.slice("--repo=".length) });
    } else if (arg === "--input") {
      options.input = argv[index + 1];
      index += 1;
    } else if (arg.startsWith("--input=")) {
      options.input = arg.slice("--input=".length);
    } else if (arg === "--limit") {
      options.limit = Number.parseInt(argv[index + 1] || "", 10);
      index += 1;
    } else if (arg.startsWith("--limit=")) {
      options.limit = Number.parseInt(arg.slice("--limit=".length), 10);
    } else if (arg === "--concurrency") {
      options.concurrency = Number.parseInt(argv[index + 1] || "", 10);
      index += 1;
    } else if (arg.startsWith("--concurrency=")) {
      options.concurrency = Number.parseInt(arg.slice("--concurrency=".length), 10);
    } else if (arg === "--ref") {
      options.ref = argv[index + 1] || null;
      index += 1;
    } else if (arg.startsWith("--ref=")) {
      options.ref = arg.slice("--ref=".length);
    } else if (arg === "--project-root") {
      options.projectRoot = path.resolve(argv[index + 1] || options.projectRoot);
      index += 1;
    } else if (arg.startsWith("--project-root=")) {
      options.projectRoot = path.resolve(arg.slice("--project-root=".length));
    } else if (arg === "--cache-dir") {
      options.cacheDir = path.resolve(argv[index + 1] || "");
      index += 1;
    } else if (arg.startsWith("--cache-dir=")) {
      options.cacheDir = path.resolve(arg.slice("--cache-dir=".length));
    } else if (arg === "--check" || arg === "--offline") {
      options.check = true;
    } else if (arg === "--json") {
      options.json = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!Number.isFinite(options.limit) || options.limit < 1) options.limit = 25;
  if (!Number.isFinite(options.concurrency) || options.concurrency < 1) options.concurrency = 1;
  return options;
}

export async function runResolveSourceSnapshots(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const inputRepos = options.input ? await readReposFromInput(options.input) : [];
  const repos = [...options.repos, ...inputRepos].slice(0, options.limit);
  const queue = new PQueue({ concurrency: options.concurrency });
  const results = [];
  await Promise.all(repos.map((repo) => queue.add(async () => {
    try {
      const normalized = normalizeRepository(repo);
      if (options.check) {
        results.push(await checkSourceSnapshot(normalized, options));
        return;
      }
      const result = await resolveSourceSnapshot(normalized, {
        projectRoot: options.projectRoot,
        cacheDir: options.cacheDir,
        ref: options.ref,
      });
      results.push({
        ok: true,
        nwo: normalized.nwo,
        cache_hit: result.cache_hit,
        wrote: result.wrote,
        snapshot_id: result.snapshot.id,
        commit: result.snapshot.metadata?.immutable?.resolved_commit_sha,
        tree: result.snapshot.metadata?.immutable?.resolved_tree_sha,
        evidence_digest: result.snapshot.metadata?.immutable?.evidence_digest,
        artifact_ref: result.snapshot.artifact_ref,
      });
    } catch (error) {
      results.push({
        ok: false,
        nwo: repoNwo(repo),
        code: internalErrorCode(error) || "resolve_failed",
        message: error.message,
        rate_limit: error.rate_limit || rateLimitDetails(error.cause || error),
      });
    }
  })));
  const summary = {
    generated_by: "vega-lab:resolve-source-snapshots",
    check: options.check,
    requested_count: repos.length,
    ok_count: results.filter((item) => item.ok).length,
    failed_count: results.filter((item) => !item.ok).length,
    results: results.sort((a, b) => String(a.nwo).localeCompare(String(b.nwo))),
  };
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runResolveSourceSnapshots().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
