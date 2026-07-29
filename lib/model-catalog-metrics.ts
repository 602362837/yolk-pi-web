/**
 * model-catalog-metrics — content-safe counters for model-catalog performance work
 *
 * MLP-01 evidence harness only. Records scalar counts and millisecond totals for
 * runtime init/refresh, credential raw-read / queue-wait, and AnyRouter
 * reconcile / mirror writes. Never stores paths, provider account ids, model
 * names, credentials, or raw error bodies.
 *
 * Collection is OFF by default. Production request paths pay only a single
 * boolean check unless a test (or explicit diagnostic) enables the counters.
 */

export type ModelCatalogMetricName =
  | "runtime.create"
  | "runtime.admin_init"
  | "runtime.admin_refresh"
  | "runtime.services_create"
  | "runtime.refresh_calls"
  | "runtime.refresh_network"
  | "runtime.refresh_offline"
  | "runtime.get_available"
  | "credential.raw_read"
  | "credential.list"
  | "credential.modify"
  | "credential.delete"
  | "credential.queue_enter"
  | "credential.queue_wait_ms"
  | "anyrouter.reconcile"
  | "anyrouter.reconcile_shared"
  | "anyrouter.reconcile_noop"
  | "anyrouter.bridge_write"
  | "anyrouter.bridge_remove"
  | "anyrouter.bridge_noop"
  | "anyrouter.auth_mirror_set"
  | "anyrouter.auth_mirror_clear"
  | "anyrouter.auth_mirror_noop"
  | "catalog.snapshot"
  | "catalog.build"
  | "catalog.project"
  | "catalog.model_count"
  | "catalog.cache_hit"
  | "catalog.cache_miss"
  | "catalog.cache_shared"
  | "catalog.invalidate";

export type ModelCatalogMetricsSnapshot = {
  enabled: boolean;
  counts: Record<string, number>;
  totalsMs: Record<string, number>;
  maxMs: Record<string, number>;
};

let enabled = false;
const counts = new Map<string, number>();
const totalsMs = new Map<string, number>();
const maxMs = new Map<string, number>();

function nowMs(): number {
  return performance.now();
}

function bump(map: Map<string, number>, name: string, delta: number): void {
  map.set(name, (map.get(name) ?? 0) + delta);
}

function setMax(name: string, value: number): void {
  const previous = maxMs.get(name) ?? 0;
  if (value > previous) maxMs.set(name, value);
}

/** Enable or disable process-local catalog metrics collection. */
export function enableModelCatalogMetrics(value: boolean): void {
  enabled = value === true;
}

export function isModelCatalogMetricsEnabled(): boolean {
  return enabled;
}

/** Drop all accumulated counters. Does not change the enabled flag. */
export function resetModelCatalogMetrics(): void {
  counts.clear();
  totalsMs.clear();
  maxMs.clear();
}

/** Test helper: disable collection and clear accumulated values. */
export function __resetModelCatalogMetricsForTests(): void {
  enabled = false;
  resetModelCatalogMetrics();
}

export function recordModelCatalogCount(name: ModelCatalogMetricName | string, n = 1): void {
  if (!enabled || !Number.isFinite(n) || n === 0) return;
  bump(counts, name, n);
}

export function recordModelCatalogDuration(
  name: ModelCatalogMetricName | string,
  ms: number,
): void {
  if (!enabled || !Number.isFinite(ms) || ms < 0) return;
  bump(totalsMs, name, ms);
  setMax(name, ms);
}

/**
 * Measure async work and optionally increment a companion count.
 * No-ops the timing bookkeeping when metrics are disabled (still runs fn).
 */
export async function measureModelCatalogAsync<T>(
  name: ModelCatalogMetricName | string,
  fn: () => Promise<T>,
  options?: { count?: boolean },
): Promise<T> {
  if (!enabled) return fn();
  if (options?.count !== false) recordModelCatalogCount(name);
  const started = nowMs();
  try {
    return await fn();
  } finally {
    recordModelCatalogDuration(`${name}.ms`, nowMs() - started);
  }
}

export function getModelCatalogMetricsSnapshot(): ModelCatalogMetricsSnapshot {
  const countObj: Record<string, number> = {};
  for (const [key, value] of counts) countObj[key] = value;
  const totalsObj: Record<string, number> = {};
  for (const [key, value] of totalsMs) totalsObj[key] = value;
  const maxObj: Record<string, number> = {};
  for (const [key, value] of maxMs) maxObj[key] = value;
  return {
    enabled,
    counts: countObj,
    totalsMs: totalsObj,
    maxMs: maxObj,
  };
}

function formatMap(prefix: string, values: Record<string, number>): string {
  const keys = Object.keys(values).sort();
  if (keys.length === 0) return `${prefix}=0`;
  return `${prefix}[${keys.map((key) => `${key}=${Math.round(values[key]!)}`).join(" ")}]`;
}

/**
 * One-line, content-safe summary. Suitable for test stdout / slow-path logs.
 * Never includes paths, credentials, provider/account/model identifiers.
 */
export function formatModelCatalogMetricsLine(
  snapshot: ModelCatalogMetricsSnapshot = getModelCatalogMetricsSnapshot(),
): string {
  return [
    "[model-catalog-metrics]",
    `enabled=${snapshot.enabled ? 1 : 0}`,
    formatMap("counts", snapshot.counts),
    formatMap("totalsMs", snapshot.totalsMs),
    formatMap("maxMs", snapshot.maxMs),
  ].join(" ");
}

/**
 * Wrap a ModelRuntime so refresh/getAvailable calls become countable.
 * Used only when metrics are enabled; leaves the original instance otherwise.
 */
export function instrumentModelRuntimeForCatalogMetrics<T extends object>(runtime: T): T {
  if (!enabled || !runtime || typeof runtime !== "object") return runtime;

  const target = runtime as T & {
    refresh?: (options?: { allowNetwork?: boolean }) => Promise<unknown>;
    getAvailable?: (...args: unknown[]) => Promise<unknown> | unknown;
  };

  if (typeof target.refresh === "function" && !(target as { __ypiCatalogMetricsRefresh?: boolean }).__ypiCatalogMetricsRefresh) {
    const original = target.refresh.bind(target);
    target.refresh = async (options?: { allowNetwork?: boolean }) => {
      recordModelCatalogCount("runtime.refresh_calls");
      if (options?.allowNetwork === true) {
        recordModelCatalogCount("runtime.refresh_network");
      } else {
        recordModelCatalogCount("runtime.refresh_offline");
      }
      const started = nowMs();
      try {
        return await original(options);
      } finally {
        recordModelCatalogDuration("runtime.refresh_calls.ms", nowMs() - started);
      }
    };
    (target as { __ypiCatalogMetricsRefresh?: boolean }).__ypiCatalogMetricsRefresh = true;
  }

  if (
    typeof target.getAvailable === "function" &&
    !(target as { __ypiCatalogMetricsGetAvailable?: boolean }).__ypiCatalogMetricsGetAvailable
  ) {
    const original = target.getAvailable.bind(target);
    target.getAvailable = async (...args: unknown[]) => {
      recordModelCatalogCount("runtime.get_available");
      const started = nowMs();
      try {
        return await original(...args);
      } finally {
        recordModelCatalogDuration("runtime.get_available.ms", nowMs() - started);
      }
    };
    (target as { __ypiCatalogMetricsGetAvailable?: boolean }).__ypiCatalogMetricsGetAvailable = true;
  }

  return runtime;
}
