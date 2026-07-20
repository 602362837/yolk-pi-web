/**
 * links-provider-registry — Links-only provider adapter registry
 *
 * ## Design
 *
 * - Allowlisted provider ids only; unknown providers fail closed.
 * - First provider: `github` (GitHub OAuth Device Flow).
 * - Adapters encapsulate provider-specific OAuth flows, token polling,
 *   and identity validation.
 * - This registry is isolated from LLM auth (oauth-accounts.ts,
 *   oauth-account-providers.ts, ModelRuntime, CredentialStore).
 *
 * ## Adding a provider
 *
 * 1. Add the id to `LinkProviderId` in `links-types.ts`.
 * 2. Add to `ALLOWLISTED_LINK_PROVIDERS`.
 * 3. Implement `LinkProviderAdapter`.
 * 4. Register in `getLinkProviderAdapter()`.
 */

import type {
  LinkProviderId,
  DeviceAuthorizationGrant,
  OAuthCredentialResult,
  ValidatedLinkIdentity,
} from "./links-types";
import { ALLOWLISTED_LINK_PROVIDERS, LINK_PROVIDER_DISPLAY_NAMES } from "./links-types";

// ─── Adapter interface ───────────────────────────────────────────────────────

export interface LinkProviderAdapter {
  /** Stable provider id matching an allowlisted id in links-types. */
  id: LinkProviderId;

  /** Human-readable display name for UI / errors. */
  displayName: string;

  /**
   * Initiate the provider's authorization flow.
   *
   * For GitHub Device Flow, this calls POST /login/device/code and returns
   * the device_code (internal only), user_code, verification_uri, expiry,
   * and polling interval.
   *
   * The returned device_code MUST NOT be serialized to wire/SSE/logs/disk.
   *
   * @param signal — abort to cancel the start request.
   */
  startAuthorization(input: {
    signal?: AbortSignal;
  }): Promise<DeviceAuthorizationGrant>;

  /**
   * Poll the provider's token endpoint.
   *
   * For GitHub Device Flow, this polls POST /login/oauth/access_token
   * with the device_code at the specified interval until the user
   * authorizes, denies, or the code expires.
   *
   * The returned access token MUST NOT be serialized to wire/SSE/logs.
   *
   * @param input.deviceCode — server-memory device_code (never on wire).
   * @param input.intervalSeconds — current polling interval.
   * @param input.expiresAt — ISO expiry from device code response.
   * @param input.signal — abort to cancel polling.
   */
  pollAuthorization(input: {
    deviceCode: string;
    intervalSeconds: number;
    expiresAt: string;
    signal?: AbortSignal;
  }): Promise<OAuthCredentialResult>;

  /**
   * Validate a credential by calling the provider's identity endpoint.
   *
   * For GitHub, this calls GET /user with the access token.
   *
   * The access token MUST NOT be serialized to wire/SSE/logs.
   *
   * @param input.accessToken — server-only access token.
   * @param input.signal — abort to cancel the request.
   */
  validateCredential(input: {
    accessToken: string;
    signal?: AbortSignal;
  }): Promise<ValidatedLinkIdentity>;
}

// ─── Registry ────────────────────────────────────────────────────────────────

/**
 * Provider id → adapter factory (lazy loaded).
 *
 * Only allowlisted providers are registered. Unknown ids are not in this
 * map and will fail closed in `getLinkProviderAdapter()`.
 */
const adapterFactories: Partial<
  Record<LinkProviderId, () => LinkProviderAdapter>
> = {};

/**
 * Register a provider adapter factory.
 *
 * Called once per provider during server initialization. Must be called
 * before any authorization/connection operation for that provider.
 *
 * Re-registration of the same provider replaces the factory (useful for tests).
 */
export function registerLinkProviderAdapter(
  providerId: LinkProviderId,
  factory: () => LinkProviderAdapter,
): void {
  if (!ALLOWLISTED_LINK_PROVIDERS.includes(providerId)) {
    throw new Error(
      `Links provider "${providerId}" is not allowlisted`,
    );
  }
  adapterFactories[providerId] = factory;
}

/**
 * Resolve a provider adapter by id.
 *
 * Returns `null` when the provider is unknown or the adapter is not
 * registered (fail closed — no path traversal, no network use).
 */
export function getLinkProviderAdapter(
  providerId: string,
): LinkProviderAdapter | null {
  if (!isAllowlistedLinkProvider(providerId)) return null;
  const factory = adapterFactories[providerId];
  if (!factory) return null;
  return factory();
}

/**
 * Check whether a provider id is in the allowlist.
 */
export function isAllowlistedLinkProvider(
  id: string,
): id is LinkProviderId {
  return (ALLOWLISTED_LINK_PROVIDERS as readonly string[]).includes(id);
}

/**
 * Get the display name for a provider, or the id itself if unknown.
 */
export function getLinkProviderDisplayName(id: string): string {
  if (isAllowlistedLinkProvider(id)) {
    return LINK_PROVIDER_DISPLAY_NAMES[id];
  }
  return id;
}
