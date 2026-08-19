/**
 * Success-only models.json commit notification owner.
 *
 * Kept as a thin module so writers (especially models-config sync tests under
 * the Node strip-only loader) can notify without importing candidate
 * verification / temporary runtime construction.
 *
 * Order is intentional:
 * 1. invalidate admin runtime config generation + advance catalog epoch
 * 2. best-effort live session `reloadConfig()` + exact descriptor reconcile
 *
 * Never call on stale / parse / semantic invalid / rollback / skip / no-write.
 * Disk remains durable truth even when individual live wrappers fail.
 *
 * Catalog/runtime helpers are loaded through createRuntimeJiti so Node strip-only
 * test runners (which cannot parse parameter properties) still get the correct
 * admin+catalog side effects when a live-reload stub is injected.
 */

import { join } from "node:path";
import { createRuntimeJiti } from "@/lib/pi-provider-extensions";

export type ModelsConfigCommitReason =
  | "models_config"
  | "models_config_sync"
  | "model_prices";

export type ModelsConfigCommitLiveSummary = {
  attempted: number;
  succeeded: number;
  failed: number;
};

export type ModelsConfigCommitNotification = {
  live: ModelsConfigCommitLiveSummary;
};

async function loadCatalogService(): Promise<{
  invalidateWebModelCatalog: (
    reason: ModelsConfigCommitReason,
    options?: { agentDir?: string; modelsPath?: string },
  ) => void;
}> {
  const jiti = createRuntimeJiti();
  return jiti.import(join(process.cwd(), "lib/model-catalog-service.ts")) as Promise<{
    invalidateWebModelCatalog: (
      reason: ModelsConfigCommitReason,
      options?: { agentDir?: string; modelsPath?: string },
    ) => void;
  }>;
}

async function loadRpcManager(): Promise<{
  reloadRpcModelsConfigState: () => Promise<ModelsConfigCommitLiveSummary>;
}> {
  const jiti = createRuntimeJiti();
  return jiti.import(join(process.cwd(), "lib/rpc-manager.ts")) as Promise<{
    reloadRpcModelsConfigState: () => Promise<ModelsConfigCommitLiveSummary>;
  }>;
}

export async function notifyModelsConfigCommitted(options: {
  reason: ModelsConfigCommitReason;
  agentDir?: string;
  modelsPath?: string;
  /** Injected for tests; defaults to reloadRpcModelsConfigState. */
  reloadLive?: () => Promise<ModelsConfigCommitLiveSummary>;
}): Promise<ModelsConfigCommitNotification> {
  const { invalidateWebModelCatalog } = await loadCatalogService();
  invalidateWebModelCatalog(options.reason, {
    agentDir: options.agentDir,
    modelsPath: options.modelsPath,
  });

  let live: ModelsConfigCommitLiveSummary = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
  };
  try {
    if (options.reloadLive) {
      live = await options.reloadLive();
    } else {
      const { reloadRpcModelsConfigState } = await loadRpcManager();
      live = await reloadRpcModelsConfigState();
    }
  } catch {
    // Live reload is best-effort; durable commit already succeeded.
    live = { attempted: 0, succeeded: 0, failed: 1 };
  }

  return { live };
}
