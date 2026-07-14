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
 * Inline extension that overrides the Authorization header for grok-cli
 * requests with the session-bound account's access token.
 *
 * On every provider request, it looks up the session's bound Grok account
 * in the runtime registry, resolves the access token (with single-flight
 * refresh), and overrides the authorization header.  This is the mechanism
 * that ensures concurrent Grok sessions use their own account's token
 * regardless of which account is currently active in auth.json.
 *
 * Requests for non-grok-cli providers pass through unchanged.
 */
export const grokSessionAccountExtension: InlineExtension = {
  name: "grok-session-account",
  factory: (api) => {
    // Lazy-import to avoid module-level cycles with grok-session-account ↔ pi-provider-extensions
    let _resolver: {
      getGrokSessionAccount: (sessionId: string) => string | undefined;
      getGrokAccessToken: (storageId: string, opts?: { minValidityMs?: number; signal?: AbortSignal }) => Promise<{ accessToken: string; refreshed: boolean; expiresAt: number }>;
    } | null = null;

    const ensureResolver = async () => {
      if (_resolver) return _resolver;
      const mod = await import("./grok-session-account");
      const tok = await import("./grok-account-token");
      _resolver = {
        getGrokSessionAccount: mod.getGrokSessionAccount,
        getGrokAccessToken: tok.getGrokAccessToken,
      };
      return _resolver;
    };

    api.on("before_provider_headers", async (event, ctx) => {
      // Only override for grok-cli provider requests
      if (ctx.model?.provider !== "grok-cli") return;

      let sessionId: string | undefined;
      try {
        sessionId = ctx.sessionManager?.getSessionId?.();
      } catch {
        return;
      }
      if (!sessionId) return;

      const resolver = await ensureResolver();
      const storageId = resolver.getGrokSessionAccount(sessionId);
      if (!storageId) return;

      try {
        const token = await resolver.getGrokAccessToken(storageId, {
          minValidityMs: 120_000,
          signal: ctx.signal,
        });
        if (token.accessToken) {
          // Override the authorization header set by the SDK's default
          // auth resolution (which uses the global active account).
          event.headers["authorization"] = `Bearer ${token.accessToken}`;
        }
      } catch {
        // If we can't resolve the session-bound token, let the request
        // proceed with the default auth (active account).  The upstream
        // provider will 401 and the SDK's normal error path handles it.
      }
    });
  },
};

/**
 * Return the standard Web extension factory list with Grok prepended.
 *
 * Order: Grok provider registration → Grok session-account token injection
 * → `extra` factories (YPI Studio, Browser Share, Studio child guard, etc.).
 *
 * Grok session-account runs after provider registration so the OAuth
 * provider is available for token refresh, and before other extensions
 * so they see the session-bound Authorization header.
 */
export function webExtensionFactories(extra: InlineExtension[] = []): InlineExtension[] {
  return [grokCliExtension, grokSessionAccountExtension, ...extra];
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
