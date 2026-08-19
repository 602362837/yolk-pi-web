/**
 * web-model-runtime — provider-aware ModelRuntime / services foundation
 *
 * 0.80.8+ replaces AuthStorage + ModelRegistry.create with ModelRuntime and a
 * public CredentialStore. Web keeps Active credentials in auth.json via
 * `createWebCredentialStore` / `getWebCredentialStore`, and always injects the
 * fixed Grok → Kiro → Antigravity → AnyRouter extension factories into the
 * *target* ModelRuntime through `createAgentSessionServices`.
 *
 * ## Isolation
 *
 * - `createWebModelRuntime` always returns a fresh runtime (session / Studio /
 *   temporary modelsPath callers).
 * - `getWebModelRuntime` caches only fixed-provider *administrative* runtimes
 *   keyed by agentDir + modelsPath. Callers that load cwd-local project
 *   extensions must use `createWebAgentSessionServices` instead so providers
 *   cannot leak across cwd boundaries.
 * - Temporary modelsPath never enters the admin cache.
 * - Successful models.json commits call `invalidateWebModelRuntimeConfig` so
 *   the next admin read creates a fresh fixed-provider runtime instead of
 *   relying on `refresh()` (which does not reread modelsPath).
 */

import { join, resolve } from "node:path";
import type { CredentialStore } from "@earendil-works/pi-ai";
import type {
  AgentSessionServices,
  CreateAgentSessionServicesOptions,
  InlineExtension,
  ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  createWebCredentialStore,
  getWebCredentialStore,
  type WebCredentialStore,
} from "./web-credential-store";
import { createAntigravityCoordinatedCredentialStore } from "./antigravity-active-credential-store";
import { createGrokCoordinatedCredentialStore } from "./grok-active-credential-store";
import { webExtensionFactories, webProviderExtensions } from "./pi-provider-extensions";
import {
  instrumentModelRuntimeForCatalogMetrics,
  measureModelCatalogAsync,
  recordModelCatalogCount,
} from "./model-catalog-metrics";

export interface CreateWebModelRuntimeOptions {
  agentDir?: string;
  cwd?: string;
  /** Override credential store (e.g. in-memory add-account login). */
  credentials?: CredentialStore;
  authPath?: string;
  modelsPath?: string | null;
  allowModelNetwork?: boolean;
  modelRefreshTimeoutMs?: number;
}

export interface GetWebModelRuntimeOptions {
  agentDir?: string;
  /** Administrative runtimes are not cwd-bound; accepted for API symmetry. */
  cwd?: string;
  modelsPath?: string;
  allowModelNetwork?: boolean;
}

export interface CreateWebAgentSessionServicesOptions {
  cwd: string;
  agentDir?: string;
  /** Caller-provided runtime (e.g. add-account in-memory credentials). */
  modelRuntime?: ModelRuntime;
  modelsPath?: string | null;
  /** Extra inline extensions after fixed providers (YPI Studio, Browser Share, guards). */
  extraExtensions?: InlineExtension[];
  /** When true, only fixed providers load — no project/cwd extension discovery. */
  fixedProvidersOnly?: boolean;
  settingsManager?: CreateAgentSessionServicesOptions["settingsManager"];
  extensionFlagValues?: CreateAgentSessionServicesOptions["extensionFlagValues"];
  resourceLoaderOptions?: CreateAgentSessionServicesOptions["resourceLoaderOptions"];
  resourceLoaderReloadOptions?: CreateAgentSessionServicesOptions["resourceLoaderReloadOptions"];
}

type AdminRuntimeCacheEntry = {
  runtime: ModelRuntime;
  credentials: CredentialStore;
  authPath: string;
  modelsPath: string | null | undefined;
};

const adminRuntimeCache = new Map<string, AdminRuntimeCacheEntry>();
// Administrative routes often arrive concurrently on a cold server (for
// example Models' provider summaries). Keep initialization and the safe,
// offline catalog refresh separate so one caller cannot duplicate fixed
// provider registration or make another caller wait on a network refresh.
const adminRuntimePending = new Map<string, Promise<AdminRuntimeCacheEntry>>();
const adminRuntimeRefreshPending = new Map<string, Promise<void>>();
/** Test-reset salt so in-flight work from a previous suite cannot refill. */
let adminRuntimeCacheGeneration = 0;
/**
 * Production per-canonical-key config generation. Successful models.json
 * commits bump the matching key so late init/refresh settlements cannot
 * republish a pre-commit runtime into the new generation.
 */
const adminRuntimeConfigGeneration = new Map<string, number>();

type AdminRuntimeTestHooks = {
  createEntry?: (
    agentDir: string,
    modelsPath: string | null | undefined,
    allowModelNetwork: false,
  ) => Promise<AdminRuntimeCacheEntry>;
  refreshOffline?: (entry: AdminRuntimeCacheEntry) => Promise<void>;
};
let adminRuntimeTestHooks: AdminRuntimeTestHooks | undefined;

function resolveAgentDir(agentDir?: string): string {
  if (agentDir && agentDir.length > 0) return resolve(agentDir);
  return resolve(getAgentDir());
}

function getAdminConfigGeneration(key: string): number {
  return adminRuntimeConfigGeneration.get(key) ?? 0;
}

function bumpAdminConfigGeneration(key: string): number {
  const next = getAdminConfigGeneration(key) + 1;
  adminRuntimeConfigGeneration.set(key, next);
  return next;
}

function resolveAdminRuntimeTarget(options?: {
  agentDir?: string;
  modelsPath?: string;
}): { agentDir: string; modelsPath: string; key: string } {
  const agentDir = resolveAgentDir(options?.agentDir);
  const modelsPath =
    options?.modelsPath === undefined ? join(agentDir, "models.json") : resolve(options.modelsPath);
  return {
    agentDir,
    modelsPath,
    key: adminCacheKey(agentDir, modelsPath),
  };
}

function isWebCredentialStore(store: CredentialStore): store is WebCredentialStore {
  return typeof (store as Partial<WebCredentialStore>).authPath === "string";
}

function adminCacheKey(agentDir: string, modelsPath: string | null | undefined): string {
  const modelsKey =
    modelsPath === undefined || modelsPath === null ? "<default>" : resolve(modelsPath);
  return `${resolve(agentDir)}::${modelsKey}`;
}

/**
 * Create an isolated ModelRuntime bound to the Web CredentialStore.
 *
 * Never cached. Use for main Chat, Studio child, temporary modelsPath tests,
 * and any path that must not share provider registrations with other sessions.
 */
export async function createWebModelRuntime(
  options: CreateWebModelRuntimeOptions = {},
): Promise<ModelRuntime> {
  const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
  const agentDir = resolveAgentDir(options.agentDir);
  const authPath =
    options.authPath && options.authPath.length > 0
      ? resolve(options.authPath)
      : join(agentDir, "auth.json");
  const rawCredentials =
    options.credentials ??
    (await createWebCredentialStore({
      authPath,
      agentDir,
    }));
  // Only the persistent Active auth store participates in managed-slot
  // transactions (Grok + Antigravity). In-memory OAuth add/login stores must
  // stay isolated so temporary login credentials never touch Active slots.
  // Wrap Grok first, then Antigravity on top so each decorator only intercepts
  // its own provider id and both transactions use the same raw file store.
  const credentials = isWebCredentialStore(rawCredentials)
    ? createAntigravityCoordinatedCredentialStore(
        rawCredentials,
        createGrokCoordinatedCredentialStore(rawCredentials),
      )
    : rawCredentials;

  const modelsPath =
    options.modelsPath === undefined
      ? join(agentDir, "models.json")
      : options.modelsPath;

  recordModelCatalogCount("runtime.create");
  const runtime = await ModelRuntime.create({
    credentials,
    authPath,
    modelsPath,
    allowModelNetwork: options.allowModelNetwork,
    modelRefreshTimeoutMs: options.modelRefreshTimeoutMs,
  });
  return instrumentModelRuntimeForCatalogMetrics(runtime);
}

/**
 * Return a process-reused fixed-provider administrative ModelRuntime.
 *
 * Cache key is canonical agentDir + modelsPath. Temporary / one-off modelsPath
 * callers should pass a unique path and prefer `createWebModelRuntime` if they
 * do not want reuse. Each call offline-refreshes the runtime before return.
 *
 * This path does NOT load cwd-local project extensions. For session work use
 * `createWebAgentSessionServices`.
 */
export async function getWebModelRuntime(
  options: GetWebModelRuntimeOptions = {},
): Promise<ModelRuntime> {
  const agentDir = resolveAgentDir(options.agentDir);
  const modelsPath =
    options.modelsPath === undefined ? join(agentDir, "models.json") : options.modelsPath;
  const key = adminCacheKey(agentDir, modelsPath);
  const entry = await getOrCreateAdminRuntimeEntry(key, agentDir, modelsPath);

  // The shared refresh is deliberately offline. It is safe for local catalog
  // routes and cannot turn a cold concurrent summary request into auth/network
  // work. An explicit network caller retains its old opt-in behavior but stays
  // outside the offline flight, so network work is never mixed into it.
  if (options.allowModelNetwork === true) {
    await entry.runtime.refresh({ allowNetwork: true });
  } else {
    await refreshAdminRuntimeOffline(key, entry);
  }
  return entry.runtime;
}

async function getOrCreateAdminRuntimeEntry(
  key: string,
  agentDir: string,
  modelsPath: string | null | undefined,
): Promise<AdminRuntimeCacheEntry> {
  for (;;) {
    const cached = adminRuntimeCache.get(key);
    if (cached) return cached;

    let pending = adminRuntimePending.get(key);
    if (!pending) {
      const suiteGeneration = adminRuntimeCacheGeneration;
      const configGeneration = getAdminConfigGeneration(key);
      pending = (async () => {
        const entry = adminRuntimeTestHooks?.createEntry
          ? await adminRuntimeTestHooks.createEntry(agentDir, modelsPath, false)
          : await createAdminRuntimeEntry(agentDir, modelsPath);
        // Test reset or a successful models.json commit must not let an older
        // pending initialization repopulate the resolved cache.
        if (
          suiteGeneration === adminRuntimeCacheGeneration &&
          configGeneration === getAdminConfigGeneration(key)
        ) {
          adminRuntimeCache.set(key, entry);
        }
        return entry;
      })();
      adminRuntimePending.set(key, pending);
      // Invalidate may have raced between create and set. Drop ownership so a
      // post-commit caller never joins this old flight, then retry as a fresh
      // generation request.
      if (
        suiteGeneration !== adminRuntimeCacheGeneration ||
        configGeneration !== getAdminConfigGeneration(key)
      ) {
        if (adminRuntimePending.get(key) === pending) {
          adminRuntimePending.delete(key);
        }
        continue;
      }
      void pending
        .finally(() => {
          if (adminRuntimePending.get(key) === pending) {
            adminRuntimePending.delete(key);
          }
        })
        .catch(() => undefined);
    }

    // Original waiters of an invalidated flight may still receive that entry;
    // they must not auto-upgrade into a newer generation (catalog epoch
    // waiters rely on keeping their own build). New callers never join an old
    // flight because invalidate deletes the pending slot first.
    return pending;
  }
}

async function refreshAdminRuntimeOffline(
  key: string,
  entry: AdminRuntimeCacheEntry,
): Promise<void> {
  let pending = adminRuntimeRefreshPending.get(key);
  if (!pending) {
    const suiteGeneration = adminRuntimeCacheGeneration;
    const configGeneration = getAdminConfigGeneration(key);
    pending = measureModelCatalogAsync("runtime.admin_refresh", async () => {
      // A config commit / test reset during flight must not refresh (and keep
      // alive) an already-evicted generation's runtime.
      if (
        suiteGeneration !== adminRuntimeCacheGeneration ||
        configGeneration !== getAdminConfigGeneration(key)
      ) {
        return;
      }
      if (adminRuntimeTestHooks?.refreshOffline) {
        await adminRuntimeTestHooks.refreshOffline(entry);
        return;
      }
      await entry.runtime.refresh({ allowNetwork: false });
    });
    adminRuntimeRefreshPending.set(key, pending);
    void pending
      .finally(() => {
        // Only clear our own pending slot. A newer generation may already own
        // a different pending promise for this key.
        if (adminRuntimeRefreshPending.get(key) === pending) {
          adminRuntimeRefreshPending.delete(key);
        }
      })
      .catch(() => undefined);
  }
  await pending;
}

/**
 * Evict the fixed-provider administrative runtime for a models.json commit.
 *
 * Advances the per-canonical-key config generation, drops the resolved entry
 * and any matching init/refresh pending slots, and prevents late settlements
 * from that generation from refilling the cache. Distinct agentDir/modelsPath
 * keys are isolated. Auth-only mutations must not call this — they continue to
 * use offline `refresh()` / catalog epoch invalidation.
 */
export function invalidateWebModelRuntimeConfig(options?: {
  agentDir?: string;
  modelsPath?: string;
}): void {
  const { key } = resolveAdminRuntimeTarget(options);
  bumpAdminConfigGeneration(key);
  adminRuntimeCache.delete(key);
  adminRuntimePending.delete(key);
  adminRuntimeRefreshPending.delete(key);
  recordModelCatalogCount("runtime.config_invalidate");
}

/**
 * Register fixed Web providers onto an existing ModelRuntime without loading
 * project-local extensions from cwd.
 */
async function createAdminRuntimeEntry(
  agentDir: string,
  modelsPath: string | null | undefined,
): Promise<AdminRuntimeCacheEntry> {
  return measureModelCatalogAsync("runtime.admin_init", async () => {
    const authPath = join(agentDir, "auth.json");
    const credentials = await getWebCredentialStore({ authPath, agentDir });
    // Initialization is always offline. In particular, a first caller that
    // asks for a network refresh must not alter the shared runtime's cold
    // startup semantics.
    const runtime = await createWebModelRuntime({
      agentDir,
      credentials,
      authPath,
      modelsPath,
      allowModelNetwork: false,
    });
    // Load fixed providers into this runtime via a throwaway services build
    // that skips project extension discovery (noExtensions) while still
    // applying webExtensionFactories.
    await registerFixedProvidersOnRuntime(runtime, agentDir);
    return { runtime, credentials, authPath, modelsPath };
  });
}

async function registerFixedProvidersOnRuntime(
  modelRuntime: ModelRuntime,
  agentDir: string,
): Promise<void> {
  const { createAgentSessionServices } = await import("@earendil-works/pi-coding-agent");
  // Use a neutral cwd so we never pick up the caller's project extensions.
  // Fixed factories still register into the provided modelRuntime.
  await createAgentSessionServices({
    cwd: agentDir,
    agentDir,
    modelRuntime,
    resourceLoaderOptions: {
      extensionFactories: webProviderExtensions(),
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    },
  });
}

/**
 * Canonical Web services helper: always injects fixed providers (Grok → Kiro →
 * Antigravity → AnyRouter) plus caller extras into the target ModelRuntime.
 *
 * Main Chat and Studio child should each call this once per services/session
 * so cwd-local extension providers cannot leak across sessions. Admin paths
 * that only need fixed providers may pass `fixedProvidersOnly: true`.
 */
export async function createWebAgentSessionServices(
  options: CreateWebAgentSessionServicesOptions,
): Promise<AgentSessionServices> {
  const { createAgentSessionServices, getAgentDir } = await import(
    "@earendil-works/pi-coding-agent"
  );
  const agentDir = options.agentDir ? resolve(options.agentDir) : resolve(getAgentDir());
  const cwd = resolve(options.cwd);

  let modelRuntime = options.modelRuntime;
  if (!modelRuntime) {
    modelRuntime = await createWebModelRuntime({
      agentDir,
      modelsPath: options.modelsPath,
    });
  }

  const extra = options.extraExtensions ?? [];
  const callerLoader = options.resourceLoaderOptions ?? {};
  const callerFactories = callerLoader.extensionFactories ?? [];
  // Prefer extraExtensions. If a transitional caller still passes
  // resourceLoaderOptions.extensionFactories that already include fixed
  // providers (legacy webExtensionFactories()), strip those known fixed names
  // so we only prepend once.
  const fixedNames = new Set(webProviderExtensions().map((ext) => ext.name));
  const strippedCallerFactories = callerFactories.filter((factory) => {
    if (typeof factory === "function") return true;
    return !fixedNames.has(factory.name);
  });
  const extensionFactories = webExtensionFactories([
    ...extra,
    ...strippedCallerFactories,
  ]);

  const resourceLoaderOptions = {
    ...callerLoader,
    extensionFactories,
    ...(options.fixedProvidersOnly
      ? {
          noExtensions: true,
          noSkills: callerLoader.noSkills ?? true,
          noPromptTemplates: callerLoader.noPromptTemplates ?? true,
          noThemes: callerLoader.noThemes ?? true,
          noContextFiles: callerLoader.noContextFiles ?? true,
        }
      : {}),
  };

  return measureModelCatalogAsync("runtime.services_create", async () => {
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      modelRuntime,
      settingsManager: options.settingsManager,
      extensionFlagValues: options.extensionFlagValues,
      resourceLoaderOptions,
      resourceLoaderReloadOptions: options.resourceLoaderReloadOptions,
    });
    // Services may wrap/refresh the target runtime; keep refresh/getAvailable
    // countable when diagnostics are enabled without changing identity.
    instrumentModelRuntimeForCatalogMetrics(services.modelRuntime);
    return services;
  });
}

/**
 * Create an isolated runtime + services for temporary modelsPath verification
 * (Models Config test, model-price write verification). Never enters the admin
 * runtime cache.
 */
export async function createTemporaryWebModelRuntimeServices(options: {
  cwd: string;
  agentDir?: string;
  modelsPath: string;
  credentials?: CredentialStore;
}): Promise<AgentSessionServices> {
  const agentDir = resolveAgentDir(options.agentDir);
  // Candidate / price paths must never hit model endpoints. Force offline
  // initial load regardless of PI_OFFLINE or ambient network policy.
  const modelRuntime = await createWebModelRuntime({
    agentDir,
    credentials: options.credentials,
    modelsPath: options.modelsPath,
    allowModelNetwork: false,
  });
  return createWebAgentSessionServices({
    cwd: options.cwd,
    agentDir,
    modelRuntime,
    modelsPath: options.modelsPath,
    fixedProvidersOnly: true,
  });
}

/** Test-only hooks for deterministic administrative runtime concurrency tests. */
export function __setWebModelRuntimeTestHooksForTests(
  hooks: AdminRuntimeTestHooks | undefined,
): void {
  adminRuntimeTestHooks = hooks;
}

/** Test helper: drop all administrative runtime state between isolated agent dirs. */
export function __resetWebModelRuntimeCacheForTests(): void {
  adminRuntimeCacheGeneration += 1;
  adminRuntimeCache.clear();
  adminRuntimePending.clear();
  adminRuntimeRefreshPending.clear();
  adminRuntimeConfigGeneration.clear();
  adminRuntimeTestHooks = undefined;
}
