/**
 * github-app-credentials — server-only GitHub App identity material.
 *
 * Resolution (per field): non-empty process env → one consistent local bundle
 * snapshot → missing. Empty/blank env does not override local.
 *
 * Env names (advanced override; never browser / pi-web.json / Links / task/session):
 * - YPI_GITHUB_APP_ID
 * - YPI_GITHUB_APP_PRIVATE_KEY_FILE (0600 PEM file path)
 * - YPI_GITHUB_APP_WEBHOOK_SECRET
 * - YPI_GITHUB_APP_SLUG (optional)
 *
 * Local bundle: `<getAgentDir()>/github-automation/credentials.v1.json` + generation PEM
 * (see github-app-credential-store). Env values are never imported into local storage.
 *
 * Responsibilities:
 * - Resolve and validate App configuration readiness (safe projection only).
 * - Load private key PEM / KeyObject (memory only).
 * - Mint short-lived RS256 App JWTs (iat = now-60s, exp <= 9 minutes).
 *
 * Non-responsibilities:
 * - Never falls back to Links OAuth, personal PAT, or `gh auth`.
 * - Never persists JWT/token material to config store.
 * - Never returns App ID value, private key, webhook secret, path, or fingerprint
 *   in safe projections.
 */

import {
  createPrivateKey,
  createSign,
  type KeyObject,
} from "node:crypto";
import { access, readFile, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";

import {
  getGithubAppLocalCredentialSafeSummary,
  loadGithubAppLocalCredentials,
  type GithubAppLocalCredentialLoadResult,
} from "./github-app-credential-store";
import { GithubAutomationError } from "./github-automation-errors";
import type {
  GithubAppCredentialReadinessCode,
  GithubAppCredentialSafeProjection,
  GithubAppCredentialValueSource,
  GithubAppLocalCredentialSafeSummary,
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

function resolveEnvAppId(): string | null {
  return readEnv(ENV_GITHUB_APP_ID, _envOverride?.appId);
}

function resolveEnvPrivateKeyFile(): string | null {
  return readEnv(ENV_GITHUB_APP_PRIVATE_KEY_FILE, _envOverride?.privateKeyFile);
}

function resolveEnvWebhookSecret(): string | null {
  return readEnv(ENV_GITHUB_APP_WEBHOOK_SECRET, _envOverride?.webhookSecret);
}

function resolveEnvAppSlug(): string | null {
  return readEnv(ENV_GITHUB_APP_SLUG, _envOverride?.appSlug);
}

// ─── Internal loaded credentials ─────────────────────────────────────────────

export interface GithubAppCredentials {
  appId: string;
  /** Loaded private key object (never serializable to JSON usefully). */
  privateKey: KeyObject;
  /**
   * Server-only path of the active key material (env path or local generation path).
   * Never projected to wire / UI.
   */
  privateKeyFile: string;
  webhookSecret: string;
  appSlug: string | null;
}

// ─── Effective resolution (one local snapshot) ───────────────────────────────

interface ResolvedScalar {
  value: string | null;
  source: GithubAppCredentialValueSource;
}

interface EffectiveCredentialSnapshot {
  appId: ResolvedScalar;
  webhook: ResolvedScalar;
  slug: ResolvedScalar;
  keySource: GithubAppCredentialValueSource;
  envKeyPath: string | null;
  /** Set only when local bundle loaded successfully (readiness ready). */
  localLoad: GithubAppLocalCredentialLoadResult | null;
  local: GithubAppLocalCredentialSafeSummary;
}

/**
 * Load one consistent local snapshot and overlay non-empty env per field.
 * Callers must use this snapshot for both projection and full load so fields
 * never come from different local generations.
 */
async function resolveEffectiveCredentialSnapshot(): Promise<EffectiveCredentialSnapshot> {
  const local = await getGithubAppLocalCredentialSafeSummary();

  let localLoad: GithubAppLocalCredentialLoadResult | null = null;
  if (local.readiness === "ready" && local.configured) {
    try {
      localLoad = await loadGithubAppLocalCredentials();
    } catch {
      // Fail closed: treat as invalid local for this resolution pass.
      localLoad = null;
    }
  }

  // If summary said ready but load failed, surface invalid for local panel.
  const localSummary: GithubAppLocalCredentialSafeSummary =
    local.readiness === "ready" && local.configured && !localLoad
      ? {
          configured: false,
          readiness: "invalid",
          hasAppId: false,
          hasKey: false,
          hasWebhook: false,
          updatedAt: local.updatedAt,
        }
      : local;

  const envAppId = resolveEnvAppId();
  const envWebhook = resolveEnvWebhookSecret();
  const envSlug = resolveEnvAppSlug();
  const envKeyPath = resolveEnvPrivateKeyFile();

  const localAppId =
    localLoad && localLoad.bundle.appId ? localLoad.bundle.appId : null;
  const localWebhook =
    localLoad && localLoad.bundle.webhookSecret
      ? localLoad.bundle.webhookSecret
      : null;
  const localSlug =
    localLoad && localLoad.bundle.appSlug ? localLoad.bundle.appSlug : null;

  const appId: ResolvedScalar = envAppId
    ? { value: envAppId, source: "env" }
    : localAppId
      ? { value: localAppId, source: "local" }
      : { value: null, source: "missing" };

  const webhook: ResolvedScalar = envWebhook
    ? { value: envWebhook, source: "env" }
    : localWebhook
      ? { value: localWebhook, source: "local" }
      : { value: null, source: "missing" };

  // Optional slug: non-empty env wins; else local (may be null → missing).
  let slug: ResolvedScalar;
  if (envSlug) {
    slug = { value: envSlug, source: "env" };
  } else if (localLoad) {
    slug = localSlug
      ? { value: localSlug, source: "local" }
      : { value: null, source: "missing" };
  } else {
    slug = { value: null, source: "missing" };
  }

  let keySource: GithubAppCredentialValueSource;
  if (envKeyPath) {
    keySource = "env";
  } else if (localLoad) {
    keySource = "local";
  } else {
    keySource = "missing";
  }

  return {
    appId,
    webhook,
    slug,
    keySource,
    envKeyPath,
    localLoad,
    local: localSummary,
  };
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

function classifyLocalKeyNeed(
  local: GithubAppLocalCredentialSafeSummary,
): {
  hasKey: boolean;
  readiness: GithubAppCredentialReadinessCode | null;
} {
  if (local.readiness === "ready" && local.hasKey) {
    return { hasKey: true, readiness: null };
  }
  if (local.readiness === "missing") {
    return { hasKey: false, readiness: "missing_private_key_file" };
  }
  // invalid / unsupported when the effective key would come from local
  return {
    hasKey: local.hasKey,
    readiness: "private_key_invalid",
  };
}

/**
 * Safe readiness projection for Settings / status APIs.
 * Never includes App ID value, key material, webhook secret, path, or fingerprint.
 */
export async function getGithubAppCredentialSafeProjection(
  checkedAt: string = new Date().toISOString(),
): Promise<GithubAppCredentialSafeProjection> {
  const snap = await resolveEffectiveCredentialSnapshot();

  const hasAppId = snap.appId.value !== null;
  const hasWebhookSecret = snap.webhook.value !== null;

  let hasPrivateKey = false;
  let keyReadiness: GithubAppCredentialReadinessCode | null = null;

  if (snap.keySource === "env") {
    const keyInfo = await classifyPrivateKeyFile(snap.envKeyPath);
    hasPrivateKey = keyInfo.hasFile;
    keyReadiness = keyInfo.readiness;
  } else if (snap.keySource === "local") {
    const keyInfo = classifyLocalKeyNeed(snap.local);
    hasPrivateKey = keyInfo.hasKey;
    keyReadiness = keyInfo.readiness;
  } else {
    // missing effective key — if local is damaged, report that rather than plain missing
    // only when env did not supply a key path (already true here).
    if (snap.local.readiness === "invalid" || snap.local.readiness === "unsupported") {
      hasPrivateKey = false;
      keyReadiness = "private_key_invalid";
    } else {
      hasPrivateKey = false;
      keyReadiness = "missing_private_key_file";
    }
  }

  // Readiness order (design):
  // 1. missing app ID
  // 2. invalid App ID (no dedicated wire code today; non-empty string accepted)
  // 3. missing key
  // 4. unreadable/invalid env key, or invalid/unsupported local when key needs local
  // 5. missing Webhook secret
  // 6. ready
  //
  // When local is invalid/unsupported but every required field is supplied by env,
  // effective remains ready and local warning stays on the local summary.
  let readiness: GithubAppCredentialReadinessCode = "ready";
  if (!hasAppId) readiness = "missing_app_id";
  else if (keyReadiness) readiness = keyReadiness;
  else if (!hasWebhookSecret) readiness = "missing_webhook_secret";

  return {
    configured: readiness === "ready",
    readiness,
    appSlug: snap.slug.value,
    hasAppId,
    hasPrivateKeyFile: hasPrivateKey,
    hasPrivateKey,
    hasWebhookSecret,
    checkedAt,
    local: {
      configured: snap.local.configured,
      readiness: snap.local.readiness,
      hasAppId: snap.local.hasAppId,
      hasKey: snap.local.hasKey,
      hasWebhook: snap.local.hasWebhook,
      updatedAt: snap.local.updatedAt,
    },
    sources: {
      appId: snap.appId.source,
      key: snap.keySource,
      webhook: snap.webhook.source,
      slug: snap.slug.source,
    },
  };
}

/**
 * Load full server credentials or throw a safe GithubAutomationError.
 * Private key PEM is read into memory only; never returned as a string from public APIs.
 * Uses one env-over-local snapshot so fields never mix local generations.
 */
export async function loadGithubAppCredentials(): Promise<GithubAppCredentials> {
  const snap = await resolveEffectiveCredentialSnapshot();

  // Reuse the same readiness rules as the safe projection (without a second local load).
  const hasAppId = snap.appId.value !== null;
  const hasWebhookSecret = snap.webhook.value !== null;

  let keyReadiness: GithubAppCredentialReadinessCode | null = null;
  let envKeyOk = false;
  if (snap.keySource === "env") {
    const keyInfo = await classifyPrivateKeyFile(snap.envKeyPath);
    keyReadiness = keyInfo.readiness;
    envKeyOk = keyInfo.readiness === null && keyInfo.hasFile;
  } else if (snap.keySource === "local") {
    keyReadiness = classifyLocalKeyNeed(snap.local).readiness;
  } else if (
    snap.local.readiness === "invalid" ||
    snap.local.readiness === "unsupported"
  ) {
    keyReadiness = "private_key_invalid";
  } else {
    keyReadiness = "missing_private_key_file";
  }

  let readiness: GithubAppCredentialReadinessCode = "ready";
  if (!hasAppId) readiness = "missing_app_id";
  else if (keyReadiness) readiness = keyReadiness;
  else if (!hasWebhookSecret) readiness = "missing_webhook_secret";

  if (readiness !== "ready") {
    throw new GithubAutomationError(
      "not_configured",
      "GitHub App automation is not configured",
      {
        status: 400,
        details: { readiness },
      },
    );
  }

  const appId = snap.appId.value;
  const webhookSecret = snap.webhook.value;
  if (!appId || !webhookSecret) {
    throw new GithubAutomationError("not_configured");
  }

  let privateKey: KeyObject;
  let privateKeyFile: string;

  if (snap.keySource === "env") {
    if (!snap.envKeyPath || !envKeyOk) {
      throw new GithubAutomationError("not_configured");
    }
    try {
      const pem = await readFile(snap.envKeyPath, "utf8");
      privateKey = createPrivateKey(pem);
      privateKeyFile = snap.envKeyPath;
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
  } else if (snap.keySource === "local" && snap.localLoad) {
    privateKey = snap.localLoad.privateKey;
    privateKeyFile = snap.localLoad.privateKeyPath;
  } else {
    throw new GithubAutomationError("not_configured");
  }

  return {
    appId,
    privateKey,
    privateKeyFile,
    webhookSecret,
    appSlug: snap.slug.value,
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
 * Re-resolves env-over-local on every call (no process-level secret cache).
 */
export async function loadGithubAppWebhookSecret(): Promise<string> {
  const credentials = await loadGithubAppCredentials();
  return credentials.webhookSecret;
}
