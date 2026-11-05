// "What deserves my attention?" — a deterministic, explainable ranking over the
// data Vega already persists, plus the single next step for each repository.
//
// The next step is derived from the durable workflow stages in action-bridge.ts.
// It never performs anything: UI buttons only *prepare* a typed action prompt that
// a person must send, and human gates are surfaced as gates, never as buttons.
import type {
  ActionItem,
  MineHealthRecord,
  Repo,
  RepoSignal,
  ResearchQueueItem,
  VegaActionKind,
  VegaActionResult,
} from "../types";
import type { ProvenanceClass } from "./review-status.ts";
import { workflowStagesForRepo } from "./action-bridge.ts";
import type { VegaWorkflowStageState } from "./action-bridge.ts";

export type RepoSourceKind = "owned" | "starred" | "research";
export type AttentionBand = "decide" | "research" | "watch";

export interface AttentionReason {
  text: string;
  provenance: ProvenanceClass;
}

export type NextStepKind =
  | "resolve-blocker"
  | "continue-review"
  | "review-draft"
  | "queue-research"
  | "run-action"
  | "human-gate"
  | "monitor";

export interface NextStep {
  kind: NextStepKind;
  label: string;
  detail: string;
  /** Typed durable action this step maps to, when there is one. */
  actionKind?: VegaActionKind;
  /** Prompt that ChatPanel routes to the typed action. Prepared, never auto-sent. */
  prompt?: string;
  /** The action writes an internal draft under data/review (never outside Vega). */
  writesDraft: boolean;
  /** A person must decide; Vega offers no button that completes this step. */
  requiresHuman: boolean;
  actionItemId?: string;
}

export interface AttentionEntry {
  nwo: string;
  repo: Repo | null;
  source: RepoSourceKind;
  visibility: "public" | "private" | "unknown";
  signal: RepoSignal | null;
  queueItem: ResearchQueueItem | null;
  health: MineHealthRecord | null;
  actionItems: ActionItem[];
  activeActions: ActionItem[];
  runs: VegaActionResult[];
  blockedRun: VegaActionResult | null;
  stages: VegaWorkflowStageState[];
  priority: number;
  band: AttentionBand;
  reasons: AttentionReason[];
  nextStep: NextStep;
}

export interface AttentionInput {
  starred: Repo[];
  mine: Repo[];
  signals: RepoSignal[];
  queue: ResearchQueueItem[];
  actionItems: ActionItem[];
  runs: VegaActionResult[];
  mineHealth: MineHealthRecord[];
}

/**
 * Prompts that ChatPanel's `inferActionFromPrompt` maps to each typed action.
 * Covered by tests/test-observatory-model.js so UI wording cannot drift away from
 * the typed tool it is meant to call.
 */
export const NEXT_STEP_PROMPTS: Record<VegaActionKind, string> = {
  "repo.inspect": "Inspect this repo and summarize the adoption fit with evidence.",
  "snapshot.resolve": "Resolve and write the immutable source snapshot for this repo.",
  "candidate.build": "Build a pending skill candidate for this repo from pinned evidence.",
  "candidate.validate": "Validate candidate schema, checksum, provenance, and safety for this repo.",
  "dossier.generate": "Generate the human approval packet (dossier) for this repo's candidate.",
  "review.queue": "Queue this repo for research and record why it matters.",
  "ops-kit.generate": "Generate an Ops kit readme draft for this repo.",
  "mission.generate": "Generate a mission brief for this repo.",
};

const STAGE_LABELS: Partial<Record<VegaActionKind, { label: string; detail: string; writesDraft: boolean }>> = {
  "repo.inspect": { label: "Inspect repository", detail: "Load metadata, signals, extraction and adoption fit. Read-only.", writesDraft: false },
  "snapshot.resolve": { label: "Resolve source snapshot", detail: "Pin immutable source evidence. Writes an internal snapshot under data/review.", writesDraft: true },
  "candidate.build": { label: "Build skill candidate", detail: "Create a pending candidate from pinned evidence. Writes an internal draft.", writesDraft: true },
  "candidate.validate": { label: "Validate candidate", detail: "Check schema, checksum, provenance and safety. Read-only.", writesDraft: false },
  "dossier.generate": { label: "Generate review dossier", detail: "Assemble the internal human-approval packet. Writes an internal draft.", writesDraft: true },
};

const PRIORITY_WEIGHT: Record<ActionItem["priority"], number> = { critical: 12, high: 10, normal: 4, low: 1 };

function keyOf(nwo: string): string {
  return String(nwo || "").trim().toLowerCase();
}

function repoNwo(repo: Repo): string {
  return `${repo.author}/${repo.name}`;
}

function isActive(item: ActionItem): boolean {
  return item.status === "open" || item.status === "reviewing";
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function byPriority(left: ActionItem, right: ActionItem): number {
  return PRIORITY_WEIGHT[right.priority] - PRIORITY_WEIGHT[left.priority] || left.title.localeCompare(right.title);
}

export function deriveNextStep(entry: Pick<AttentionEntry, "source" | "signal" | "queueItem" | "activeActions" | "blockedRun" | "stages">): NextStep {
  if (entry.blockedRun) {
    return {
      kind: "resolve-blocker",
      label: "Resolve blocker",
      detail: entry.blockedRun.error?.message || `${entry.blockedRun.action_kind} is blocked.`,
      writesDraft: false,
      requiresHuman: true,
    };
  }

  const reviewing = entry.activeActions.filter((item) => item.status === "reviewing").sort(byPriority);
  if (reviewing.length > 0) {
    const item = reviewing[0];
    return {
      kind: "continue-review",
      label: `Finish review: ${item.title}`,
      detail: "A reviewer picked this draft up. Record accept or dismiss explicitly.",
      prompt: `Review Vega Lab action item ${item.id}. Use list_action_items and update_action_item only if I explicitly approve a status change.`,
      writesDraft: false,
      requiresHuman: true,
      actionItemId: item.id,
    };
  }

  if (entry.source === "owned") {
    const open = entry.activeActions.filter((item) => item.status === "open").sort(byPriority);
    if (open.length > 0) {
      const item = open[0];
      return {
        kind: "review-draft",
        label: `Review draft: ${item.title}`,
        detail: `${item.kind} draft · ${item.priority} priority · drafted by ${item.source}.`,
        prompt: `Review Vega Lab action item ${item.id}. Use list_action_items and update_action_item only if I explicitly approve a status change.`,
        writesDraft: false,
        requiresHuman: true,
        actionItemId: item.id,
      };
    }
  }

  const queueStatus = entry.queueItem?.status;
  if (queueStatus === "dismissed" && entry.activeActions.length === 0) {
    return { kind: "monitor", label: "No action", detail: "Dismissed from research. Kept for reference.", writesDraft: false, requiresHuman: false };
  }

  if (!queueStatus && entry.source !== "owned" && entry.signal && entry.signal.adoptionKind !== "ignore") {
    return {
      kind: "queue-research",
      label: "Queue for research",
      detail: "Add to the durable research queue. Writes an internal queue record.",
      actionKind: "review.queue",
      prompt: NEXT_STEP_PROMPTS["review.queue"],
      writesDraft: true,
      requiresHuman: false,
    };
  }

  for (const stage of entry.stages) {
    if (stage.state === "locked" || !stage.actionKind || stage.actionKind === "review.queue") continue;
    if (stage.state === "succeeded") continue;
    const meta = STAGE_LABELS[stage.actionKind];
    if (!meta) continue;
    if (stage.state === "running" || stage.state === "queued") {
      return { kind: "monitor", label: `${meta.label} in progress`, detail: "Wait for the durable receipt.", writesDraft: false, requiresHuman: false };
    }
    const retry = stage.state === "failed";
    return {
      kind: "run-action",
      label: retry ? `Retry: ${meta.label}` : meta.label,
      detail: retry ? `Previous run failed: ${stage.run?.error?.message || "see receipt"}. ${meta.detail}` : meta.detail,
      actionKind: stage.actionKind,
      prompt: NEXT_STEP_PROMPTS[stage.actionKind],
      writesDraft: meta.writesDraft,
      requiresHuman: false,
    };
  }

  return {
    kind: "human-gate",
    label: "Human review required",
    detail: "All Vega draft steps have receipts. Approval and promotion happen outside Vega through the Core-X review gate.",
    writesDraft: false,
    requiresHuman: true,
  };
}

export function buildAttentionQueue(input: AttentionInput): AttentionEntry[] {
  const repos = new Map<string, { repo: Repo; source: RepoSourceKind }>();
  for (const repo of input.starred) repos.set(keyOf(repoNwo(repo)), { repo, source: "starred" });
  for (const repo of input.mine) {
    if (repo.is_owner === false) continue;
    repos.set(keyOf(repoNwo(repo)), { repo, source: "owned" });
  }

  const signals = new Map(input.signals.map((signal) => [keyOf(signal.nwo), signal]));
  const queue = new Map(input.queue.map((item) => [keyOf(item.nwo), item]));
  const health = new Map(input.mineHealth.map((record) => [keyOf(record.nwo), record]));
  const actionsByRepo = new Map<string, ActionItem[]>();
  for (const item of input.actionItems) {
    const key = keyOf(item.nwo);
    actionsByRepo.set(key, [...(actionsByRepo.get(key) || []), item]);
  }
  const runsByRepo = new Map<string, VegaActionResult[]>();
  // Newest first, matching the bridge's /runs ordering that workflowStagesForRepo relies on.
  const newestFirst = [...input.runs].sort((left, right) => String(right.completed_at || "").localeCompare(String(left.completed_at || "")));
  for (const run of newestFirst) {
    const key = keyOf(run.repo?.nwo || "");
    if (!key) continue;
    runsByRepo.set(key, [...(runsByRepo.get(key) || []), run]);
  }

  const keys = new Set<string>([...repos.keys(), ...queue.keys(), ...actionsByRepo.keys(), ...runsByRepo.keys()]);
  const entries: AttentionEntry[] = [];

  for (const key of keys) {
    const known = repos.get(key) || null;
    const repo = known?.repo || null;
    const signal = signals.get(key) || null;
    const queueItem = queue.get(key) || null;
    const actionItems = actionsByRepo.get(key) || [];
    const activeActions = actionItems.filter(isActive);
    const runs = runsByRepo.get(key) || [];
    // The newest receipt per action kind decides the stage; a later success clears an older block.
    const blockedRun = runs.find((run) => run.status === "blocked"
      && !runs.some((other) => other.action_kind === run.action_kind && other.status === "succeeded"
        && String(other.completed_at) > String(run.completed_at))) || null;

    const worthAttention = activeActions.length > 0
      || blockedRun
      || (queueItem && queueItem.status !== "dismissed" && queueItem.status !== "done")
      || (signal && signal.adoptionKind !== "ignore" && signal.adoptionScore >= 50);
    if (!worthAttention) continue;

    const nwo = repo ? repoNwo(repo) : signal?.nwo || queueItem?.nwo || actionItems[0]?.nwo || runs[0]?.repo?.nwo || key;
    const source: RepoSourceKind = known?.source || "research";
    const reasons: AttentionReason[] = [];
    let priority = 0;

    if (blockedRun) {
      priority += 50;
      reasons.push({ text: `Blocked ${blockedRun.action_kind}: ${blockedRun.error?.message || "see receipt"}`, provenance: "generated-draft" });
    }
    const reviewingCount = activeActions.filter((item) => item.status === "reviewing").length;
    if (reviewingCount > 0) {
      priority += 30;
      reasons.push({ text: `${plural(reviewingCount, "draft")} in review`, provenance: "human-decision" });
    }
    const openActions = activeActions.filter((item) => item.status === "open");
    if (openActions.length > 0) {
      priority += Math.min(20, openActions.reduce((sum, item) => sum + PRIORITY_WEIGHT[item.priority], 0));
      reasons.push({ text: `${plural(openActions.length, "draft action")} awaiting review`, provenance: "generated-draft" });
    }
    if (queueItem?.status === "researching") {
      priority += 24;
      reasons.push({ text: "Research in progress", provenance: "human-decision" });
    } else if (queueItem?.status === "queued") {
      priority += 18;
      reasons.push({ text: "Queued for research", provenance: "generated-draft" });
    }
    if (signal) {
      priority += Math.min(20, signal.adoptionScore * 0.2);
      if (signal.adoptionKind !== "ignore") {
        reasons.push({ text: `Heuristic fit ${signal.adoptionScore}/100 as ${signal.adoptionKind}`, provenance: "derived-heuristic" });
      }
      if (signal.staleness === "stale") {
        reasons.push({ text: "Little recent activity (stale)", provenance: "derived-heuristic" });
        if (source === "owned") priority += 6;
      }
    }

    const stages = workflowStagesForRepo(runs, repo || ({ author: nwo.split("/")[0], name: nwo.split("/")[1] } as Repo));
    const band: AttentionBand = blockedRun || activeActions.length > 0
      ? "decide"
      : queueItem && (queueItem.status === "queued" || queueItem.status === "researching")
        ? "research"
        : "watch";

    const partial = { source, signal, queueItem, activeActions, blockedRun, stages };
    entries.push({
      nwo,
      repo,
      source,
      visibility: repo ? (repo.private ? "private" : "public") : "unknown",
      signal,
      queueItem,
      health: health.get(key) || null,
      actionItems,
      activeActions,
      runs,
      blockedRun,
      stages,
      priority: Math.round(priority),
      band,
      reasons,
      nextStep: deriveNextStep(partial),
    });
  }

  return entries.sort((left, right) => right.priority - left.priority || left.nwo.localeCompare(right.nwo));
}
