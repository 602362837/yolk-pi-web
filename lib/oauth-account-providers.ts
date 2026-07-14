/**
 * oauth-account-providers — provider adapters for the OAuth saved-account store
 *
 * Each adapter encapsulates provider-specific credential validation, account-id
 * derivation, display hints, label backfill, and import support.  The generic
 * account store in `oauth-accounts.ts` delegates to these adapters instead of
 * hard-coding openai-codex assumptions.
 */

import { createHash } from "node:crypto";
import { convertOAuthAccountCredentialWithWarnings, type OAuthAccountImportMode } from "./oauth-account-converters";

// ─── Provider IDs ────────────────────────────────────────────────────────────

export const OPENAI_CODEX_PROVIDER_ID = "openai-codex";
export const GROK_CLI_PROVIDER_ID = "grok-cli";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const [, payload] = token.split(".");
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as unknown;
    return isRecord(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim();
  return email.includes("@") ? email : null;
}

function normalizePhone(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const phone = String(value).trim();
  const digitCount = phone.replace(/\D/g, "").length;
  return digitCount >= 6 ? phone : null;
}

const EMAIL_KEYS = ["email", "email_address", "emailAddress"];
const PHONE_KEYS = ["phone", "phone_number", "phoneNumber", "mobile", "mobile_number", "mobileNumber"];
const NESTED_ACCOUNT_INFO_KEYS = ["https://api.openai.com/profile", "https://api.openai.com/auth", "user", "account", "profile"];

function findEmailInRecord(value: unknown): string | null {
  if (!isRecord(value)) return null;
  for (const key of EMAIL_KEYS) {
    const email = normalizeEmail(value[key]);
    if (email) return email;
  }
  for (const key of NESTED_ACCOUNT_INFO_KEYS) {
    const nestedEmail = findEmailInRecord(value[key]);
    if (nestedEmail) return nestedEmail;
  }
  return null;
}

function findPhoneInRecord(value: unknown): string | null {
  if (!isRecord(value)) return null;
  for (const key of PHONE_KEYS) {
    const phone = normalizePhone(value[key]);
    if (phone) return phone;
  }
  for (const key of NESTED_ACCOUNT_INFO_KEYS) {
    const nestedPhone = findPhoneInRecord(value[key]);
    if (nestedPhone) return nestedPhone;
  }
  return null;
}

export function maskAccountId(accountId: string): string {
  if (accountId.length <= 10) return accountId;
  return `${accountId.slice(0, 6)}…${accountId.slice(-4)}`;
}

// ─── Adapter Interface ───────────────────────────────────────────────────────

export interface OAuthAccountProviderAdapter {
  /** Stable provider id matching the Pi provider id (e.g. "openai-codex"). */
  id: string;
  /** Human-readable provider name for diagnostics and error messages. */
  displayName: string;

  /** Whether a raw value looks like a valid persisted OAuth credential for this provider. */
  isCredential(value: unknown): boolean;

  /**
   * Derive a stable real/provider-native account identifier from the credential.
   * This is used for diagnostics, outbound API calls, and metadata; it is NOT
   * the opaque storage id used as the file-system key.
   */
  deriveRealAccountId(credential: Record<string, unknown>): string;

  /**
   * Best-effort display hint (email, name) from credential metadata.
   * Must never return secrets (tokens, codes).
   */
  deriveDisplayHint(credential: Record<string, unknown>): string | null;

  /** Whether this provider supports credential JSON import (CPA / sub2api). */
  supportsCredentialImport: boolean;

  /**
   * Convert and validate an imported credential blob into raw OAuth credential
   * objects suitable for `saveOAuthAccountCredential()`.
   */
  normalizeImportCredential(mode: OAuthAccountImportMode, credential: unknown): Record<string, unknown>[];

  /**
   * Optional async label backfill.  Called during `listOAuthAccounts()` when an
   * account has no user-set label.  Must not throw — failures are silently ignored.
   */
  backfillLabel?(accessToken: string, realAccountId: string): Promise<string | null>;

  /** Mask a real account id for safe UI display. */
  maskAccountId(accountId: string): string;
}

// ─── OpenAI Codex Adapter ────────────────────────────────────────────────────

function isOpenAICodexCredential(value: unknown): boolean {
  return isRecord(value)
    && value.type === "oauth"
    && typeof value.access === "string"
    && typeof value.refresh === "string"
    && typeof value.expires === "number";
}

export function extractOpenAICodexAccountId(accessToken: string): string | null {
  const decoded = decodeJwtPayload(accessToken) as { "https://api.openai.com/auth"?: { chatgpt_account_id?: unknown } } | null;
  const accountId = decoded?.["https://api.openai.com/auth"]?.chatgpt_account_id;
  return typeof accountId === "string" && accountId.length > 0 ? accountId : null;
}

function deriveOpenAICodexRealAccountId(credential: Record<string, unknown>): string {
  // Explicit accountId field from import or previous normalization.
  if (typeof credential.accountId === "string" && credential.accountId.trim()) {
    return credential.accountId.trim();
  }
  // JWT-based extraction from the access token.
  if (typeof credential.access === "string") {
    const tokenAccountId = extractOpenAICodexAccountId(credential.access);
    if (tokenAccountId) return tokenAccountId;
  }
  // Fallback hash when no stable identifier is available.
  const refresh = typeof credential.refresh === "string" ? credential.refresh : "";
  const access = typeof credential.access === "string" ? credential.access : "";
  const hash = createHash("sha256").update(refresh).update("\0").update(access).digest("hex").slice(0, 16);
  return `unknown-${hash}`;
}

function deriveOpenAICodexDisplayHint(credential: Record<string, unknown>): string | null {
  if (typeof credential.access === "string") {
    const claims = decodeJwtPayload(credential.access);
    if (claims) {
      const email = findEmailInRecord(claims);
      if (email) return email;
      const phone = findPhoneInRecord(claims);
      if (phone) return phone;
    }
  }
  return null;
}

const OPENAI_USERINFO_URLS = [
  "https://auth.openai.com/oauth/userinfo",
  "https://auth.openai.com/userinfo",
  "https://chatgpt.com/backend-api/me",
];

async function fetchOpenAICodexAccountLabel(accessToken: string, accountId: string): Promise<string | null> {
  const claims = decodeJwtPayload(accessToken);
  const claimsEmail = findEmailInRecord(claims);
  if (claimsEmail) return claimsEmail;
  const claimsPhone = findPhoneInRecord(claims);
  if (claimsPhone) return claimsPhone;

  const results = await Promise.all(OPENAI_USERINFO_URLS.map(async (url) => {
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "ChatGPT-Account-Id": accountId,
          "User-Agent": "yolk-pi-web",
        },
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) return null;
      const body = await response.json().catch(() => null) as unknown;
      return { email: findEmailInRecord(body), phone: findPhoneInRecord(body) };
    } catch {
      return null;
    }
  }));
  return results.find((r): r is { email: string; phone: string | null } => Boolean(r?.email))?.email
    ?? results.find((r): r is { email: string | null; phone: string } => Boolean(r?.phone))?.phone
    ?? null;
}

export const openAICodexAdapter: OAuthAccountProviderAdapter = {
  id: OPENAI_CODEX_PROVIDER_ID,
  displayName: "ChatGPT Plus/Pro",
  isCredential: isOpenAICodexCredential,
  deriveRealAccountId: deriveOpenAICodexRealAccountId,
  deriveDisplayHint: deriveOpenAICodexDisplayHint,
  supportsCredentialImport: true,
  normalizeImportCredential(mode, credential) {
    return convertOAuthAccountCredentialWithWarnings(mode, credential).credentials;
  },
  backfillLabel: fetchOpenAICodexAccountLabel,
  maskAccountId,
};

// ─── Grok CLI Adapter ────────────────────────────────────────────────────────

function isGrokCliCredential(value: unknown): boolean {
  // grok-cli credentials from pi-grok-cli's login() / refresh() contain
  // access / refresh / expires plus optional extended fields, but no
  // "type": "oauth" sentinel — matching only the required core shape.
  return isRecord(value)
    && typeof value.access === "string"
    && typeof value.refresh === "string"
    && typeof value.expires === "number";
}

function deriveGrokCliRealAccountId(credential: Record<string, unknown>): string {
  // xAI does not expose a stable account identifier in OAuth tokens.
  // Derive one from the refresh token for diagnostics and session pinning.
  const refresh = typeof credential.refresh === "string" ? credential.refresh : "";
  const hash = createHash("sha256").update(refresh).digest("hex").slice(0, 16);
  return `grok-${hash}`;
}

function deriveGrokCliDisplayHint(credential: Record<string, unknown>): string | null {
  // Try the access token JWT claims first, then idToken claims.
  if (typeof credential.access === "string") {
    const claims = decodeJwtPayload(credential.access);
    if (claims) {
      const email = typeof claims.email === "string" ? claims.email.trim() || null : null;
      if (email) return email;
      const name = typeof claims.name === "string" ? claims.name.trim() || null : null;
      if (name) return name;
    }
  }
  if (typeof credential.idToken === "string") {
    const claims = decodeJwtPayload(credential.idToken);
    if (claims) {
      const email = typeof claims.email === "string" ? claims.email.trim() || null : null;
      if (email) return email;
      const name = typeof claims.name === "string" ? claims.name.trim() || null : null;
      if (name) return name;
    }
  }
  return null;
}

export const grokCliAdapter: OAuthAccountProviderAdapter = {
  id: GROK_CLI_PROVIDER_ID,
  displayName: "Grok CLI (SuperGrok / X Premium)",
  isCredential: isGrokCliCredential,
  deriveRealAccountId: deriveGrokCliRealAccountId,
  deriveDisplayHint: deriveGrokCliDisplayHint,
  supportsCredentialImport: false,
  normalizeImportCredential() {
    throw new Error("Credential import is not supported for grok-cli. Use OAuth login instead.");
  },
  maskAccountId,
};

// ─── Adapter Registry ────────────────────────────────────────────────────────

const adapters = new Map<string, OAuthAccountProviderAdapter>([
  [OPENAI_CODEX_PROVIDER_ID, openAICodexAdapter],
  [GROK_CLI_PROVIDER_ID, grokCliAdapter],
]);

/**
 * Return the adapter for `provider`, or throw if the provider is not a
 * supported OAuth saved-account provider.
 */
export function getOAuthAccountAdapter(provider: string): OAuthAccountProviderAdapter {
  const adapter = adapters.get(provider);
  if (!adapter) {
    const supported = [...adapters.keys()].join(", ");
    throw new Error(`OAuth account management is not supported for ${provider}. Supported providers: ${supported}`);
  }
  return adapter;
}

/** Check whether a provider id is registered in the adapter registry. */
export function isSupportedOAuthAccountProvider(provider: string): boolean {
  return adapters.has(provider);
}
