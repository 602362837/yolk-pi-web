/**
 * pi-provider-extensions — unified provider extension factory list
 *
 * Every Web entrypoint that creates a ResourceLoader, calls
 * `createAgentSessionServices`, or bootstraps Auth/Models must include these
 * factories so dynamic providers (currently grok-cli) are consistently
 * registered in the process-global pi-ai OAuth registry and in each
 * ModelRegistry instance.
 *
 * ## Invariant
 *
 * Any `ModelRegistry.create()` or `ModelRegistry.refresh()` call must be fed
 * through a path that loads these factories first; otherwise a cold
 * registry-reset can remove grok-cli from the global pi-ai provider set.
 */

import { createJiti } from "jiti";
import type { ExtensionFactory, InlineExtension } from "@earendil-works/pi-coding-agent";

// pi-grok-cli publishes TypeScript source with ESM-style `.js` specifiers.
// Loading it through jiti keeps the extension in the server runtime instead
// of asking Next/Turbopack to resolve its source tree as an application module.
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
    // Use jiti's async loader so its ESM helper is not synchronously required
    // while Pi's own extension loader is initializing in another module thread.
    const loaded = await createJiti(import.meta.url, { interopDefault: true }).import("pi-grok-cli");
    const factory = (loaded as { default?: ExtensionFactory }).default;
    if (typeof factory !== "function") throw new Error("pi-grok-cli did not export an extension factory");
    await factory(api);
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
 * Return the standard Web extension factory list with Grok prepended.
 *
 * Order: Grok provider registration → `extra` factories (YPI Studio,
 * Browser Share, Studio child guard, etc.).
 *
 * Main inference no longer injects a session-bound Authorization header;
 * Grok requests use the global Active account from auth.json, reloaded into
 * live wrappers after Activate / auto-failover.
 */
export function webExtensionFactories(extra: InlineExtension[] = []): InlineExtension[] {
  return [grokCliExtension, ...extra];
}

// ---------------------------------------------------------------------------
// Cold-bootstrap guard for standalone ModelRegistry.create() callers
// ---------------------------------------------------------------------------

/**
 * One-shot promise that ensures grok-cli is registered in the process-global
 * pi-ai OAuth/provider registry before any standalone `ModelRegistry.create()`
 * call.  Without this, a cold `ModelRegistry` that later calls `refresh()`
 * can reset the global registry and drop grok-cli.
 *
 * This is intentionally lightweight: it creates a temporary services bundle
 * purely to trigger extension loading, then discards the services.  The
 * extension registration is durable in the process-global pi-ai registry.
 */
let _grokBootstrapPromise: Promise<void> | null = null;

export function ensureGrokBootstrapped(): Promise<void> {
  if (_grokBootstrapPromise) return _grokBootstrapPromise;
  _grokBootstrapPromise = _bootstrapGrokOnce();
  return _grokBootstrapPromise;
}

async function _bootstrapGrokOnce(): Promise<void> {
  try {
    const { createAgentSessionServices, getAgentDir } = await import("@earendil-works/pi-coding-agent");
    // Create a throwaway services bundle just to load grok-cli into the
    // process-global pi-ai registry.  We do NOT keep the returned services
    // alive — the registry side effect is all we need.
    await createAgentSessionServices({
      cwd: process.cwd(),
      agentDir: getAgentDir(),
      resourceLoaderOptions: { extensionFactories: [grokCliExtension] },
    });
  } catch {
    // Best-effort only.  If the extension cannot load (missing dep, bad
    // permutation, etc.), other providers continue working and the Models /
    // Auth APIs will surface the error through their own diagnostics.
  }
}

/**
 * Create a ModelRegistry whose `refresh()` preserves grok-cli in the global
 * pi-ai provider set.  Prefer `createAgentSessionServices` with the Grok
 * extension for richer call sites; use this helper only when you genuinely
 * need a bare `ModelRegistry` (e.g. when offline api-key management must not
 * depend on a full session-services load).
 */
export async function createGrokAwareModelRegistry(
  authStorage: import("@earendil-works/pi-coding-agent").AuthStorage,
  modelsPath?: string,
): Promise<import("@earendil-works/pi-coding-agent").ModelRegistry> {
  const { ModelRegistry } = await import("@earendil-works/pi-coding-agent");
  await ensureGrokBootstrapped();
  return ModelRegistry.create(authStorage, modelsPath);
}
