/**
 * model-catalog-service — offline shared model catalog snapshot
 *
 * Serves `GET /api/models` from the fixed-provider administrative ModelRuntime
 * (`getWebModelRuntime`) instead of creating a per-request session services
 * tree. One epoch + single-flight + short burst cache collapses concurrent and
 * warm catalog reads; successful model/auth mutations (MLP-05) advance the
 * epoch via `invalidateWebModelCatalog`.
 *
 * Invariants:
 * - Catalog initialization/refresh is offline (`allowModelNetwork: false`).
 * - Projection uses `getAvailableSnapshot()` after the admin offline refresh;
 *   it never calls `getAvailable()`, which would force another availability
 *   scan.
 * - Does not load cwd project extensions; model list identity is canonical
 *   agentDir (not request cwd). Cache / pending / burst slots are isolated by
 *   that key so concurrent explicit agentDir callers never share a wrong
 *   catalog. Epoch invalidation remains process-wide.
 * - Snapshots returned to callers are clones so shared cache cannot be mutated.
 * - Failed builds clear pending so the next request can retry.
 * - Old-generation builds must not publish into a newer epoch.
 */

import { resolve } from "node:path";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import {
  measureModelCatalogAsync,
  recordModelCatalogCount,
} from "./model-catalog-metrics";
import { getWebModelRuntime } from "./web-model-runtime";

export type WebModelCatalogModelListItem = {
  id: string;
  name: string;
  provider: string;
  providerDisplayName?: string;
};

export type WebModelCatalogResponse = {
  models: Record<string, string>;
  modelList: WebModelCatalogModelListItem[];
  defaultModel: { provider: string; modelId: string } | null;
  thinkingLevels: Record<string, string[]>;
  thinkingLevelMaps: Record<string, Record<string, string | null>>;
};

export type ModelCatalogInvalidationReason =
  | "models_config"
  | "models_config_sync"
  | "model_prices"
  | "auth_mutation"
  | "account_mutation"
  | "anyrouter_config"
  | "settings_default"
  | "manual"
  | "test";

type CatalogBaseSnapshot = {
  models: Record<string, string>;
  modelList: WebModelCatalogModelListItem[];
  thinkingLevels: Record<string, string[]>;
  thinkingLevelMaps: Record<string, Record<string, string | null>>;
};

type CachedCatalogBase = {
  epoch: number;
  expiresAt: number;
  base: CatalogBaseSnapshot;
};

/** Short burst collapse only; correctness is epoch/invalidation. */
const CATALOG_BURST_TTL_MS = 2_500;

const modelNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function compareModelEntries(
  a: WebModelCatalogModelListItem,
  b: WebModelCatalogModelListItem,
): number {
  return (
    modelNameCollator.compare(a.name || a.id, b.name || b.id) ||
    modelNameCollator.compare(a.provider, b.provider) ||
    modelNameCollator.compare(a.id, b.id)
  );
}

type CatalogPending = {
  epoch: number;
  promise: Promise<CatalogBaseSnapshot>;
};

/** Process-wide generation; successful mutations advance it for every slot. */
let catalogEpoch = 1;
/** Per canonical-agentDir burst cache (epoch-gated). */
const cachedByKey = new Map<string, CachedCatalogBase>();
/** Per canonical-agentDir in-flight build for the current epoch. */
const pendingByKey = new Map<string, CatalogPending>();

/** Catalog list identity: agentDir only (cwd is default-model resolution). */
function catalogIdentityKey(agentDir: string): string {
  return resolve(agentDir);
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

function cloneModelList(
  source: WebModelCatalogModelListItem[],
): WebModelCatalogModelListItem[] {
  return source.map((item) => ({ ...item }));
}

function cloneBase(base: CatalogBaseSnapshot): CatalogBaseSnapshot {
  return {
    models: cloneStringRecord(base.models),
    modelList: cloneModelList(base.modelList),
    thinkingLevels: cloneThinkingLevels(base.thinkingLevels),
    thinkingLevelMaps: cloneThinkingLevelMaps(base.thinkingLevelMaps),
  };
}

async function resolveAgentDir(agentDir?: string): Promise<string> {
  if (agentDir && agentDir.length > 0) return resolve(agentDir);
  const { getAgentDir } = await import("@earendil-works/pi-coding-agent");
  return resolve(getAgentDir());
}

/**
 * Project the already-refreshed admin runtime available snapshot into the wire
 * shape shared by Chat and Settings. Pure CPU work after offline refresh.
 */
function projectCatalogBase(runtime: {
  getAvailableSnapshot: () => readonly {
    id: string;
    name: string;
    provider: string;
    thinkingLevelMap?: Record<string, string | null>;
  }[];
  getProvider: (providerId: string) => { name?: string } | undefined;
}): CatalogBaseSnapshot {
  const available = runtime.getAvailableSnapshot();
  const nameMap = new Map<string, string>();
  const thinkingLevels: Record<string, string[]> = {};
  const thinkingLevelMaps: Record<string, Record<string, string | null>> = {};

  const modelList = available
    .map((m) => {
      const providerDisplayName = runtime.getProvider(m.provider)?.name;
      return {
        id: m.id,
        name: m.name,
        provider: m.provider,
        ...(providerDisplayName && providerDisplayName !== m.provider
          ? { providerDisplayName }
          : {}),
      };
    })
    .sort(compareModelEntries);

  for (const m of available) {
    const key = `${m.provider}:${m.id}`;
    nameMap.set(key, m.name);
    // getSupportedThinkingLevels accepts the SDK Model shape; available
    // snapshot entries are the same model objects.
    thinkingLevels[key] = getSupportedThinkingLevels(
      m as Parameters<typeof getSupportedThinkingLevels>[0],
    );
    if (m.thinkingLevelMap) thinkingLevelMaps[key] = { ...m.thinkingLevelMap };
  }

  recordModelCatalogCount("catalog.project");
  recordModelCatalogCount("catalog.model_count", modelList.length);

  return {
    models: Object.fromEntries(nameMap),
    modelList,
    thinkingLevels,
    thinkingLevelMaps,
  };
}

async function buildCatalogBase(agentDir: string): Promise<CatalogBaseSnapshot> {
  return measureModelCatalogAsync("catalog.build", async () => {
    // Administrative fixed-provider runtime: offline refresh single-flight is
    // owned by getWebModelRuntime. Catalog must never opt into network.
    const runtime = await getWebModelRuntime({
      agentDir,
      allowModelNetwork: false,
    });
    return projectCatalogBase(runtime);
  });
}

async function getSharedCatalogBase(agentDir?: string): Promise<CatalogBaseSnapshot> {
  const resolvedAgentDir = await resolveAgentDir(agentDir);
  const key = catalogIdentityKey(resolvedAgentDir);
  const epochAtStart = catalogEpoch;
  const now = Date.now();

  const cached = cachedByKey.get(key);
  if (cached && cached.epoch === epochAtStart && cached.expiresAt > now) {
    recordModelCatalogCount("catalog.cache_hit");
    return cloneBase(cached.base);
  }

  const existingPending = pendingByKey.get(key);
  if (existingPending && existingPending.epoch === epochAtStart) {
    recordModelCatalogCount("catalog.cache_shared");
    const base = await existingPending.promise;
    // Epoch may have advanced while we waited; still return the completed
    // build to this waiter (it was requested under that generation) without
    // re-publishing into a newer cache / other agentDir slots.
    return cloneBase(base);
  }

  recordModelCatalogCount("catalog.cache_miss");
  const buildEpoch = epochAtStart;
  const promise = buildCatalogBase(resolvedAgentDir);
  pendingByKey.set(key, { epoch: buildEpoch, promise });

  try {
    const base = await promise;
    // Only publish when this build still matches the live epoch. A concurrent
    // invalidate must not let a late build repopulate the new generation.
    if (catalogEpoch === buildEpoch) {
      cachedByKey.set(key, {
        epoch: buildEpoch,
        expiresAt: Date.now() + CATALOG_BURST_TTL_MS,
        base: cloneBase(base),
      });
    }
    return cloneBase(base);
  } catch (error) {
    // Failed pending must clear so the next caller can retry this key.
    const cur = pendingByKey.get(key);
    if (cur?.promise === promise) {
      pendingByKey.delete(key);
    }
    throw error;
  } finally {
    const cur = pendingByKey.get(key);
    if (cur?.promise === promise) {
      pendingByKey.delete(key);
    }
  }
}

async function resolveDefaultModel(
  cwd: string | undefined,
  agentDir: string,
  modelList: WebModelCatalogModelListItem[],
): Promise<{ provider: string; modelId: string } | null> {
  try {
    const { SettingsManager } = await import("@earendil-works/pi-coding-agent");
    // Keep request cwd for project-scoped default overrides (wire compatibility).
    // Model list itself stays admin/agentDir-scoped and is not cwd-split.
    const settingsCwd = cwd && cwd.length > 0 ? resolve(cwd) : agentDir;
    const settings = SettingsManager.create(settingsCwd, agentDir);
    const provider = settings.getDefaultProvider();
    const modelId = settings.getDefaultModel();
    if (
      provider &&
      modelId &&
      modelList.some((m) => m.provider === provider && m.id === modelId)
    ) {
      return { provider, modelId };
    }
  } catch {
    // Default is best-effort; missing/malformed settings yield null.
  }
  return null;
}

/**
 * Return the shared offline model catalog projection for Chat / Settings.
 *
 * `cwd` is only used for SettingsManager default-model resolution; the model
 * list is always built from the fixed-provider admin runtime.
 */
export async function getWebModelCatalogSnapshot(options?: {
  cwd?: string;
  agentDir?: string;
}): Promise<WebModelCatalogResponse> {
  return measureModelCatalogAsync("catalog.snapshot", async () => {
    const agentDir = await resolveAgentDir(options?.agentDir);
    const base = await getSharedCatalogBase(agentDir);
    const defaultModel = await resolveDefaultModel(options?.cwd, agentDir, base.modelList);
    return {
      models: base.models,
      modelList: base.modelList,
      defaultModel,
      thinkingLevels: base.thinkingLevels,
      thinkingLevelMaps: base.thinkingLevelMaps,
    };
  });
}

/**
 * Advance the catalog epoch so the next snapshot rebuilds from admin runtime.
 * Call only after a successful models/auth/account/default mutation commits.
 * Failures/cancels must not call this.
 */
export function invalidateWebModelCatalog(
  _reason: ModelCatalogInvalidationReason = "manual",
): void {
  catalogEpoch += 1;
  // Drop every agentDir burst slot. Leave in-flight builds alone; their finally
  // clears per-key pending, and publish is gated on matching epoch so a late
  // success cannot refill the new epoch.
  cachedByKey.clear();
  recordModelCatalogCount("catalog.invalidate");
}

/** Current monotonic catalog epoch (test/diagnostics). */
export function getWebModelCatalogEpoch(): number {
  return catalogEpoch;
}

/** Test helper: drop all cache/pending slots and reset epoch. */
export function __resetWebModelCatalogForTests(): void {
  catalogEpoch = 1;
  pendingByKey.clear();
  cachedByKey.clear();
}
