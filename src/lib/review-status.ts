// One presentation vocabulary for the different status fields Vega already stores.
//
// Vega persists at least six status vocabularies (action items, research queue,
// durable action receipts, skill candidates, review envelopes, workflow stages).
// The UI must never let a machine-produced record look like a human decision, so
// every mapping here also states the record's provenance class.
//
// Pure module: type-only imports so it runs under Node type stripping in tests.
import type {
  ActionItemStatus,
  ResearchStatus,
  VegaActionResult,
  VegaActionStatus,
} from "../types";

export type PresentationStatus =
  | "draft"
  | "queued"
  | "in-review"
  | "pending-review"
  | "accepted"
  | "done"
  | "dismissed"
  | "stale"
  | "unavailable"
  | "blocked"
  | "running"
  | "failed"
  | "untracked"
  | "locked";

export type ProvenanceClass =
  | "source-fact"
  | "derived-heuristic"
  | "generated-draft"
  | "human-decision"
  | "runtime-probe";

export type StatusTone = "neutral" | "info" | "warn" | "ok" | "danger" | "muted";

export interface StatusPresentation {
  status: PresentationStatus;
  label: string;
  tone: StatusTone;
  description: string;
  provenance: ProvenanceClass;
  /** True only when a person made this decision and it is durably recorded. */
  isHumanDecision: boolean;
}

export const PROVENANCE_LABELS: Record<ProvenanceClass, { label: string; description: string }> = {
  "source-fact": {
    label: "Source fact",
    description: "Copied from the repository host snapshot (GitHub metadata). Not interpreted by Vega.",
  },
  "derived-heuristic": {
    label: "Derived · heuristic",
    description: "Computed by Vega's deterministic house model from source facts. A ranking aid, not a finding.",
  },
  "generated-draft": {
    label: "Generated draft",
    description: "Produced by Vega tooling or a model. Internal and pending until a person reviews it.",
  },
  "human-decision": {
    label: "Human decision",
    description: "A durable record of a reviewer's decision.",
  },
  "runtime-probe": {
    label: "Runtime probe",
    description: "Observed from this browser just now. Reflects reachability, not correctness.",
  },
};

function present(
  status: PresentationStatus,
  label: string,
  tone: StatusTone,
  description: string,
  provenance: ProvenanceClass,
  isHumanDecision = false,
): StatusPresentation {
  return { status, label, tone, description, provenance, isHumanDecision };
}

export function presentActionItemStatus(status: ActionItemStatus | string): StatusPresentation {
  switch (status) {
    case "open":
      return present("draft", "Draft", "neutral", "Drafted by Vega automation. Nobody has reviewed it yet.", "generated-draft");
    case "reviewing":
      return present("in-review", "In review", "info", "A reviewer has picked this draft up. No decision is recorded yet.", "human-decision");
    case "accepted":
      return present("accepted", "Accepted", "ok", "A reviewer accepted this draft. Execution is a separate, explicit step.", "human-decision", true);
    case "done":
      return present("done", "Done", "ok", "A reviewer marked this action complete.", "human-decision", true);
    case "dismissed":
      return present("dismissed", "Dismissed", "muted", "A reviewer dismissed this draft.", "human-decision", true);
    default:
      return present("unavailable", "Unknown status", "warn", `Unrecognized action status "${String(status)}".`, "generated-draft");
  }
}

export function presentResearchStatus(status: ResearchStatus | string | undefined): StatusPresentation {
  switch (status) {
    case "queued":
      return present("queued", "Queued", "info", "Waiting in the research queue (added by a person or an automation draft).", "generated-draft");
    case "researching":
      return present("in-review", "Researching", "info", "Research is in progress. Findings remain drafts.", "human-decision");
    case "done":
      return present("done", "Researched", "ok", "Research was marked complete. Any outputs still need review before adoption.", "human-decision", true);
    case "dismissed":
      return present("dismissed", "Dismissed", "muted", "Removed from research by a reviewer.", "human-decision", true);
    case "untracked":
    case undefined:
    case "":
      return present("untracked", "Not queued", "muted", "Not in the research queue.", "derived-heuristic");
    default:
      return present("unavailable", "Unknown status", "warn", `Unrecognized research status "${String(status)}".`, "derived-heuristic");
  }
}

/**
 * Durable action receipts are machine records. A succeeded run means a draft
 * artifact exists, never that it was approved: the bridge pins every receipt to
 * review_state=pending / visibility=internal.
 */
export function presentActionRun(run: Pick<VegaActionResult, "status" | "review_state"> & { error?: { message?: string } }): StatusPresentation {
  const status: VegaActionStatus = run.status;
  switch (status) {
    case "succeeded":
      return present("pending-review", "Completed", "neutral", "The action completed. Any produced output remains subject to human review.", "generated-draft");
    case "queued":
    case "running":
      return present("running", status === "queued" ? "Queued" : "Running", "info", "The action is in progress.", "generated-draft");
    case "blocked":
      return present("blocked", "Blocked", "warn", run.error?.message || "The action is blocked until its blocker is resolved.", "generated-draft");
    case "failed":
      return present("failed", "Failed", "danger", run.error?.message || "The action failed.", "generated-draft");
    case "cancelled":
      return present("dismissed", "Cancelled", "muted", "The action was cancelled.", "generated-draft");
    default:
      return present("unavailable", "Unknown", "warn", `Unrecognized run status "${String(status)}".`, "generated-draft");
  }
}

export interface CandidateLike {
  candidate_id: string;
  content_checksum: string;
  review_status?: string;
}

export interface ReviewEnvelopeLike {
  schema_version?: string;
  review_id?: string;
  candidate_id: string;
  candidate_checksum: string;
  status: "approved" | "rejected" | "changes-requested" | string;
  reviewer?: { id?: string };
  reviewed_at?: string;
}

/**
 * A candidate is only "accepted" when a corex.vega-skill-review.v1 envelope for the
 * same candidate *and the same content checksum* says approved. A candidate that
 * claims approval without such a record is treated as blocked, not accepted.
 */
export function presentCandidate(candidate: CandidateLike, review?: ReviewEnvelopeLike | null): StatusPresentation {
  if (review && review.candidate_id === candidate.candidate_id) {
    if (review.schema_version !== "corex.vega-skill-review.v1" || !review.review_id?.trim() ||
        !review.reviewer?.id?.trim() || !review.reviewed_at?.trim() ||
        !/^sha256:[a-f0-9]{64}$/.test(review.candidate_checksum)) {
      return present("blocked", "Invalid review record", "warn", "The review is missing required identity, provenance, or checksum fields. It cannot establish a human decision.", "generated-draft");
    }
    if (review.candidate_checksum !== candidate.content_checksum) {
      return present("stale", "Review outdated", "warn", "The review record belongs to a different revision of this candidate. Review again.", "human-decision");
    }
    if (review.status === "approved") {
      return present("accepted", "Approved", "ok", `Approved by ${review.reviewer?.id || "a reviewer"}. Promotion is still a separate Core-X step.`, "human-decision", true);
    }
    if (review.status === "rejected") {
      return present("dismissed", "Rejected", "muted", "A reviewer rejected this candidate.", "human-decision", true);
    }
    if (review.status === "changes-requested") {
      return present("in-review", "Changes requested", "info", "A reviewer asked for changes.", "human-decision");
    }
  }
  if (!candidate.review_status || candidate.review_status === "pending") {
    return present("pending-review", "Pending review", "neutral", "Generated candidate awaiting human review.", "generated-draft");
  }
  return present("blocked", "Unverified status", "warn", `Candidate claims "${candidate.review_status}" without a matching review record. Treated as not approved.`, "generated-draft");
}

export type WorkflowStageState = "pending" | "queued" | "running" | "succeeded" | "failed" | "blocked" | "cancelled" | "locked";

export function presentWorkflowStage(state: WorkflowStageState): StatusPresentation {
  if (state === "locked") {
    return present("locked", "Human gate", "muted", "Requires an explicit human decision outside Vega. No button in Vega performs it.", "human-decision");
  }
  if (state === "pending") {
    return present("untracked", "Not run", "muted", "No durable receipt for this step yet.", "generated-draft");
  }
  return presentActionRun({ status: state, review_state: "pending" });
}

export function isAcceptedByHuman(presentation: StatusPresentation): boolean {
  return presentation.isHumanDecision && (presentation.status === "accepted" || presentation.status === "done");
}
