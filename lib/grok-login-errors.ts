/**
 * grok-login-errors — safe Grok OAuth login error projection
 *
 * Maps upstream pi-grok-cli login/refresh errors to fixed, safe SSE messages.
 * Never projects raw upstream response text, callback URLs, device codes,
 * token endpoint bodies, or filesystem paths.
 *
 * ## Usage
 *
 * Used by the OAuth login SSE route for add, reauth, and provider-wide
 * login flows so all Grok OAuth paths share the same safe error contract.
 */

// ─── Fixed safe error messages ───────────────────────────────────────────────

const GROK_LOGIN_ERROR_MAP: Array<{ match: (msg: string) => boolean; safe: string }> = [
  {
    match: (msg) => msg === "Login cancelled" || msg.startsWith("Login cancelled"),
    safe: "Login cancelled.",
  },
  {
    match: (msg) =>
      msg.includes("authorization denied") ||
      msg.includes("access_denied") ||
      msg.includes("user denied"),
    safe: "Authorization was denied. Please try again and approve the request.",
  },
  {
    match: (msg) => msg.includes("timeout") || msg.includes("timed out"),
    safe: "Login timed out. Please try again.",
  },
  {
    match: (msg) => msg.includes("expired") || msg.includes("device code expired"),
    safe: "The device code has expired. Please start a new login.",
  },
  {
    match: (msg) => msg.includes("bind") || msg.includes("address in use"),
    safe: "Login setup failed. Please try again or use a different login method.",
  },
  {
    match: (msg) =>
      msg.includes("refresh") &&
      (msg.includes("missing") || msg.includes("not found") || msg.includes("no refresh")),
    safe: "Login succeeded but the credential is incomplete. Please try a different login method.",
  },
  {
    match: (msg) =>
      msg.includes("select") ||
      msg.includes("unknown option") ||
      msg.includes("unsupported method"),
    safe: "The selected login method is not available. Please choose a different method.",
  },
  {
    match: (msg) =>
      msg.includes("OAuthAccountStoreError") &&
      (msg.includes("not found") || msg.includes("does not exist")),
    safe: "The target account no longer exists. It may have been deleted.",
  },
  {
    match: (msg) =>
      msg.includes("Reauthentication is currently only supported"),
    safe: "Reauthentication is not supported for this provider.",
  },
];

const GROK_LOGIN_FALLBACK_SAFE =
  "Grok login failed. Please retry or use a different login method.";

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Map an upstream Grok login error to a fixed safe message suitable for SSE.
 *
 * - `cancelled`-like strings → `"cancelled"` (special sentinel)
 * - Known upstream patterns → fixed actionable text
 * - Everything else → generic fallback
 *
 * Never returns the original error message, callback URL, device code,
 * upstream response body, or filesystem path.
 */
export function sanitizeGrokLoginError(err: unknown): string {
  if (err instanceof Error && err.name === "AbortError") {
    return "Login cancelled.";
  }

  const rawMsg = err instanceof Error ? err.message : String(err);

  // Special sentinel: "Login cancelled" is a known cancel marker.
  if (rawMsg === "Login cancelled" || rawMsg.startsWith("Login cancelled")) {
    return rawMsg; // keep as sentinel for SSE "cancelled" path
  }

  // Match against known patterns
  for (const { match, safe } of GROK_LOGIN_ERROR_MAP) {
    if (match(rawMsg)) return safe;
  }

  return GROK_LOGIN_FALLBACK_SAFE;
}

/**
 * Returns true if the raw error message is the "Login cancelled" sentinel
 * that should produce an SSE `cancelled` event rather than `error`.
 */
export function isGrokLoginCancelled(err: unknown): boolean {
  if (err instanceof Error && err.name === "AbortError") return true;
  const msg = err instanceof Error ? err.message : String(err);
  return msg === "Login cancelled" || msg.startsWith("Login cancelled");
}
