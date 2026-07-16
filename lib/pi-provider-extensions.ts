/**
 * pi-provider-extensions — unified provider extension factory list
 *
 * Every Web entrypoint that creates a ResourceLoader, calls
 * `createAgentSessionServices`, or bootstraps Auth/Models must include these
 * factories so dynamic providers (currently grok-cli and kiro) are consistently
 * registered in the process-global pi-ai OAuth registry and in each
 * ModelRegistry instance.
 *
 * ## Invariant
 *
 * Any `ModelRegistry.create()` or `ModelRegistry.refresh()` call must be fed
 * through a path that loads these factories first; otherwise a cold
 * registry-reset can remove grok-cli / kiro from the global pi-ai provider set.
 */

import { createJiti } from "jiti";
import type { ExtensionFactory, InlineExtension } from "@earendil-works/pi-coding-agent";

// pi-grok-cli and pi-kiro-provider publish TypeScript source with ESM-style
// `.js` specifiers. Loading them through jiti keeps the extensions in the
// server runtime instead of asking Next/Turbopack to resolve their source
// trees as application modules.

/**
 * Named inline extension wrapping the pi-grok-cli default factory.
 *
 * The extension registers `grok-cli` models, OAuth provider, tools, vision,
 * Imagine, and request hooks. It is the only publicly stable entry point the
 * package exports.
 */
export const grokCliExtension: InlineExtension = {
  name: "pi-grok-cli",
  factory: async (api) => {
    try {
      // Use jiti's async loader so its ESM helper is not synchronously required
      // while Pi's own extension loader is initializing in another module thread.
      const loaded = await createJiti(import.meta.url, { interopDefault: true }).import("pi-grok-cli");
      const factory = (loaded as { default?: ExtensionFactory }).default;
      if (typeof factory !== "function") throw new Error("pi-grok-cli did not export an extension factory");
      await factory(api);
    } catch {
      // Best-effort per provider: a Grok load failure must not block Kiro or
      // native providers. Models/Auth diagnostics surface the missing provider.
    }
  },
};

/**
 * Named inline extension wrapping the pi-kiro-provider default factory.
 *
 * The extension registers the `kiro` provider and OAuth methods (Builder ID /
 * Google / GitHub). Only the package public default export is used — never
 * private `src/` paths.
 */
export const kiroProviderExtension: InlineExtension = {
  name: "pi-kiro-provider",
  factory: async (api) => {
    try {
      const loaded = await createJiti(import.meta.url, { interopDefault: true }).import("pi-kiro-provider");
      const factory = (loaded as { default?: ExtensionFactory }).default;
      if (typeof factory !== "function") throw new Error("pi-kiro-provider did not export an extension factory");
      await factory(api);
    } catch {
      // Best-effort per provider: a Kiro load failure must not block Grok or
      // native providers. Models/Auth diagnostics surface the missing provider.
    }
  },
};

/**
 * @deprecated Session Authorization pin is retired. Grok main inference now
 * uses the global Active account via auth.json + live reload. This export is
 * kept only so historical tests can assert the pin path is no longer wired
 * into `webExtensionFactories()`.
 */
export const grokSessionAccountExtension: InlineExtension = {
  name: "grok-session-account",
  factory: () => {
    // Intentionally empty — session pin no longer overrides Authorization.
  },
};

/**
 * Fixed Web provider extension list (Grok + Kiro).
 *
 * Always load both before any call-site `extra` factories so ModelRegistry
 * refresh cannot drop either provider from the process-global set.
 */
export function webProviderExtensions(): InlineExtension[] {
  return [grokCliExtension, kiroProviderExtension];
}

/**
 * Return the standard Web extension factory list with fixed providers prepended.
 *
 * Order: Grok → Kiro → `extra` factories (YPI Studio, Browser Share, Studio
 * child guard, etc.).
 *
 * Main inference no longer injects a session-bound Authorization header;
 * Grok requests use the global Active account from auth.json, reloaded into
 * live wrappers after Activate / auto-failover.
 */
export function webExtensionFactories(extra: InlineExtension[] = []): InlineExtension[] {
  return [...webProviderExtensions(), ...extra];
}

// ---------------------------------------------------------------------------
// Cold-bootstrap guard for standalone ModelRegistry.create() callers
// ---------------------------------------------------------------------------

/**
 * One-shot promise that ensures fixed Web providers (Grok + Kiro) are
 * registered in the process-global pi-ai OAuth/provider registry before any
 * standalone `ModelRegistry.create()` call. Without this, a cold
 * `ModelRegistry` that later calls `refresh()` can reset the global registry
 * and drop grok-cli / kiro.
 *
 * This is intentionally lightweight: it creates a temporary services bundle
 * purely to trigger extension loading, then discards the services. The
 * extension registration is durable in the process-global pi-ai registry.
 */
let _webProvidersBootstrapPromise: Promise<void> | null = null;

export function ensureWebProvidersBootstrapped(): Promise<void> {
  if (_webProvidersBootstrapPromise) return _webProvidersBootstrapPromise;
  _webProvidersBootstrapPromise = _bootstrapWebProvidersOnce();
  return _webProvidersBootstrapPromise;
}

/**
 * @deprecated Prefer `ensureWebProvidersBootstrapped()`. Alias retained so
 * older Grok-named call sites and tests keep working during migration.
 */
export function ensureGrokBootstrapped(): Promise<void> {
  return ensureWebProvidersBootstrapped();
}

async function _bootstrapWebProvidersOnce(): Promise<void> {
  try {
    const { createAgentSessionServices, getAgentDir } = await import("@earendil-works/pi-coding-agent");
    // Create a throwaway services bundle just to load fixed providers into the
    // process-global pi-ai registry. We do NOT keep the returned services
    // alive — the registry side effect is all we need.
    await createAgentSessionServices({
      cwd: process.cwd(),
      agentDir: getAgentDir(),
      resourceLoaderOptions: { extensionFactories: webProviderExtensions() },
    });
  } catch {
    // Best-effort only. If the extension cannot load (missing dep, bad
    // permutation, etc.), other providers continue working and the Models /
    // Auth APIs will surface the error through their own diagnostics.
  }
}

/**
 * Create a ModelRegistry whose `refresh()` preserves fixed Web providers
 * (Grok + Kiro) in the global pi-ai provider set. Prefer
 * `createAgentSessionServices` with `webExtensionFactories()` for richer call
 * sites; use this helper only when you genuinely need a bare `ModelRegistry`
 * (e.g. when offline api-key management must not depend on a full
 * session-services load).
 */
export async function createWebProviderAwareModelRegistry(
  authStorage: import("@earendil-works/pi-coding-agent").AuthStorage,
  modelsPath?: string,
): Promise<import("@earendil-works/pi-coding-agent").ModelRegistry> {
  const { ModelRegistry } = await import("@earendil-works/pi-coding-agent");
  await ensureWebProvidersBootstrapped();
  return ModelRegistry.create(authStorage, modelsPath);
}

/**
 * @deprecated Prefer `createWebProviderAwareModelRegistry()`. Alias retained
 * for compatibility with older Grok-named call sites and tests.
 */
export async function createGrokAwareModelRegistry(
  authStorage: import("@earendil-works/pi-coding-agent").AuthStorage,
  modelsPath?: string,
): Promise<import("@earendil-works/pi-coding-agent").ModelRegistry> {
  return createWebProviderAwareModelRegistry(authStorage, modelsPath);
}
