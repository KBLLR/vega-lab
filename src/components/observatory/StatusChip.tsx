import type { ProvenanceClass, StatusPresentation } from "../../lib/review-status";
import { PROVENANCE_LABELS } from "../../lib/review-status";

/** Status = small dot + text label. Color never carries meaning on its own. */
export function StatusChip({ presentation, compact = false }: { presentation: StatusPresentation; compact?: boolean }) {
  return (
    <span
      className={`vx-chip vx-chip--${presentation.status} vx-tone--${presentation.tone}${compact ? " vx-chip--compact" : ""}`}
      title={presentation.description}
    >
      <span className="vx-dot" aria-hidden="true" />
      <span>{presentation.label}</span>
      {presentation.isHumanDecision ? <span className="vx-sr-only"> (human decision)</span> : null}
    </span>
  );
}

/** Labels where a piece of information comes from. */
export function ProvenanceTag({ kind }: { kind: ProvenanceClass }) {
  const meta = PROVENANCE_LABELS[kind];
  return (
    <span className={`vx-prov vx-prov--${kind}`} title={meta.description}>
      {meta.label}
    </span>
  );
}
