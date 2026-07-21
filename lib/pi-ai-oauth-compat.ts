/**
 * pi-ai-oauth-compat — temporary runtime shim for third-party fixed providers
 *
 * In pi-ai 0.80.8+, `@earendil-works/pi-ai/oauth` is a type-only entrypoint.
 * `pi-kiro-provider@0.2.2` still does:
 *
 *   import { registerOAuthProvider } from "@earendil-works/pi-ai/oauth";
 *   registerOAuthProvider(oauthProvider);
 *   pi.registerProvider(...);
 *
 * Without a runtime shim, the first call throws and the factory never reaches
 * `pi.registerProvider`, so Kiro never lands on the target ModelRuntime.
 *
 * This module is wired through `createRuntimeJiti()` aliases for extension load
 * and is also imported directly by Web non-active token refresh helpers. Active
 * request auth should prefer ModelRuntime.getAuth after consumer migration.
 */

import type { OAuthCredentials } from "@earendil-works/pi-ai";

/** Minimal legacy OAuth provider shape used by pre-0.80.8 extension packages. */
export interface LegacyOAuthProvider {
  id: string;
  name?: string;
  login?(callbacks: unknown): Promise<OAuthCredentials>;
  refreshToken?(credentials: OAuthCredentials): Promise<OAuthCredentials>;
  getApiKey?(credentials: OAuthCredentials): Promise<string | unknown> | string | unknown;
  modifyModels?(models: unknown[], credentials: OAuthCredentials): unknown[] | Promise<unknown[]>;
  [key: string]: unknown;
}

/** Result shape expected by Web token refresh helpers (0.80.7-compatible). */
export interface OAuthApiKeyResult {
  apiKey: string;
  newCredentials: OAuthCredentials;
}

const providers = new Map<string, LegacyOAuthProvider>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asOAuthCredentials(value: unknown): OAuthCredentials | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.access !== "string" || typeof value.refresh !== "string") return undefined;
  if (typeof value.expires !== "number") return undefined;
  return value as OAuthCredentials;
}

function resolveCredentialMap(
  credentials: OAuthCredentials | Record<string, unknown>,
  providerId: string,
): OAuthCredentials | undefined {
  // Historical callers pass either:
  //   1) a credential object directly, or
  //   2) { [providerId]: credential } (AuthStorage.getAll shape).
  const direct = asOAuthCredentials(credentials);
  if (direct) return direct;
  if (isRecord(credentials) && providerId in credentials) {
    return asOAuthCredentials(credentials[providerId]);
  }
  return undefined;
}

async function resolveProviderApiKey(
  provider: LegacyOAuthProvider,
  credentials: OAuthCredentials,
): Promise<string | undefined> {
  if (!provider.getApiKey) return undefined;
  const value = await provider.getApiKey(credentials);
  if (typeof value === "string" && value.length > 0) return value;
  if (
    value
    && typeof value === "object"
    && "token" in value
    && typeof (value as { token?: unknown }).token === "string"
  ) {
    return (value as { token: string }).token;
  }
  return undefined;
}

export function registerOAuthProvider(provider: LegacyOAuthProvider): void {
  if (!provider || typeof provider !== "object" || typeof provider.id !== "string" || !provider.id) {
    throw new Error("registerOAuthProvider requires a provider with a string id");
  }
  providers.set(provider.id, provider);
}

/**
 * Register only when the provider id is not already present.
 *
 * Used by production bridges that project a public ModelRuntime OAuth config
 * into this legacy map. Explicit test fixtures / native compat registrations
 * must not be overwritten by a later bridge attempt.
 *
 * @returns true when the provider was newly registered.
 */
export function registerOAuthProviderIfAbsent(provider: LegacyOAuthProvider): boolean {
  if (!provider || typeof provider !== "object" || typeof provider.id !== "string" || !provider.id) {
    throw new Error("registerOAuthProviderIfAbsent requires a provider with a string id");
  }
  if (providers.has(provider.id)) return false;
  providers.set(provider.id, provider);
  return true;
}

/**
 * Project a public extension/ModelRuntime OAuth config into the legacy registry.
 *
 * Does not copy secrets, endpoints, or private package modules — only the
 * already-constructed public function references from ProviderConfig.oauth.
 * Never overwrites an existing explicit registration.
 */
export function bridgePublicProviderOAuthToCompat(
  providerId: string,
  oauth: {
    name?: string;
    login?: LegacyOAuthProvider["login"];
    refreshToken?: LegacyOAuthProvider["refreshToken"];
    getApiKey?: LegacyOAuthProvider["getApiKey"];
    modifyModels?: LegacyOAuthProvider["modifyModels"];
  } | null | undefined,
): boolean {
  if (typeof providerId !== "string" || providerId.length === 0) return false;
  if (!oauth || typeof oauth !== "object") return false;

  const login = typeof oauth.login === "function" ? oauth.login : undefined;
  const refreshToken = typeof oauth.refreshToken === "function" ? oauth.refreshToken : undefined;
  const getApiKey = typeof oauth.getApiKey === "function" ? oauth.getApiKey : undefined;
  const modifyModels = typeof oauth.modifyModels === "function" ? oauth.modifyModels : undefined;
  if (!login && !refreshToken && !getApiKey) return false;

  return registerOAuthProviderIfAbsent({
    id: providerId,
    name: typeof oauth.name === "string" ? oauth.name : undefined,
    login,
    refreshToken,
    getApiKey,
    modifyModels,
  });
}

export function unregisterOAuthProvider(providerId: string): void {
  providers.delete(providerId);
}

export function getOAuthProvider(providerId: string): LegacyOAuthProvider | undefined {
  return providers.get(providerId);
}

export function getOAuthProviders(): LegacyOAuthProvider[] {
  return [...providers.values()];
}

/**
 * Legacy helper used by non-active saved-account token refresh paths.
 *
 * When the access token is still valid, returns the current key without network
 * refresh. When expired (or always when refreshToken is available and expires
 * is past), calls the registered provider's refreshToken then getApiKey.
 *
 * Prefer ModelRuntime.getAuth for Active auth.json request auth.
 */
export async function getOAuthApiKey(
  providerId: string,
  credentials: OAuthCredentials | Record<string, unknown>,
  options: { forceRefresh?: boolean } = {},
): Promise<OAuthApiKeyResult | null> {
  const provider = providers.get(providerId);
  if (!provider) return null;

  const current = resolveCredentialMap(credentials, providerId);
  if (!current) return null;

  const expires = typeof current.expires === "number" ? current.expires : 0;
  const needsRefresh = options.forceRefresh === true || Date.now() >= expires;

  let nextCredentials = current;
  if (needsRefresh) {
    if (typeof provider.refreshToken !== "function") {
      return null;
    }
    nextCredentials = await provider.refreshToken(current);
  }

  const apiKey = await resolveProviderApiKey(provider, nextCredentials);
  if (!apiKey) return null;
  return { apiKey, newCredentials: nextCredentials };
}

/** Test helper. */
export function __resetPiAiOauthCompatForTests(): void {
  providers.clear();
}

// Re-export credential type name used by some extension type imports.
export type { OAuthCredentials };
