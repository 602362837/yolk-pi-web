/**
 * github-app-credentials — server-only GitHub App identity material (GHA-01).
 *
 * Env (never browser / pi-web.json / Links / task/session):
 * - YPI_GITHUB_APP_ID
 * - YPI_GITHUB_APP_PRIVATE_KEY_FILE (0600 PEM file path)
 * - YPI_GITHUB_APP_WEBHOOK_SECRET
 * - YPI_GITHUB_APP_SLUG (optional)
 *
 * Responsibilities:
 * - Resolve and validate App configuration readiness (safe projection only).
 * - Load private key PEM from disk (memory only).
 * - Mint short-lived RS256 App JWTs (iat = now-60s, exp <= 9 minutes).
 *
 * Non-responsibilities:
 * - Never falls back to Links OAuth, personal PAT, or `gh auth`.
 * - Never persists JWT/token material to config store.
 * - Never returns private key or webhook secret in safe projections.
 */

import {
  createPrivateKey,
  createSign,
  type KeyObject,
} from "node:crypto";
import { access, readFile, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";

import { GithubAutomationError } from "./github-automation-errors";
import type {
  GithubAppCredentialReadinessCode,
  GithubAppCredentialSafeProjection,
} from "./github-automation-types";

// ─── Env names ───────────────────────────────────────────────────────────────

export const ENV_GITHUB_APP_ID = "YPI_GITHUB_APP_ID";
export const ENV_GITHUB_APP_PRIVATE_KEY_FILE = "YPI_GITHUB_APP_PRIVATE_KEY_FILE";
export const ENV_GITHUB_APP_WEBHOOK_SECRET = "YPI_GITHUB_APP_WEBHOOK_SECRET";
export const ENV_GITHUB_APP_SLUG = "YPI_GITHUB_APP_SLUG";

/** Max App JWT lifetime (GitHub allows up to 10 minutes; we use <= 9). */
export const GITHUB_APP_JWT_MAX_LIFETIME_SECONDS = 9 * 60;

/** Clock skew allowance when setting iat. */
export const GITHUB_APP_JWT_IAT_SKEW_SECONDS = 60;

// ─── Test overrides ──────────────────────────────────────────────────────────

interface CredentialEnvOverride {
  appId?: string | null;
  privateKeyFile?: string | null;
  webhookSecret?: string | null;
  appSlug?: string | null;
}

let _envOverride: CredentialEnvOverride | null = null;
let _nowSecondsOverride: number | null = null;

/** Test-only env override; pass null to clear. */
export function _testOverrideGithubAppCredentialEnv(
  override: CredentialEnvOverride | null,
): void {
  _envOverride = override;
}

/** Test-only clock; pass null to clear. */
export function _testOverrideGithubAppNowSeconds(now: number | null): void {
  _nowSecondsOverride =
    typeof now === "number" && Number.isFinite(now) ? Math.floor(now) : null;
}

function nowSeconds(): number {
  return _nowSecondsOverride ?? Math.floor(Date.now() / 1000);
}

function readEnv(name: string, overrideValue: string | null | undefined): string | null {
  if (overrideValue !== undefined) {
    if (overrideValue === null) return null;
    const trimmed = overrideValue.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  const raw = process.env[name];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveAppId(): string | null {
  return readEnv(ENV_GITHUB_APP_ID, _envOverride?.appId);
}

function resolvePrivateKeyFile(): string | null {
  return readEnv(ENV_GITHUB_APP_PRIVATE_KEY_FILE, _envOverride?.privateKeyFile);
}

function resolveWebhookSecret(): string | null {
  return readEnv(ENV_GITHUB_APP_WEBHOOK_SECRET, _envOverride?.webhookSecret);
}

function resolveAppSlug(): string | null {
  return readEnv(ENV_GITHUB_APP_SLUG, _envOverride?.appSlug);
}

// ─── Internal loaded credentials ─────────────────────────────────────────────

export interface GithubAppCredentials {
  appId: string;
  /** Loaded private key object (never serializable to JSON usefully). */
  privateKey: KeyObject;
  /** Absolute/relative path as configured (server-only; not for wire). */
  privateKeyFile: string;
  webhookSecret: string;
  appSlug: string | null;
}

// ─── Readiness ───────────────────────────────────────────────────────────────

async function classifyPrivateKeyFile(
  filePath: string | null,
): Promise<{
  hasFile: boolean;
  readiness: GithubAppCredentialReadinessCode | null;
}> {
  if (!filePath) {
    return { hasFile: false, readiness: "missing_private_key_file" };
  }
  try {
    await access(filePath, fsConstants.R_OK);
  } catch {
    return { hasFile: true, readiness: "private_key_unreadable" };
  }
  try {
    const st = await stat(filePath);
    if (!st.isFile()) {
      return { hasFile: true, readiness: "private_key_unreadable" };
    }
  } catch {
    return { hasFile: true, readiness: "private_key_unreadable" };
  }
  try {
    const pem = await readFile(filePath, "utf8");
    createPrivateKey(pem);
  } catch {
    return { hasFile: true, readiness: "private_key_invalid" };
  }
  return { hasFile: true, readiness: null };
}

/**
 * Safe readiness projection for Settings / status APIs.
 * Never includes key material, webhook secret, or file contents.
 */
export async function getGithubAppCredentialSafeProjection(
  checkedAt: string = new Date().toISOString(),
): Promise<GithubAppCredentialSafeProjection> {
  const appId = resolveAppId();
  const privateKeyFile = resolvePrivateKeyFile();
  const webhookSecret = resolveWebhookSecret();
  const appSlug = resolveAppSlug();

  const hasAppId = appId !== null;
  const hasWebhookSecret = webhookSecret !== null;
  const keyInfo = await classifyPrivateKeyFile(privateKeyFile);

  let readiness: GithubAppCredentialReadinessCode = "ready";
  if (!hasAppId) readiness = "missing_app_id";
  else if (keyInfo.readiness) readiness = keyInfo.readiness;
  else if (!hasWebhookSecret) readiness = "missing_webhook_secret";

  return {
    configured: readiness === "ready",
    readiness,
    appSlug,
    hasAppId,
    hasPrivateKeyFile: keyInfo.hasFile,
    hasWebhookSecret,
    checkedAt,
  };
}

/**
 * Load full server credentials or throw a safe GithubAutomationError.
 * Private key PEM is read into memory only; never returned as a string from public APIs.
 */
export async function loadGithubAppCredentials(): Promise<GithubAppCredentials> {
  const projection = await getGithubAppCredentialSafeProjection();
  if (!projection.configured) {
    throw new GithubAutomationError(
      "not_configured",
      "GitHub App automation is not configured",
      {
        status: 400,
        details: { readiness: projection.readiness },
      },
    );
  }

  const appId = resolveAppId();
  const privateKeyFile = resolvePrivateKeyFile();
  const webhookSecret = resolveWebhookSecret();
  if (!appId || !privateKeyFile || !webhookSecret) {
    // Race with env mutation; still fail closed.
    throw new GithubAutomationError("not_configured");
  }

  let privateKey: KeyObject;
  try {
    const pem = await readFile(privateKeyFile, "utf8");
    privateKey = createPrivateKey(pem);
  } catch {
    throw new GithubAutomationError(
      "not_configured",
      "GitHub App private key is unreadable or invalid",
      {
        status: 400,
        details: { readiness: "private_key_invalid" },
      },
    );
  }

  return {
    appId,
    privateKey,
    privateKeyFile,
    webhookSecret,
    appSlug: resolveAppSlug(),
  };
}

// ─── App JWT (RS256) ─────────────────────────────────────────────────────────

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

/**
 * Create a GitHub App JWT (RS256).
 * iat = now - 60s, exp = now + min(lifetimeSeconds, 9min).
 * Does not log or return the private key.
 */
export function createGithubAppJwt(
  credentials: Pick<GithubAppCredentials, "appId" | "privateKey">,
  options?: { nowSeconds?: number; lifetimeSeconds?: number },
): { token: string; iat: number; exp: number } {
  const now = options?.nowSeconds ?? nowSeconds();
  const lifetime = Math.min(
    Math.max(1, options?.lifetimeSeconds ?? GITHUB_APP_JWT_MAX_LIFETIME_SECONDS),
    GITHUB_APP_JWT_MAX_LIFETIME_SECONDS,
  );
  const iat = now - GITHUB_APP_JWT_IAT_SKEW_SECONDS;
  const exp = now + lifetime;

  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iat,
    exp,
    iss: credentials.appId,
  };

  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(credentials.privateKey).toString("base64url");
  return {
    token: `${signingInput}.${signature}`,
    iat,
    exp,
  };
}

/**
 * Convenience: load credentials and mint a JWT in one call.
 */
export async function mintGithubAppJwt(options?: {
  nowSeconds?: number;
  lifetimeSeconds?: number;
}): Promise<{ token: string; iat: number; exp: number; appId: string }> {
  const credentials = await loadGithubAppCredentials();
  const jwt = createGithubAppJwt(credentials, options);
  return { ...jwt, appId: credentials.appId };
}

/**
 * Return webhook secret for signature verification only (server memory).
 * Callers must not log or persist the value.
 */
export async function loadGithubAppWebhookSecret(): Promise<string> {
  const credentials = await loadGithubAppCredentials();
  return credentials.webhookSecret;
}
