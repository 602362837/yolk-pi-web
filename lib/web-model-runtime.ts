/**
 * web-model-runtime — provider-aware ModelRuntime / services foundation
 *
 * 0.80.8+ replaces AuthStorage + ModelRegistry.create with ModelRuntime and a
 * public CredentialStore. Web keeps Active credentials in auth.json via
 * `createWebCredentialStore` / `getWebCredentialStore`, and always injects the
 * fixed Grok → Kiro → Antigravity extension factories into the *target*
 * ModelRuntime through `createAgentSessionServices`.
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
 */

import { join, resolve } from "node:path";
import type { CredentialStore } from "@earendil-works/pi-ai";
import type {
  AgentSessionServices,
  CreateAgentSessionServicesOptions,
  InlineExtension,
  ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import {
  createWebCredentialStore,
  getWebCredentialStore,
  type WebCredentialStore,
} from "./web-credential-store";
import { createGrokCoordinatedCredentialStore } from "./grok-active-credential-store";
import { webExtensionFactories, webProviderExtensions } from "./pi-provider-extensions";

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

async function resolveAgentDir(agentDir?: string): Promise<string> {
  if (agentDir && agentDir.length > 0) return resolve(agentDir);
  const { getAgentDir } = await import("@earendil-works/pi-coding-agent");
  return resolve(getAgentDir());
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
  const agentDir = await resolveAgentDir(options.agentDir);
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
  // Only the persistent Active auth store participates in Grok's managed-slot
  // transaction. In-memory OAuth add/login stores must stay isolated.
  const credentials = isWebCredentialStore(rawCredentials)
    ? createGrokCoordinatedCredentialStore(rawCredentials)
    : rawCredentials;

  const modelsPath =
    options.modelsPath === undefined
      ? join(agentDir, "models.json")
      : options.modelsPath;

  return ModelRuntime.create({
    credentials,
    authPath,
    modelsPath,
    allowModelNetwork: options.allowModelNetwork,
    modelRefreshTimeoutMs: options.modelRefreshTimeoutMs,
  });
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
  const agentDir = await resolveAgentDir(options.agentDir);
  const modelsPath =
    options.modelsPath === undefined ? join(agentDir, "models.json") : options.modelsPath;
  const key = adminCacheKey(agentDir, modelsPath);
  let entry = adminRuntimeCache.get(key);

  if (!entry) {
    const authPath = join(agentDir, "auth.json");
    const credentials = await getWebCredentialStore({ authPath, agentDir });
    const runtime = await createWebModelRuntime({
      agentDir,
      credentials,
      authPath,
      modelsPath,
      allowModelNetwork: options.allowModelNetwork,
    });
    // Load fixed providers into this runtime via a throwaway services build
    // that skips project extension discovery (noExtensions) while still
    // applying webExtensionFactories.
    await registerFixedProvidersOnRuntime(runtime, agentDir);
    entry = { runtime, credentials, authPath, modelsPath };
    adminRuntimeCache.set(key, entry);
  }

  await entry.runtime.refresh({ allowNetwork: options.allowModelNetwork === true });
  return entry.runtime;
}

/**
 * Register fixed Web providers onto an existing ModelRuntime without loading
 * project-local extensions from cwd.
 */
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
 * Antigravity) plus caller extras into the target ModelRuntime.
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

  return createAgentSessionServices({
    cwd,
    agentDir,
    modelRuntime,
    settingsManager: options.settingsManager,
    extensionFlagValues: options.extensionFlagValues,
    resourceLoaderOptions,
    resourceLoaderReloadOptions: options.resourceLoaderReloadOptions,
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
  const agentDir = await resolveAgentDir(options.agentDir);
  const modelRuntime = await createWebModelRuntime({
    agentDir,
    credentials: options.credentials,
    modelsPath: options.modelsPath,
  });
  return createWebAgentSessionServices({
    cwd: options.cwd,
    agentDir,
    modelRuntime,
    modelsPath: options.modelsPath,
    fixedProvidersOnly: true,
  });
}

/** Test helper: drop admin runtime cache between isolated agent dirs. */
export function __resetWebModelRuntimeCacheForTests(): void {
  adminRuntimeCache.clear();
}
