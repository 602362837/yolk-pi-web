/**
 * links-api-helpers — shared utilities for Links API routes
 *
 * ## Isolation
 *
 * Does NOT import LLM auth, ModelRuntime, or RPC modules.
 */

import { NextResponse } from "next/server";
import type {
  LinkAuthorizationErrorCode,
  LinkErrorResponse,
  LinkProviderId,
} from "./links-types";
import { isValidOpaqueId } from "./links-types";
import { isAllowlistedLinkProvider } from "./links-provider-registry";
import { createGitHubLinkAdapter } from "./github-link-oauth";
import { registerLinkProviderAdapter } from "./links-provider-registry";
import {
  setLinksPersistHandler,
  getPersistingCredential,
  markAuthorizationConnected,
  markAuthorizationDuplicate,
  markAuthorizationFailed,
} from "./links-authorization-manager";
import {
  createLinkConnection,
  findConnectionByProviderUserId,
  LinksStoreError,
} from "./links-store";

// ─── Adapter registration ────────────────────────────────────────────────────

let _githubAdapterRegistered = false;

/**
 * Ensure the GitHub adapter is registered in the provider registry.
 *
 * Idempotent — only registers once per process. Must be called before
 * any authorization or connection operation for the github provider.
 */
export function ensureGitHubLinksAdapter(): void {
  if (_githubAdapterRegistered) return;
  registerLinkProviderAdapter("github" as LinkProviderId, () =>
    createGitHubLinkAdapter(),
  );
  _githubAdapterRegistered = true;
}

// ─── Persist handler registration ────────────────────────────────────────────

let _persistHandlerRegistered = false;

/**
 * Register the global persist handler that bridges the authorization
 * manager's background polling to the store layer.
 *
 * When a background authorization task reaches `persisting` state
 * (credential validated by GitHub), this handler persists the
 * connection via the store and updates the authorization session.
 *
 * This runs independently of SSE subscribers — persistence completes
 * even if the browser disconnects.
 *
 * Idempotent — only registers once per process.
 */
export function ensureLinksPersistHandler(): void {
  if (_persistHandlerRegistered) return;

  setLinksPersistHandler(async (authorizationId: string) => {
    const persisting = getPersistingCredential(authorizationId);
    if (!persisting) {
      // Session may have been cancelled or already processed.
      return;
    }

    const { credential, identity } = persisting;

    try {
      const connection = await createLinkConnection({
        provider: "github" as LinkProviderId,
        identity,
        credential,
      });

      markAuthorizationConnected(authorizationId, connection);
    } catch (err: unknown) {
      if (err instanceof LinksStoreError && err.code === "duplicate_identity") {
        // Find the existing connection for the duplicate marker.
        const existing = await findConnectionByProviderUserId(
          "github" as LinkProviderId,
          identity.providerUserId,
        );

        markAuthorizationDuplicate(
          authorizationId,
          existing?.id ?? "",
          identity.login,
        );
      } else {
        const msg =
          err instanceof Error ? err.message : "Failed to persist connection";
        markAuthorizationFailed(authorizationId, "links_store_error", msg);
      }
    }
  });

  _persistHandlerRegistered = true;
}

// ─── Error mapping ───────────────────────────────────────────────────────────

const ERROR_CODE_TO_STATUS: Record<LinkAuthorizationErrorCode, number> = {
  invalid_request: 400,
  authorization_not_found: 404,
  connection_not_found: 404,
  provider_not_found: 404,
  duplicate_identity: 409,
  authorization_capacity_exceeded: 429,
  github_rate_limited: 429,
  links_store_error: 500,
  github_bad_response: 502,
  github_authorization_not_configured: 503,
  github_unavailable: 503,
  github_timeout: 504,
  github_access_denied: 403,
  github_authorization_expired: 410,
  github_device_flow_disabled: 503,
  github_client_invalid: 500,
  github_network_error: 502,
  github_invalid_response: 502,
  github_identity_invalid: 502,
  internal_error: 500,
};

/**
 * Map an error (Error with `code` property) to a Links error response.
 *
 * Falls back to 500 `internal_error` for unknown errors, but sanitizes
 * the message to avoid leaking upstream data.
 */
export function toLinkErrorResponse(err: unknown): NextResponse<LinkErrorResponse> {
  const code: LinkAuthorizationErrorCode | undefined =
    typeof err === "object" && err !== null && "code" in err
      ? (err as { code?: LinkAuthorizationErrorCode }).code
      : undefined;

  const message: string =
    err instanceof Error ? err.message : String(err);

  let status: number;
  let errorCode: LinkAuthorizationErrorCode;
  let errorMessage: string;

  if (code && code in ERROR_CODE_TO_STATUS) {
    status = ERROR_CODE_TO_STATUS[code];
    errorCode = code;
    // For known codes, use the original message (already sanitized by store/adapter).
    errorMessage = message;
  } else {
    // Unknown error — use a generic message to avoid leaking raw data.
    status = 500;
    errorCode = "internal_error";
    errorMessage = "An internal error occurred";
  }

  return NextResponse.json(
    {
      error: {
        code: errorCode,
        message: errorMessage,
      },
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

// ─── Provider validation ─────────────────────────────────────────────────────

/**
 * Validate a dynamic route provider param against the allowlist.
 *
 * Returns `{ provider }` for a valid provider.
 * Returns `{ errorResponse }` for an unknown provider.
 */
export function validateProviderParam(
  raw: string,
): { provider: LinkProviderId; errorResponse?: never }
  | { provider?: never; errorResponse: NextResponse<LinkErrorResponse> } {
  if (!isAllowlistedLinkProvider(raw)) {
    return {
      errorResponse: NextResponse.json(
        {
          error: {
            code: "provider_not_found" as LinkAuthorizationErrorCode,
            message: `Links provider "${raw}" is not supported`,
          },
        },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      ),
    };
  }
  return { provider: raw };
}

// ─── Opaque id validation ────────────────────────────────────────────────────

/**
 * Validate a dynamic route opaque id param against the safety rules.
 *
 * Returns `{ id }` for a valid opaque id.
 * Returns `{ errorResponse }` for an invalid id.
 */
export function validateOpaqueIdParam(
  raw: string,
  notFoundCode: LinkAuthorizationErrorCode = "connection_not_found",
): { id: string; errorResponse?: never }
  | { id?: never; errorResponse: NextResponse<LinkErrorResponse> } {
  if (!isValidOpaqueId(raw)) {
    return {
      errorResponse: NextResponse.json(
        {
          error: {
            code: notFoundCode,
            message: `Resource "${raw}" not found`,
          },
        },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      ),
    };
  }
  return { id: raw };
}

// ─── Body validation ─────────────────────────────────────────────────────────

/**
 * Forbidden keys that must NOT appear in client request bodies.
 *
 * These fields, if present in any form, indicate the client is attempting
 * to bypass the Device Flow or inject secrets. The request must be rejected.
 */
const FORBIDDEN_BODY_KEYS = [
  "token",
  "clientId",
  "client_id",
  "clientSecret",
  "client_secret",
  "scope",
  "redirectUri",
  "redirect_uri",
  "url",
  "deviceCode",
  "device_code",
  "accessToken",
  "access_token",
  "code",
  "secret",
  "password",
  "pat",
] as const;

/**
 * Reject client bodies that contain forbidden keys.
 *
 * Links is a Device Flow-only domain. Token, secret, scope, client
 * configuration, and URL fields must never be submitted by the client.
 *
 * Returns an error response if any forbidden key is found, or null if the body is clean.
 */
export function rejectForbiddenBodyKeys(
  body: unknown,
): NextResponse<LinkErrorResponse> | null {
  if (typeof body !== "object" || body === null) return null;

  const bodyRecord = body as Record<string, unknown>;
  const lowerKeys = new Set(
    Object.keys(bodyRecord).map((k) => k.toLowerCase()),
  );

  for (const forbidden of FORBIDDEN_BODY_KEYS) {
    if (lowerKeys.has(forbidden.toLowerCase())) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_request" as LinkAuthorizationErrorCode,
            message: `The field "${forbidden}" is not allowed in this request`,
          },
        },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  return null;
}

// ─── Cache header helper ─────────────────────────────────────────────────────

/**
 * Standard no-store cache headers for all Links REST responses.
 */
export const LINKS_REST_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
};

/**
 * Standard SSE cache headers for Links event streams.
 */
export const LINKS_SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-store",
  Connection: "keep-alive",
};
