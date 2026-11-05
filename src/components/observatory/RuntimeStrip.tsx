import type { ObservatoryData, ProbeResult } from "../../lib/use-observatory-data";

const PROBE_LABEL: Record<ProbeResult["state"], string> = {
  checking: "Checking",
  live: "Reachable",
  offline: "Unavailable",
  disabled: "Disabled",
};

function Probe({ name, probe }: { name: string; probe: ProbeResult }) {
  return (
    <li className={`vx-probe vx-probe--${probe.state}`} title={probe.detail}>
      <span className="vx-dot" aria-hidden="true" />
      <span className="vx-probe__name">{name}</span>
      <span className="vx-probe__value">{PROBE_LABEL[probe.state]}</span>
    </li>
  );
}

function snapshotText(data: ObservatoryData): { state: string; label: string; detail: string } {
  if (data.loading) return { state: "checking", label: "Loading", detail: "Reading repository snapshots…" };
  if (data.mode === "fixture") {
    return { state: "fixture", label: "Synthetic", detail: data.fixtureLabel || "Synthetic fixture" };
  }
  if (data.overall === "unavailable") return { state: "offline", label: "Unavailable", detail: "No repository snapshot found." };
  if (data.overall === "empty") return { state: "offline", label: "Empty", detail: "Snapshot files are present but empty." };
  if (data.freshness === "stale") {
    return { state: "stale", label: `Stale · ${Math.round(data.ageDays || 0)}d`, detail: `Derived data generated ${data.snapshotAt}. Older than 7 days.` };
  }
  if (data.freshness === "unknown") return { state: "stale", label: "Age unknown", detail: "Derived data has no generation timestamp." };
  return {
    state: data.overall === "partial" ? "stale" : "live",
    label: data.overall === "partial" ? "Partial" : `Fresh · ${Math.round(data.ageDays || 0)}d`,
    detail: data.overall === "partial" ? "Some derived datasets are missing." : `Derived data generated ${data.snapshotAt}.`,
  };
}

export function RuntimeStrip({ data }: { data: ObservatoryData }) {
  const snapshot = snapshotText(data);
  return (
    <section className="vx-strip" aria-label="Data and runtime status">
      <ul className="vx-strip__list">
        <li className={`vx-probe vx-probe--${snapshot.state}`} title={snapshot.detail}>
          <span className="vx-dot" aria-hidden="true" />
          <span className="vx-probe__name">Snapshot</span>
          <span className="vx-probe__value">{snapshot.label}</span>
        </li>
        <Probe name="Gateway" probe={data.probes.gateway} />
        <Probe name="OCR" probe={data.probes.ocr} />
        <Probe name="Action bridge" probe={data.probes.bridge} />
        <li className={`vx-probe vx-probe--${data.runtimeMode === "local" ? "live" : "stale"}`} title={data.runtimeMode === "local" ? "Local-first: Gateway /v1/responses on the Mac." : "External inference is an explicit exception and must be a deliberate choice."}>
          <span className="vx-dot" aria-hidden="true" />
          <span className="vx-probe__name">Inference</span>
          <span className="vx-probe__value">{data.runtimeMode}</span>
        </li>
      </ul>
      <details className="vx-strip__details">
        <summary>Status details</summary>
        <dl>
          <div><dt>Snapshot</dt><dd>{snapshot.detail}</dd></div>
          <div><dt>Gateway</dt><dd>{data.probes.gateway.detail}</dd></div>
          <div><dt>OCR</dt><dd>{data.probes.ocr.detail}</dd></div>
          <div><dt>Action bridge</dt><dd>{data.probes.bridge.detail}</dd></div>
          <div><dt>Inference</dt><dd>{data.runtimeMode === "local" ? "Local-first: Gateway POST /v1/responses." : "External inference mode is selected in Settings. This is an explicit exception, never a silent fallback."}</dd></div>
        </dl>
        <p className="vx-strip__note">Probes are observed from this browser and reflect reachability only.</p>
      </details>
    </section>
  );
}
