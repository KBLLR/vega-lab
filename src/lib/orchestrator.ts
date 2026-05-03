import type { Repo } from "../types";

export const VEGA_LAB_HOUSE_ID = "vega-lab";
export const LEGACY_HOUSE_ID = "git-stars";
export const HOUSE_ID = VEGA_LAB_HOUSE_ID;
export const DEFAULT_AGENT_ID = "vega-lab:orchestrator";
export const EVENT_BUS_URL = import.meta.env.VITE_EVENT_BUS_URL || "/bus";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
}

export interface VegaLabRoute {
  capability: string;
  agentId: string;
  label: string;
}

export type GitStarsRoute = VegaLabRoute;

export interface ActionPreset {
  label: string;
  prompt: string;
  title: string;
  variant?: "primary" | "default";
}

const ROUTES: Array<{ pattern: RegExp; route: VegaLabRoute }> = [
  {
    pattern: /\b(search|find|filter|discover|similar|compare|topic)\b/i,
    route: {
      capability: "repo-discovery",
      agentId: "vega-lab:repo-navigator",
      label: "Repository Navigator",
    },
  },
  {
    pattern: /\b(news|trend|stats|analytics|intelligence|signal|highlights)\b/i,
    route: {
      capability: "star-intelligence",
      agentId: "vega-lab:repo-analyst",
      label: "Repository Analyst",
    },
  },
  {
    pattern: /\b(research|queue|adoption|align|house integration|fit)\b/i,
    route: {
      capability: "repo-research",
      agentId: "vega-lab:alignment-scout",
      label: "Alignment Scout",
    },
  },
  {
    pattern: /\b(skill|rules|flows|codex|claude|mlx|mission|template)\b/i,
    route: {
      capability: "skill-extraction",
      agentId: "vega-lab:tool-architect",
      label: "Tool Architect",
    },
  },
  {
    pattern: /\b(readme|agents draft|ops kit|maintain|maintenance|dependency|package|mine|private|repo ops|deployment plan|test plan)\b/i,
    route: {
      capability: "mine-execution",
      agentId: "vega-lab:repo-ops",
      label: "Repo Ops",
    },
  },
];

export function routeVegaLabIntent(input: string, isMineContext = false): VegaLabRoute {
  if (isMineContext) {
    return {
      capability: "mine-execution",
      agentId: "vega-lab:repo-ops",
      label: "Repo Ops",
    };
  }

  const match = ROUTES.find(({ pattern }) => pattern.test(input));
  return match?.route ?? {
    capability: "orchestration",
    agentId: DEFAULT_AGENT_ID,
    label: "Vega Lab Orchestrator",
  };
}

export const routeGitStarsIntent = routeVegaLabIntent;

export function buildSystemPrompt(repo?: Repo | null, route?: VegaLabRoute): string {
  const context = repo
    ? `Current repo focus:
- Name: ${repo.author}/${repo.name}
- Stars: ${repo.stars}
- Forks: ${repo.forks}
- Open issues: ${repo.open_issues}
- Last updated: ${repo.last_updated}
- Topics: ${(repo.topics || []).slice(0, 8).join(", ") || "none"}
- Languages: ${(repo.languages || []).map((entry) => entry.language).join(", ") || "unknown"}`
    : "No repo is currently selected.";

  const routeContext = route
    ? `Active route:
- Capability: ${route.capability}
- Agent: ${route.agentId}
- Label: ${route.label}`
    : "Active route: orchestrator default.";

  return `You are Vega Lab, the core-x Git universe intelligence lab. Work from canonical tools and derived house data, not generic guessing.
Always prefer typed tools over freeform inference when repo facts, queue state, adoption fit, skills, missions, or mine health are requested.
Local chat and reasoning use OpenResponses through the MLX gateway. Use get_runtime_health for live runtime status and inspect_model_zoo for model availability, not guesses.
For PDFs, screenshots, graphics, tables, diagrams, or image evidence, use inspect_pdf_with_ocr, inspect_image_with_ocr, extract_repo_visual_evidence, extract_skill_evidence_from_pdf, or generate_skill_candidate_from_ocr_evidence so evidence stays traceable and review-gated.
When an Ops kit, README draft, AGENTS draft, deployment plan, or test plan is requested, call generate_repo_ops_kit and return the relevant artifacts.
When a mission brief is requested, call generate_repo_mission. Supported mission targets are codex, claude, and mlx; default to mlx for local runtime work.
When research state changes, call update_research_queue.
When an inbox action is requested, call list_action_items, draft_action_item, or update_action_item.
Jules is not an active Vega Lab target. If asked, state that it is historical template vocabulary and use codex, claude, or mlx instead.
Do not invent repository facts, tool results, model availability, or local runtime status. If a tool or dataset is unavailable, say exactly what is missing.

Response contract:
- Use Markdown with short headings.
- Start with **Direct Answer** in 1-3 sentences.
- Add **Evidence** with concrete repos, scores, topics, or tool/data sources when available.
- Add **Next Actions** with 2-5 specific steps when action is useful.
- For repo recommendations, include why it matters, adoption angle, and first Vega Lab action.
- For skill/rule/flow questions, output reusable bullets that can become house artifacts.
- Avoid loose brainstorming unless the user explicitly asks for it.

${routeContext}

${context}`;
}

export function buildVegaLabTools() {
  return [
    {
      type: "function",
      function: {
        name: "list_starred_repos",
        description: "List starred repositories with pagination and sorting.",
        parameters: {
          type: "object",
          properties: {
            limit: { type: "number", description: "Max results (default 50)" },
            offset: { type: "number", description: "Offset for pagination" },
            sortBy: {
              type: "string",
              enum: ["stars", "forks", "name", "date"],
              description: "Sort field (default stars)",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "search_repos",
        description: "Search repos by name, description, author, or topics.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            language: { type: "string", description: "Optional language filter" },
            minStars: { type: "number", description: "Minimum stars" },
            maxResults: { type: "number", description: "Max results (default 50)" },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_repo_details",
        description: "Get detailed info about a repository.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "Repository name" },
            author: { type: "string", description: "Repository owner (optional)" },
          },
          required: ["name"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_statistics",
        description: "Get aggregate stats for all starred repos.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "get_language_breakdown",
        description: "Get breakdown by programming language.",
        parameters: {
          type: "object",
          properties: {
            topN: { type: "number", description: "Top N languages" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_trending_topics",
        description: "Get most common topics across repos.",
        parameters: {
          type: "object",
          properties: {
            limit: { type: "number", description: "Number of topics to return" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "filter_by_criteria",
        description: "Filter repositories by multiple criteria.",
        parameters: {
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
    },
    {
      type: "function",
      function: {
        name: "find_similar_repos",
        description: "Find repositories similar to a given repo.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "Repository name" },
          },
          required: ["name"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "list_news_signals",
        description: "Return ranked News tab signals for watched, research, mine, or starred scope.",
        parameters: {
          type: "object",
          properties: {
            scope: {
              type: "string",
              enum: ["watched", "research", "mine", "starred", "all"],
              description: "Signal scope (default watched)",
            },
            limit: { type: "number", description: "Maximum signals to return" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_research_queue",
        description: "Return the canonical research queue with optional status filtering.",
        parameters: {
          type: "object",
          properties: {
            status: {
              type: "string",
              enum: ["queued", "researching", "done", "dismissed"],
              description: "Optional research status filter",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "update_research_queue",
        description: "Create or update a research queue item for a repository.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "Repository name" },
            author: { type: "string", description: "Repository owner (optional)" },
            status: {
              type: "string",
              enum: ["queued", "researching", "done", "dismissed"],
              description: "Target status",
            },
            notes: { type: "string", description: "Queue notes" },
            priority: { type: "string", description: "Priority label" },
          },
          required: ["name"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "mark_for_research",
        description: "Compatibility alias for update_research_queue with queued status.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "Repository name" },
            author: { type: "string", description: "Repository owner (optional)" },
            notes: { type: "string", description: "Optional notes" },
          },
          required: ["name"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_adoption_candidates",
        description: "Return top ranked repositories for house, tool, service, or template adoption.",
        parameters: {
          type: "object",
          properties: {
            limit: { type: "number", description: "Maximum candidates to return" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "extract_repo_skills",
        description: "Return the canonical skill extraction record for a repository, including rules and flows.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "Repository name" },
            author: { type: "string", description: "Repository owner (optional)" },
          },
          required: ["name"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "list_template_kits",
        description: "List Vega Lab template kits and source template paths.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "generate_repo_mission",
        description: "Generate a canonical Codex, Claude, or local MLX mission brief for a repository.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "Repository name" },
            author: { type: "string", description: "Repository owner (optional)" },
            target: {
              type: "string",
              enum: ["codex", "claude", "mlx"],
              description: "Mission output target",
            },
          },
          required: ["name", "target"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "generate_repo_ops_kit",
        description: "Generate a draft-only README, AGENTS, maintenance, deployment, testing, and action-item kit for a repo.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "Repository name" },
            author: { type: "string", description: "Repository owner (optional)" },
            target: {
              type: "string",
              enum: ["codex", "claude", "mlx"],
              description: "Output target adapter (default mlx)",
            },
          },
          required: ["name"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_mine_health",
        description: "Return owned-repo health records for Mine workflows.",
        parameters: {
          type: "object",
          properties: {
            flag: { type: "string", description: "Optional health flag filter" },
            visibility: {
              type: "string",
              enum: ["public", "private"],
              description: "Optional visibility filter",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "find_repos_missing_readme",
        description: "List repositories missing a README file (best for Mine scope).",
        parameters: {
          type: "object",
          properties: {
            scope: {
              type: "string",
              enum: ["mine", "starred"],
              description: "Which repo set to inspect (default mine).",
            },
            limit: { type: "number", description: "Max results (default 50)" },
            offset: { type: "number", description: "Offset for pagination" },
            includeUnknown: {
              type: "boolean",
              description: "Include repos where README status is unknown",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "list_action_items",
        description: "List durable Vega Lab Ops Inbox action items.",
        parameters: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["open", "reviewing", "accepted", "dismissed", "done"] },
            kind: { type: "string", enum: ["readme", "maintenance", "deployment", "testing", "dependency", "research", "skill", "template", "adoption"] },
            priority: { type: "string", enum: ["low", "normal", "high", "critical"] },
            limit: { type: "number", description: "Max results" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "update_action_item",
        description: "Update a Vega Lab action item status.",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string" },
            status: { type: "string", enum: ["open", "reviewing", "accepted", "dismissed", "done"] },
            notes: { type: "string" },
          },
          required: ["id", "status"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "inspect_owned_repo",
        description: "Return key-file inspection findings for an owned repository.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string" },
            author: { type: "string" },
          },
          required: ["name"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "draft_action_item",
        description: "Create or refresh a draft-only Vega Lab action item.",
        parameters: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["readme", "maintenance", "deployment", "testing", "dependency", "research", "skill", "template", "adoption"] },
            name: { type: "string" },
            author: { type: "string" },
            source: { type: "string", enum: ["daily-ops", "weekly-research", "manual"] },
          },
          required: ["kind", "name"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "generate_ops_digest",
        description: "Return the latest Vega Lab daily ops digest.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "generate_weekly_research_review",
        description: "Return the latest weekly research and skill extraction review.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "get_runtime_health",
        description: "Return OpenResponses local runtime and dataset health expectations.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "inspect_model_zoo",
        description: "Inspect model-zoo eligibility, production policy, and balanced local MLX recommendations.",
        parameters: {
          type: "object",
          properties: {
            profile: { type: "string", description: "Model profile, default balanced-32gb" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "ocr_health",
        description: "Return OCR service health and mlx-vision worker state.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "inspect_pdf_with_ocr",
        description: "Extract OCR/text evidence from a PDF path or supplied PDF page images.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Local PDF path" },
            file_path: { type: "string", description: "Local PDF file path" },
            file: { type: "string", description: "File reference" },
            max_pages: { type: "number", description: "Max pages to inspect" },
            prompt: { type: "string", description: "OCR prompt" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "inspect_image_with_ocr",
        description: "Extract OCR/visual evidence from an image, screenshot, diagram, or graph.",
        parameters: {
          type: "object",
          properties: {
            image: { type: "string", description: "Image path, URL, or encoded target" },
            path: { type: "string", description: "Local image path" },
            prompt: { type: "string", description: "OCR prompt" },
            allow_url: { type: "boolean", description: "Allow URL input when explicitly true" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "extract_repo_visual_evidence",
        description: "Use OCR to extract repository-relevant evidence from screenshots, diagrams, charts, or UI images.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "Repository name" },
            author: { type: "string", description: "Repository owner (optional)" },
            image: { type: "string", description: "Image path or encoded target" },
            path: { type: "string", description: "Local image path" },
            prompt: { type: "string", description: "OCR prompt" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "extract_skill_evidence_from_pdf",
        description: "Use OCR/PDF inspection to extract SKILL/RULE/WORKFLOW evidence from a PDF.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Local PDF path" },
            file_path: { type: "string", description: "Local PDF file path" },
            file: { type: "string", description: "File reference" },
            max_pages: { type: "number", description: "Max pages to inspect" },
            prompt: { type: "string", description: "OCR prompt" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "generate_skill_candidate_from_ocr_evidence",
        description: "Generate an internal pending SKILL candidate from repo metadata plus optional OCR image/PDF evidence.",
        parameters: {
          type: "object",
          properties: {
            repo_url: { type: "string", description: "GitHub repo URL" },
            local_repo_path: { type: "string", description: "Optional local repo path" },
            name: { type: "string", description: "Repository name" },
            author: { type: "string", description: "Repository owner" },
            pdf_path: { type: "string", description: "Optional PDF evidence path" },
            image_path: { type: "string", description: "Optional image or screenshot evidence path" },
            target_topic: { type: "string", description: "Topic to orient the SKILL candidate" },
            writeArtifact: { type: "boolean", description: "Write an internal data/review artifact when true" },
          },
        },
      },
    },
  ];
}

export const buildGitStarsTools = buildVegaLabTools;

const GENERAL_ACTIONS: ActionPreset[] = [
  {
    label: "Ops kit",
    title: "Ops kit",
    prompt: "Call generate_repo_ops_kit with target mlx and summarize the README, AGENTS, maintenance, deployment, testing, and action-item artifacts.",
    variant: "primary",
  },
  {
    label: "README draft",
    title: "README draft",
    prompt: "Call generate_repo_ops_kit with target mlx and return only the README artifact with its evidence.",
  },
  {
    label: "AGENTS draft",
    title: "AGENTS draft",
    prompt: "Call generate_repo_ops_kit with target mlx and return only the AGENTS artifact with operating rules and commands.",
  },
  {
    label: "Deployment plan",
    title: "Deployment plan",
    prompt: "Call generate_repo_ops_kit with target mlx and return the deployment artifact with known evidence and missing checks.",
  },
  {
    label: "Test plan",
    title: "Test plan",
    prompt: "Call generate_repo_ops_kit with target mlx and return the testing artifact with verification commands or gaps.",
  },
  {
    label: "SKILL candidate",
    title: "SKILL candidate",
    prompt: "Call generate_skill_candidate_from_ocr_evidence with writeArtifact true and return the internal pending SKILL candidate, evidence refs, and limitations. Do not publish it.",
  },
  {
    label: "MLX mission",
    title: "MLX mission",
    prompt: "Call generate_repo_mission with target mlx and return the resulting local MLX mission brief.",
  },
  {
    label: "Codex mission",
    title: "Codex mission",
    prompt: "Call generate_repo_mission with target codex and return the resulting mission brief.",
  },
  {
    label: "Claude mission",
    title: "Claude mission",
    prompt: "Call generate_repo_mission with target claude and return the resulting mission brief.",
  },
];

const MINE_ACTIONS: ActionPreset[] = [
  {
    label: "Ops kit",
    title: "Ops kit",
    prompt: "Call generate_repo_ops_kit with target mlx and summarize the README, AGENTS, maintenance, deployment, testing, and action-item artifacts for this owned repo.",
    variant: "primary",
  },
  {
    label: "README draft",
    title: "README draft",
    prompt: "Call generate_repo_ops_kit with target mlx and return only the README artifact with its evidence.",
  },
  {
    label: "AGENTS draft",
    title: "AGENTS draft",
    prompt: "Call generate_repo_ops_kit with target mlx and return only the AGENTS artifact with operating rules and commands.",
  },
  {
    label: "Deployment plan",
    title: "Deployment plan",
    prompt: "Call generate_repo_ops_kit with target mlx and return the deployment artifact with known evidence and missing checks.",
  },
  {
    label: "Test plan",
    title: "Test plan",
    prompt: "Call generate_repo_ops_kit with target mlx and return the testing artifact with verification commands or gaps.",
  },
  {
    label: "SKILL candidate",
    title: "SKILL candidate",
    prompt: "Call generate_skill_candidate_from_ocr_evidence with writeArtifact true and return the internal pending SKILL candidate, evidence refs, and limitations. Do not publish it.",
  },
  {
    label: "MLX mission",
    title: "MLX mission",
    prompt: "Call generate_repo_mission with target mlx and return the resulting local MLX mission brief.",
  },
  {
    label: "Codex mission",
    title: "Codex mission",
    prompt: "Call generate_repo_mission with target codex and return the resulting mission brief.",
  },
  {
    label: "Claude mission",
    title: "Claude mission",
    prompt: "Call generate_repo_mission with target claude and return the resulting mission brief.",
  },
];

export function getReadmeActionPresets(scope: "general" | "mine" = "general"): ActionPreset[] {
  return scope === "mine" ? MINE_ACTIONS : GENERAL_ACTIONS;
}
