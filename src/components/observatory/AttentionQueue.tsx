import { useMemo, useRef } from "react";
import type { KeyboardEvent } from "react";
import { Lock } from "lucide-react";
import type { AttentionBand, AttentionEntry } from "../../lib/attention";
import { presentResearchStatus } from "../../lib/review-status";
import { StatusChip } from "./StatusChip";

export type BandFilter = "all" | AttentionBand;

const BAND_LABELS: Record<AttentionBand, string> = {
  decide: "Needs decision",
  research: "Research only",
  watch: "Watching",
};

const SOURCE_LABELS: Record<AttentionEntry["source"], string> = {
  owned: "Owned",
  starred: "Starred",
  research: "Research only",
};

interface AttentionQueueProps {
  entries: AttentionEntry[];
  selectedNwo: string | null;
  /** `activated` is true for click/Enter, false for arrow-key browsing. */
  onSelect: (nwo: string, activated: boolean) => void;
  band: BandFilter;
  onBandChange: (band: BandFilter) => void;
  query: string;
  onQueryChange: (query: string) => void;
}

export function AttentionQueue({ entries, selectedNwo, onSelect, band, onBandChange, query, onQueryChange }: AttentionQueueProps) {
  const listRef = useRef<HTMLOListElement>(null);
  const counts = useMemo(() => {
    const next: Record<BandFilter, number> = { all: entries.length, decide: 0, research: 0, watch: 0 };
    for (const entry of entries) next[entry.band] += 1;
    return next;
  }, [entries]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries.filter((entry) => (band === "all" || entry.band === band)
      && (!needle
        || entry.nwo.toLowerCase().includes(needle)
        || (entry.repo?.description || "").toLowerCase().includes(needle)
        || (entry.repo?.topics || []).some((topic) => topic.toLowerCase().includes(needle))));
  }, [band, entries, query]);

  // Arrow keys move through the queue (roving focus); Enter/Space select via the button.
  const handleKeyDown = (event: KeyboardEvent<HTMLOListElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-nwo]") || []);
    if (buttons.length === 0) return;
    event.preventDefault();
    const current = buttons.findIndex((button) => button === document.activeElement);
    let next = current;
    if (event.key === "ArrowDown") next = Math.min(buttons.length - 1, current + 1);
    if (event.key === "ArrowUp") next = Math.max(0, current - 1);
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = buttons.length - 1;
    buttons[next]?.focus();
    const nwo = buttons[next]?.dataset.nwo;
    if (nwo) onSelect(nwo, false);
  };

  return (
    <section className="vx-queue" aria-labelledby="vx-queue-title">
      <header className="vx-queue__header">
        <h2 id="vx-queue-title" className="vx-section-label">Attention queue</h2>
        <span className="vx-meta">{visible.length} of {entries.length}</span>
      </header>

      <div className="vx-segmented" role="group" aria-label="Filter by attention band">
        {(["all", "decide", "research", "watch"] as BandFilter[]).map((option) => (
          <button
            key={option}
            type="button"
            className="vx-segmented__item"
            aria-pressed={band === option}
            onClick={() => onBandChange(option)}
          >
            {option === "all" ? "All" : BAND_LABELS[option]} <span className="vx-count">{counts[option]}</span>
          </button>
        ))}
      </div>

      <label className="vx-field">
        <span className="vx-sr-only">Search the attention queue</span>
        <input
          type="search"
          value={query}
          placeholder="Search name, topic, description"
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </label>

      {visible.length === 0 ? (
        <p className="vx-empty-inline">
          {entries.length === 0
            ? "Nothing needs attention: no open drafts, queued research, blocked actions, or high-fit signals."
            : "No repositories match this filter."}
        </p>
      ) : (
        <ol className="vx-queue__list" ref={listRef} onKeyDown={handleKeyDown} aria-label="Repositories ranked by attention">
          {visible.map((entry, index) => {
            const selected = entry.nwo === selectedNwo;
            return (
              <li key={entry.nwo}>
                <button
                  type="button"
                  data-nwo={entry.nwo}
                  className={`vx-queue__item${selected ? " is-selected" : ""}`}
                  aria-current={selected ? "true" : undefined}
                  tabIndex={selected || (!selectedNwo && index === 0) ? 0 : -1}
                  onClick={() => onSelect(entry.nwo, true)}
                >
                  <span className="vx-queue__rank" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                  <span className="vx-queue__body">
                    <span className="vx-queue__title">
                      {entry.repo?.name || entry.nwo.split("/")[1] || entry.nwo}
                      {entry.visibility === "private" ? <Lock size={12} aria-label="Private repository" /> : null}
                    </span>
                    <span className="vx-queue__owner">{entry.nwo.split("/")[0]} · {SOURCE_LABELS[entry.source]}</span>
                    <span className="vx-queue__next">
                      <span className="vx-queue__arrow" aria-hidden="true">→</span> {entry.nextStep.label}
                    </span>
                    <span className="vx-queue__chips">
                      <span className={`vx-band vx-band--${entry.band}`}>{BAND_LABELS[entry.band]}</span>
                      {entry.queueItem ? <StatusChip presentation={presentResearchStatus(entry.queueItem.status)} compact /> : null}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
      <p className="vx-queue__legend">
        Ranked by blocked actions, drafts in review, research state, and the house-model heuristic. Arrow keys move through the list.
      </p>
    </section>
  );
}
