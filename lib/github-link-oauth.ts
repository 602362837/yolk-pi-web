/**
 * github-link-oauth — GitHub OAuth Device Flow adapter
 *
 * ## Design
 *
 * - Uses a **product-owned** GitHub OAuth App with Device Flow enabled.
 * - Client id is read from server-only `YPI_LINKS_GITHUB_OAUTH_CLIENT_ID`.
 * - **No client secret** (Device Flow does not require it).
 * - Missing configuration returns a stable error — never falls back to PAT.
 * - Fixed endpoints, fixed `read:user` scope, fixed verification URI.
 * - device_code and access token are server-only values and must never
 *   appear in wire snapshots, API responses, SSE frames, metadata, logs,
 *   or error messages.
 *
 * ## Network contract
 *
 * 1. POST https://github.com/login/device/code
 *    Accept: application/json
 *    body: client_id=<server>&scope=read:user
 *
 * 2. POST https://github.com/login/oauth/access_token
 *    Accept: application/json
 *    body: client_id=<server>&device_code=<memory>&grant_type=urn:ietf:params:oauth:grant-type:device_code
 *
 * 3. GET https://api.github.com/user
 *    Authorization: Bearer <access-token>
 *    Accept: application/vnd.github+json
 *    X-GitHub-Api-Version: 2022-11-28
 *
 * All calls enforce timeout, response size cap, redirect rejection,
 * and fixed host/path. Raw upstream bodies must not leak into errors.
 *
 * ## Isolation
 *
 * This module does NOT import oauth-accounts.ts, oauth-account-providers.ts,
 * web-credential-store.ts, web-model-runtime.ts, or rpc-manager.ts.
 */

import type {
  LinkProviderId,
  DeviceAuthorizationGrant,
  OAuthCredentialResult,
  ValidatedLinkIdentity,
  LinkAuthorizationErrorCode,
} from "./links-types";
import {
  GITHUB_DEVICE_VERIFICATION_URI,
  GITHUB_DEVICE_CODE_URL,
  GITHUB_ACCESS_TOKEN_URL,
  GITHUB_USER_API_URL,
} from "./links-types";
import type { LinkProviderAdapter } from "./links-provider-registry";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Server-only env var for the product-owned GitHub OAuth App client id. */
const ENV_GITHUB_CLIENT_ID = "YPI_LINKS_GITHUB_OAUTH_CLIENT_ID";

/** Fixed P0 scope. */
const FIXED_SCOPE = "read:user";

/** Client version for User-Agent header. */
const USER_AGENT_VERSION = "yolk-pi-web";

/** Timeout for upstream HTTP calls (seconds). */
const UPSTREAM_TIMEOUT_S = 15;

/** Test-only override; production always uses the fixed 15 second deadline. */
let _testTimeoutMs: number | undefined;

function upstreamTimeoutMs(): number {
  return _testTimeoutMs ?? UPSTREAM_TIMEOUT_S * 1000;
}

/** Override the per-request deadline for focused tests; pass undefined to reset. */
export function _testOverrideGithubRequestTimeoutMs(timeoutMs: number | undefined): void {
  _testTimeoutMs =
    typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs >= 0
      ? timeoutMs
      : undefined;
}

/** Maximum response body size (bytes). */
const MAX_RESPONSE_SIZE = 64 * 1024; // 64 KiB

/** Fixed Accept header for GitHub API. */
const GITHUB_API_ACCEPT = "application/vnd.github+json";

/** Fixed GitHub API version. */
const GITHUB_API_VERSION = "2022-11-28";

// ─── Safe error messages ─────────────────────────────────────────────────────

const SAFE_ERRORS = {
  not_configured:
    "GitHub Device Flow is not configured. Set YPI_LINKS_GITHUB_OAUTH_CLIENT_ID.",
  network: "Network error contacting GitHub",
  timeout: "GitHub request timed out",
  upstream_error: "GitHub returned an unexpected error",
  bad_response: "GitHub response could not be parsed",
  redirect_rejected: "GitHub redirected to an unexpected host",
  oversized: "GitHub response exceeded size limit",
  identity_invalid: "GitHub user identity could not be validated",
  device_flow_disabled: "GitHub Device Flow is not enabled for this OAuth App",
  expired: "Device authorization expired",
  access_denied: "User denied the authorization request",
  rate_limited: "GitHub rate limited the request",
  client_invalid: "GitHub OAuth App client configuration is invalid",
  slow_down: "GitHub requested slower polling", // not an error, but a signal
} as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeError(
  code: LinkAuthorizationErrorCode,
  message: string,
): { code: LinkAuthorizationErrorCode; message: string } {
  // Ensure message never contains raw upstream data.
  return { code, message };
}

/**
 * Map a GitHub error string from the access_token endpoint to a stable error.
 * The raw error must NOT be passed as the user-facing message.
 */
function mapGitHubTokenError(
  error: string,
): { code: LinkAuthorizationErrorCode; message: string } {
  switch (error) {
    case "authorization_pending":
      // Not an error — caller handles this as continue.
      return safeError("internal_error", "Unexpected authorization_pending in error path");
    case "slow_down":
      return safeError("github_rate_limited", SAFE_ERRORS.slow_down);
    case "expired_token":
      return safeError("github_authorization_expired", SAFE_ERRORS.expired);
    case "access_denied":
      return safeError("github_access_denied", SAFE_ERRORS.access_denied);
    case "incorrect_client_credentials":
      return safeError("github_client_invalid", SAFE_ERRORS.client_invalid);
    case "incorrect_device_code":
      return safeError("github_client_invalid", "Device code is invalid or expired");
    case "device_flow_disabled":
      return safeError("github_device_flow_disabled", SAFE_ERRORS.device_flow_disabled);
    default:
      // Never include the raw error in the message.
      return safeError("github_bad_response", SAFE_ERRORS.upstream_error);
  }
}

// ─── Client id resolution (server-only) ──────────────────────────────────────

let _cachedClientId: string | null | undefined;

/**
 * Resolve the GitHub OAuth App client id from server environment.
 *
 * Returns `null` when not configured (fail closed).
 * The value is cached after first read for the process lifetime.
 */
export function resolveGithubOAuthClientId(): string | null {
  if (_cachedClientId !== undefined) return _cachedClientId;

  const raw = process.env[ENV_GITHUB_CLIENT_ID];
  if (typeof raw !== "string" || raw.trim().length === 0) {
    _cachedClientId = null;
    return null;
  }
  _cachedClientId = raw.trim();
  return _cachedClientId;
}

/**
 * Check whether GitHub OAuth is configured (client id is present).
 */
export function isGithubOAuthConfigured(): boolean {
  return resolveGithubOAuthClientId() !== null;
}

/**
 * Override the cached client id (for tests).
 */
export function _testOverrideGithubClientId(
  clientId: string | null,
): void {
  _cachedClientId = clientId === null ? null : clientId.trim() || null;
}

// ─── Scope parsing ───────────────────────────────────────────────────────────

/**
 * Parse and normalize the `scope` field from GitHub's token response.
 * Returns sorted, deduped, trimmed scopes. Returns empty array for missing/empty scope.
 */
export function parseGrantedScopes(raw: unknown): string[] {
  if (typeof raw !== "string" || raw.trim().length === 0) return [];
  const scopes = raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return [...new Set(scopes)].sort();
}

// ─── HTTP helpers ────────────────────────────────────────────────────────────

interface RequestDeadline {
  signal: AbortSignal;
  didTimeout(): boolean;
  didCallerAbort(): boolean;
  dispose(): void;
}

/** Compose caller cancellation with an independent internal deadline. */
function createRequestDeadline(caller: AbortSignal | undefined): RequestDeadline {
  const controller = new AbortController();
  let timedOut = false;
  let callerAborted = false;
  const abortFromCaller = (): void => {
    if (timedOut || callerAborted) return;
    callerAborted = true;
    controller.abort();
  };

  if (caller?.aborted) {
    abortFromCaller();
  } else {
    caller?.addEventListener("abort", abortFromCaller, { once: true });
  }

  const timer = setTimeout(() => {
    if (callerAborted || timedOut) return;
    timedOut = true;
    controller.abort();
  }, upstreamTimeoutMs());

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    didCallerAbort: () => callerAborted,
    dispose: () => {
      clearTimeout(timer);
      caller?.removeEventListener("abort", abortFromCaller);
    },
  };
}

function cancellationError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

function deadlineError(deadline: RequestDeadline): Error {
  if (deadline.didTimeout()) {
    return Object.assign(new Error(SAFE_ERRORS.timeout), {
      code: "github_timeout" as LinkAuthorizationErrorCode,
    });
  }
  // Caller aborts deliberately preserve native AbortError semantics.
  if (deadline.didCallerAbort()) return cancellationError();
  return cancellationError();
}

/** Race an operation with cancellation even when a custom stream ignores its signal. */
function raceDeadline<T>(operation: Promise<T>, deadline: RequestDeadline): Promise<T> {
  if (deadline.signal.aborted) return Promise.reject(deadlineError(deadline));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(deadlineError(deadline));
    deadline.signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        deadline.signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        deadline.signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

async function safeFetch(
  url: string,
  init: RequestInit & { maxSize?: number },
): Promise<{ status: number; body: unknown; headers: Headers }> {
  const maxSize = init.maxSize ?? MAX_RESPONSE_SIZE;
  const deadline = createRequestDeadline(init.signal ?? undefined);

  try {
    let response: Response;
    try {
      response = await raceDeadline(fetch(url, {
        ...init,
        redirect: "manual",
        signal: deadline.signal,
      }), deadline);
    } catch {
      if (deadline.signal.aborted) throw deadlineError(deadline);
      throw Object.assign(new Error(SAFE_ERRORS.network), {
        code: "github_network_error" as LinkAuthorizationErrorCode,
      });
    }

    const status = response.status;
    const location = response.headers.get("location");
    if (status >= 300 && status < 400 && location) {
      throw Object.assign(new Error(SAFE_ERRORS.redirect_rejected), {
        code: "github_bad_response" as LinkAuthorizationErrorCode,
      });
    }

    let bodyText: string;
    const reader = response.body?.getReader();
    let completed = false;
    try {
      if (!reader) {
        bodyText = "";
      } else {
        const chunks: Uint8Array[] = [];
        let total = 0;
        while (true) {
          const { done, value } = await raceDeadline(reader.read(), deadline);
          if (done) break;
          total += value.length;
          if (total > maxSize) {
            throw Object.assign(new Error(SAFE_ERRORS.oversized), {
              code: "github_bad_response" as LinkAuthorizationErrorCode,
            });
          }
          chunks.push(value);
        }
        completed = true;
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        bodyText = new TextDecoder().decode(bytes);
      }
    } catch (err: unknown) {
      if (deadline.signal.aborted) throw deadlineError(deadline);
      if (err instanceof Error && (err as Error & { code?: string }).code === "github_bad_response") {
        throw err;
      }
      throw Object.assign(new Error(SAFE_ERRORS.network), {
        code: "github_network_error" as LinkAuthorizationErrorCode,
      });
    } finally {
      if (reader) {
        const releaseReader = (): void => {
          try {
            reader.releaseLock();
          } catch {
            // Best effort: a nonstandard reader may already be released.
          }
        };
        if (completed) {
          releaseReader();
        } else {
          // A pending read prevents immediate release; cancel first without
          // awaiting a nonstandard stream that might itself remain stuck.
          void reader.cancel().catch(() => {}).finally(releaseReader);
        }
      }
    }

    try {
      return { status, body: bodyText ? JSON.parse(bodyText) : null, headers: response.headers };
    } catch {
      throw Object.assign(new Error(SAFE_ERRORS.bad_response), {
        code: "github_bad_response" as LinkAuthorizationErrorCode,
      });
    }
  } finally {
    deadline.dispose();
  }
}

// ─── Device code request ─────────────────────────────────────────────────────

/**
 * POST https://github.com/login/device/code
 *
 * Returns the DeviceAuthorizationGrant with device_code (server-only).
 * Throws on network errors, configuration errors, or unexpected responses.
 */
export async function requestDeviceCode(
  signal?: AbortSignal,
): Promise<DeviceAuthorizationGrant> {
  const clientId = resolveGithubOAuthClientId();
  if (!clientId) {
    throw Object.assign(
      new Error(SAFE_ERRORS.not_configured),
      { code: "github_authorization_not_configured" as LinkAuthorizationErrorCode },
    );
  }

  const params = new URLSearchParams();
  params.set("client_id", clientId);
  params.set("scope", FIXED_SCOPE);

  const { status, body } = await safeFetch(GITHUB_DEVICE_CODE_URL, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT_VERSION,
    },
    body: params.toString(),
    signal,
  });

  if (!isRecord(body)) {
    throw Object.assign(
      new Error(SAFE_ERRORS.bad_response),
      { code: "github_bad_response" as LinkAuthorizationErrorCode },
    );
  }

  // Check for error response
  if (status >= 400) {
    const error = typeof body.error === "string" ? body.error : "";

    if (error === "device_flow_disabled") {
      throw Object.assign(
        new Error(SAFE_ERRORS.device_flow_disabled),
        { code: "github_device_flow_disabled" as LinkAuthorizationErrorCode },
      );
    }

    throw Object.assign(
      new Error(SAFE_ERRORS.upstream_error),
      { code: "github_bad_response" as LinkAuthorizationErrorCode },
    );
  }

  // Validate required fields
  const deviceCode = typeof body.device_code === "string" ? body.device_code.trim() : "";
  const userCode = typeof body.user_code === "string" ? body.user_code.trim() : "";
  const verificationUri = typeof body.verification_uri === "string" ? body.verification_uri.trim() : "";
  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : 0;
  const interval = typeof body.interval === "number" ? body.interval : 5;

  if (!deviceCode || !userCode || !verificationUri) {
    throw Object.assign(
      new Error(SAFE_ERRORS.bad_response),
      { code: "github_bad_response" as LinkAuthorizationErrorCode },
    );
  }

  if (expiresIn <= 0) {
    throw Object.assign(
      new Error(SAFE_ERRORS.bad_response),
      { code: "github_bad_response" as LinkAuthorizationErrorCode },
    );
  }

  // Validate verification URI is GitHub's device page
  if (verificationUri !== GITHUB_DEVICE_VERIFICATION_URI) {
    // GitHub may return a different verification_uri in some cases.
    // We accept only the known HTTPS device page.
    if (!verificationUri.startsWith("https://github.com/")) {
      throw Object.assign(
        new Error(SAFE_ERRORS.redirect_rejected),
        { code: "github_bad_response" as LinkAuthorizationErrorCode },
      );
    }
  }

  return {
    deviceCode,
    userCode,
    verificationUri,
    expiresIn,
    interval: Math.max(interval, 5), // minimum 5 seconds
  };
}

// ─── Token polling ───────────────────────────────────────────────────────────

/**
 * Poll POST https://github.com/login/oauth/access_token
 *
 * Handles authorization_pending, slow_down, and terminal states.
 * Returns OAuthCredentialResult on success.
 *
 * device_code is only read from server memory, never from the wire.
 */
export async function pollAccessToken(
  deviceCode: string,
  signal?: AbortSignal,
): Promise<OAuthCredentialResult> {
  const clientId = resolveGithubOAuthClientId();
  if (!clientId) {
    throw Object.assign(
      new Error(SAFE_ERRORS.not_configured),
      { code: "github_authorization_not_configured" as LinkAuthorizationErrorCode },
    );
  }

  const params = new URLSearchParams();
  params.set("client_id", clientId);
  params.set("device_code", deviceCode);
  params.set("grant_type", "urn:ietf:params:oauth:grant-type:device_code");

  const { status, body } = await safeFetch(GITHUB_ACCESS_TOKEN_URL, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT_VERSION,
    },
    body: params.toString(),
    signal,
  });

  if (!isRecord(body)) {
    throw Object.assign(
      new Error(SAFE_ERRORS.bad_response),
      { code: "github_bad_response" as LinkAuthorizationErrorCode },
    );
  }

  // Check for error / pending states
  const error = typeof body.error === "string" ? body.error.trim() : "";

  if (error) {
    if (error === "authorization_pending") {
      // Not an error — return a sentinel to indicate continue polling.
      throw Object.assign(
        new Error("authorization_pending"),
        { code: "authorization_pending" as const, _pending: true },
      );
    }
    if (error === "slow_down") {
      // Not a terminal error — caller increases interval.
      const newInterval =
        typeof body.interval === "number" && body.interval > 0
          ? body.interval
          : undefined;
      throw Object.assign(
        new Error("slow_down"),
        {
          code: "slow_down" as const,
          _slowDown: true,
          _slowDownInterval: newInterval,
        },
      );
    }

    // Terminal errors — never pass raw error_description into the message.
    const mapped = mapGitHubTokenError(error);
    throw Object.assign(new Error(mapped.message), { code: mapped.code });
  }

  // Success: extract access token
  const accessToken = typeof body.access_token === "string" ? body.access_token.trim() : "";
  if (!accessToken) {
    throw Object.assign(
      new Error(SAFE_ERRORS.bad_response),
      { code: "github_bad_response" as LinkAuthorizationErrorCode },
    );
  }

  const tokenType =
    typeof body.token_type === "string"
      ? (body.token_type.toLowerCase() as "bearer")
      : "bearer";
  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : 0;
  const expiresAt = expiresIn > 0 ? Date.now() + expiresIn * 1000 : 0;

  const grantedScopes = parseGrantedScopes(body.scope);

  // Validate status is 200
  if (status !== 200) {
    throw Object.assign(
      new Error(SAFE_ERRORS.bad_response),
      { code: "github_bad_response" as LinkAuthorizationErrorCode },
    );
  }

  return {
    accessToken,
    tokenType,
    expiresAt,
    grantedScopes,
  };
}

// ─── Identity validation ─────────────────────────────────────────────────────

/**
 * GET https://api.github.com/user
 *
 * Validates the access token and returns the GitHub user identity.
 * Only returns allowlisted fields (id, login) + optional display fields.
 *
 * access_token is only present in the Authorization header; never logged.
 */
export async function validateGitHubIdentity(
  accessToken: string,
  signal?: AbortSignal,
): Promise<ValidatedLinkIdentity> {
  const { status, body } = await safeFetch(GITHUB_USER_API_URL, {
    method: "GET",
    headers: {
      "Accept": GITHUB_API_ACCEPT,
      "Authorization": `Bearer ${accessToken}`,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      "User-Agent": USER_AGENT_VERSION,
    },
    signal,
  });

  if (!isRecord(body)) {
    throw Object.assign(
      new Error(SAFE_ERRORS.identity_invalid),
      { code: "github_identity_invalid" as LinkAuthorizationErrorCode },
    );
  }

  if (status === 401 || status === 403) {
    throw Object.assign(
      new Error(SAFE_ERRORS.identity_invalid),
      { code: "github_identity_invalid" as LinkAuthorizationErrorCode },
    );
  }

  if (status >= 400) {
    throw Object.assign(
      new Error(SAFE_ERRORS.upstream_error),
      { code: "github_bad_response" as LinkAuthorizationErrorCode },
    );
  }

  // Validate required identity fields
  const id = body.id;
  const login = typeof body.login === "string" ? body.login.trim() : "";

  if (typeof id !== "number" || !Number.isFinite(id) || id <= 0) {
    throw Object.assign(
      new Error(SAFE_ERRORS.identity_invalid),
      { code: "github_identity_invalid" as LinkAuthorizationErrorCode },
    );
  }

  if (!login) {
    throw Object.assign(
      new Error(SAFE_ERRORS.identity_invalid),
      { code: "github_identity_invalid" as LinkAuthorizationErrorCode },
    );
  }

  const identity: ValidatedLinkIdentity = {
    login,
    providerUserId: String(id),
  };

  // Optional safe display fields
  if (typeof body.name === "string" && body.name.trim()) {
    identity.name = body.name.trim();
  }
  if (typeof body.avatar_url === "string" && body.avatar_url.trim()) {
    identity.avatarUrl = body.avatar_url.trim();
  }

  return identity;
}

// ─── GitHub-specific error classification for polling loop ───────────────────

export interface GitHubPollResult {
  /** true when the user has not yet authorized (continue polling). */
  pending: boolean;
  /** true when GitHub requested slower polling. */
  slowDown: boolean;
  /** New interval in seconds (when slowDown and _slowDownInterval is valid). */
  newIntervalSeconds?: number;
  /** Terminal error (when !pending and !slowDown and no credential). */
  error?: { code: LinkAuthorizationErrorCode; message: string };
  /** The credential result on success. */
  credential?: OAuthCredentialResult;
}

/**
 * Single polling attempt wrapper.
 *
 * Returns a structured result so the caller (authorization manager) can
 * decide whether to continue, back off, or terminate.
 *
 * device_code is never logged or returned from this function.
 */
export async function attemptPollAccessToken(
  deviceCode: string,
  signal?: AbortSignal,
): Promise<GitHubPollResult> {
  try {
    const credential = await pollAccessToken(deviceCode, signal);
    return { pending: false, slowDown: false, credential };
  } catch (err: unknown) {
    if (err instanceof Error) {
      // Preserve caller cancellation so the authorization manager can exit without a false terminal failure.
      if (err.name === "AbortError") throw err;

      const code = (err as Error & { code?: string }).code;
      const isPending = (err as Error & { _pending?: boolean })._pending === true;
      const isSlowDown = (err as Error & { _slowDown?: boolean })._slowDown === true;

      if (isPending) {
        return { pending: true, slowDown: false };
      }
      if (isSlowDown) {
        const newInterval = (err as Error & { _slowDownInterval?: number })._slowDownInterval;
        return {
          pending: true,
          slowDown: true,
          newIntervalSeconds: newInterval,
        };
      }

      // Terminal error
      if (typeof code === "string") {
        return {
          pending: false,
          slowDown: false,
          error: safeError(code as LinkAuthorizationErrorCode, err.message),
        };
      }
    }

    // Unknown error — treat as terminal with network error
    return {
      pending: false,
      slowDown: false,
      error: safeError("github_network_error", SAFE_ERRORS.network),
    };
  }
}

// ─── Adapter factory ─────────────────────────────────────────────────────────

/**
 * Create the GitHub LinkProviderAdapter.
 *
 * This factory is registered in the links provider registry at server init.
 * It does not import LLM auth modules.
 */
export function createGitHubLinkAdapter(): LinkProviderAdapter {
  return {
    id: "github" as LinkProviderId,
    displayName: "GitHub",

    async startAuthorization(input) {
      const grant = await requestDeviceCode(input.signal);
      return grant;
    },

    async pollAuthorization(input) {
      // Poll until success or terminal error.
      // The authorization manager handles the polling loop and interval.
      const result = await pollAccessToken(input.deviceCode, input.signal);
      return result;
    },

    async validateCredential(input) {
      const identity = await validateGitHubIdentity(
        input.accessToken,
        input.signal,
      );
      return identity;
    },
  };
}
