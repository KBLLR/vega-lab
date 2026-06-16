import type { Repo, VegaActionKind, VegaActionRequest, VegaActionResult } from "../types";

export interface RepoActionOptions {
  actionKind: VegaActionKind;
  repo?: Repo | null;
  candidateId?: string;
  parameters?: Record<string, unknown>;
  write?: boolean;
}

export interface VegaWorkflowStage {
  id: string;
  label: string;
  description: string;
  actionKind?: VegaActionKind;
  locked?: boolean;
}

export interface VegaWorkflowStageState extends VegaWorkflowStage {
  state: "pending" | "queued" | "running" | "succeeded" | "failed" | "blocked" | "cancelled" | "locked";
  run?: VegaActionResult;
}

export const VEGA_WORKFLOW_STAGES: VegaWorkflowStage[] = [
  {
    id: "repo.inspect",
    actionKind: "repo.inspect",
    label: "Repo inspected",
    description: "Metadata, signals, extraction, and adoption fit loaded.",
  },
  {
    id: "snapshot.resolve",
    actionKind: "snapshot.resolve",
    label: "Source snapshot",
    description: "Immutable source evidence checked or resolved.",
  },
  {
    id: "candidate.build",
    actionKind: "candidate.build",
    label: "Candidate built",
    description: "Pending skill candidate created from pinned evidence.",
  },
  {
    id: "candidate.validate",
    actionKind: "candidate.validate",
    label: "Candidate valid",
    description: "Candidate schema, checksum, provenance, and safety verified.",
  },
  {
    id: "dossier.generate",
    actionKind: "dossier.generate",
    label: "Dossier ready",
    description: "Internal human approval packet generated.",
  },
  {
    id: "review.queue",
    actionKind: "review.queue",
    label: "Research queued",
    description: "Repository is durable in the review/research queue.",
  },
  {
    id: "review.approve",
    label: "Human decision",
    description: "Requires explicit human approval outside this UI flow.",
    locked: true,
  },
  {
    id: "promotion.propose",
    label: "Promotion proposal",
    description: "Core-X capability promotion proposal remains locked.",
    locked: true,
  },
  {
    id: "corex.dry-run",
    label: "Core-X dry-run",
    description: "Registry dry-run must be initiated separately.",
    locked: true,
  },
  {
    id: "bundle.review",
    label: "Bundle review",
    description: "Promotion bundle review remains operator-gated.",
    locked: true,
  },
  {
    id: "corex.apply",
    label: "Apply",
    description: "No apply path is exposed from Vega.",
    locked: true,
  },
];

export async function runVegaAction(options: RepoActionOptions): Promise<VegaActionResult> {
  const body: VegaActionRequest = {
    action_kind: options.actionKind,
    candidate_id: options.candidateId,
    parameters: options.parameters || {},
    write: options.write,
    repo: options.repo
      ? {
          name: options.repo.name,
          author: options.repo.author,
          nwo: `${options.repo.author}/${options.repo.name}`,
        }
      : undefined,
  };

  const response = await fetch("/api/vega/actions/run", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Vega-Action-Origin": "vega-lab-ui",
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload as VegaActionResult;
}

export async function fetchVegaActionRuns(): Promise<VegaActionResult[]> {
  const response = await fetch("/api/vega/actions/runs", {
    method: "GET",
    headers: {
      "Accept": "application/json",
    },
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return (payload?.runs || []) as VegaActionResult[];
}

function repoNwo(repo?: Repo | null): string {
  return repo ? `${repo.author}/${repo.name}`.toLowerCase() : "";
}

function runMatchesRepo(run: VegaActionResult, repo?: Repo | null): boolean {
  const target = repoNwo(repo);
  if (!target) return false;
  return String(run.repo?.nwo || "").toLowerCase() === target;
}

export function workflowStagesForRepo(runs: VegaActionResult[], repo?: Repo | null): VegaWorkflowStageState[] {
  return VEGA_WORKFLOW_STAGES.map((stage) => {
    if (stage.locked || !stage.actionKind) {
      return {
        ...stage,
        state: "locked" as const,
      };
    }
    const run = runs.find((candidateRun) =>
      candidateRun.action_kind === stage.actionKind && runMatchesRepo(candidateRun, repo),
    );
    return {
      ...stage,
      state: run?.status || "pending",
      run,
    };
  });
}

function summarizeValue(value: unknown): string {
  if (!value || typeof value !== "object") return String(value ?? "");

  const record = value as Record<string, unknown>;
  if (typeof record.summary === "string") return record.summary;
  if (typeof record.mission === "string") return record.mission;
  if (record.adoption_fit && typeof record.adoption_fit === "object") {
    const fit = record.adoption_fit as { kind?: string; score?: number; reasons?: string[] };
    return [
      `Adoption kind: ${fit.kind || "unknown"}`,
      typeof fit.score === "number" ? `Score: ${fit.score}` : null,
      ...(fit.reasons || []).slice(0, 4),
    ].filter(Boolean).join("\n");
  }
  if (Array.isArray(record.artifacts)) {
    return record.artifacts
      .map((artifact) => {
        const next = artifact as { kind?: string; title?: string; body?: string };
        return [`### ${next.title || next.kind || "Artifact"}`, next.body || ""].join("\n");
      })
      .join("\n\n");
  }
  if (record.candidate && typeof record.candidate === "object") {
    const candidate = record.candidate as {
      candidate_id?: string;
      suggested_skill_id?: string;
      evidence_summary?: string;
      review_status?: string;
      candidate_profile?: {
        profile_id?: string;
        profile_digest?: string;
        source?: {
          repository?: string;
          commit?: string;
        };
      };
    };
    const profile = candidate.candidate_profile;
    return [
      `Candidate: ${candidate.candidate_id}`,
      `Suggested skill: ${candidate.suggested_skill_id}`,
      profile?.profile_id
        ? `Curated candidate profile: ${profile.profile_id}`
        : "Candidate kind: Generic candidate",
      profile?.profile_digest ? `Profile digest: ${profile.profile_digest}` : null,
      profile?.source?.repository && profile?.source?.commit
        ? `Profile source: ${profile.source.repository}@${profile.source.commit}`
        : null,
      `Review: ${candidate.review_status || "pending"}`,
      "",
      candidate.evidence_summary || "",
    ].filter(Boolean).join("\n");
  }

  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

export function formatVegaActionResult(result: VegaActionResult): string {
  const lines = [
    "**Direct Answer**",
    result.status === "succeeded"
      ? `Vega action \`${result.action_kind}\` completed as run \`${result.run_id}\` and remains \`${result.review_state}\` / \`${result.visibility}\`.`
      : `Vega action \`${result.action_kind}\` is \`${result.status}\`: ${result.error?.message || "unknown error"}.`,
    "",
    "**Receipt**",
    `- Run: \`${result.run_id}\``,
    `- Action: \`${result.action_id}\``,
    `- Requested: ${result.requested_at}`,
    `- Input digest: \`${result.input_digest}\``,
    "",
    "**Progress**",
    ...result.steps.map((step) => `- ${step.status}: ${step.label}${step.detail ? ` — ${step.detail}` : ""}`),
  ];

  if (result.warnings.length > 0) {
    lines.push("", "**Warnings**");
    lines.push(...result.warnings.map((warning) => `- ${warning}`));
  }

  if (result.error) {
    lines.push("", "**Error**");
    lines.push(`- Code: \`${result.error.code}\``);
    lines.push(`- Retryable: ${result.error.retryable ? "yes" : "no"}`);
  }

  if (result.artifacts.length > 0) {
    lines.push("", "**Artifacts**");
    lines.push(...result.artifacts.map((artifact) => `- ${artifact.kind}: ${artifact.path || artifact.title || "in-memory"}`));
  }

  if (result.result) {
    lines.push("", "**Result**", summarizeValue(result.result));
  }

  lines.push("", "**Next Actions**");
  if (result.status === "blocked") {
    lines.push("- Resolve the blocker before retrying this action.");
  } else {
    lines.push("- Review the internal artifact before promotion or publication.");
    lines.push("- If this is a skill candidate, validate it and generate a dossier before requesting approval.");
  }

  return lines.join("\n");
}

export function inferActionFromPrompt(prompt: string, activeMissionTarget: "codex" | "claude" | "mlx" = "mlx"): {
  actionKind: VegaActionKind;
  parameters?: Record<string, unknown>;
  write?: boolean;
} | null {
  const text = prompt.toLowerCase();

  if (/\b(queue|research queue|queued|research)\b/.test(text) && /\bupdate_research_queue|queue|research\b/.test(text)) {
    return {
      actionKind: "review.queue",
      parameters: {
        status: "queued",
        priority: "normal",
        notes: "Queued from Vega UI action for research, adoption fit, and skill evidence review.",
      },
      write: true,
    };
  }

  if (/\b(source snapshot|snapshot\.resolve|immutable snapshot)\b/.test(text)) {
    return {
      actionKind: "snapshot.resolve",
      write: /\b(write|resolve|cache)\b/.test(text),
    };
  }

  if (/\b(skill candidate|candidate\.build)\b/.test(text)) {
    return {
      actionKind: "candidate.build",
      write: true,
    };
  }

  if (/\b(validate candidate|candidate\.validate)\b/.test(text)) {
    return {
      actionKind: "candidate.validate",
      write: false,
    };
  }

  if (/\b(dossier|approval packet|human approval packet)\b/.test(text)) {
    return {
      actionKind: "dossier.generate",
      write: true,
    };
  }

  if (/\b(ops kit|readme draft|agents draft|deployment plan|test plan)\b/.test(text)) {
    let artifactKind = null;
    if (text.includes("readme draft")) artifactKind = "readme";
    else if (text.includes("agents draft")) artifactKind = "agents";
    else if (text.includes("deployment plan")) artifactKind = "deployment";
    else if (text.includes("test plan")) artifactKind = "testing";
    return {
      actionKind: "ops-kit.generate",
      parameters: {
        target: activeMissionTarget,
        ...(artifactKind ? { artifactKind } : {}),
      },
      write: false,
    };
  }

  if (/\b(mission|generate_repo_mission)\b/.test(text)) {
    const target = text.includes("claude") ? "claude" : text.includes("codex") ? "codex" : activeMissionTarget;
    return {
      actionKind: "mission.generate",
      parameters: { target },
      write: false,
    };
  }

  if (/\b(brief|adoption fit|repo inspect|get_repo_details|extract_repo_skills)\b/.test(text)) {
    return {
      actionKind: "repo.inspect",
      write: false,
    };
  }

  return null;
}
