/**
 * github-automation-errors — stable, secret-safe errors for the GitHub App automation domain.
 *
 * Isolation / security:
 * - Error messages must never contain App private keys, JWTs, installation tokens,
 *   webhook secrets, machine personal tokens, raw webhook bodies, or signatures.
 * - Codes are an allowlist; unknown upstream text is mapped to generic safe messages.
 * - This domain never falls back to Links OAuth, personal PAT, or `gh auth` for App ops.
 */

// ─── Error codes ─────────────────────────────────────────────────────────────

export type GithubAutomationErrorCode =
  | "not_configured"
  | "invalid_config"
  | "stale_revision"
  | "permission_missing"
  | "installation_missing"
  | "repository_not_allowlisted"
  | "assignee_unavailable"
  | "assignee_unassignable"
  | "assignee_readback_failed"
  | "credential_invalid"
  | "credential_host_unsupported"
  | "credential_no_active_account"
  | "credential_timeout"
  // Local GitHub App credentials store / API (GHCRED-03). Path-free and secret-free.
  | "invalid_credentials_request"
  | "invalid_app_id"
  | "invalid_webhook_secret"
  | "invalid_private_key"
  | "private_key_too_large"
  | "local_credentials_invalid"
  | "local_credentials_unsupported"
  | "credentials_lock_timeout"
  | "credentials_store_error"
  | "github_network_error"
  | "github_timeout"
  | "github_bad_response"
  | "github_redirect_rejected"
  | "github_oversized_response"
  | "github_rate_limited"
  | "github_auth_failed"
  | "internal_error";

/** HTTP-ish status for API mapping; callers may override. */
export type GithubAutomationErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 429 | 500 | 502 | 503 | 504;

const SAFE_DEFAULT_MESSAGES: Record<GithubAutomationErrorCode, string> = {
  not_configured: "GitHub App automation is not configured",
  invalid_config: "GitHub App automation configuration is invalid",
  stale_revision: "Configuration revision conflict",
  permission_missing: "GitHub App installation is missing required permissions",
  installation_missing: "GitHub App is not installed for the repository",
  repository_not_allowlisted: "Repository is not on the automation allowlist",
  assignee_unavailable: "Machine GitHub assignee identity is unavailable",
  assignee_unassignable: "Resolved machine login cannot be assigned on the repository",
  assignee_readback_failed: "Assignee read-back did not confirm the machine login",
  credential_invalid: "Local GitHub credential is missing or invalid",
  credential_host_unsupported: "Only github.com credentials are supported for assignee resolution",
  credential_no_active_account: "No active gh account is selected",
  credential_timeout: "Local credential resolution timed out",
  invalid_credentials_request: "GitHub App credentials request is invalid",
  invalid_app_id: "GitHub App ID is invalid",
  invalid_webhook_secret: "GitHub App webhook secret is invalid",
  invalid_private_key: "GitHub App private key is invalid",
  private_key_too_large: "GitHub App private key exceeds size limit",
  local_credentials_invalid: "Local GitHub App credentials are invalid",
  local_credentials_unsupported:
    "Local GitHub App credentials use an unsupported schema",
  credentials_lock_timeout: "GitHub App credentials store lock timed out",
  credentials_store_error: "GitHub App credentials store error",
  github_network_error: "Network error contacting GitHub",
  github_timeout: "GitHub request timed out",
  github_bad_response: "GitHub returned an unexpected response",
  github_redirect_rejected: "GitHub redirected to an unexpected host",
  github_oversized_response: "GitHub response exceeded size limit",
  github_rate_limited: "GitHub rate limited the request",
  github_auth_failed: "GitHub App authentication failed",
  internal_error: "Internal GitHub automation error",
};

// Patterns that must never appear in serialized errors/logs from this domain.
const SECRETISH_PATTERNS: RegExp[] = [
  /-----BEGIN[ A-Z0-9]*PRIVATE KEY-----/i,
  /gho_[A-Za-z0-9_]{10,}/g,
  /ghu_[A-Za-z0-9_]{10,}/g,
  /ghs_[A-Za-z0-9_]{10,}/g,
  /github_pat_[A-Za-z0-9_]{10,}/g,
  /ghp_[A-Za-z0-9_]{10,}/g,
  /Bearer\s+[A-Za-z0-9._\-+/=]{12,}/gi,
  /password[=:\s]+[^\s&"']+/gi,
  /x-hub-signature-256[=:\s]+[^\s&"']+/gi,
];

/**
 * Strip secret-like substrings from an arbitrary string for logging / error projection.
 * Prefer not putting secrets into strings at all; this is defense-in-depth.
 */
export function redactGithubAutomationSecrets(input: string): string {
  let out = input;
  for (const pattern of SECRETISH_PATTERNS) {
    out = out.replace(pattern, "[redacted]");
  }
  return out;
}

/**
 * Serialize an unknown thrown value into a short secret-safe diagnostic (no stacks by default).
 */
export function safeGithubAutomationErrorMessage(
  err: unknown,
  fallback = SAFE_DEFAULT_MESSAGES.internal_error,
): string {
  if (err instanceof GithubAutomationError) {
    return err.message;
  }
  if (err instanceof Error && typeof err.message === "string" && err.message.trim()) {
    const redacted = redactGithubAutomationSecrets(err.message).trim();
    // Avoid echoing long upstream bodies.
    if (redacted.length > 0 && redacted.length <= 200 && !redacted.includes("\n")) {
      // Only allow already-safe automation messages; drop free-form upstream text.
      if (Object.values(SAFE_DEFAULT_MESSAGES).includes(redacted)) {
        return redacted;
      }
    }
  }
  return fallback;
}

export class GithubAutomationError extends Error {
  public readonly code: GithubAutomationErrorCode;
  public readonly status: GithubAutomationErrorStatus;
  /** Optional non-secret details for operators (never tokens/paths with secrets). */
  public readonly details?: Record<string, string | number | boolean | null>;

  constructor(
    code: GithubAutomationErrorCode,
    message?: string,
    options?: {
      status?: GithubAutomationErrorStatus;
      details?: Record<string, string | number | boolean | null>;
      cause?: unknown;
    },
  ) {
    const safeMessage = redactGithubAutomationSecrets(
      (message && message.trim()) || SAFE_DEFAULT_MESSAGES[code],
    );
    super(safeMessage, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "GithubAutomationError";
    this.code = code;
    this.status = options?.status ?? defaultStatusForCode(code);
    this.details = options?.details;
  }

  toJSON(): {
    name: string;
    code: GithubAutomationErrorCode;
    message: string;
    status: GithubAutomationErrorStatus;
    details?: Record<string, string | number | boolean | null>;
  } {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      status: this.status,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

function defaultStatusForCode(code: GithubAutomationErrorCode): GithubAutomationErrorStatus {
  switch (code) {
    case "not_configured":
    case "invalid_config":
    case "repository_not_allowlisted":
    case "credential_host_unsupported":
    case "invalid_credentials_request":
    case "invalid_app_id":
    case "invalid_webhook_secret":
    case "invalid_private_key":
    case "private_key_too_large":
    case "local_credentials_invalid":
    case "local_credentials_unsupported":
      return 400;
    case "github_auth_failed":
    case "credential_invalid":
      return 401;
    case "permission_missing":
    case "assignee_unassignable":
      return 403;
    case "installation_missing":
    case "assignee_unavailable":
    case "credential_no_active_account":
      return 404;
    case "stale_revision":
      return 409;
    case "github_oversized_response":
      return 413;
    case "github_rate_limited":
      return 429;
    case "github_timeout":
    case "credential_timeout":
    case "credentials_lock_timeout":
      return 504;
    case "github_network_error":
    case "github_bad_response":
    case "github_redirect_rejected":
    case "assignee_readback_failed":
      return 502;
    case "credentials_store_error":
      return 500;
    default:
      return 500;
  }
}

export function isGithubAutomationError(value: unknown): value is GithubAutomationError {
  return value instanceof GithubAutomationError;
}
