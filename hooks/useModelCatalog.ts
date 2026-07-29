"use client";

/**
 * Shared browser model-catalog resource for Chat + Settings.
 *
 * One module-level generation + single-flight fetch for `/api/models`.
 * Subscribers share the same in-flight Promise + AbortController; unmount
 * does not abort a flight still needed by other subscribers. Explicit
 * invalidate / force refresh advances generation, aborts the superseded
 * request, and keeps a generation guard so late responses cannot overwrite
 * newer catalog state.
 */

import { useCallback, useEffect, useSyncExternalStore } from "react";

export type ModelCatalogModelListItem = {
  id: string;
  name: string;
  provider: string;
  providerDisplayName?: string;
};

export type ModelCatalogPayload = {
  models: Record<string, string>;
  modelList: ModelCatalogModelListItem[];
  defaultModel: { provider: string; modelId: string } | null;
  thinkingLevels: Record<string, string[]>;
  thinkingLevelMaps: Record<string, Record<string, string | null>>;
};

export type ModelCatalogStatus = "idle" | "loading" | "ready" | "error";

export type ModelCatalogSnapshot = {
  status: ModelCatalogStatus;
  /** Monotonic client generation; advanced by invalidate / force refresh. */
  generation: number;
  /** Generation that produced `data` (may lag after invalidate). */
  dataGeneration: number | null;
  /** Last successfully parsed catalog (retained across errors). */
  data: ModelCatalogPayload | null;
  error: string | null;
  /** True while a fetch for the current generation is in flight. */
  inflight: boolean;
};

type Inflight = {
  generation: number;
  promise: Promise<void>;
  controller: AbortController;
};

const EMPTY_SNAPSHOT: ModelCatalogSnapshot = {
  status: "idle",
  generation: 0,
  dataGeneration: null,
  data: null,
  error: null,
  inflight: false,
};

/** Stable empties so consumers can put modelList/models in effect deps safely. */
const EMPTY_MODELS: Record<string, string> = {};
const EMPTY_MODEL_LIST: ModelCatalogModelListItem[] = [];
const EMPTY_THINKING_LEVELS: Record<string, string[]> = {};
const EMPTY_THINKING_LEVEL_MAPS: Record<string, Record<string, string | null>> = {};

const listeners = new Set<() => void>();
let snapshot: ModelCatalogSnapshot = EMPTY_SNAPSHOT;
let clientGeneration = 0;
let inflight: Inflight | null = null;
/** Optional fetch override for tests (defaults to global fetch). */
let fetchImpl: typeof fetch | null = null;
/** Test-only: count of abort() calls on superseded catalog flights. */
let abortCountForTests = 0;

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: unknown }).name;
  return name === "AbortError";
}

/** Abort any in-flight shared fetch for a superseded generation. */
function abortInflight(reason: string): void {
  const current = inflight;
  if (!current) return;
  inflight = null;
  try {
    if (!current.controller.signal.aborted) {
      abortCountForTests += 1;
      current.controller.abort(reason);
    }
  } catch {
    // AbortController.abort is non-throwing in modern runtimes; ignore edge hosts.
  }
}

function emit(next: ModelCatalogSnapshot): void {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ModelCatalogSnapshot {
  return snapshot;
}

function getServerSnapshot(): ModelCatalogSnapshot {
  return EMPTY_SNAPSHOT;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneStringRecord(source: Record<string, string>): Record<string, string> {
  return { ...source };
}

function cloneThinkingLevels(
  source: Record<string, string[]>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, levels] of Object.entries(source)) {
    out[key] = [...levels];
  }
  return out;
}

function cloneThinkingLevelMaps(
  source: Record<string, Record<string, string | null>>,
): Record<string, Record<string, string | null>> {
  const out: Record<string, Record<string, string | null>> = {};
  for (const [key, map] of Object.entries(source)) {
    out[key] = { ...map };
  }
  return out;
}

function clonePayload(payload: ModelCatalogPayload): ModelCatalogPayload {
  return {
    models: cloneStringRecord(payload.models),
    modelList: payload.modelList.map((item) => ({ ...item })),
    defaultModel: payload.defaultModel
      ? { provider: payload.defaultModel.provider, modelId: payload.defaultModel.modelId }
      : null,
    thinkingLevels: cloneThinkingLevels(payload.thinkingLevels),
    thinkingLevelMaps: cloneThinkingLevelMaps(payload.thinkingLevelMaps),
  };
}

function parseModelListItem(value: unknown): ModelCatalogModelListItem | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || typeof value.name !== "string" || typeof value.provider !== "string") {
    return null;
  }
  const item: ModelCatalogModelListItem = {
    id: value.id,
    name: value.name,
    provider: value.provider,
  };
  if (typeof value.providerDisplayName === "string" && value.providerDisplayName.trim()) {
    item.providerDisplayName = value.providerDisplayName;
  }
  return item;
}

function parseStringArrayRecord(value: unknown): Record<string, string[]> {
  if (!isRecord(value)) return {};
  const out: Record<string, string[]> = {};
  for (const [key, levels] of Object.entries(value)) {
    if (!Array.isArray(levels)) continue;
    const cleaned = levels.filter((level): level is string => typeof level === "string");
    out[key] = cleaned;
  }
  return out;
}

function parseThinkingLevelMaps(
  value: unknown,
): Record<string, Record<string, string | null>> {
  if (!isRecord(value)) return {};
  const out: Record<string, Record<string, string | null>> = {};
  for (const [key, map] of Object.entries(value)) {
    if (!isRecord(map)) continue;
    const entry: Record<string, string | null> = {};
    for (const [from, to] of Object.entries(map)) {
      if (to === null || typeof to === "string") entry[from] = to;
    }
    out[key] = entry;
  }
  return out;
}

/**
 * Validate `/api/models` JSON into a catalog payload.
 * Requires `models` object; other fields default to empty/null when missing.
 */
export function parseModelCatalogPayload(raw: unknown): ModelCatalogPayload | null {
  if (!isRecord(raw)) return null;
  if (!isRecord(raw.models)) return null;

  const models: Record<string, string> = {};
  for (const [id, name] of Object.entries(raw.models)) {
    if (typeof name === "string") models[id] = name;
  }

  const modelList: ModelCatalogModelListItem[] = [];
  if (Array.isArray(raw.modelList)) {
    for (const item of raw.modelList) {
      const parsed = parseModelListItem(item);
      if (parsed) modelList.push(parsed);
    }
  }

  let defaultModel: ModelCatalogPayload["defaultModel"] = null;
  if (raw.defaultModel !== null && raw.defaultModel !== undefined) {
    if (!isRecord(raw.defaultModel)) return null;
    if (typeof raw.defaultModel.provider !== "string" || typeof raw.defaultModel.modelId !== "string") {
      return null;
    }
    defaultModel = {
      provider: raw.defaultModel.provider,
      modelId: raw.defaultModel.modelId,
    };
  }

  return {
    models,
    modelList,
    defaultModel,
    thinkingLevels: parseStringArrayRecord(raw.thinkingLevels),
    thinkingLevelMaps: parseThinkingLevelMaps(raw.thinkingLevelMaps),
  };
}

function notifyLoading(generation: number): void {
  emit({
    status: "loading",
    generation,
    dataGeneration: snapshot.dataGeneration,
    data: snapshot.data,
    error: null,
    inflight: true,
  });
}

async function runFetch(generation: number, controller: AbortController): Promise<void> {
  const doFetch = fetchImpl ?? fetch;
  try {
    const res = await doFetch("/api/models", {
      cache: "no-store",
      signal: controller.signal,
    });
    // Generation guard: a newer invalidate must ignore this response entirely.
    if (generation !== clientGeneration || controller.signal.aborted) return;

    let raw: unknown;
    try {
      raw = await res.json();
    } catch {
      raw = null;
    }
    if (generation !== clientGeneration || controller.signal.aborted) return;

    if (!res.ok) {
      const message =
        isRecord(raw) && typeof raw.error === "string" && raw.error.trim()
          ? raw.error
          : `HTTP ${res.status}`;
      emit({
        status: "error",
        generation,
        dataGeneration: snapshot.dataGeneration,
        data: snapshot.data,
        error: message,
        inflight: false,
      });
      return;
    }

    if (isRecord(raw) && typeof raw.error === "string" && raw.error.trim()) {
      emit({
        status: "error",
        generation,
        dataGeneration: snapshot.dataGeneration,
        data: snapshot.data,
        error: raw.error,
        inflight: false,
      });
      return;
    }

    const parsed = parseModelCatalogPayload(raw);
    if (!parsed) {
      emit({
        status: "error",
        generation,
        dataGeneration: snapshot.dataGeneration,
        data: snapshot.data,
        error: "invalid_model_catalog",
        inflight: false,
      });
      return;
    }

    emit({
      status: "ready",
      generation,
      dataGeneration: generation,
      data: clonePayload(parsed),
      error: null,
      inflight: false,
    });
  } catch (err) {
    // Superseded flights are aborted on invalidate; never surface AbortError as catalog error.
    if (generation !== clientGeneration || controller.signal.aborted || isAbortError(err)) {
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    emit({
      status: "error",
      generation,
      dataGeneration: snapshot.dataGeneration,
      data: snapshot.data,
      error: message || "model_catalog_fetch_failed",
      inflight: false,
    });
  } finally {
    if (inflight?.generation === generation) {
      inflight = null;
    }
    // If a newer generation is waiting without an owner, the next ensure will start it.
  }
}

/**
 * Ensure a catalog fetch for the current generation.
 * Concurrent callers share one Promise; ready data for the current generation is a no-op.
 */
export function ensureModelCatalog(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }

  // Only skip network when data was produced for the current generation.
  // After invalidate, data may still be last-good but dataGeneration lags.
  if (
    snapshot.generation === clientGeneration &&
    snapshot.dataGeneration === clientGeneration &&
    snapshot.status === "ready" &&
    snapshot.data &&
    !snapshot.inflight
  ) {
    return Promise.resolve();
  }

  if (inflight && inflight.generation === clientGeneration) {
    return inflight.promise;
  }

  // A leftover flight for an older generation should not stay attached.
  if (inflight && inflight.generation !== clientGeneration) {
    abortInflight("model_catalog_generation_superseded");
  }

  const generation = clientGeneration;
  const controller = new AbortController();
  notifyLoading(generation);
  const promise = runFetch(generation, controller);
  inflight = { generation, promise, controller };
  return promise;
}

/**
 * Advance generation so the next ensure/refresh loads a new catalog.
 * Keeps last-good data; does not start a network request by itself.
 */
export function invalidateModelCatalog(): void {
  clientGeneration += 1;
  // Abort the superseded shared flight so the browser drops the network work.
  // Waiters of the old Promise still settle; generation + abort guards prevent
  // them from publishing. Unmount of a single subscriber never calls this.
  abortInflight("model_catalog_invalidated");
  emit({
    // Keep last-good payload, but mark not ready for the new generation so
    // ensureModelCatalog will refetch.
    status: snapshot.data ? "ready" : "idle",
    generation: clientGeneration,
    dataGeneration: snapshot.dataGeneration,
    data: snapshot.data,
    error: null,
    inflight: false,
  });
}

/**
 * Invalidate (if needed) and fetch the next catalog generation.
 * Used by Models close / explicit retry paths.
 */
export function refreshModelCatalog(options?: { force?: boolean }): Promise<void> {
  const force = options?.force !== false;
  if (force) {
    // Always bump so Models close produces a next-generation request even when
    // a previous generation is still marked ready.
    invalidateModelCatalog();
  }
  return ensureModelCatalog();
}

export type UseModelCatalogResult = {
  status: ModelCatalogStatus;
  loading: boolean;
  models: Record<string, string>;
  modelList: ModelCatalogModelListItem[];
  defaultModel: { provider: string; modelId: string } | null;
  thinkingLevels: Record<string, string[]>;
  thinkingLevelMaps: Record<string, Record<string, string | null>>;
  error: string | null;
  generation: number;
  refresh: (options?: { force?: boolean }) => Promise<void>;
  invalidate: () => void;
};

/**
 * Subscribe to the shared model catalog. Mount ensures one shared fetch;
 * defaultModel / view changes must not call this again for the same generation.
 */
export function useModelCatalog(): UseModelCatalogResult {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    void ensureModelCatalog();
  }, [state.generation]);

  const refresh = useCallback((options?: { force?: boolean }) => refreshModelCatalog(options), []);
  const invalidate = useCallback(() => {
    invalidateModelCatalog();
  }, []);

  const data = state.data;
  return {
    status: state.status,
    loading: state.inflight || (state.status === "loading") || (state.status === "idle" && !data),
    models: data?.models ?? EMPTY_MODELS,
    modelList: data?.modelList ?? EMPTY_MODEL_LIST,
    defaultModel: data?.defaultModel ?? null,
    thinkingLevels: data?.thinkingLevels ?? EMPTY_THINKING_LEVELS,
    thinkingLevelMaps: data?.thinkingLevelMaps ?? EMPTY_THINKING_LEVEL_MAPS,
    error: state.error,
    generation: state.generation,
    refresh,
    invalidate,
  };
}

/** Test-only: replace fetch and reset module state. */
export function __resetModelCatalogForTests(options?: {
  fetchImpl?: typeof fetch | null;
}): void {
  abortInflight("model_catalog_test_reset");
  clientGeneration = 0;
  inflight = null;
  fetchImpl = options?.fetchImpl ?? null;
  abortCountForTests = 0;
  snapshot = EMPTY_SNAPSHOT;
}

/** Test-only: inspect module snapshot without React. */
export function __getModelCatalogSnapshotForTests(): ModelCatalogSnapshot {
  return snapshot;
}

/** Test-only: current client generation. */
export function __getModelCatalogGenerationForTests(): number {
  return clientGeneration;
}

/** Test-only: how many times a shared flight was abort()ed. */
export function __getModelCatalogAbortCountForTests(): number {
  return abortCountForTests;
}

/** Test-only: whether a current-generation flight is still attached. */
export function __getModelCatalogInflightGenerationForTests(): number | null {
  return inflight?.generation ?? null;
}
