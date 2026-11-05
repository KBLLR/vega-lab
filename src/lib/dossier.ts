// Risks and unknowns for a repository dossier. Severity names follow
// corex.knowledge-refinery-artifact (info | warning | blocking).
import type { Repo, RepoInspection, RepoSignal, VegaActionResult } from "../types";
import type { ProvenanceClass } from "./review-status.ts";

export type RiskSeverity = "info" | "warning" | "blocking";

export interface DossierRisk {
  text: string;
  severity: RiskSeverity;
  provenance: ProvenanceClass;
}

function hasLicense(repo: Repo): boolean {
  return !!repo.license && !["None", "NOASSERTION", "Other"].includes(repo.license);
}

export function buildDossierRisks(input: {
  repo: Repo | null;
  signal: RepoSignal | null;
  inspection: RepoInspection | null;
  blockedRun: VegaActionResult | null;
}): DossierRisk[] {
  const risks: DossierRisk[] = [];
  const { repo, signal, inspection, blockedRun } = input;

  if (blockedRun) {
    risks.push({ text: `Durable action ${blockedRun.action_kind} is blocked: ${blockedRun.error?.message || "see receipt"}`, severity: "blocking", provenance: "generated-draft" });
  }
  if (!repo) {
    risks.push({ text: "No repository snapshot record. Source facts are unknown.", severity: "warning", provenance: "source-fact" });
  } else {
    if (!hasLicense(repo)) {
      risks.push({ text: "No license declared in the snapshot. Reuse or redistribution needs a license decision.", severity: "warning", provenance: "source-fact" });
    }
    if (repo.has_readme === false) {
      risks.push({ text: "No README in the snapshot. Evidence is limited to metadata.", severity: "warning", provenance: "source-fact" });
    } else if (repo.has_readme == null) {
      risks.push({ text: "README presence was not recorded.", severity: "info", provenance: "source-fact" });
    }
    if (repo.private) {
      risks.push({ text: "Private repository. Generated outputs must stay internal and never reach public summaries.", severity: "warning", provenance: "source-fact" });
    }
    if (repo.is_fork) {
      risks.push({ text: "Fork. Confirm the upstream is the right evidence source.", severity: "info", provenance: "source-fact" });
    }
  }
  if (!signal) {
    risks.push({ text: "No derived signal for this repository. Run the data pipeline locally to score it.", severity: "info", provenance: "derived-heuristic" });
  } else if (signal.staleness === "stale") {
    risks.push({ text: "Little recent upstream activity. Maintenance risk is higher.", severity: "warning", provenance: "derived-heuristic" });
  }
  for (const risk of inspection?.risks || []) {
    risks.push({ text: risk, severity: "warning", provenance: "derived-heuristic" });
  }
  risks.push({ text: "Heuristic scores are not findings. Nothing here has been verified against source code by a person.", severity: "info", provenance: "derived-heuristic" });
  return risks;
}

export function formatRelativeDays(iso: string | null | undefined, now: number): string {
  const parsed = Date.parse(String(iso || ""));
  if (!Number.isFinite(parsed) || parsed <= 0) return "not recorded";
  const days = Math.round((now - parsed) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 60) return `${days} days ago`;
  const months = Math.round(days / 30);
  if (months < 24) return `${months} months ago`;
  return `${Math.round(days / 365)} years ago`;
}
