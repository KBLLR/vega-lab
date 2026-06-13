#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { calculateStatistics } from "../analytics/statistics.js";
import {
  buildMissionBriefForTarget,
  draftActionItem,
  findRepoInspection,
  findSkillExtraction,
  generateDerivedHouseData,
  generateRepoOpsKit,
  listAdoptionCandidates,
  listActionItems,
  listNewsSignals,
  listTemplateKits,
  loadHouseDatasets,
  resolveRepoRecord,
  updateActionItem,
  updateResearchQueue,
} from "../server/house-model.js";
import { executeVegaOcrTool, OCR_TOOL_DEFINITIONS } from "../server/ocr-tools.js";
import {
  getSkillCandidate,
  listSkillCandidates,
  proposeSkillPromotion,
  validateSkillCandidate,
} from "../../scripts/build-skill-candidates.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HOUSE_ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.join(HOUSE_ROOT, "data");
const STATS_FILE = path.join(DATA_DIR, "stats.json");
const REPO_SIGNALS_FILE = path.join(DATA_DIR, "repo-signals.json");
const RESEARCH_QUEUE_FILE = path.join(DATA_DIR, "research-queue.json");
const SKILL_EXTRACTIONS_FILE = path.join(DATA_DIR, "skill-extractions.json");
const MINE_HEALTH_FILE = path.join(DATA_DIR, "mine-health.json");
const ACTION_ITEMS_FILE = path.join(DATA_DIR, "action-items.json");
const REPO_INSPECTIONS_FILE = path.join(DATA_DIR, "repo-inspections.json");
const AUTOMATION_RUNS_FILE = path.join(DATA_DIR, "automation-runs.json");
const OPS_DIGEST_FILE = path.join(DATA_DIR, "ops-digest.json");
const WEEKLY_RESEARCH_REVIEW_FILE = path.join(DATA_DIR, "weekly-research-review.json");
const TEMPLATE_KITS_FILE = path.join(DATA_DIR, "template-kits.json");
const REPO_OPS_KITS_FILE = path.join(DATA_DIR, "repo-ops-kits.json");

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function searchRepos(repos, query, options = {}) {
  const {
    language = null,
    minStars = 0,
    maxResults = 50,
  } = options;
  const searchTerm = String(query || "").toLowerCase();

  return repos
    .filter((repo) => {
      const matchesQuery = !searchTerm
        || repo.name?.toLowerCase().includes(searchTerm)
        || repo.description?.toLowerCase().includes(searchTerm)
        || repo.author?.toLowerCase().includes(searchTerm)
        || (Array.isArray(repo.topics) && repo.topics.some((topic) => topic.toLowerCase().includes(searchTerm)));

      const matchesLanguage = !language
        || repo.primary_language === language
        || repo.language === language
        || (Array.isArray(repo.languages) && repo.languages.some((entry) => entry.language === language));

      return matchesQuery && matchesLanguage && (repo.stars || 0) >= minStars;
    })
    .sort((a, b) => (b.stars || 0) - (a.stars || 0))
    .slice(0, maxResults);
}

function filterRepos(repos, criteria = {}) {
  return repos.filter((repo) => {
    const matchesLanguage = !criteria.language
      || repo.primary_language === criteria.language
      || repo.language === criteria.language
      || (Array.isArray(repo.languages) && repo.languages.some((entry) => entry.language === criteria.language));

    const matchesTopic = !criteria.topic
      || (Array.isArray(repo.topics) && repo.topics.includes(criteria.topic));

    const matchesLicense = !criteria.license || repo.license === criteria.license;
    const matchesAuthor = !criteria.author || repo.author === criteria.author;
    const stars = repo.stars || 0;
    const forks = repo.forks || 0;

    return matchesLanguage
      && matchesTopic
      && matchesLicense
      && matchesAuthor
      && stars >= (criteria.minStars ?? 0)
      && stars <= (criteria.maxStars ?? Number.POSITIVE_INFINITY)
      && forks >= (criteria.minForks ?? 0);
  });
}

function findSimilarRepos(repos, targetName) {
  const target = repos.find(
    (repo) => repo.name?.toLowerCase() === String(targetName || "").toLowerCase(),
  );

  if (!target) return [];

  const tokens = new Set(
    [
      target.name,
      target.description || "",
      target.author,
      ...(Array.isArray(target.topics) ? target.topics : []),
      target.primary_language || target.language || "",
    ]
      .join(" ")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 3),
  );

  return repos
    .filter((repo) => repo.name !== target.name)
    .map((repo) => {
      const text = [
        repo.name,
        repo.description || "",
        repo.author,
        ...(Array.isArray(repo.topics) ? repo.topics : []),
        repo.primary_language || repo.language || "",
      ]
        .join(" ")
        .toLowerCase();
      let score = 0;
      tokens.forEach((token) => {
        if (text.includes(token)) score += 1;
      });
      return { repo, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((item) => item.repo);
}

class VegaLabServer {
  constructor() {
    this.server = new Server(
      {
        name: "vega-lab-mcp",
        version: "3.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    this.starredRepos = [];
    this.myRepos = [];
    this.stats = null;
    this.repoSignals = [];
    this.researchQueue = [];
    this.skillExtractions = [];
    this.mineHealth = [];
    this.actionItems = [];
    this.repoInspections = [];
    this.automationRuns = [];
    this.opsDigest = null;
    this.weeklyResearchReview = null;
    this.templateKits = [];
    this.repoOpsKits = [];

    this.setupHandlers();
    this.server.onerror = (error) => console.error("[MCP Error]", error);
  }

  async refresh() {
    const datasets = await loadHouseDatasets(HOUSE_ROOT);
    this.starredRepos = datasets.starredRepos;
    this.myRepos = datasets.myRepos;

    const derived = await generateDerivedHouseData(HOUSE_ROOT, datasets);
    this.repoSignals = derived.repoSignals;
    this.researchQueue = derived.researchQueue;
    this.skillExtractions = derived.skillExtractions;
    this.mineHealth = derived.mineHealth;
    this.actionItems = derived.actionItems;
    this.repoInspections = derived.repoInspections;
    this.automationRuns = derived.automationRuns;
    this.opsDigest = derived.opsDigest;
    this.weeklyResearchReview = derived.weeklyResearchReview;
    this.templateKits = derived.templateKits;
    this.repoOpsKits = derived.repoOpsKits;

    this.stats = await readJson(STATS_FILE, null);
    if (!this.stats) {
      this.stats = calculateStatistics(this.starredRepos);
    }
  }

  repoPool() {
    return [...this.myRepos, ...this.starredRepos];
  }

  resolveRepo(args) {
    return resolveRepoRecord(args, {
      starredRepos: this.starredRepos,
      myRepos: this.myRepos,
    });
  }

  response(payload) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(payload, null, 2),
        },
      ],
    };
  }

  setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "list_starred_repos",
          description: "List all starred repositories with optional pagination",
          inputSchema: {
            type: "object",
            properties: {
              limit: { type: "number", default: 50 },
              offset: { type: "number", default: 0 },
              sortBy: { type: "string", enum: ["stars", "forks", "name", "date"], default: "stars" },
            },
          },
        },
        {
          name: "search_repos",
          description: "Search repositories by name, description, author, or topics",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string" },
              language: { type: "string" },
              minStars: { type: "number", default: 0 },
              maxResults: { type: "number", default: 50 },
            },
            required: ["query"],
          },
        },
        {
          name: "get_repo_details",
          description: "Get detailed information about a specific repository",
          inputSchema: {
            type: "object",
            properties: {
              name: { type: "string" },
              author: { type: "string" },
            },
            required: ["name"],
          },
        },
        {
          name: "get_statistics",
          description: "Get comprehensive statistics about all starred repositories",
          inputSchema: { type: "object", properties: {} },
        },
        {
          name: "get_language_breakdown",
          description: "Get breakdown of repositories by programming language",
          inputSchema: {
            type: "object",
            properties: {
              topN: { type: "number", default: 20 },
            },
          },
        },
        {
          name: "get_trending_topics",
          description: "Get the most popular topics across starred repositories",
          inputSchema: {
            type: "object",
            properties: {
              limit: { type: "number", default: 20 },
            },
          },
        },
        {
          name: "filter_by_criteria",
          description: "Filter repositories by multiple criteria",
          inputSchema: {
            type: "object",
            properties: {
              language: { type: "string" },
              topic: { type: "string" },
              license: { type: "string" },
              minStars: { type: "number" },
              maxStars: { type: "number" },
              minForks: { type: "number" },
              author: { type: "string" },
            },
          },
        },
        {
          name: "find_similar_repos",
          description: "Find repositories similar to a given one",
          inputSchema: {
            type: "object",
            properties: {
              name: { type: "string" },
            },
            required: ["name"],
          },
        },
        {
          name: "list_news_signals",
          description: "Return ranked News tab signals for watched, research, mine, or starred scope",
          inputSchema: {
            type: "object",
            properties: {
              scope: { type: "string", enum: ["watched", "research", "mine", "starred", "all"], default: "watched" },
              limit: { type: "number", default: 12 },
            },
          },
        },
        {
          name: "get_research_queue",
          description: "Return the canonical research queue",
          inputSchema: {
            type: "object",
            properties: {
              status: { type: "string", enum: ["queued", "researching", "done", "dismissed"] },
            },
          },
        },
        {
          name: "update_research_queue",
          description: "Create or update a research queue item for a repository",
          inputSchema: {
            type: "object",
            properties: {
              name: { type: "string" },
              author: { type: "string" },
              status: { type: "string", enum: ["queued", "researching", "done", "dismissed"] },
              notes: { type: "string" },
              priority: { type: "string" },
            },
            required: ["name"],
          },
        },
        {
          name: "mark_for_research",
          description: "Compatibility alias for update_research_queue with queued status",
          inputSchema: {
            type: "object",
            properties: {
              name: { type: "string" },
              author: { type: "string" },
              notes: { type: "string" },
            },
            required: ["name"],
          },
        },
        {
          name: "get_adoption_candidates",
          description: "Return top-ranked repositories for house, tool, service, or template adoption",
          inputSchema: {
            type: "object",
            properties: {
              limit: { type: "number", default: 10 },
            },
          },
        },
        {
          name: "extract_repo_skills",
          description: "Return the canonical skill extraction record for a repository",
          inputSchema: {
            type: "object",
            properties: {
              name: { type: "string" },
              author: { type: "string" },
            },
            required: ["name"],
          },
        },
        {
          name: "list_template_kits",
          description: "List Vega Lab template kits and their source template paths",
          inputSchema: { type: "object", properties: {} },
        },
        {
          name: "generate_repo_mission",
          description: "Generate a canonical Codex, Claude, or local MLX mission brief for a repository",
          inputSchema: {
            type: "object",
            properties: {
              name: { type: "string" },
              author: { type: "string" },
              target: { type: "string", enum: ["codex", "claude", "mlx"] },
            },
            required: ["name", "target"],
          },
        },
        {
          name: "generate_repo_ops_kit",
          description: "Generate a draft-only README, AGENTS, maintenance, deployment, testing, and action-item kit for a repository",
          inputSchema: {
            type: "object",
            properties: {
              name: { type: "string" },
              author: { type: "string" },
              target: { type: "string", enum: ["codex", "claude", "mlx"], default: "mlx" },
            },
            required: ["name"],
          },
        },
        {
          name: "get_mine_health",
          description: "Return owned-repo health records for Mine workflows",
          inputSchema: {
            type: "object",
            properties: {
              flag: { type: "string" },
              visibility: { type: "string", enum: ["public", "private"] },
            },
          },
        },
        {
          name: "find_repos_missing_readme",
          description: "List repositories missing a README file (best for Mine scope)",
          inputSchema: {
            type: "object",
            properties: {
              scope: { type: "string", enum: ["mine", "starred"], default: "mine" },
              limit: { type: "number", default: 50 },
              offset: { type: "number", default: 0 },
              includeUnknown: { type: "boolean", default: false },
            },
          },
        },
        {
          name: "list_action_items",
          description: "List durable Vega Lab inbox action items with optional filters",
          inputSchema: {
            type: "object",
            properties: {
              status: { type: "string", enum: ["open", "reviewing", "accepted", "dismissed", "done"] },
              kind: { type: "string", enum: ["readme", "maintenance", "deployment", "testing", "dependency", "research", "skill", "template", "adoption"] },
              priority: { type: "string", enum: ["low", "normal", "high", "critical"] },
              limit: { type: "number", default: 50 },
            },
          },
        },
        {
          name: "update_action_item",
          description: "Update a Vega Lab action item status and optional review notes",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string" },
              status: { type: "string", enum: ["open", "reviewing", "accepted", "dismissed", "done"] },
              notes: { type: "string" },
            },
            required: ["id", "status"],
          },
        },
        {
          name: "inspect_owned_repo",
          description: "Return the key-file inspection record for an owned repository",
          inputSchema: {
            type: "object",
            properties: {
              name: { type: "string" },
              author: { type: "string" },
            },
            required: ["name"],
          },
        },
        {
          name: "get_repo_inspection",
          description: "Compatibility alias for inspect_owned_repo",
          inputSchema: {
            type: "object",
            properties: {
              name: { type: "string" },
              author: { type: "string" },
            },
            required: ["name"],
          },
        },
        {
          name: "generate_ops_digest",
          description: "Return the latest Vega Lab daily ops digest",
          inputSchema: { type: "object", properties: {} },
        },
        {
          name: "generate_weekly_research_review",
          description: "Return the latest Vega Lab weekly research and skill extraction review",
          inputSchema: { type: "object", properties: {} },
        },
        {
          name: "draft_action_item",
          description: "Create or refresh a manual draft-only Vega Lab action item",
          inputSchema: {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["readme", "maintenance", "deployment", "testing", "dependency", "research", "skill", "template", "adoption"] },
              name: { type: "string" },
              author: { type: "string" },
              source: { type: "string", enum: ["daily-ops", "weekly-research", "manual"], default: "manual" },
            },
            required: ["kind", "name"],
          },
        },
        {
          name: "get_runtime_health",
          description: "Return local OpenResponses, dataset, and tool availability expectations for Vega Lab",
          inputSchema: { type: "object", properties: {} },
        },
        {
          name: "list_skill_candidates",
          description: "Build and list deterministic review-gated skill candidates from Vega repo caches and review artifacts",
          inputSchema: {
            type: "object",
            properties: {
              limit: { type: "number", default: 10 },
              scope: { type: "string", enum: ["mine", "starred", "all"], default: "all" },
            },
          },
        },
        {
          name: "get_skill_candidate",
          description: "Return one deterministic skill candidate by candidate_id or suggested_skill_id",
          inputSchema: {
            type: "object",
            properties: {
              candidate_id: { type: "string" },
              limit: { type: "number", default: 250 },
            },
            required: ["candidate_id"],
          },
        },
        {
          name: "validate_skill_candidate",
          description: "Validate one deterministic skill candidate for review-gate blockers",
          inputSchema: {
            type: "object",
            properties: {
              candidate_id: { type: "string" },
              limit: { type: "number", default: 250 },
            },
            required: ["candidate_id"],
          },
        },
        {
          name: "propose_skill_promotion",
          description: "Draft a pending Core-X capability-promotion proposal from a skill candidate without mutating registries",
          inputSchema: {
            type: "object",
            properties: {
              candidate_id: { type: "string" },
              write: { type: "boolean", default: false },
              limit: { type: "number", default: 250 },
            },
            required: ["candidate_id"],
          },
        },
        ...OCR_TOOL_DEFINITIONS,
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      await this.refresh();
      const { name, arguments: args = {} } = request.params;

      try {
        switch (name) {
          case "list_starred_repos":
            return this.handleListRepos(args);
          case "search_repos":
            return this.handleSearch(args);
          case "get_repo_details":
            return this.handleGetDetails(args);
          case "get_statistics":
            return this.handleGetStats();
          case "get_language_breakdown":
            return this.handleGetLanguages(args);
          case "get_trending_topics":
            return this.handleGetTopics(args);
          case "filter_by_criteria":
            return this.handleFilter(args);
          case "find_similar_repos":
            return this.handleFindSimilar(args);
          case "list_news_signals":
            return this.handleListNewsSignals(args);
          case "get_research_queue":
            return this.handleGetResearchQueue(args);
          case "update_research_queue":
            return await this.handleUpdateResearchQueue(args);
          case "mark_for_research":
            return await this.handleMarkForResearch(args);
          case "get_adoption_candidates":
            return this.handleGetAdoptionCandidates(args);
          case "extract_repo_skills":
            return this.handleExtractRepoSkills(args);
          case "list_template_kits":
            return this.handleListTemplateKits();
          case "generate_repo_mission":
            return this.handleGenerateRepoMission(args);
          case "generate_repo_ops_kit":
            return await this.handleGenerateRepoOpsKit(args);
          case "get_mine_health":
            return this.handleGetMineHealth(args);
          case "find_repos_missing_readme":
            return this.handleMissingReadme(args);
          case "list_action_items":
            return this.handleListActionItems(args);
          case "update_action_item":
            return await this.handleUpdateActionItem(args);
          case "inspect_owned_repo":
          case "get_repo_inspection":
            return this.handleInspectOwnedRepo(args);
          case "generate_ops_digest":
            return this.handleGenerateOpsDigest();
          case "generate_weekly_research_review":
            return this.handleGenerateWeeklyResearchReview();
          case "draft_action_item":
            return await this.handleDraftActionItem(args);
          case "get_runtime_health":
            return this.handleGetRuntimeHealth();
          case "list_skill_candidates":
            return await this.handleListSkillCandidates(args);
          case "get_skill_candidate":
            return await this.handleGetSkillCandidate(args);
          case "validate_skill_candidate":
            return await this.handleValidateSkillCandidate(args);
          case "propose_skill_promotion":
            return await this.handleProposeSkillPromotion(args);
          case "inspect_model_zoo":
          case "ocr_health":
          case "inspect_image_with_ocr":
          case "inspect_pdf_with_ocr":
          case "extract_repo_visual_evidence":
          case "extract_skill_evidence_from_pdf":
          case "generate_skill_candidate_from_ocr_evidence":
            return this.response(await executeVegaOcrTool(HOUSE_ROOT, name, args));
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return this.response({ error: error instanceof Error ? error.message : String(error) });
      }
    });
  }

  handleListRepos(args) {
    const { limit = 50, offset = 0, sortBy = "stars" } = args;
    const repos = [...this.starredRepos];

    switch (sortBy) {
      case "forks":
        repos.sort((a, b) => (b.forks || 0) - (a.forks || 0));
        break;
      case "name":
        repos.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        break;
      case "date":
        repos.sort((a, b) => Date.parse(b.date || 0) - Date.parse(a.date || 0));
        break;
      default:
        repos.sort((a, b) => (b.stars || 0) - (a.stars || 0));
        break;
    }

    const repositories = repos.slice(offset, offset + limit);
    return this.response({
      total: repos.length,
      offset,
      limit,
      count: repositories.length,
      repositories,
    });
  }

  handleSearch(args) {
    const repositories = searchRepos(this.repoPool(), args.query, args);
    return this.response({
      query: args.query,
      count: repositories.length,
      repositories,
    });
  }

  handleGetDetails(args) {
    const repo = this.resolveRepo(args);
    if (!repo) {
      return this.response({ error: "Repository not found" });
    }

    return this.response(repo);
  }

  handleGetStats() {
    return this.response(this.stats);
  }

  handleGetLanguages(args) {
    const topN = args.topN ?? 20;
    const languages = Object.entries(this.stats.languages || {})
      .slice(0, topN)
      .map(([language, details]) => ({
        language,
        count: details.count,
        percentage: details.percentage,
      }));

    return this.response({ languages });
  }

  handleGetTopics(args) {
    const limit = args.limit ?? 20;
    const topics = Object.entries(this.stats.topics || {})
      .slice(0, limit)
      .map(([topic, details]) => ({
        topic,
        count: details.count,
      }));

    return this.response({ topics });
  }

  handleFilter(args) {
    const repositories = filterRepos(this.repoPool(), args);
    return this.response({
      criteria: args,
      count: repositories.length,
      repositories,
    });
  }

  handleFindSimilar(args) {
    const repositories = findSimilarRepos(this.repoPool(), args.name);
    return this.response({
      name: args.name,
      count: repositories.length,
      repositories,
    });
  }

  handleListNewsSignals(args) {
    const scope = args.scope ?? "watched";
    const limit = args.limit ?? 12;
    const signals = scope === "all"
      ? this.repoSignals.slice(0, limit)
      : listNewsSignals(this.repoSignals, scope, limit);

    return this.response({
      scope,
      count: signals.length,
      signals,
    });
  }

  handleGetResearchQueue(args) {
    const status = args.status;
    const queue = status
      ? this.researchQueue.filter((item) => item.status === status)
      : this.researchQueue;

    return this.response({
      count: queue.length,
      queue,
    });
  }

  async handleUpdateResearchQueue(args) {
    const repo = this.resolveRepo(args);
    if (!repo) {
      throw new Error("Repository not found");
    }

    const item = await updateResearchQueue(HOUSE_ROOT, {
      nwo: `${repo.author}/${repo.name}`,
      status: args.status ?? "queued",
      notes: args.notes ?? "",
      priority: args.priority ?? "normal",
    });

    return this.response({
      updated: true,
      item,
    });
  }

  async handleMarkForResearch(args) {
    const repo = this.resolveRepo(args);
    if (!repo) {
      throw new Error("Repository not found");
    }

    const item = await updateResearchQueue(HOUSE_ROOT, {
      nwo: `${repo.author}/${repo.name}`,
      status: "queued",
      notes: args.notes ?? "",
      priority: "normal",
    });

    return this.response({
      queued: true,
      item,
    });
  }

  handleGetAdoptionCandidates(args) {
    const limit = args.limit ?? 10;
    const candidates = listAdoptionCandidates(this.repoSignals, limit);
    return this.response({
      count: candidates.length,
      candidates,
    });
  }

  handleExtractRepoSkills(args) {
    const repo = this.resolveRepo(args);
    if (!repo) {
      throw new Error("Repository not found");
    }

    const extraction = findSkillExtraction(this.skillExtractions, `${repo.author}/${repo.name}`);
    if (!extraction) {
      throw new Error("Skill extraction not found");
    }

    return this.response(extraction);
  }

  handleListTemplateKits() {
    const kits = this.templateKits.length > 0 ? this.templateKits : listTemplateKits();
    return this.response({
      count: kits.length,
      kits,
    });
  }

  handleGenerateRepoMission(args) {
    const repo = this.resolveRepo(args);
    if (!repo) {
      throw new Error("Repository not found");
    }

    const extraction = findSkillExtraction(this.skillExtractions, `${repo.author}/${repo.name}`);
    if (!extraction) {
      throw new Error("Skill extraction not found");
    }

    const target = String(args.target ?? "mlx").toLowerCase();
    const mission = buildMissionBriefForTarget(extraction, target);
    return this.response({
      nwo: extraction.nwo,
      target,
      mission,
    });
  }

  async handleGenerateRepoOpsKit(args) {
    const kit = await generateRepoOpsKit(HOUSE_ROOT, {
      name: args.name,
      author: args.author,
      target: args.target ?? "mlx",
    });
    if (!kit) {
      throw new Error("Could not generate repo ops kit");
    }

    this.repoOpsKits = this.repoOpsKits.filter((item) => !(item.nwo === kit.nwo && item.target === kit.target));
    this.repoOpsKits.push(kit);
    return this.response(kit);
  }

  handleGetMineHealth(args) {
    let records = [...this.mineHealth];
    if (args.visibility) {
      records = records.filter((record) => record.visibility === args.visibility);
    }
    if (args.flag) {
      records = records.filter((record) => record.healthFlags.includes(args.flag));
    }

    return this.response({
      count: records.length,
      records,
    });
  }

  handleMissingReadme(args) {
    const {
      scope = "mine",
      limit = 50,
      offset = 0,
      includeUnknown = false,
    } = args;

    const source = scope === "starred"
      ? this.starredRepos
      : this.myRepos.filter((repo) => repo.is_owner !== false);

    const repositories = source
      .filter((repo) => {
        if (repo.has_readme === false) return true;
        return includeUnknown && (repo.has_readme === null || repo.has_readme === undefined);
      })
      .slice(offset, offset + limit);

    return this.response({
      scope,
      total: source.length,
      count: repositories.length,
      repositories,
    });
  }

  handleListActionItems(args) {
    const items = listActionItems(this.actionItems, args);
    return this.response({
      count: items.length,
      items,
    });
  }

  async handleUpdateActionItem(args) {
    const item = await updateActionItem(HOUSE_ROOT, {
      id: args.id,
      status: args.status,
      notes: args.notes ?? "",
    });
    if (!item) {
      throw new Error("Action item not found");
    }

    return this.response({
      updated: true,
      item,
    });
  }

  handleInspectOwnedRepo(args) {
    const repo = this.resolveRepo(args);
    if (!repo) {
      throw new Error("Repository not found");
    }

    const inspection = findRepoInspection(this.repoInspections, `${repo.author}/${repo.name}`);
    if (!inspection) {
      throw new Error("Repo inspection not found");
    }

    return this.response({
      inspected: true,
      ...inspection,
    });
  }

  handleGenerateOpsDigest() {
    return this.response(this.opsDigest);
  }

  handleGenerateWeeklyResearchReview() {
    return this.response(this.weeklyResearchReview);
  }

  async handleDraftActionItem(args) {
    const item = await draftActionItem(HOUSE_ROOT, {
      kind: args.kind,
      name: args.name,
      author: args.author,
      source: args.source ?? "manual",
    });
    if (!item) {
      throw new Error("Could not draft action item");
    }

    return this.response({
      drafted: true,
      item,
    });
  }

  handleGetRuntimeHealth() {
    return this.response({
      houseId: "vega-lab",
      legacyHouseId: "git-stars",
      runtimeContract: "openresponses",
      local: {
        busUrl: "/bus",
        proxiedTarget: "http://127.0.0.1:8090",
        responsesEndpoint: "/bus/v1/responses",
        modelsEndpoint: "/bus/v1/models",
        healthEndpoint: "/bus/health",
        ocrEndpoint: "/bus/v1/ocr/extract",
        ocrHealthEndpoint: "/bus/v1/ocr/health",
      },
      localBus: {
        url: "/bus",
        target: "http://127.0.0.1:8090",
        status: "expected",
        responsesEndpoint: "/bus/v1/responses",
        modelsEndpoint: "/bus/v1/models",
        healthEndpoint: "/bus/health",
        ocrEndpoint: "/bus/v1/ocr/extract",
        ocrHealthEndpoint: "/bus/v1/ocr/health",
      },
      ocr: {
        status: "expected",
        directUrl: "http://127.0.0.1:8097",
        gatewayExtractEndpoint: "/bus/v1/ocr/extract",
        gatewayModelsEndpoint: "/bus/v1/ocr/models",
        capabilityLanes: ["image_ocr", "pdf_inspection", "table_extraction", "layout_extraction", "skill_evidence"],
      },
      datasets: {
        starredRepos: this.starredRepos.length,
        myRepos: this.myRepos.length,
        repoSignals: this.repoSignals.length,
        researchQueue: this.researchQueue.length,
        skillExtractions: this.skillExtractions.length,
        mineHealth: this.mineHealth.length,
        repoInspections: this.repoInspections.length,
        actionItems: this.actionItems.length,
        templateKits: this.templateKits.length,
        repoOpsKits: this.repoOpsKits.length,
      },
      artifacts: [
        STATS_FILE,
        REPO_SIGNALS_FILE,
        RESEARCH_QUEUE_FILE,
        SKILL_EXTRACTIONS_FILE,
        MINE_HEALTH_FILE,
        REPO_INSPECTIONS_FILE,
        ACTION_ITEMS_FILE,
        OPS_DIGEST_FILE,
        WEEKLY_RESEARCH_REVIEW_FILE,
        AUTOMATION_RUNS_FILE,
        TEMPLATE_KITS_FILE,
        REPO_OPS_KITS_FILE,
      ],
      tools: {
        total: 38,
        draftOnly: true,
      },
    });
  }

  async handleListSkillCandidates(args) {
    const result = await listSkillCandidates({
      projectRoot: HOUSE_ROOT,
      limit: args.limit ?? 10,
      scope: args.scope ?? "all",
      dryRun: true,
    });
    return this.response(result);
  }

  async handleGetSkillCandidate(args) {
    const candidate = await getSkillCandidate(args.candidate_id, {
      projectRoot: HOUSE_ROOT,
      limit: args.limit ?? 250,
    });
    if (!candidate) {
      throw new Error("Skill candidate not found");
    }
    return this.response(candidate);
  }

  async handleValidateSkillCandidate(args) {
    const candidate = await getSkillCandidate(args.candidate_id, {
      projectRoot: HOUSE_ROOT,
      limit: args.limit ?? 250,
    });
    if (!candidate) {
      throw new Error("Skill candidate not found");
    }
    return this.response({
      candidate_id: candidate.candidate_id,
      validation: validateSkillCandidate(candidate),
    });
  }

  async handleProposeSkillPromotion(args) {
    const result = await proposeSkillPromotion(args.candidate_id, {
      projectRoot: HOUSE_ROOT,
      limit: args.limit ?? 250,
      write: args.write === true,
    });
    if (!result) {
      throw new Error("Skill candidate not found");
    }
    return this.response(result);
  }

  async run() {
    console.error("Loading Vega Lab datasets...");
    await this.refresh();
    console.error(`Loaded ${this.starredRepos.length} starred repos and ${this.myRepos.length} owned/collab repos.`);
    console.error(`Loaded ${this.repoSignals.length} signals, ${this.researchQueue.length} queue items, ${this.skillExtractions.length} skill extractions, ${this.actionItems.length} actions.`);

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("MCP Server running on stdio");
  }
}

const server = new VegaLabServer();
server.run().catch((error) => {
  console.error(error);
  process.exit(1);
});
