import { startTransition, useCallback, useEffect, useMemo, useState } from "react";
import type {
  ActionItem,
  LanguageGroup,
  MineHealthRecord,
  OpsDigest,
  Repo,
  RepoInspection,
  RepoSignal,
  ResearchQueueItem,
  SkillExtraction,
  VegaActionResult,
  WeeklyResearchReview,
} from "../types";
import {
  loadDataset,
  requestedDataMode,
  snapshotFreshness,
  summarizeDataState,
} from "./observatory-data";
import type {
  DataMode,
  DatasetResult,
  DatasetState,
  DatasetSummary,
  FetchLike,
  Freshness,
  OverallDataState,
} from "./observatory-data";
import { fetchVegaActionRuns } from "./action-bridge";
import { fetchRuntimeHealth } from "./runtime-client";
import { loadRuntimeSettings, resolveRuntimeTarget, SETTINGS_EVENT } from "./settings";

export type ProbeState = "checking" | "live" | "offline" | "disabled";

export interface ProbeResult {
  state: ProbeState;
  detail: string;
}

export interface ObservatoryData {
  mode: DataMode;
  loading: boolean;
  fixtureLabel: string | null;
  starred: Repo[];
  mine: Repo[];
  signals: RepoSignal[];
  queue: ResearchQueueItem[];
  extractions: SkillExtraction[];
  inspections: RepoInspection[];
  mineHealth: MineHealthRecord[];
  actionItems: ActionItem[];
  opsDigest: OpsDigest | null;
  weeklyReview: WeeklyResearchReview | null;
  runs: VegaActionResult[];
  datasets: DatasetSummary[];
  overall: OverallDataState;
  snapshotAt: string | null;
  freshness: Freshness;
  ageDays: number | null;
  probes: { gateway: ProbeResult; ocr: ProbeResult; bridge: ProbeResult };
  runtimeMode: string;
  reload: () => void;
  refreshDerived: () => void;
}

const browserFetch: FetchLike = async (input) => {
  const response = await fetch(input, { headers: { Accept: "application/json" } });
  return {
    ok: response.ok,
    status: response.status,
    headers: { get: (name: string) => response.headers.get(name) },
    text: () => response.text(),
  };
};

function normalizeRepos(value: unknown): Repo[] {
  if (!Array.isArray(value)) return [];
  if (value.length === 0 || (value[0] && typeof value[0] === "object" && "name" in value[0])) return value as Repo[];
  return (value as LanguageGroup[]).flatMap((group) => group.repos || []);
}

function summary<T>(label: string, result: DatasetResult<T>): DatasetSummary {
  const count = Array.isArray(result.data) ? result.data.length : result.data ? 1 : null;
  return { label, state: result.state, count: result.state === "missing" || result.state === "invalid" ? null : count, detail: result.detail };
}

interface DerivedState {
  signals: RepoSignal[];
  queue: ResearchQueueItem[];
  extractions: SkillExtraction[];
  inspections: RepoInspection[];
  mineHealth: MineHealthRecord[];
  actionItems: ActionItem[];
  opsDigest: OpsDigest | null;
  weeklyReview: WeeklyResearchReview | null;
  summaries: DatasetSummary[];
}

const EMPTY_DERIVED: DerivedState = {
  signals: [], queue: [], extractions: [], inspections: [], mineHealth: [], actionItems: [],
  opsDigest: null, weeklyReview: null, summaries: [],
};

async function loadDerived(): Promise<DerivedState> {
  const [signals, queue, extractions, inspections, mineHealth, actionItems, opsDigest, weeklyReview] = await Promise.all([
    loadDataset<RepoSignal[]>(["/repo-signals.json", "/data/repo-signals.json"], "array", browserFetch),
    loadDataset<ResearchQueueItem[]>(["/research-queue.json", "/data/research-queue.json"], "array", browserFetch),
    loadDataset<SkillExtraction[]>(["/skill-extractions.json", "/data/skill-extractions.json"], "array", browserFetch),
    loadDataset<RepoInspection[]>(["/repo-inspections.json", "/data/repo-inspections.json"], "array", browserFetch),
    loadDataset<MineHealthRecord[]>(["/mine-health.json", "/data/mine-health.json"], "array", browserFetch),
    loadDataset<ActionItem[]>(["/action-items.json", "/data/action-items.json"], "array", browserFetch),
    loadDataset<OpsDigest>(["/ops-digest.json", "/data/ops-digest.json"], "object", browserFetch),
    loadDataset<WeeklyResearchReview>(["/weekly-research-review.json", "/data/weekly-research-review.json"], "object", browserFetch),
  ]);
  return {
    signals: signals.data,
    queue: queue.data,
    extractions: extractions.data,
    inspections: inspections.data,
    mineHealth: mineHealth.data,
    actionItems: actionItems.data,
    opsDigest: opsDigest.data,
    weeklyReview: weeklyReview.data,
    summaries: [
      summary("Repo signals", signals),
      summary("Research queue", queue),
      summary("Skill extractions", extractions),
      summary("Repo inspections", inspections),
      summary("Mine health", mineHealth),
      summary("Action items", actionItems),
      summary("Ops digest", opsDigest),
      summary("Weekly research review", weeklyReview),
    ],
  };
}

interface FixturePayload {
  meta: { label: string; clock_anchor: string };
  starredRepos: Repo[];
  myRepos: Repo[];
  repoSignals: RepoSignal[];
  researchQueue: ResearchQueueItem[];
  skillExtractions: SkillExtraction[];
  repoInspections: RepoInspection[];
  mineHealth: MineHealthRecord[];
  actionItems: ActionItem[];
  opsDigest: OpsDigest;
  weeklyResearchReview: WeeklyResearchReview;
  actionRuns: VegaActionResult[];
}

function fixtureSummary(label: string, count: number): DatasetSummary {
  return { label, state: "fixture" as DatasetState, count, detail: "Synthetic fixture (tests/fixtures/synthetic-observatory)." };
}

export function useObservatoryData(): ObservatoryData {
  const mode = useMemo(() => requestedDataMode(typeof window === "undefined" ? "" : window.location.search), []);
  const [loading, setLoading] = useState(true);
  const [fixtureLabel, setFixtureLabel] = useState<string | null>(null);
  const [starred, setStarred] = useState<Repo[]>([]);
  const [mine, setMine] = useState<Repo[]>([]);
  const [primarySummaries, setPrimarySummaries] = useState<DatasetSummary[]>([]);
  const [derived, setDerived] = useState<DerivedState>(EMPTY_DERIVED);
  const [runs, setRuns] = useState<VegaActionResult[]>([]);
  const [fixtureAnchor, setFixtureAnchor] = useState<string | null>(null);
  const [bridge, setBridge] = useState<ProbeResult>({ state: "checking", detail: "Checking local action bridge…" });
  const [gateway, setGateway] = useState<ProbeResult>({ state: "checking", detail: "Probing Gateway…" });
  const [ocr, setOcr] = useState<ProbeResult>({ state: "checking", detail: "Probing OCR…" });
  const [runtimeTarget, setRuntimeTarget] = useState(() => resolveRuntimeTarget(loadRuntimeSettings()));
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const apply = () => setRuntimeTarget(resolveRuntimeTarget(loadRuntimeSettings()));
    window.addEventListener(SETTINGS_EVENT, apply);
    return () => window.removeEventListener(SETTINGS_EVENT, apply);
  }, []);

  const refreshRuns = useCallback(() => {
    if (mode === "fixture") return;
    fetchVegaActionRuns()
      .then((next) => {
        setRuns(next);
        setBridge({ state: "live", detail: `Local action bridge reachable · ${next.length} durable receipts.` });
      })
      .catch((error: Error) => {
        setRuns([]);
        setBridge({ state: "offline", detail: `Action bridge unavailable (${error.message}). It runs only in local Vite dev/preview.` });
      });
  }, [mode]);

  const refreshDerived = useCallback(() => {
    if (mode === "fixture") return;
    void loadDerived().then((next) => startTransition(() => setDerived(next)));
    refreshRuns();
  }, [mode, refreshRuns]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    if (mode === "fixture") {
      import("../../tests/fixtures/synthetic-observatory/observatory.json")
        .then((module) => {
          if (cancelled) return;
          const payload = (module.default || module) as unknown as FixturePayload;
          startTransition(() => {
            setFixtureLabel(payload.meta.label);
            setFixtureAnchor(payload.meta.clock_anchor);
            setStarred(payload.starredRepos);
            setMine(payload.myRepos);
            setPrimarySummaries([
              fixtureSummary("Starred snapshot", payload.starredRepos.length),
              fixtureSummary("Owned snapshot", payload.myRepos.length),
            ]);
            setDerived({
              signals: payload.repoSignals,
              queue: payload.researchQueue,
              extractions: payload.skillExtractions,
              inspections: payload.repoInspections,
              mineHealth: payload.mineHealth,
              actionItems: payload.actionItems,
              opsDigest: payload.opsDigest,
              weeklyReview: payload.weeklyResearchReview,
              summaries: [
                fixtureSummary("Repo signals", payload.repoSignals.length),
                fixtureSummary("Research queue", payload.researchQueue.length),
                fixtureSummary("Action items", payload.actionItems.length),
              ],
            });
            setRuns(payload.actionRuns);
            setBridge({ state: "disabled", detail: "Synthetic preview: the action bridge is not called and no action can run." });
            setLoading(false);
          });
        })
        .catch((error: Error) => {
          if (cancelled) return;
          setFixtureLabel(`Synthetic fixture failed to load: ${error.message}`);
          setLoading(false);
        });
      return () => { cancelled = true; };
    }

    Promise.all([
      loadDataset<unknown>(["/data.json", "/data/data.json"], "array", browserFetch),
      loadDataset<unknown>(["/my-repos.json", "/data/my-repos.json", "/data/owned-repos.json"], "array", browserFetch),
      loadDerived(),
    ]).then(([starredResult, mineResult, derivedResult]) => {
      if (cancelled) return;
      startTransition(() => {
        setStarred(normalizeRepos(starredResult.data));
        setMine(normalizeRepos(mineResult.data));
        setPrimarySummaries([summary("Starred snapshot", starredResult), summary("Owned snapshot", mineResult)]);
        setDerived(derivedResult);
        setLoading(false);
      });
    });
    refreshRuns();
    return () => { cancelled = true; };
  }, [mode, refreshRuns, reloadToken]);

  // Runtime probes are real in both modes: fixtures never fake service health.
  useEffect(() => {
    let cancelled = false;
    setGateway({ state: "checking", detail: "Probing Gateway…" });
    setOcr({ state: "checking", detail: "Probing OCR…" });
    fetchRuntimeHealth(runtimeTarget.busUrl)
      .then((health) => {
        if (cancelled) return;
        setGateway({
          state: health.status === "live" ? "live" : "offline",
          detail: `${health.detail}${health.model ? ` · model ${health.model}` : ""}`,
        });
      })
      .catch((error: Error) => !cancelled && setGateway({ state: "offline", detail: error.message }));
    fetch(`${runtimeTarget.busUrl}/v1/ocr/health`, { headers: { Accept: "application/json" } })
      .then(async (response) => {
        const text = await response.text();
        if (cancelled) return;
        if (!response.ok || /^\s*</.test(text)) {
          setOcr({ state: "offline", detail: `${runtimeTarget.busUrl}/v1/ocr/health unavailable (HTTP ${response.status}).` });
          return;
        }
        setOcr({ state: "live", detail: `${runtimeTarget.busUrl}/v1/ocr/health reachable. Used for visual/PDF evidence only.` });
      })
      .catch((error: Error) => !cancelled && setOcr({ state: "offline", detail: error.message }));
    return () => { cancelled = true; };
  }, [runtimeTarget.busUrl, reloadToken]);

  const datasets = useMemo(() => [...primarySummaries, ...derived.summaries], [derived.summaries, primarySummaries]);
  const overall = useMemo(() => summarizeDataState(primarySummaries, derived.summaries), [derived.summaries, primarySummaries]);
  const snapshotAt = derived.opsDigest?.generatedAt || derived.weeklyReview?.generatedAt || null;
  const now = mode === "fixture" && fixtureAnchor ? Date.parse(fixtureAnchor) : Date.now();
  const { freshness, ageDays } = snapshotFreshness(snapshotAt, now);

  return {
    mode,
    loading,
    fixtureLabel,
    starred,
    mine,
    signals: derived.signals,
    queue: derived.queue,
    extractions: derived.extractions,
    inspections: derived.inspections,
    mineHealth: derived.mineHealth,
    actionItems: derived.actionItems,
    opsDigest: derived.opsDigest,
    weeklyReview: derived.weeklyReview,
    runs,
    datasets,
    overall,
    snapshotAt,
    freshness,
    ageDays,
    probes: { gateway, ocr, bridge },
    runtimeMode: runtimeTarget.mode === "inference" ? `inference (${runtimeTarget.provider})` : "local",
    reload: () => setReloadToken((value) => value + 1),
    refreshDerived,
  };
}
