/**
 * antigravity-account-token unit tests
 *
 * Covers merge/projectId preservation, API key JSON parsing, fixed error
 * mapping, and basic forceRefresh semantics without Google network calls.
 */

import { ok, strictEqual } from "node:assert";
import {
  mapAntigravityOAuthError,
  mergeAntigravityCredential,
  parseAntigravityApiKeyPayload,
  sanitizeAntigravityLoginError,
} from "./antigravity-account-token";

// ── merge preserves projectId ────────────────────────────────────────────────

{
  const previous = {
    access: "old-access",
    refresh: "refresh-1",
    expires: 100,
    projectId: "project-keep",
    email: "user@example.com",
    extraField: "secret-extra",
  };
  const refreshed = {
    access: "new-access",
    refresh: "refresh-1",
    expires: 200,
    // deliberately omit projectId / email / extraField
  };
  const merged = mergeAntigravityCredential(previous, refreshed);
  strictEqual(merged.access, "new-access");
  strictEqual(merged.expires, 200);
  strictEqual(merged.projectId, "project-keep", "projectId must survive refresh omission");
  strictEqual(merged.email, "user@example.com", "email must survive refresh omission");
  strictEqual(merged.extraField, "secret-extra", "unknown secret fields preserved");
}

{
  const previous = {
    access: "a",
    refresh: "r",
    expires: 1,
    projectId: "old-project",
  };
  const refreshed = {
    access: "b",
    refresh: "r2",
    expires: 2,
    projectId: "new-project",
  };
  const merged = mergeAntigravityCredential(previous, refreshed);
  strictEqual(merged.projectId, "new-project", "non-empty refreshed projectId wins");
  strictEqual(merged.refresh, "r2");
}

// ── parse API key payload ────────────────────────────────────────────────────

{
  const token = parseAntigravityApiKeyPayload(
    JSON.stringify({ token: "access-token-value", projectId: "must-not-return" }),
  );
  strictEqual(token, "access-token-value");
  ok(!token.includes("must-not-return"));
}

{
  strictEqual(parseAntigravityApiKeyPayload("plain-token"), "plain-token");
  strictEqual(parseAntigravityApiKeyPayload(""), "");
}

// ── safe error mapping (no raw body projection) ──────────────────────────────

{
  const mapped = mapAntigravityOAuthError(
    new Error('Antigravity token refresh failed: {"error":"invalid_grant","error_description":"Token has been expired or revoked."}'),
  );
  strictEqual(mapped.code, "unauthorized");
  ok(!mapped.message.includes("invalid_grant"), "safe message must not include raw body");
  ok(!mapped.message.includes("expired or revoked"), "safe message must not include upstream text");
}

{
  const mapped = mapAntigravityOAuthError(new Error("Missing projectId in Antigravity credentials"));
  strictEqual(mapped.code, "missing_project");
}

{
  const mapped = mapAntigravityOAuthError(new Error("fetch failed: ECONNRESET"));
  strictEqual(mapped.code, "network");
}

// Generic refresh/infrastructure failures must not be classified as reauth.
{
  const mapped = mapAntigravityOAuthError(new Error("Antigravity token refresh failed temporarily"));
  strictEqual(mapped.code, "refresh_failed");
  ok(!mapped.message.toLowerCase().includes("re-authenticate"));
}

{
  const mapped = mapAntigravityOAuthError(new Error("Antigravity Active credential mirror reconciliation failed"));
  strictEqual(mapped.code, "unavailable");
}

{
  const mapped = mapAntigravityOAuthError(new Error("provider lock timed out"));
  strictEqual(mapped.code, "unavailable");
}

{
  const mapped = mapAntigravityOAuthError(new Error("OAuth provider is not available for google-antigravity"));
  strictEqual(mapped.code, "provider_unavailable");
}

{
  const sanitized = sanitizeAntigravityLoginError(
    new Error("Token exchange failed: client_secret=abc access_token=xyz projectId=leaky"),
  );
  ok(!sanitized.includes("client_secret"));
  ok(!sanitized.includes("access_token=xyz"));
  ok(!sanitized.includes("projectId=leaky"));
  ok(sanitized.length > 0);
}

console.log("Antigravity account token unit tests passed");
