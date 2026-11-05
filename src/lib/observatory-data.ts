// Honest dataset loading for the Vega observatory.
//
// Every dataset reports *why* it has the data it has: ready, empty, missing,
// invalid (including the Vite SPA fallback that serves index.html for a missing
// JSON file), or fixture. Synthetic fixtures load only on explicit opt-in.
//
// Pure module (type-only imports) so the logic is testable under Node.

export type DatasetState = "ready" | "empty" | "missing" | "invalid" | "fixture";

export interface DatasetResult<T> {
  state: DatasetState;
  data: T;
  /** Path that produced the data, when one did. */
  source: string | null;
  detail: string;
}

export type FetchLike = (input: string) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export type DatasetShape = "array" | "object";

function emptyValue<T>(shape: DatasetShape): T {
  return (shape === "array" ? [] : null) as T;
}

function looksLikeHtml(contentType: string | null, body: string): boolean {
  if (contentType && contentType.toLowerCase().includes("text/html")) return true;
  return /^\s*</.test(body);
}

/**
 * Tries each candidate path in order. A 404 or HTML fallback on one path does not
 * hide a valid file on a later path; the most informative failure is reported.
 */
export async function loadDataset<T>(
  paths: string[],
  shape: DatasetShape,
  fetchImpl: FetchLike,
): Promise<DatasetResult<T>> {
  let lastFailure: DatasetResult<T> = {
    state: "missing",
    data: emptyValue<T>(shape),
    source: null,
    detail: `Not found at ${paths.join(" or ")}.`,
  };

  for (const path of paths) {
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await fetchImpl(path);
    } catch (error) {
      lastFailure = {
        state: "missing",
        data: emptyValue<T>(shape),
        source: null,
        detail: `Request for ${path} failed: ${error instanceof Error ? error.message : String(error)}.`,
      };
      continue;
    }
    if (!response.ok) {
      if (lastFailure.state !== "invalid") {
        lastFailure = { ...lastFailure, detail: `${path} returned HTTP ${response.status}.` };
      }
      continue;
    }

    const body = await response.text();
    if (looksLikeHtml(response.headers.get("content-type"), body)) {
      lastFailure = {
        state: "missing",
        data: emptyValue<T>(shape),
        source: null,
        detail: `${path} is not present (the server answered with an HTML page instead of JSON).`,
      };
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      lastFailure = { state: "invalid", data: emptyValue<T>(shape), source: path, detail: `${path} is not valid JSON.` };
      continue;
    }

    const shapeOk = shape === "array" ? Array.isArray(parsed) : !!parsed && typeof parsed === "object" && !Array.isArray(parsed);
    if (!shapeOk) {
      lastFailure = { state: "invalid", data: emptyValue<T>(shape), source: path, detail: `${path} has an unexpected shape (expected ${shape}).` };
      continue;
    }

    const isEmpty = shape === "array" ? (parsed as unknown[]).length === 0 : Object.keys(parsed as object).length === 0;
    return {
      state: isEmpty ? "empty" : "ready",
      data: parsed as T,
      source: path,
      detail: isEmpty ? `${path} is present but empty.` : `Loaded from ${path}.`,
    };
  }

  return lastFailure;
}

export type Freshness = "fresh" | "stale" | "unknown";

export const STALE_AFTER_DAYS = 7;

export function snapshotFreshness(generatedAt: string | null | undefined, now: number, maxAgeDays = STALE_AFTER_DAYS): {
  freshness: Freshness;
  ageDays: number | null;
} {
  const parsed = Date.parse(String(generatedAt || ""));
  if (!Number.isFinite(parsed) || parsed <= 0) return { freshness: "unknown", ageDays: null };
  const ageDays = Math.max(0, (now - parsed) / 86_400_000);
  return { freshness: ageDays > maxAgeDays ? "stale" : "fresh", ageDays };
}

export type DataMode = "live" | "fixture";

export function deskSelectionKey(mode: DataMode): string {
  return mode === "fixture" ? "vega-lab:fixture:desk-selection" : "vega-lab:desk-selection";
}

/** Synthetic fixtures are opt-in only: `?fixtures=synthetic`. */
export function requestedDataMode(search: string): DataMode {
  try {
    return new URLSearchParams(search).get("fixtures") === "synthetic" ? "fixture" : "live";
  } catch {
    return "live";
  }
}

export interface DatasetSummary {
  label: string;
  state: DatasetState;
  count: number | null;
  detail: string;
}

export type OverallDataState = "ready" | "partial" | "empty" | "unavailable" | "fixture";

/**
 * Collapses per-dataset states into one honest headline.
 * The primary dataset (repository snapshots) decides whether there is anything to show.
 */
export function summarizeDataState(primary: DatasetSummary[], secondary: DatasetSummary[]): OverallDataState {
  const all = [...primary, ...secondary];
  if (all.length > 0 && all.every((entry) => entry.state === "fixture")) return "fixture";
  const primaryReady = primary.some((entry) => entry.state === "ready");
  if (!primaryReady) {
    return primary.some((entry) => entry.state === "empty") ? "empty" : "unavailable";
  }
  return all.every((entry) => entry.state === "ready") ? "ready" : "partial";
}
