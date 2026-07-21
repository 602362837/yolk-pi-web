/**
 * grok-account-token unit tests
 *
 * Covers fixed credential-evidence-only error mapping without xAI network calls.
 */

import { ok, strictEqual } from "node:assert";
import {
  GrokTokenError,
  mapGrokOAuthError,
  sanitizeGrokLoginError,
} from "./grok-account-token";

function xaiLikeError(
  message: string,
  code: string,
  reloginRequired = false,
): Error & { code: string; reloginRequired: boolean } {
  const error = new Error(message) as Error & { code: string; reloginRequired: boolean };
  error.name = "XaiOAuthError";
  error.code = code;
  error.reloginRequired = reloginRequired;
  return error;
}

// ── safe error mapping (structured Xai evidence first) ───────────────────────

{
  const mapped = mapGrokOAuthError(xaiLikeError("Missing refresh_token. Re-login required.", "refresh_missing", true));
  strictEqual(mapped.code, "missing_refresh");
  ok(!mapped.message.includes("refresh_token"), "safe message must not include raw body");
}

{
  const mapped = mapGrokOAuthError(
    xaiLikeError('xAI token refresh failed: 401 {"error":"invalid_grant"}', "refresh_failed", true),
  );
  strictEqual(mapped.code, "unauthorized");
  ok(!mapped.message.includes("invalid_grant"), "safe message must not include raw body");
  ok(!mapped.message.includes("401"), "safe message must not include upstream status text");
}

{
  const mapped = mapGrokOAuthError(
    xaiLikeError("xAI token refresh failed temporarily", "refresh_failed", false),
  );
  strictEqual(mapped.code, "refresh_failed");
  ok(!mapped.message.toLowerCase().includes("re-authenticate"));
}

{
  const mapped = mapGrokOAuthError(xaiLikeError("OIDC discovery failed", "discovery_failed", false));
  strictEqual(mapped.code, "network");
}

// ── message-level confirmed revocation without structured flags ──────────────

{
  const mapped = mapGrokOAuthError(
    new Error('Grok token refresh failed: {"error":"invalid_grant","error_description":"Token has been expired or revoked."}'),
  );
  strictEqual(mapped.code, "unauthorized");
  ok(!mapped.message.includes("invalid_grant"));
  ok(!mapped.message.includes("expired or revoked"));
}

// ── non-reauth infrastructure ────────────────────────────────────────────────

{
  const mapped = mapGrokOAuthError(new Error("fetch failed: ECONNRESET"));
  strictEqual(mapped.code, "network");
}

{
  const mapped = mapGrokOAuthError(new Error("Grok Active credential mirror reconciliation failed"));
  strictEqual(mapped.code, "unavailable");
}

{
  const mapped = mapGrokOAuthError(new Error("provider lock timed out"));
  strictEqual(mapped.code, "unavailable");
}

{
  const mapped = mapGrokOAuthError(new Error("OAuth provider is not available for grok-cli"));
  strictEqual(mapped.code, "provider_unavailable");
}

{
  const mapped = mapGrokOAuthError(new Error("totally unknown boom"));
  strictEqual(mapped.code, "unavailable", "unknown defaults to non-reauth unavailable");
}

// ── preserve structured GrokTokenError ───────────────────────────────────────

{
  const original = new GrokTokenError("provider_unavailable");
  const mapped = mapGrokOAuthError(original);
  strictEqual(mapped.code, "provider_unavailable");
  strictEqual(mapped.message, original.message);
}

// ── sanitize never projects secrets ──────────────────────────────────────────

{
  const sanitized = sanitizeGrokLoginError(
    new Error("Token exchange failed: client_secret=abc access_token=xyz path=/tmp/secret"),
  );
  ok(!sanitized.includes("client_secret"));
  ok(!sanitized.includes("access_token=xyz"));
  ok(!sanitized.includes("/tmp/secret"));
  ok(sanitized.length > 0);
}

console.log("Grok account token unit tests passed");
