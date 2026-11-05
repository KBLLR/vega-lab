import type { VegaActionResult } from "../types";

/** Read only the candidate already embedded in a receipt; never fetch a private path. */
export function candidateReceipts(runs: VegaActionResult[], nwo: string) {
  const seen = new Set<string>();
  return runs.flatMap((run) => {
    if (!["candidate.build", "candidate.validate"].includes(run.action_kind)) return [];
    if (!run.repo?.nwo || run.repo.nwo.toLowerCase() !== nwo.toLowerCase()) return [];
    const result = run.result;
    if (!result || typeof result !== "object" || Array.isArray(result)) return [];
    const record = result as Record<string, unknown>;
    const value = record.candidate;
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const candidate = value as Record<string, unknown>;
    const source = candidate.source_repository as Record<string, unknown> | undefined;
    if (candidate.schema_version !== "corex.vega-skill-candidate.v1" ||
        typeof candidate.candidate_id !== "string" || typeof candidate.content_checksum !== "string" ||
        !source || typeof source.nwo !== "string" || source.nwo.toLowerCase() !== nwo.toLowerCase()) return [];
    const key = `${candidate.candidate_id}:${candidate.content_checksum}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const snapshot = candidate.source_snapshot_identity as Record<string, unknown> | undefined;
    const validation = record.validation as Record<string, unknown> | undefined;
    const stringValue = (v: unknown) => typeof v === "string" && v ? v : "Not recorded";
    return [{ id: candidate.candidate_id, checksum: candidate.content_checksum,
      name: stringValue(candidate.name), description: stringValue(candidate.description),
      evidence: stringValue(candidate.evidence_summary), snapshot: stringValue(snapshot?.snapshot_id),
      sourceRef: stringValue(snapshot?.source_ref),
      provenance: Array.isArray(candidate.provenance_references) ? candidate.provenance_references.filter((v): v is string => typeof v === "string") : [],
      validation: validation?.valid === true ? "Receipt reports valid" : validation?.valid === false ? "Receipt reports invalid" : "Not recorded",
      runId: run.run_id }];
  });
}
