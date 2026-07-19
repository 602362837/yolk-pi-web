/**
 * links-authorization-manager — in-process authorization state machine
 *
 * ## Design
 *
 * Manages short-lived authorization sessions in `globalThis.__piLinkAuthorizations`.
 * Each session tracks the full Device Flow lifecycle:
 *
 *   starting → awaiting_user → polling → validating_identity →
 *     persisting → connected | duplicate | failed
 *
 * Alternative terminal paths: denied, expired, cancelled, failed.
 *
 * ## Security
 *
 * - device_code and access_token are stored ONLY in server-memory
 *   authorization sessions and are NEVER exposed in snapshots, SSE,
 *   API responses, logs, or error messages.
 * - Snapshots are sanitized before dispatch to subscribers.
 * - Pending sessions are never persisted to disk.
 * - Terminal sessions are retained for a short TTL (2 min) for SSE
 *   reconnect, then cleaned up.
 *
 * ## Isolation
 *
 * Does NOT import oauth-accounts.ts, web-credential-store.ts,
 * web-model-runtime.ts, rpc-manager.ts, or any LLM auth module.
 */

import { randomUUID } from "node:crypto";
import type {
  LinkProviderId,
  LinkAuthorizationStatus,
  LinkAuthorizationSnapshot,
  LinkAuthorizationSession,
  LinkConnectionMetadata,
  LinkAuthorizationErrorCode,
  ValidatedLinkIdentity,
  OAuthCredentialResult,
} from "./links-types";
import { isActiveAuthorizationStatus } from "./links-types";
import { getLinkProviderAdapter } from "./links-provider-registry";
import { attemptPollAccessToken, validateGitHubIdentity } from "./github-link-oauth";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum number of concurrent authorization sessions. */
const MAX_AUTHORIZATIONS = 20;

/** TTL for terminal authorization sessions (ms) — retained for SSE reconnect. */
const TERMINAL_TTL_MS = 2 * 60 * 1000;

/** Minimum polling interval in ms. */
const MIN_POLL_INTERVAL_MS = 5_000;

/** Maximum polling interval in ms. */
const MAX_POLL_INTERVAL_MS = 60_000;

/** Jitter margin before expiry checks (ms). We stop polling slightly before
 *  actual expiry to avoid race conditions. */
const EXPIRY_JITTER_MS = 5_000;

// ─── Global state ────────────────────────────────────────────────────────────

interface AuthorizationRegistry {
  /** Map of opaque authorization id → session. */
  sessions: Map<string, LinkAuthorizationSession>;
  /** Total active (non-terminal) sessions count. */
  activeCount: number;
}

const GLOBAL_KEY = "__piLinkAuthorizations" as const;

function getRegistry(): AuthorizationRegistry {
  const g = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: AuthorizationRegistry;
  };
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      sessions: new Map(),
      activeCount: 0,
    };
  }
  return g[GLOBAL_KEY];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function epochNow(): number {
  return Date.now();
}

function parseExpiresAtToMs(expiresAt: string): number {
  const ts = Date.parse(expiresAt);
  if (!Number.isFinite(ts)) return 0;
  return ts;
}

function generateAuthorizationId(): string {
  return `la_${randomUUID()}`;
}

/**
 * Sanitize a session into a wire-safe snapshot.
 * device_code, access token, and raw upstream data are EXCLUDED.
 */
function sanitizeSnapshot(
  session: LinkAuthorizationSession,
): LinkAuthorizationSnapshot {
  const snapshot: LinkAuthorizationSnapshot = {
    authorizationId: session.authorizationId,
    provider: session.provider,
    status: session.status,
  };

  // userCode is intentionally included — GitHub designed it for display.
  // It is cleared on terminal states by the manager.
  if (session.userCode && isActiveAuthorizationStatus(session.status)) {
    snapshot.userCode = session.userCode;
  }
  if (session.verificationUri) {
    snapshot.verificationUri = session.verificationUri;
  }
  if (session.expiresAt) {
    snapshot.expiresAt = session.expiresAt;
  }
  if (session.intervalSeconds) {
    snapshot.intervalSeconds = session.intervalSeconds;
  }

  // requestedScopes from the adapter / constants
  snapshot.requestedScopes = ["read:user"];

  // Connected: include sanitized connection summary
  if (session.status === "connected" && session.connection) {
    snapshot.connection = session.connection;
  }

  // Duplicate: include existing connection safe subset
  if (session.status === "duplicate") {
    snapshot.existingConnectionId = session.existingConnectionId;
    snapshot.existingConnectionLogin = session.existingConnectionLogin;
  }

  // Error states: include safe error code/message
  if (session.errorCode) {
    snapshot.errorCode = session.errorCode;
  }
  if (session.errorMessage) {
    snapshot.errorMessage = session.errorMessage;
  }

  return snapshot;
}

/**
 * Set the session status and notify all subscribers.
 */
function setStatus(
  session: LinkAuthorizationSession,
  status: LinkAuthorizationStatus,
): void {
  const wasActive = isActiveAuthorizationStatus(session.status);
  session.status = status;
  const isNowActive = isActiveAuthorizationStatus(status);

  // Track active count
  const registry = getRegistry();
  if (wasActive && !isNowActive) {
    registry.activeCount = Math.max(0, registry.activeCount - 1);
    session.terminalAt = epochNow();
    // Clear sensitive display fields on terminal
    session.userCode = "";
  } else if (!wasActive && isNowActive) {
    registry.activeCount += 1;
  }

  // Notify subscribers
  const snapshot = sanitizeSnapshot(session);
  for (const sub of session.subscribers) {
    try {
      sub(snapshot);
    } catch {
      // Subscriber errors must not break other subscribers or the manager.
    }
  }
}

// ─── Background polling ──────────────────────────────────────────────────────

/**
 * Wait for `ms` milliseconds, respecting an AbortSignal.
 */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Background polling task for a Device Flow authorization.
 *
 * This runs independently of SSE subscribers — the browser can disconnect
 * and the polling continues. On success, the credential is validated and
 * the session is transitioned to a persistent state.
 *
 * device_code and access token never leave this function's scope except
 * through the adapter's validateCredential call.
 */
async function runBackgroundPolling(session: LinkAuthorizationSession): Promise<void> {
  const registry = getRegistry();
  const adapter = getLinkProviderAdapter(session.provider);
  if (!adapter) {
    setError(session, "provider_not_found", `Provider "${session.provider}" is not available`);
    return;
  }

  const { abortController, deviceCode } = session;
  const signal = abortController.signal;
  let intervalMs = session.intervalSeconds * 1000;
  if (intervalMs < MIN_POLL_INTERVAL_MS) intervalMs = MIN_POLL_INTERVAL_MS;
  if (intervalMs > MAX_POLL_INTERVAL_MS) intervalMs = MAX_POLL_INTERVAL_MS;

  const expiresAtMs = parseExpiresAtToMs(session.expiresAt);

  // Transition to polling state
  setStatus(session, "polling");

  while (true) {
    // Check abort
    if (signal.aborted) return;

    // Check if session was removed (e.g., cancelled externally)
    if (!registry.sessions.has(session.authorizationId)) return;

    // Check expiry
    if (expiresAtMs > 0 && epochNow() > expiresAtMs - EXPIRY_JITTER_MS) {
      setError(session, "github_authorization_expired", "Device authorization expired");
      return;
    }

    try {
      const result = await attemptPollAccessToken(deviceCode, signal);

      if (signal.aborted) return;
      if (!registry.sessions.has(session.authorizationId)) return;

      if (result.credential) {
        // Success — validate identity
        setStatus(session, "validating_identity");

        try {
          const identity = await validateGitHubIdentity(
            result.credential.accessToken,
            signal,
          );

          if (signal.aborted) return;
          if (!registry.sessions.has(session.authorizationId)) return;

          // Store credential + identity in session for the persist step
          session.credential = result.credential;
          session.identity = identity;
          setStatus(session, "persisting");

          // Invoke persist handler if registered (independent of SSE subscribers).
          // The handler runs in the background and must not throw — errors are
          // handled within the handler (via markAuthorizationFailed).
          // API start routes must register the handler before polling can finish;
          // if it is still missing, fail closed rather than leave the session stuck
          // in `persisting` (capacity leak + unpersisted grant).
          const handler = _persistHandler;
          if (handler) {
            handler(session.authorizationId).catch(() => {
              // Handler errors are self-contained; fallback handled by TTL cleanup.
            });
          } else {
            setError(
              session,
              "internal_error",
              "Authorization completed but the persist handler was not registered",
            );
          }
          return;
        } catch {
          if (signal.aborted) return;
          setError(
            session,
            "github_identity_invalid",
            "GitHub user identity could not be validated",
          );
          return;
        }
      }

      if (result.error) {
        // Terminal error from polling
        setError(session, result.error.code, result.error.message);
        return;
      }

      if (result.slowDown) {
        // GitHub requested slower polling
        if (
          result.newIntervalSeconds &&
          result.newIntervalSeconds > 0
        ) {
          intervalMs = Math.min(
            Math.max(result.newIntervalSeconds * 1000, MIN_POLL_INTERVAL_MS),
            MAX_POLL_INTERVAL_MS,
          );
          session.intervalSeconds = Math.round(intervalMs / 1000);
        } else {
          intervalMs = Math.min(intervalMs + MIN_POLL_INTERVAL_MS, MAX_POLL_INTERVAL_MS);
          session.intervalSeconds = Math.round(intervalMs / 1000);
        }
      }

      // pending — continue polling after interval
    } catch {
      if (signal.aborted) return;
      if (!registry.sessions.has(session.authorizationId)) return;

      // Network error during polling — treat as terminal with a safe message.
      setError(
        session,
        "github_network_error",
        "Network error contacting GitHub during authorization polling",
      );
      return;
    }

    // Wait for the polling interval
    try {
      await delay(intervalMs, signal);
    } catch {
      // Aborted during wait
      return;
    }
  }
}

function setError(
  session: LinkAuthorizationSession,
  code: LinkAuthorizationErrorCode,
  message: string,
): void {
  // Ensure the message never contains raw upstream data.
  // All callers of setError already pass safe messages.
  session.errorCode = code;
  session.errorMessage = message;

  if (code === "github_authorization_expired") {
    setStatus(session, "expired");
  } else if (code === "github_access_denied") {
    setStatus(session, "denied");
  } else {
    setStatus(session, "failed");
  }
}

// ─── Persist handler (bridge to store, called by background task) ────────────

/**
 * Handler invoked by the background polling task when a session reaches
 * the `persisting` state (credential validated, ready to store).
 *
 * Registered by the API layer. Runs independently of SSE subscribers —
 * persistence completes even if the browser disconnects.
 *
 * The handler receives the authorization session and must:
 * 1. Call `getPersistingCredential()` to get the credential + identity.
 * 2. Call the store to persist the connection.
 * 3. Call `markAuthorizationConnected/Duplicate/Failed()` based on the result.
 */
export type LinksPersistHandler = (
  authorizationId: string,
) => Promise<void>;

let _persistHandler: LinksPersistHandler | null = null;

/**
 * Set the global persist handler for Links authorizations.
 *
 * Called once by the API layer during initialization. Must be
 * re-entrant — the handler should handle multiple concurrent
 * invocations.
 */
export function setLinksPersistHandler(handler: LinksPersistHandler | null): void {
  _persistHandler = handler;
}

/**
 * Get the current persist handler (for tests).
 */
export function getLinksPersistHandler(): LinksPersistHandler | null {
  return _persistHandler;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Start a new Device Flow authorization for a provider.
 *
 * Returns the initial authorization snapshot (safe for API/SSE).
 * device_code stays in server memory only.
 *
 * @throws if capacity exceeded, provider not found, or start fails.
 */
export async function startAuthorization(
  provider: LinkProviderId,
): Promise<LinkAuthorizationSnapshot> {
  const registry = getRegistry();

  // Capacity check
  if (registry.activeCount >= MAX_AUTHORIZATIONS) {
    throw Object.assign(
      new Error("Too many active authorizations. Please wait and try again."),
      {
        code: "authorization_capacity_exceeded" as LinkAuthorizationErrorCode,
      },
    );
  }

  const adapter = getLinkProviderAdapter(provider);
  if (!adapter) {
    throw Object.assign(
      new Error(`Links provider "${provider}" is not available`),
      { code: "provider_not_found" as LinkAuthorizationErrorCode },
    );
  }

  // Start the Device Flow
  const abortController = new AbortController();
  let grant;
  try {
    grant = await adapter.startAuthorization({ signal: abortController.signal });
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err) {
      throw err;
    }
    throw Object.assign(
      new Error("Failed to start Device Flow authorization"),
      { code: "github_unavailable" as LinkAuthorizationErrorCode },
    );
  }

  const authorizationId = generateAuthorizationId();
  const expiresAt = new Date(
    epochNow() + grant.expiresIn * 1000,
  ).toISOString();
  const intervalSeconds = Math.max(grant.interval, 5);

  const session: LinkAuthorizationSession = {
    authorizationId,
    provider,
    status: "awaiting_user",
    userCode: grant.userCode,
    verificationUri: grant.verificationUri,
    expiresAt,
    intervalSeconds,
    deviceCode: grant.deviceCode,
    abortController,
    subscribers: new Set(),
    createdAt: epochNow(),
    backgroundTask: undefined,
  };

  registry.sessions.set(authorizationId, session);
  registry.activeCount += 1;

  // Start background polling (decoupled from subscribers)
  const backgroundTask = runBackgroundPolling(session).catch(() => {
    // Errors are already handled in the polling loop via setError.
  });
  session.backgroundTask = backgroundTask;

  return sanitizeSnapshot(session);
}

/**
 * Subscribe to authorization state changes via callback.
 *
 * Returns the current snapshot immediately, then calls the callback
 * on every state transition. The callback receives a sanitized
 * snapshot (no device_code / access token).
 *
 * Returns an unsubscribe function.
 */
export function subscribeToAuthorization(
  authorizationId: string,
  callback: (snapshot: LinkAuthorizationSnapshot) => void,
): () => void {
  const registry = getRegistry();
  const session = registry.sessions.get(authorizationId);

  if (!session) {
    // Session doesn't exist — emit a terminal snapshot
    callback({
      authorizationId,
      provider: "github" as LinkProviderId,
      status: "expired",
      errorCode: "authorization_not_found",
      errorMessage: "Authorization session not found or expired",
    });
    return () => {};
  }

  // Send current snapshot immediately
  callback(sanitizeSnapshot(session));

  // Subscribe for future changes
  session.subscribers.add(callback);

  return () => {
    session.subscribers.delete(callback);
  };
}

/**
 * Cancel an active authorization.
 *
 * Aborts background polling and transitions to cancelled state.
 * Idempotent: terminal/unknown sessions return a clean result without error.
 */
export function cancelAuthorization(
  authorizationId: string,
): { cancelled: boolean } {
  const registry = getRegistry();
  const session = registry.sessions.get(authorizationId);

  if (!session) {
    return { cancelled: false };
  }

  if (!isActiveAuthorizationStatus(session.status)) {
    return { cancelled: false };
  }

  // Abort background polling
  session.abortController.abort();

  // Transition to cancelled
  setStatus(session, "cancelled");

  return { cancelled: true };
}

/**
 * Get the current snapshot for an authorization.
 * Returns null if the session does not exist.
 */
export function getAuthorizationSnapshot(
  authorizationId: string,
): LinkAuthorizationSnapshot | null {
  const registry = getRegistry();
  const session = registry.sessions.get(authorizationId);
  if (!session) return null;
  return sanitizeSnapshot(session);
}

/**
 * Mark an authorization as connected with a sanitized connection.
 *
 * Called by the store layer after successful persistence.
 * Transitions from `persisting` → `connected`.
 */
export function markAuthorizationConnected(
  authorizationId: string,
  connection: LinkConnectionMetadata,
): void {
  const registry = getRegistry();
  const session = registry.sessions.get(authorizationId);
  if (!session) return;
  if (session.status !== "persisting") return;

  session.connection = connection;
  // Clear sensitive internal fields
  session.credential = undefined;
  session.identity = undefined;
  session.deviceCode = "";
  setStatus(session, "connected");
}

/**
 * Mark an authorization as duplicate with the existing connection info.
 *
 * Called by the store layer when a duplicate identity is detected.
 */
export function markAuthorizationDuplicate(
  authorizationId: string,
  existingConnectionId: string,
  existingConnectionLogin: string,
): void {
  const registry = getRegistry();
  const session = registry.sessions.get(authorizationId);
  if (!session) return;
  if (session.status !== "persisting") return;

  session.existingConnectionId = existingConnectionId;
  session.existingConnectionLogin = existingConnectionLogin;
  // Clear sensitive internal fields (new token is not written)
  session.credential = undefined;
  session.identity = undefined;
  session.deviceCode = "";
  setStatus(session, "duplicate");
}

/**
 * Mark an authorization as failed during the persist step.
 */
export function markAuthorizationFailed(
  authorizationId: string,
  code: LinkAuthorizationErrorCode,
  message: string,
): void {
  const registry = getRegistry();
  const session = registry.sessions.get(authorizationId);
  if (!session) return;

  setError(session, code, message);
}

/**
 * Get the credential and identity from a persisting session.
 *
 * Returns null if the session is not in `persisting` state.
 * The caller (store layer) is responsible for clearing these
 * values from the session after successful persistence.
 */
export function getPersistingCredential(
  authorizationId: string,
): {
  credential: OAuthCredentialResult;
  identity: ValidatedLinkIdentity;
} | null {
  const registry = getRegistry();
  const session = registry.sessions.get(authorizationId);
  if (!session) return null;
  if (session.status !== "persisting") return null;
  if (!session.credential || !session.identity) return null;

  return {
    credential: session.credential,
    identity: session.identity,
  };
}

/**
 * Clean up terminal authorization sessions past their TTL.
 *
 * Should be called periodically (e.g., on each new authorization start
 * or via a lightweight timer).
 */
export function cleanupTerminalAuthorizations(): void {
  const registry = getRegistry();
  const now = epochNow();

  for (const [id, session] of registry.sessions) {
    if (isActiveAuthorizationStatus(session.status)) continue;
    if (session.terminalAt && now - session.terminalAt > TERMINAL_TTL_MS) {
      registry.sessions.delete(id);
    }
  }
}

/**
 * Get the number of active (non-terminal) authorizations.
 */
export function getActiveAuthorizationCount(): number {
  return getRegistry().activeCount;
}

/**
 * Get the maximum allowed concurrent authorizations.
 */
export function getMaxAuthorizations(): number {
  return MAX_AUTHORIZATIONS;
}

/**
 * Check whether an authorization id exists and is active.
 */
export function isAuthorizationActive(authorizationId: string): boolean {
  const session = getRegistry().sessions.get(authorizationId);
  if (!session) return false;
  return isActiveAuthorizationStatus(session.status);
}
