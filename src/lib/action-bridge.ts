import type { Repo, VegaActionKind, VegaActionRequest, VegaActionResult } from "../types";

export interface RepoActionOptions {
  actionKind: VegaActionKind;
  repo?: Repo | null;
  candidateId?: string;
  parameters?: Record<string, unknown>;
  write?: boolean;
}

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
    };
    return [
      `Candidate: ${candidate.candidate_id}`,
      `Suggested skill: ${candidate.suggested_skill_id}`,
      `Review: ${candidate.review_status || "pending"}`,
      "",
      candidate.evidence_summary || "",
    ].join("\n");
  }

  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

export function formatVegaActionResult(result: VegaActionResult): string {
  const lines = [
    "**Direct Answer**",
    result.status === "succeeded"
      ? `Vega action \`${result.action_kind}\` completed and remains \`${result.review_state}\` / \`${result.visibility}\`.`
      : `Vega action \`${result.action_kind}\` failed: ${result.error?.message || "unknown error"}.`,
    "",
    "**Progress**",
    ...result.steps.map((step) => `- ${step.status}: ${step.label}${step.detail ? ` — ${step.detail}` : ""}`),
  ];

  if (result.artifacts.length > 0) {
    lines.push("", "**Artifacts**");
    lines.push(...result.artifacts.map((artifact) => `- ${artifact.kind}: ${artifact.path || artifact.title || "in-memory"}`));
  }

  if (result.result) {
    lines.push("", "**Result**", summarizeValue(result.result));
  }

  lines.push("", "**Next Actions**");
  lines.push("- Review the internal artifact before promotion or publication.");
  lines.push("- If this is a skill candidate, validate it and generate a dossier before requesting approval.");

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
