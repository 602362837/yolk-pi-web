/**
 * pi-provider-extensions — unified provider extension factory list
 *
 * Every Web entrypoint that creates a ResourceLoader, calls
 * `createAgentSessionServices`, or bootstraps Auth/Models must include these
 * factories so dynamic providers (currently grok-cli, kiro, and
 * google-antigravity) are consistently registered in the process-global pi-ai
 * OAuth registry and in each ModelRegistry instance.
 *
 * ## Invariant
 *
 * Any `ModelRegistry.create()` or `ModelRegistry.refresh()` call must be fed
 * through a path that loads these factories first; otherwise a cold
 * registry-reset can remove grok-cli / kiro / google-antigravity from the
 * global pi-ai provider set.
 */

import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createJiti, type Jiti } from "jiti";
import type { ExtensionFactory, InlineExtension } from "@earendil-works/pi-coding-agent";

// pi-grok-cli, pi-kiro-provider, and @yofriadi/pi-antigravity-oauth publish
// TypeScript source with ESM-style `.js` / `.ts` specifiers. Loading them
// through jiti keeps the extensions in the server runtime instead of asking
// Next/Turbopack to resolve their source trees as application modules.
//
// Runtime anchors must NEVER use import.meta.url as the sole jiti/createRequire
// base. Next production bundles rewrite import.meta.url to the build-machine
// absolute path, which breaks npm installs on other machines.

/** package.json path used as the stable jiti / createRequire anchor. */
export function resolveRuntimePackageAnchor(cwd: string = process.cwd()): string {
  return join(cwd, "package.json");
}

/**
 * Create a jiti loader anchored at the running package root (process.cwd()).
 *
 * `ypi` / `next start` set cwd to the package directory, so this resolves
 * published dependencies from that install's node_modules without baking
 * build-time absolute paths into the production bundle.
 */
export function createRuntimeJiti(cwd: string = process.cwd()): Jiti {
  return createJiti(resolveRuntimePackageAnchor(cwd), { interopDefault: true });
}

/**
 * Resolve an installed package's package.json without relying on import.meta.url.
 *
 * Prefer createRequire(process.cwd()/package.json), then walk node_modules from
 * cwd upward. Path-based fallbacks keep npm global / npx installs working even
 * when webpack mangles createRequire call sites.
 */
export function resolveInstalledPackageJson(
  packageName: string,
  cwd: string = process.cwd(),
): string {
  const errors: string[] = [];
  const segments = packageName.split("/").filter(Boolean);
  if (segments.length === 0) {
    throw new Error(`Invalid package name: ${packageName}`);
  }

  try {
    const resolved = createRequire(resolveRuntimePackageAnchor(cwd)).resolve(
      `${packageName}/package.json`,
    );
    if (typeof resolved === "string" && resolved.length > 0 && existsSync(resolved)) {
      return resolved;
    }
    errors.push(`createRequire resolved missing path: ${String(resolved)}`);
  } catch (err) {
    errors.push(`createRequire: ${err instanceof Error ? err.message : String(err)}`);
  }

  let dir = cwd;
  for (let i = 0; i < 12; i++) {
    const candidate = join(dir, "node_modules", ...segments, "package.json");
    if (existsSync(candidate)) return candidate;
    errors.push(`missing: ${candidate}`);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new Error(
    `Unable to resolve ${packageName}/package.json (${errors.join(" | ")})`,
  );
}

/** Fixed Antigravity OAuth callback bind host (loopback only). */
export const ANTIGRAVITY_OAUTH_CALLBACK_HOST = "127.0.0.1";

/** Env var read by @yofriadi/pi-antigravity-oauth at module import time. */
export const ANTIGRAVITY_OAUTH_CALLBACK_HOST_ENV = "PI_OAUTH_CALLBACK_HOST";

/**
 * Resolve the Antigravity OAuth callback host policy.
 *
 * Always returns loopback. Unset or non-loopback environment values must not
 * widen the listener surface — the package captures this env var as a module
 * constant on first import, so the Web loader forces the safe value first.
 */
export function resolveAntigravityOAuthCallbackHost(
  _envValue?: string | undefined,
): string {
  return ANTIGRAVITY_OAUTH_CALLBACK_HOST;
}

/**
 * Resolve the package's declared public Pi extension entry.
 *
 * `@yofriadi/pi-antigravity-oauth@0.3.0` ships TypeScript source without a
 * package `main`/`exports` map; the only public entry is `pi.extensions[0]`.
 * Never hardcode private package internals beyond that declared entry.
 */
function resolveAntigravityPackageJsonPath(): string {
  // Never anchor on import.meta.url — production bundles bake the build host path.
  return resolveInstalledPackageJson("@yofriadi/pi-antigravity-oauth");
}

export function resolveAntigravityPackageExtensionEntry(): string {
  const pkgJsonPath = resolveAntigravityPackageJsonPath();
  const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as {
    pi?: { extensions?: unknown };
  };
  const entry = Array.isArray(pkg.pi?.extensions) ? pkg.pi.extensions[0] : null;
  if (typeof entry !== "string" || entry.length === 0) {
    throw new Error("@yofriadi/pi-antigravity-oauth did not declare a pi.extensions entry");
  }
  const absoluteEntry = join(dirname(pkgJsonPath), entry);
  if (!existsSync(absoluteEntry)) {
    throw new Error(`@yofriadi/pi-antigravity-oauth extension entry missing: ${absoluteEntry}`);
  }
  return absoluteEntry;
}

/** Specifiers tried by jiti after package entry resolution (package has no main/exports). */
export function antigravityJitiImportCandidates(absoluteEntry: string): string[] {
  const candidates = [
    absoluteEntry,
    isAbsolute(absoluteEntry) ? pathToFileURL(absoluteEntry).href : absoluteEntry,
    // Package has no main/exports; the public TS entry is the only stable import path.
    "@yofriadi/pi-antigravity-oauth/src/index.ts",
  ];
  return [...new Set(candidates.filter((value) => typeof value === "string" && value.length > 0))];
}

/**
 * One-shot / single-flight loader for the Antigravity public extension factory.
 *
 * Forces `PI_OAUTH_CALLBACK_HOST=127.0.0.1` before the first jiti import so the
 * package's import-time `CALLBACK_HOST` constant cannot bind a non-loopback
 * interface. Concurrent callers share the same promise so env mutation stays
 * consistent for the critical section.
 */
let _antigravityFactoryPromise: Promise<ExtensionFactory> | null = null;

let _lastAntigravityLoadError: string | null = null;

/** Last Antigravity jiti load error message (null when healthy). Diagnostics only. */
export function getLastAntigravityProviderLoadError(): string | null {
  return _lastAntigravityLoadError;
}

export function loadAntigravityExtensionFactory(): Promise<ExtensionFactory> {
  if (_antigravityFactoryPromise) return _antigravityFactoryPromise;
  const run = (async (): Promise<ExtensionFactory> => {
    const envKey = ANTIGRAVITY_OAUTH_CALLBACK_HOST_ENV;
    const previous = process.env[envKey];
    process.env[envKey] = resolveAntigravityOAuthCallbackHost(previous);
    try {
      const entry = resolveAntigravityPackageExtensionEntry();
      // Anchor jiti at the running package root (not import.meta.url).
      const jiti = createRuntimeJiti();
      const candidates = antigravityJitiImportCandidates(entry);
      const loadErrors: string[] = [];
      for (const candidate of candidates) {
        try {
          const loaded = await jiti.import(candidate);
          const factory = (loaded as { default?: ExtensionFactory }).default;
          if (typeof factory !== "function") {
            throw new Error("@yofriadi/pi-antigravity-oauth did not export an extension factory");
          }
          _lastAntigravityLoadError = null;
          return factory;
        } catch (err) {
          loadErrors.push(`${candidate}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      throw new Error(
        `Failed to jiti-import @yofriadi/pi-antigravity-oauth (${loadErrors.join(" | ")})`,
      );
    } finally {
      // Module-level CALLBACK_HOST already captured the forced loopback value.
      // Restore the process env so other code sees the pre-import value.
      if (previous === undefined) delete process.env[envKey];
      else process.env[envKey] = previous;
    }
  })();
  // Single-flight: concurrent callers share this promise. On failure, clear so
  // a later attempt can retry instead of permanently caching rejection.
  _antigravityFactoryPromise = run.then(
    (factory) => factory,
    (err) => {
      _antigravityFactoryPromise = null;
      _lastAntigravityLoadError = err instanceof Error ? err.message : String(err);
      throw err;
    },
  );
  return _antigravityFactoryPromise;
}

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
      const loaded = await createRuntimeJiti().import("pi-grok-cli");
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
      const loaded = await createRuntimeJiti().import("pi-kiro-provider");
      const factory = (loaded as { default?: ExtensionFactory }).default;
      if (typeof factory !== "function") throw new Error("pi-kiro-provider did not export an extension factory");
      await factory(api);
    } catch {
      // Best-effort per provider: a Kiro load failure must not block Grok,
      // Antigravity, or native providers. Models/Auth diagnostics surface the
      // missing provider.
    }
  },
};

/**
 * Named inline extension wrapping the @yofriadi/pi-antigravity-oauth default
 * factory (provider id `google-antigravity`).
 *
 * Only the package's declared public Pi extension entry is loaded. Before the
 * first jiti import, the loader forces OAuth callback bind host to loopback
 * under a single-flight critical section. Remote Web users still use the
 * existing manual redirect URL paste path when browser localhost is not the
 * server.
 */
export const antigravityProviderExtension: InlineExtension = {
  name: "@yofriadi/pi-antigravity-oauth",
  factory: async (api) => {
    try {
      const factory = await loadAntigravityExtensionFactory();
      await factory(api);
    } catch (err) {
      // Best-effort per provider: an Antigravity load failure must not block
      // Grok, Kiro, or native providers. Log once-per-failure so silent Next
      // resolution issues are visible in the server log.
      const message = err instanceof Error ? err.message : String(err);
      _lastAntigravityLoadError = message;
      console.error("[pi-web] failed to load google-antigravity provider:", message);
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
 * Fixed Web provider extension list (Grok → Kiro → Antigravity).
 *
 * Always load all three before any call-site `extra` factories so ModelRegistry
 * refresh cannot drop any fixed provider from the process-global set.
 */
export function webProviderExtensions(): InlineExtension[] {
  return [grokCliExtension, kiroProviderExtension, antigravityProviderExtension];
}

/**
 * Return the standard Web extension factory list with fixed providers prepended.
 *
 * Order: Grok → Kiro → Antigravity → `extra` factories (YPI Studio, Browser
 * Share, Studio child guard, etc.).
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
 * One-shot promise that ensures fixed Web providers (Grok + Kiro +
 * Antigravity) are registered in the process-global pi-ai OAuth/provider
 * registry before any standalone `ModelRegistry.create()` call. Without this,
 * a cold `ModelRegistry` that later calls `refresh()` can reset the global
 * registry and drop grok-cli / kiro / google-antigravity.
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
 * (Grok + Kiro + Antigravity) in the global pi-ai provider set. Prefer
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
