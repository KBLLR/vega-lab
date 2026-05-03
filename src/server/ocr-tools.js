import fs from "fs/promises";
import path from "path";
import {
  findSkillExtraction,
  loadHouseDatasets,
  resolveRepoRecord,
} from "./house-model.js";

const MODEL_ZOO_ROOT = path.resolve(process.env.MODEL_ZOO_ROOT || path.join(process.cwd(), "..", "..", "model-zoo"));
const OCR_BASE_URL = process.env.OCR_BASE_URL || "http://127.0.0.1:8090";
const RESPONSES_BASE_URL = process.env.VEGA_RESPONSES_BASE_URL || "http://127.0.0.1:8090";
const GENERATED_BY = "vega-lab:ocr-tools";
const HIDDEN_MODEL_TERMS = ["llasa", "nsfw", "abliterated", "utena"];
const OCR_TERMS = ["ocr", "vision", "vlm", "image-text-to-text", "image-to-text", "document", "layout", "table", "formula"];

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function slug(value) {
  return String(value || "item").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";
}

function stableId(kind, source) {
  return `vega-${kind}-${slug(source)}`;
}

function withReviewEnvelope(kind, payload, options = {}) {
  const source = options.source || payload.nwo || payload.sourceRepo || payload.sourceUrl || payload.image || payload.path || payload.title || kind;
  const evidence = toArray(payload.evidence || payload.evidenceRefs || payload.evidence_refs);
  return {
    id: payload.id || stableId(kind, source),
    sourceRepo: options.sourceRepo || payload.nwo || payload.sourceRepo || null,
    sourceUrl: options.sourceUrl || payload.sourceUrl || payload.path || payload.image || null,
    evidenceRefs: evidence,
    tags: options.tags || payload.tags || [kind],
    confidence: options.confidence ?? payload.confidence ?? 0.72,
    recommendedAction: options.recommendedAction || payload.recommendedAction || toArray(payload.nextActions)[0] || "Review this OCR-derived evidence before adoption.",
    review_state: payload.review_state || "pending",
    visibility: payload.visibility || "internal",
    derived_from: payload.derived_from || options.derived_from || ["vega-lab datasets", "ocr service", "model-zoo policy"],
    created_at: payload.created_at || new Date().toISOString(),
    generated_by: payload.generated_by || GENERATED_BY,
    ...payload,
  };
}

function hiddenModelReason(model) {
  const id = String(model.runtimeId || model.id || "").toLowerCase();
  const type = String(model.type || "").toLowerCase();
  const task = String(model.task || "").toLowerCase();
  const caps = toArray(model.capabilities).join(",").toLowerCase();
  const term = HIDDEN_MODEL_TERMS.find((entry) => id.includes(entry));
  if (term) return `Production policy hides ${term} models`;
  if (type === "embedding" || task.includes("embedding") || caps.includes("embedding")) return "Not usable for OCR";
  return null;
}

function isOcrModel(model) {
  const text = [
    model.runtimeId,
    model.id,
    model.type,
    model.category,
    model.task,
    ...(model.modality || []),
    ...(model.capabilities || []),
    model.serving?.backend,
    model.serving?.model_type,
  ].filter(Boolean).join(" ").toLowerCase();
  return OCR_TERMS.some((term) => text.includes(term)) && !hiddenModelReason(model);
}

async function callOcr(pathname, payload = {}, method = "POST") {
  const url = `${OCR_BASE_URL}${pathname}`;
  try {
    const response = await fetch(url, {
      method,
      headers: method === "GET" ? undefined : { "content-type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data, url };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: {
        status: "degraded",
        error: {
          code: "ocr_unreachable",
          message: error instanceof Error ? error.message : String(error),
          service: "ocr",
          retryable: true,
        },
      },
      url,
    };
  }
}

async function callResponsesForSynthesis(prompt, args = {}) {
  if (args.skip_synthesis) return null;
  try {
    const response = await fetch(`${RESPONSES_BASE_URL}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: args.model || "text/Meta-Llama-3.1-8B-Instruct-4bit",
        stream: false,
        house_id: "vega-lab",
        agent_id: "vega-lab:tool-architect",
        task_kind: "ocr_evidence_to_skill_candidate",
        evidence_policy: "required",
        messages: [
          {
            role: "system",
            content: "You draft internal Vega Labs SKILL candidates from evidence. Return concise Markdown only. Do not publish, create repos, or mutate external systems.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!response.ok) return null;
    const data = await response.json().catch(() => ({}));
    return data.output_text
      || data.text
      || data.content
      || data.choices?.[0]?.message?.content
      || data.output?.map((item) => item.content?.map((entry) => entry.text).join("\n")).filter(Boolean).join("\n")
      || null;
  } catch {
    return null;
  }
}

function parseGithubRepoUrl(value) {
  const match = String(value || "").match(/github\.com[:/]([^/\s]+)\/([^/\s#?]+)(?:[/?#].*)?$/i);
  if (!match) return null;
  return { author: match[1], name: match[2].replace(/\.git$/i, "") };
}

function repoNwo(repo) {
  return repo?.author && repo?.name ? `${repo.author}/${repo.name}` : null;
}

function repoSourceUrl(repo, args = {}) {
  if (args.repo_url) return args.repo_url;
  const nwo = repoNwo(repo);
  return nwo ? `https://github.com/${nwo}` : null;
}

function localPathRef(value, rootDir) {
  if (!value) return null;
  const resolved = path.resolve(String(value));
  const root = path.resolve(rootDir);
  return resolved.startsWith(root) ? path.relative(root, resolved) : path.basename(resolved);
}

async function resolveRepoContext(rootDir, args = {}) {
  const datasets = await loadHouseDatasets(rootDir);
  const skillExtractions = await readJson(path.join(rootDir, "data", "skill-extractions.json"), []);
  const parsed = parseGithubRepoUrl(args.repo_url || args.url);
  const nwoParts = String(args.nwo || "").split("/");
  const name = args.name || parsed?.name || nwoParts[1];
  const author = args.author || parsed?.author || nwoParts[0];
  let repo = name ? resolveRepoRecord({ name, author }, datasets) : null;
  if (!repo && (name || author || args.local_repo_path)) {
    repo = {
      name: name || path.basename(String(args.local_repo_path || "local-repo")),
      author: author || "local",
      description: args.description || "Local or external repository supplied for OCR evidence review.",
      topics: [],
      primary_language: args.language || null,
      language: args.language || null,
      stars: 0,
      forks: 0,
    };
  }
  const nwo = repoNwo(repo) || args.nwo || null;
  const extraction = nwo ? findSkillExtraction(skillExtractions, nwo) : null;
  return { datasets, repo, extraction, nwo };
}

function evidenceRefsFrom(items) {
  return items
    .flatMap((item) => toArray(item.evidenceRefs || item.evidence_refs || item.evidence))
    .map((ref) => {
      if (typeof ref === "string") return ref;
      if (ref?.id) return String(ref.id);
      if (ref?.summary) return String(ref.summary);
      return JSON.stringify(ref).slice(0, 180);
    });
}

function deriveCandidateCapabilities(repo, extraction, evidencePack, targetTopic) {
  const repoTopics = toArray(repo?.topics).slice(0, 8);
  const language = repo?.primary_language || repo?.language;
  return unique([
    targetTopic ? slug(targetTopic) : null,
    language ? slug(language) : null,
    ...repoTopics.map(slug),
    ...toArray(extraction?.capabilities),
    ...toArray(evidencePack.tags),
  ]).slice(0, 12);
}

function buildDraftSkillMd(candidate, synthesisText) {
  if (synthesisText && String(synthesisText).trim()) {
    return String(synthesisText).trim();
  }
  return [
    `# ${candidate.title}`,
    "",
    "## Purpose",
    candidate.summary,
    "",
    "## Source",
    `- Repo: ${candidate.source_repo || "unresolved"}`,
    ...candidate.source_refs.map((ref) => `- Evidence: ${ref}`),
    "",
    "## Capabilities",
    ...candidate.capabilities.map((capability) => `- ${capability}`),
    "",
    "## Suggested Tools",
    ...candidate.suggested_tools.map((tool) => `- ${tool}`),
    "",
    "## Review Notes",
    "- This is an internal pending draft generated from OCR evidence.",
    "- Validate source evidence before promoting to SKILL.md, RULES.md, or WORKFLOWS.md.",
  ].join("\n");
}

async function writeReviewArtifact(rootDir, folder, id, artifact) {
  const dir = path.join(rootDir, "data", "review", folder);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${slug(id)}.json`);
  await fs.writeFile(filePath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return path.relative(rootDir, filePath);
}

export async function inspectModelZoo(rootDir, args = {}) {
  const snapshot = await readJson(path.join(rootDir, "data", "model-zoo-text-models.json"), null)
    ?? await readJson(path.join(rootDir, "public", "model-zoo-text-models.json"), { models: [] });
  const registry = await readJson(path.join(MODEL_ZOO_ROOT, "registry.json"), { models: {} });
  const registryModels = Array.isArray(registry.models) ? registry.models : Object.values(registry.models || {});
  const snapshotModels = toArray(snapshot.models);
  const textModels = snapshotModels.filter((model) => String(model.runtimeId || model.id || "").startsWith("text/") && !hiddenModelReason(model));
  const ocrModels = registryModels.filter(isOcrModel);
  const excluded = registryModels
    .map((model) => ({ id: model.runtimeId || model.id, reason: hiddenModelReason(model) }))
    .filter((item) => item.id && item.reason);

  return withReviewEnvelope("model-zoo-inspection", {
    title: "Vega Labs model-zoo inspection",
    profile: args.profile || "balanced-32gb",
    summary: "Vega Labs inspected text runtime candidates and OCR/VLM evidence models with production policy filters.",
    counts: {
      textEligible: textModels.length,
      ocrEligible: ocrModels.length,
      excluded: excluded.length,
      ocrLoadable: ocrModels.filter((model) => model.app_config?.runtime_profile === "serving").length,
      ocrCandidates: ocrModels.filter((model) => model.app_config?.runtime_profile !== "serving").length,
    },
    recommendedText: textModels.slice(0, 8).map((model) => ({
      id: model.runtimeId || model.id,
      status: model.status || (model.loadable ? "local-loadable" : "registry-candidate"),
      sourceUrl: model.sourceUrl || model.source_url,
    })),
    recommendedOcr: ocrModels.slice(0, 12).map((model) => ({
      id: model.id,
      task: model.task,
      capabilities: model.capabilities || [],
      sourceUrl: model.sourceUrl || model.source_url,
      runtimeProfile: model.app_config?.runtime_profile || "candidate_download",
    })),
    excluded,
    evidence: [
      "Model-zoo registry scanned for text and OCR/VLM candidates.",
      "OCR selector should include only vision/OCR-capable models.",
      `Text snapshot models: ${snapshotModels.length}`,
      `Registry models scanned: ${registryModels.length}`,
    ],
    nextActions: [
      "Use /v1/ocr/models for OCR/VLM selector readiness.",
      "Keep text chat model selection separate from OCR model selection.",
      "Download OCR candidates only when a repo/PDF/screenshot workflow needs them.",
    ],
  }, {
    tags: ["model-zoo", "ocr", "mlx"],
    confidence: 0.9,
    sourceUrl: "model-zoo/registry.json",
  });
}

export async function ocrHealth() {
  let live = null;
  try {
    const result = await callOcr("/v1/ocr/health", {}, "GET");
    live = result.ok ? result.data : null;
  } catch {
    live = null;
  }
  return withReviewEnvelope("ocr-health", {
    title: "OCR service health",
    summary: live ? "OCR health endpoint is reachable." : "OCR health endpoint is not reachable from Vega Labs MCP.",
    status: live?.status || "offline",
    endpoint: OCR_BASE_URL,
    worker: live?.worker || null,
    evidence: [
      `OCR endpoint: ${OCR_BASE_URL}`,
      live ? "GET /health returned JSON" : "GET /health unavailable",
    ],
    nextActions: live ? ["Use OCR for image, screenshot, PDF, table, and diagram evidence."] : ["Start mlx-services/ocr and mlx-services/mlx-vision."],
  }, {
    tags: ["ocr", "health"],
    confidence: live ? 0.92 : 0.6,
  });
}

export async function inspectImageWithOcr(args = {}) {
  const target = args.image || args.path || args.file_path;
  if (!target) {
    return withReviewEnvelope("image-ocr", {
      title: "Image OCR",
      summary: "No image target was provided.",
      evidence: ["Missing image/path/file_path input."],
      nextActions: ["Provide an image base64 payload or local image path."],
    }, { tags: ["ocr", "image"], confidence: 0.25 });
  }
  const result = await callOcr("/v1/ocr/image", {
    image: args.image,
    path: args.path,
    file_path: args.file_path,
    mode: args.mode || "evidence_summary",
    prompt: args.prompt,
    model: args.model,
    allow_url: Boolean(args.allow_url),
    allow_remote: Boolean(args.allow_remote),
    allow_file_uri: Boolean(args.allow_file_uri),
    privacy_mode: args.privacy_mode || "local",
  });
  return withReviewEnvelope("image-ocr", {
    title: "Image OCR evidence",
    summary: result.data.text || result.data.error?.message || "OCR image inspection completed.",
    ocr: result.data,
    evidence: result.data.evidence_refs || result.data.evidenceRefs || [`OCR route: ${result.url}`],
    nextActions: ["Attach this OCR evidence to the relevant repo analysis, action item, or skill candidate."],
  }, {
    sourceUrl: args.path || args.image || args.file_path || null,
    tags: ["ocr", "image", "evidence"],
    confidence: result.ok && result.data.status !== "error" ? 0.76 : 0.4,
  });
}

export async function inspectPdfWithOcr(args = {}) {
  const target = args.path || args.file_path || args.file;
  if (!target) {
    return withReviewEnvelope("pdf-ocr", {
      title: "PDF OCR",
      summary: "No PDF target was provided.",
      evidence: ["Missing path/file_path/file input."],
      nextActions: ["Provide a local PDF path or a file reference."],
    }, { tags: ["ocr", "pdf"], confidence: 0.25 });
  }
  const result = await callOcr("/v1/ocr/pdf", {
    path: args.path,
    file_path: args.file_path,
    file: args.file,
    page_images: args.page_images,
    max_pages: args.max_pages || 5,
    mode: args.mode || "markdown",
    prompt: args.prompt,
    model: args.model,
    allow_file_uri: Boolean(args.allow_file_uri),
    allow_url: Boolean(args.allow_url),
    allow_remote: Boolean(args.allow_remote),
    privacy_mode: args.privacy_mode || "local",
  });
  return withReviewEnvelope("pdf-ocr", {
    title: "PDF OCR evidence",
    summary: result.data.text ? `Extracted ${result.data.text.length} characters from PDF evidence.` : result.data.error?.message || "PDF OCR inspection completed.",
    ocr: result.data,
    evidence: result.data.evidence_refs || result.data.evidenceRefs || [`OCR route: ${result.url}`],
    nextActions: ["Use the extracted PDF evidence for repo research, skill evidence, or action item review."],
  }, {
    sourceUrl: target,
    tags: ["ocr", "pdf", "evidence"],
    confidence: result.ok && result.data.status !== "error" ? 0.78 : 0.4,
  });
}

export async function extractRepoVisualEvidence(args = {}) {
  const result = await inspectImageWithOcr({
    ...args,
    mode: args.mode || "evidence_summary",
    prompt: args.prompt || "Extract visible repo, UI, chart, diagram, or deployment evidence from this image.",
  });
  return withReviewEnvelope("repo-visual-evidence", {
    ...result,
    title: "Repo visual evidence",
    nwo: args.author && args.name ? `${args.author}/${args.name}` : args.nwo,
    nextActions: ["Attach this visual evidence to Vega Labs repo analysis or an action item."],
  }, {
    sourceRepo: args.author && args.name ? `${args.author}/${args.name}` : args.nwo || null,
    tags: ["ocr", "repo-evidence", "visual"],
    confidence: result.confidence,
  });
}

export async function extractSkillEvidenceFromPdf(args = {}) {
  const result = await inspectPdfWithOcr({
    ...args,
    mode: args.mode || "skill_evidence",
    prompt: args.prompt || "Extract reusable technical skills, rules, workflows, and evidence from this PDF.",
  });
  return withReviewEnvelope("skill-pdf-evidence", {
    ...result,
    title: "Skill evidence from PDF",
    nextActions: ["Review extracted evidence before creating SKILL, RULE, or WORKFLOW candidates."],
  }, {
    tags: ["ocr", "skill-evidence", "pdf"],
    confidence: result.confidence,
  });
}

export async function generateSkillCandidateFromOcrEvidence(rootDir, args = {}) {
  const { repo, extraction, nwo } = await resolveRepoContext(rootDir, args);
  if (!repo) {
    return withReviewEnvelope("ocr-skill-candidate", {
      title: "OCR evidence to SKILL candidate",
      summary: "No repository URL, local repo path, name, or author resolved to a repo context.",
      evidence: ["Missing repo_url, local_repo_path, nwo, or name/author input."],
      nextActions: ["Provide a GitHub repo URL, local repo path, or known Vega Labs repository name."],
    }, { tags: ["ocr", "skill-candidate"], confidence: 0.25 });
  }

  const evidenceResults = [];
  const imageTarget = args.image || args.image_path || args.screenshot_path;
  if (imageTarget) {
    evidenceResults.push(await extractRepoVisualEvidence({
      ...args,
      image: args.image,
      path: args.image_path || args.screenshot_path,
      nwo,
      mode: args.image_mode || "skill_evidence",
      prompt: args.image_prompt || "Extract technical evidence that could support a reusable Core-X skill candidate.",
    }));
  }
  if (args.pdf_path || args.pdf || args.file_path) {
    evidenceResults.push(await extractSkillEvidenceFromPdf({
      ...args,
      path: args.pdf_path,
      file: args.pdf,
      file_path: args.file_path,
      mode: "skill_evidence",
    }));
  }

  const createdAt = new Date().toISOString();
  const sourceRefs = unique([
    repoSourceUrl(repo, args),
    args.local_repo_path ? `local:${localPathRef(args.local_repo_path, rootDir)}` : null,
    args.pdf_path ? `pdf:${localPathRef(args.pdf_path, rootDir)}` : null,
    args.image_path ? `image:${localPathRef(args.image_path, rootDir)}` : null,
    args.screenshot_path ? `image:${localPathRef(args.screenshot_path, rootDir)}` : null,
    args.image && String(args.image).startsWith("data:image/") ? "image:base64-input" : null,
  ]);

  const evidencePack = {
    id: `vega-evidence-pack-${slug(nwo || repo.name)}-${slug(args.target_topic || "general")}`,
    title: `OCR evidence pack for ${nwo || repo.name}`,
    summary: evidenceResults.length > 0
      ? `Collected ${evidenceResults.length} OCR evidence result(s) for SKILL candidate review.`
      : "No OCR file/image inputs were supplied; evidence pack uses repository metadata only.",
    source_repo: nwo,
    source_refs: sourceRefs,
    evidence_refs: evidenceRefsFrom(evidenceResults),
    repo_metadata: {
      name: repo.name,
      author: repo.author,
      description: repo.description || "",
      language: repo.primary_language || repo.language || null,
      topics: toArray(repo.topics).slice(0, 12),
      stars: repo.stars || 0,
      forks: repo.forks || 0,
    },
    ocr_results: evidenceResults,
    review_state: "pending",
    visibility: "internal",
    generated_by: GENERATED_BY,
    created_at: createdAt,
  };

  const capabilities = deriveCandidateCapabilities(repo, extraction, evidencePack, args.target_topic);
  const synthesisPrompt = [
    `Repository: ${nwo || repo.name}`,
    `Description: ${repo.description || "No description"}`,
    `Target topic: ${args.target_topic || "general"}`,
    `Capabilities: ${capabilities.join(", ") || "unknown"}`,
    `Evidence refs: ${evidencePack.evidence_refs.join(", ") || "metadata only"}`,
    "Draft an internal pending SKILL.md candidate. Keep it evidence-grounded and include limitations.",
  ].join("\n");
  const synthesisText = await callResponsesForSynthesis(synthesisPrompt, args);

  const candidateBase = {
    id: `vega-skill-candidate-${slug(nwo || repo.name)}-${slug(args.target_topic || "ocr-evidence")}`,
    title: `${repo.name} OCR evidence SKILL candidate`,
    summary: `Internal pending SKILL candidate derived from ${nwo || repo.name} metadata and OCR evidence.`,
    source_repo: nwo,
    source_refs: sourceRefs,
    evidence_refs: evidencePack.evidence_refs,
    capabilities,
    suggested_house_connections: unique([
      "vega-lab",
      capabilities.includes("ml-ai") ? "project-anja" : null,
      capabilities.includes("frontend-ui") ? "le-belle-epoch" : null,
      capabilities.includes("repo-ops") ? "core-x" : null,
    ]),
    suggested_tools: [
      "inspect_image_with_ocr",
      "inspect_pdf_with_ocr",
      "extract_repo_skills",
      "generate_repo_ops_kit",
    ],
    confidence: evidenceResults.length > 0 ? 0.78 : 0.58,
    limitations: unique([
      evidenceResults.length === 0 ? "No OCR image or PDF evidence was supplied." : null,
      synthesisText ? null : "Local /v1/responses synthesis was unavailable; deterministic fallback draft was used.",
      "Human review is required before creating or publishing any SKILL.md artifact.",
    ]),
    review_state: "pending",
    visibility: "internal",
    generated_by: GENERATED_BY,
    created_at: createdAt,
  };
  const skillCandidate = {
    ...candidateBase,
    draft_skill_md: buildDraftSkillMd(candidateBase, synthesisText),
  };

  const result = withReviewEnvelope("ocr-skill-candidate", {
    title: skillCandidate.title,
    summary: skillCandidate.summary,
    sourceRepo: nwo,
    sourceUrl: repoSourceUrl(repo, args),
    evidence: skillCandidate.evidence_refs,
    evidencePack,
    skillCandidate,
    candidate: skillCandidate,
    nextActions: [
      "Review evidence refs and limitations.",
      "Promote to SKILL.md only after human approval.",
      "Attach accepted candidate to the relevant house workflow or action item.",
    ],
  }, {
    sourceRepo: nwo,
    sourceUrl: repoSourceUrl(repo, args),
    tags: ["ocr", "skill-candidate", "review-gated"],
    confidence: skillCandidate.confidence,
  });

  if (args.writeArtifact !== false) {
    result.artifacts = {
      evidencePack: await writeReviewArtifact(rootDir, "evidence-packs", evidencePack.id, evidencePack),
      skillCandidate: await writeReviewArtifact(rootDir, "skill-candidates", skillCandidate.id, skillCandidate),
    };
  }
  return result;
}

export async function executeVegaOcrTool(rootDir, name, args = {}) {
  switch (name) {
    case "inspect_model_zoo":
      return await inspectModelZoo(rootDir, args);
    case "ocr_health":
      return await ocrHealth();
    case "inspect_image_with_ocr":
      return await inspectImageWithOcr(args);
    case "inspect_pdf_with_ocr":
      return await inspectPdfWithOcr(args);
    case "extract_repo_visual_evidence":
      return await extractRepoVisualEvidence(args);
    case "extract_skill_evidence_from_pdf":
      return await extractSkillEvidenceFromPdf(args);
    case "generate_skill_candidate_from_ocr_evidence":
      return await generateSkillCandidateFromOcrEvidence(rootDir, args);
    default:
      throw new Error(`Unknown Vega OCR tool: ${name}`);
  }
}

export const OCR_TOOL_DEFINITIONS = [
  {
    name: "inspect_model_zoo",
    description: "Inspect model-zoo eligibility for local text models and OCR/VLM candidates.",
    inputSchema: { type: "object", properties: { profile: { type: "string" } } },
  },
  {
    name: "ocr_health",
    description: "Return OCR service health and mlx-vision worker state.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "inspect_image_with_ocr",
    description: "Extract OCR/visual evidence from an image, screenshot, diagram, or graph.",
    inputSchema: {
      type: "object",
      properties: {
        image: { type: "string" },
        path: { type: "string" },
        file_path: { type: "string" },
        mode: { type: "string" },
        prompt: { type: "string" },
        model: { type: "string" },
        allow_url: { type: "boolean" },
      },
    },
  },
  {
    name: "inspect_pdf_with_ocr",
    description: "Extract OCR/text evidence from a PDF path or supplied PDF page images.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        file_path: { type: "string" },
        file: { type: "string" },
        page_images: { type: "array", items: { type: "string" } },
        max_pages: { type: "number" },
        mode: { type: "string" },
        prompt: { type: "string" },
        model: { type: "string" },
      },
    },
  },
  {
    name: "extract_repo_visual_evidence",
    description: "Use OCR to extract repository-relevant evidence from screenshots, diagrams, charts, or UI images.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        author: { type: "string" },
        nwo: { type: "string" },
        image: { type: "string" },
        path: { type: "string" },
        prompt: { type: "string" },
      },
    },
  },
  {
    name: "extract_skill_evidence_from_pdf",
    description: "Use OCR/PDF inspection to extract SKILL/RULE/WORKFLOW evidence from a PDF.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        file_path: { type: "string" },
        file: { type: "string" },
        max_pages: { type: "number" },
        prompt: { type: "string" },
      },
    },
  },
  {
    name: "generate_skill_candidate_from_ocr_evidence",
    description: "Generate an internal pending SKILL candidate from repo metadata plus optional OCR image/PDF evidence.",
    inputSchema: {
      type: "object",
      properties: {
        repo_url: { type: "string" },
        local_repo_path: { type: "string" },
        name: { type: "string" },
        author: { type: "string" },
        nwo: { type: "string" },
        pdf_path: { type: "string" },
        image_path: { type: "string" },
        screenshot_path: { type: "string" },
        image: { type: "string" },
        target_topic: { type: "string" },
        model: { type: "string" },
        skip_synthesis: { type: "boolean" },
        writeArtifact: { type: "boolean" },
        allow_file_uri: { type: "boolean" },
        allow_url: { type: "boolean" },
        allow_remote: { type: "boolean" },
      },
    },
  },
];
