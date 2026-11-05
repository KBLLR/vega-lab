import { useEffect, useMemo, useRef, useState } from "react";
import type { Repo } from "../types";
import { buildAttentionQueue } from "../lib/attention";
import { deskSelectionKey } from "../lib/observatory-data";
import type { DataMode } from "../lib/observatory-data";
import type { ObservatoryData } from "../lib/use-observatory-data";
import { isAcceptedByHuman, presentActionItemStatus } from "../lib/review-status";
import { AttentionQueue } from "./observatory/AttentionQueue";
import type { BandFilter } from "./observatory/AttentionQueue";
import { RepoDossier } from "./observatory/RepoDossier";
import { RuntimeStrip } from "./observatory/RuntimeStrip";

interface ObservatoryDeskProps {
  data: ObservatoryData;
  onPrepareAction: (repo: Repo, prompt: string) => void;
  onOpenReadme: (repo: Repo) => void;
}

function readStoredSelection(mode: DataMode): string | null {
  try {
    return window.localStorage.getItem(deskSelectionKey(mode));
  } catch {
    return null;
  }
}

function DeskUnavailable({ data }: { data: ObservatoryData }) {
  return (
    <section className="vx-unavailable" aria-labelledby="vx-unavailable-title">
      <p className="vx-eyebrow">{data.overall === "empty" ? "Empty snapshot" : "No repository snapshot"}</p>
      <h2 id="vx-unavailable-title" className="vx-h2">Nothing to observe yet</h2>
      <p className="vx-body">
        Vega reads repository snapshots and derived intelligence from <code>public/*.json</code>. None were found,
        so this view shows no repositories, scores, or findings rather than guessing.
      </p>
      <table className="vx-table">
        <caption className="vx-sr-only">Dataset status</caption>
        <thead><tr><th scope="col">Dataset</th><th scope="col">State</th><th scope="col">Detail</th></tr></thead>
        <tbody>
          {data.datasets.map((dataset) => (
            <tr key={dataset.label}>
              <td>{dataset.label}</td>
              <td><span className={`vx-state vx-state--${dataset.state}`}>{dataset.state}</span></td>
              <td>{dataset.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="vx-unavailable__paths">
        <div>
          <h3 className="vx-mini-label">On David's Mac</h3>
          <p className="vx-body-sm">Refresh snapshots with the documented, credentialed pipeline (requires a GitHub token; not run in cloud previews):</p>
          <pre className="vx-pre">pnpm run build:data{"\n"}pnpm run sync:mine{"\n"}pnpm run generate:stats</pre>
        </div>
        <div>
          <h3 className="vx-mini-label">Cloud preview</h3>
          <p className="vx-body-sm">Explore the interface with invented repositories that run through the real house-model pipeline. Clearly labeled; never mixed with real data.</p>
          <a className="vx-button vx-button--ghost" href="?fixtures=synthetic">Open synthetic preview</a>
        </div>
      </div>
    </section>
  );
}

export function ObservatoryDesk({ data, onPrepareAction, onOpenReadme }: ObservatoryDeskProps) {
  const [band, setBand] = useState<BandFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedNwo, setSelectedNwo] = useState<string | null>(() => readStoredSelection(data.mode));
  const dossierRef = useRef<HTMLDivElement>(null);

  // On stacked (tablet) layouts the dossier sits below the queue: bring it into view on click.
  const handleSelect = (nwo: string, activated: boolean) => {
    setSelectedNwo(nwo);
    if (!activated || !window.matchMedia("(max-width: 1023px)").matches) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.requestAnimationFrame(() => {
      dossierRef.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      dossierRef.current?.focus({ preventScroll: true });
    });
  };

  const entries = useMemo(() => buildAttentionQueue({
    starred: data.starred,
    mine: data.mine,
    signals: data.signals,
    queue: data.queue,
    actionItems: data.actionItems,
    runs: data.runs,
    mineHealth: data.mineHealth,
  }), [data.actionItems, data.mine, data.mineHealth, data.queue, data.runs, data.signals, data.starred]);

  const selected = entries.find((entry) => entry.nwo === selectedNwo) || entries[0] || null;

  useEffect(() => {
    if (!selected) return;
    try {
      window.localStorage.setItem(deskSelectionKey(data.mode), selected.nwo);
    } catch {
      // per-viewer convenience only
    }
  }, [data.mode, selected]);

  const extraction = useMemo(
    () => (selected ? data.extractions.find((item) => item.nwo.toLowerCase() === selected.nwo.toLowerCase()) || null : null),
    [data.extractions, selected],
  );
  const inspection = useMemo(
    () => (selected ? data.inspections.find((item) => item.nwo.toLowerCase() === selected.nwo.toLowerCase()) || null : null),
    [data.inspections, selected],
  );

  const totals = useMemo(() => {
    const decide = entries.filter((entry) => entry.band === "decide").length;
    const research = data.queue.filter((item) => item.status === "queued" || item.status === "researching").length;
    const drafts = data.actionItems.filter((item) => item.status === "open").length;
    const accepted = data.actionItems.filter((item) => isAcceptedByHuman(presentActionItemStatus(item.status))).length;
    return { decide, research, drafts, accepted };
  }, [data.actionItems, data.queue, entries]);

  const now = data.mode === "fixture" && data.snapshotAt ? Date.parse(data.snapshotAt) : Date.now();
  const actionsDisabledReason = data.mode === "fixture"
    ? "Synthetic preview: actions are disabled. Nothing can be queued, written, or sent."
    : null;

  return (
    <div className="vx-desk">
      <RuntimeStrip data={data} />

      {data.loading ? (
        <p className="vx-loading" role="status">Reading repository snapshots…</p>
      ) : data.overall === "unavailable" || data.overall === "empty" ? (
        <DeskUnavailable data={data} />
      ) : (
        <>
          <section className="vx-summary" aria-label="Observatory summary">
            <div className="vx-summary__intro">
              <p className="vx-eyebrow">Observatory desk</p>
              <h1 className="vx-h1">What deserves attention</h1>
              <p className="vx-body-sm">
                Repositories ranked by open review work, research state, blocked actions and heuristic fit.
                Facts, heuristics and drafts are labeled separately; only a person can accept.
              </p>
            </div>
            <dl className="vx-summary__stats">
              <div><dt>Needs decision</dt><dd>{totals.decide}</dd></div>
              <div><dt>In research</dt><dd>{totals.research}</dd></div>
              <div><dt>Draft actions</dt><dd>{totals.drafts}</dd></div>
              <div><dt>Accepted by a person</dt><dd>{totals.accepted}</dd></div>
            </dl>
          </section>

          {data.overall === "partial" ? (
            <p className="vx-notice" role="note">
              Some derived datasets are missing ({data.datasets.filter((d) => d.state !== "ready").map((d) => d.label).join(", ")}). Rankings use what is available.
            </p>
          ) : null}

          <div className="vx-desk__layout">
            <AttentionQueue
              entries={entries}
              selectedNwo={selected?.nwo || null}
              onSelect={handleSelect}
              band={band}
              onBandChange={setBand}
              query={query}
              onQueryChange={setQuery}
            />
            <div className="vx-desk__detail" ref={dossierRef} tabIndex={-1}>
            {selected ? (
              <RepoDossier
                key={selected.nwo}
                entry={selected}
                extraction={extraction}
                inspection={inspection}
                now={now}
                actionsDisabledReason={actionsDisabledReason}
                onPrepareAction={onPrepareAction}
                onOpenReadme={onOpenReadme}
              />
            ) : (
              <section className="vx-panel vx-dossier--empty">
                <p className="vx-body">Select a repository to see its evidence, drafts, and next step.</p>
              </section>
            )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
