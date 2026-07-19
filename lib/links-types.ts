/**
 * links-types — shared Links domain types, contracts, and stable error codes
 *
 * ## Isolation
 *
 * Links is a standalone domain. These types do NOT import or extend:
 * - auth.json / auth-accounts / auth-api-key-accounts
 * - CredentialStore / ModelRuntime / RPC auth reload
 * - oauth-accounts.ts / oauth-account-providers.ts
 * - pi-web.json settings
 *
 * ## Security boundary
 *
 * - device_code / access_token / refresh_token / client_secret are NOT
 *   wire fields and must never appear in API responses, SSE frames, DOM
 *   state, logs, or metadata.
 * - userCode is intentionally visible — it is the short-term code GitHub
 *   shows the user; it must be cleared from browser state on terminal
 *   states, view changes, and unmount.
 * - error codes are fixed allowlists; raw upstream bodies/paths/stacks
 *   must not leak through message strings.
 */

// ─── Provider identity ───────────────────────────────────────────────────────

/** Allowlisted Links provider ids. Add new providers here only after review. */
export type LinkProviderId = "github";

export const ALLOWLISTED_LINK_PROVIDERS: readonly LinkProviderId[] = ["github"] as const;

/** Human-readable display names for allowlisted providers. */
export const LINK_PROVIDER_DISPLAY_NAMES: Record<LinkProviderId, string> = {
  github: "GitHub",
} as const;

// ─── Connection metadata (safe for API / UI) ─────────────────────────────────

export type LinkConnectionStatus = "connected" | "disconnected";

export interface LinkConnectionMetadata {
  /** Opaque random id — never contains login, user id, or token hash. */
  id: string;
  provider: LinkProviderId;
  /** User-facing label derived from login (e.g. "@octocat"). */
  label: string;
  /** GitHub login (username). */
  login: string;
  /** GitHub numeric user id as a string (e.g. "583231"). */
  providerUserId: string;
  status: LinkConnectionStatus;
  /** P0 always ["read:user"]. */
  requestedScopes: string[];
  /** Scopes returned by GitHub token endpoint (sorted, deduped). */
  grantedScopes: string[];
  createdAt: string;
  updatedAt: string;
  /** ISO timestamp of last successful /user validation. */
  lastValidatedAt: string;
  /** ISO timestamp when disconnected (soft-delete metadata). */
  deletedAt?: string;
  /** Future: reserved for domain-level default marker; P0 not consumed. */
  isDefault?: boolean;
}

// ─── OAuth credential (server-only, never on wire) ───────────────────────────

export interface GitHubOAuthSecretV1 {
  schemaVersion: 1;
  kind: "github_oauth";
  accessToken: string;
  tokenType: "bearer";
  /** epoch millis when token was issued/received. */
  issuedAt: number;
  /** epoch millis when token expires (0 = unknown). */
  expiresAt: number;
  /** Scopes from token response (sorted, deduped). */
  grantedScopes: string[];
}

// ─── GitHub Device Flow grant (internal, device_code never on wire) ──────────

export interface DeviceAuthorizationGrant {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

// ─── Validated identity ──────────────────────────────────────────────────────

export interface ValidatedLinkIdentity {
  login: string;
  providerUserId: string;
  /** Optional display fields for label generation only. */
  name?: string;
  avatarUrl?: string;
}

// ─── OAuth credential result (internal, access token never on wire) ──────────

export interface OAuthCredentialResult {
  accessToken: string;
  tokenType: "bearer";
  expiresAt: number;
  grantedScopes: string[];
}

// ─── Authorization state machine ─────────────────────────────────────────────

export type LinkAuthorizationStatus =
  | "starting"
  | "awaiting_user"
  | "polling"
  | "validating_identity"
  | "persisting"
  | "connected"
  | "duplicate"
  | "denied"
  | "expired"
  | "cancelled"
  | "failed";

/** Terminal authorization states — retained for short TTL for SSE reconnect. */
export const TERMINAL_AUTHORIZATION_STATUSES: ReadonlySet<LinkAuthorizationStatus> =
  new Set(["connected", "duplicate", "denied", "expired", "cancelled", "failed"]);

/** Non-terminal (active) authorization states. */
export function isActiveAuthorizationStatus(
  s: LinkAuthorizationStatus,
): boolean {
  return !TERMINAL_AUTHORIZATION_STATUSES.has(s);
}

// ─── Authorization snapshot (SSE-safe, no device_code / access token) ────────

export interface LinkAuthorizationSnapshot {
  /** Opaque authorization id — never contains secrets or identity. */
  authorizationId: string;
  provider: LinkProviderId;
  status: LinkAuthorizationStatus;
  /** Short-term GitHub user code (only when awaiting_user / polling). */
  userCode?: string;
  /** Fixed GitHub device verification page. */
  verificationUri?: string;
  /** ISO timestamp when this authorization expires. */
  expiresAt?: string;
  /** Recommended polling interval in seconds. */
  intervalSeconds?: number;
  /** P0 always ["read:user"]. */
  requestedScopes?: string[];
  /**
   * Sanitized connection summary (only on connected).
   * Excludes internal ids, tokens, and raw upstream data.
   */
  connection?: LinkConnectionMetadata;
  /**
   * For duplicate: the existing connection's safe subset so UI can highlight it.
   */
  existingConnectionId?: string;
  existingConnectionLogin?: string;
  /** Stable error code (on failed / denied / expired). */
  errorCode?: LinkAuthorizationErrorCode;
  /** Safe error message — never contains device_code, access token, or raw upstream body. */
  errorMessage?: string;
}

// ─── Authorization session (internal, device_code / access token present) ────

export interface LinkAuthorizationSession {
  authorizationId: string;
  provider: LinkProviderId;
  status: LinkAuthorizationStatus;
  /** Short-term GitHub user code (safe to show). */
  userCode: string;
  /** GitHub device verification page (fixed). */
  verificationUri: string;
  /** ISO expiration timestamp. */
  expiresAt: string;
  /** Current polling interval in seconds. */
  intervalSeconds: number;
  /** Internal: GitHub device_code — NEVER on wire, NEVER logged, NEVER persisted. */
  deviceCode: string;
  /** Internal: OAuth credential result after successful polling (cleared after persist). */
  credential?: OAuthCredentialResult;
  /** Validated identity after /user call (cleared after persist). */
  identity?: ValidatedLinkIdentity;
  /** Sanitized connection after persist. */
  connection?: LinkConnectionMetadata;
  /** Existing connection id on duplicate. */
  existingConnectionId?: string;
  existingConnectionLogin?: string;
  /** Abort controller for background polling / validation. */
  abortController: AbortController;
  /** Subscribers to notify on state changes. */
  subscribers: Set<(snapshot: LinkAuthorizationSnapshot) => void>;
  /** When the session was created (epoch ms). */
  createdAt: number;
  /** When the session entered a terminal state (epoch ms) for TTL cleanup. */
  terminalAt?: number;
  /** Background polling task (resolves when done / cancelled / errored). */
  backgroundTask?: Promise<void>;
  /** Safe error for terminal states. */
  errorCode?: LinkAuthorizationErrorCode;
  errorMessage?: string;
}

// ─── Stable error codes ──────────────────────────────────────────────────────

export type LinkAuthorizationErrorCode =
  // 400-level
  | "invalid_request"
  // 404
  | "authorization_not_found"
  | "connection_not_found"
  | "provider_not_found"
  // 409
  | "duplicate_identity"
  // 429
  | "authorization_capacity_exceeded"
  | "github_rate_limited"
  // 500-level
  | "links_store_error"
  | "github_bad_response"
  | "github_authorization_not_configured"
  | "github_unavailable"
  | "github_timeout"
  // SSE terminal
  | "github_access_denied"
  | "github_authorization_expired"
  | "github_device_flow_disabled"
  | "github_client_invalid"
  // upstream / network
  | "github_network_error"
  | "github_invalid_response"
  | "github_identity_invalid"
  // internal
  | "internal_error";

// ─── Provider catalog response ───────────────────────────────────────────────

export interface LinkProviderCatalogEntry {
  id: LinkProviderId;
  displayName: string;
  /** Whether the server has the required OAuth client configuration. */
  authorizationConfigured: boolean;
  /** Number of active (connected) connections. */
  connectionCount: number;
}

export interface LinksCatalogResponse {
  providers: LinkProviderCatalogEntry[];
}

// ─── Authorization start response (wire-safe) ────────────────────────────────

export interface LinkAuthorizationStartResponse {
  authorization: {
    id: string;
    status: "awaiting_user";
    userCode: string;
    verificationUri: string;
    expiresAt: string;
    intervalSeconds: number;
    requestedScopes: string[];
  };
}

// ─── Connections list item (wire-safe) ───────────────────────────────────────

export type LinkConnectionListItem = LinkConnectionMetadata;

export interface LinksConnectionsResponse {
  provider: LinkProviderId;
  connections: LinkConnectionListItem[];
}

// ─── Disconnect response ─────────────────────────────────────────────────────

export interface LinkDisconnectResponse {
  disconnectedId: string;
}

// ─── Cancel response ─────────────────────────────────────────────────────────

export interface LinkCancelResponse {
  cancelledId: string;
}

// ─── Safe error response ─────────────────────────────────────────────────────

export interface LinkErrorResponse {
  error: {
    code: LinkAuthorizationErrorCode;
    message: string;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Fixed P0 requested scopes. Client input cannot alter this.
 */
export const LINKS_P0_REQUESTED_SCOPES: readonly string[] = ["read:user"] as const;

/**
 * Fixed GitHub verification URI. Only this HTTPS host is accepted.
 */
export const GITHUB_DEVICE_VERIFICATION_URI = "https://github.com/login/device" as const;

/**
 * Fixed GitHub API endpoints used by the adapter.
 * Host/path/scopes are fixed; client input cannot alter them.
 */
export const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code" as const;
export const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token" as const;
export const GITHUB_USER_API_URL = "https://api.github.com/user" as const;

/**
 * Validate that an opaque id is safe (no path traversal, URL schemes, or secret material).
 */
export function isValidOpaqueId(id: unknown): id is string {
  if (typeof id !== "string") return false;
  if (id.length === 0 || id.length > 256) return false;
  if (id.includes("/") || id.includes("\\") || id.includes("..")) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(id)) return false; // no URL schemes
  return true;
}
