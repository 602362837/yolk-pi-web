/**
 * antigravity-subscription-quota — fixed fetchAvailableModels quota service
 *
 * ## Contract
 *
 * - Calls only
 *   `POST https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels`
 *   with server-side Bearer token + `{"project":"<projectId>"}`.
 * - Never accepts a credential URL, arbitrary headers, UA, or body extension.
 * - Parses a bounded `models` record and only
 *   `quotaInfo.remainingFraction` / `quotaInfo.resetTime`.
 * - remainingFraction must be finite and in [0, 1]; invalid entries are dropped
 *   (never coerced to 0%). usedPercent = 100 * (1 - remaining).
 * - 5min fresh TTL, 24h stale max age, single-flight per account, 10s timeout.
 * - 401 triggers exactly one force-refresh + retry. 403 is access_denied /
 *   invalid_project and is not treated as reauth.
 * - Wire projection is AntigravityQuotaResultV1 only: opaque accountId, bounded
 *   model windows, cache state, fixed error codes. No token/refresh/projectId/
 *   raw body/URL/headers/path/request id.
 * - Default project id alone never marks quota/account healthy; success requires
 *   at least one valid model window from a live/fresh parse.
 *
 * ## Security
 *
 * Route layer must set Cache-Control: no-store. Errors use fixed safe messages.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { ANTIGRAVITY_PROVIDER_ID } from "./oauth-account-providers";
import { readOAuthActiveAccountId } from "./oauth-accounts";
import {
  getAntigravityAccessToken,
  type AntigravityTokenError,
} from "./antigravity-account-token";
import {
  getPublicModelIdsForQuotaKey,
  labelForAntigravityQuotaKey,
  MAX_PUBLIC_MODEL_IDS_PER_WINDOW,
  MAX_QUOTA_MODEL_KEY_LEN,
  MAX_QUOTA_MODEL_LABEL_LEN,
} from "./antigravity-model-quota";
import { ensureWebProvidersBootstrapped } from "./pi-provider-extensions";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Minimum interval between automatic Antigravity live quota fetches. Manual refresh=1 bypasses. */
const FRESH_TTL_MS = 5 * 60_000;
const STALE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h
const FETCH_TIMEOUT_MS = 10_000;
const QUOTA_CACHE_FILE = ".quota-cache.json";
const JSON_FILE_MODE = 0o600;
const ACCOUNT_DIR_MODE = 0o700;
const MAX_MODEL_WINDOWS = 64;

/** Fixed primary quota host — no credential URL, no host guessing. */
const FETCH_AVAILABLE_MODELS_URL =
  "https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels";

/**
 * Fixed Antigravity-style UA compatible with the locked 0.3.0 package.
 * Version is a code constant; credential may not supply UA.
 */
const ANTIGRAVITY_UA_VERSION = "1.104.0";
const ANTIGRAVITY_USER_AGENT = `antigravity/${ANTIGRAVITY_UA_VERSION} darwin/arm64`;

/** Safe fixed error messages — never include upstream body/path/projectId. */
const SAFE_ERROR_MESSAGES = {
  network: "Network error contacting Antigravity quota endpoint",
  rate_limited: "Antigravity quota endpoint rate limited the request",
  unauthorized: "Antigravity authorization expired. Please re-authenticate.",
  access_denied: "Antigravity quota access was denied",
  invalid_project: "Antigravity project is missing or not permitted for quota",
  upstream: "Antigravity quota endpoint returned an error",
  invalid_payload: "Antigravity quota response contained no usable model windows",
  missing_account: "Antigravity account id is required",
  no_active: "No active Antigravity account. Please log in or activate an account.",
  missing_credential: "Antigravity account credential not found",
  invalid_credential: "Antigravity account credential is invalid",
  missing_project: "Antigravity credential is missing project binding. Please re-authenticate.",
} as const;

// ─── Types ───────────────────────────────────────────────────────────────────

export type AntigravityQuotaErrorCode =
  | "network"
  | "rate_limited"
  | "unauthorized"
  | "access_denied"
  | "invalid_project"
  | "upstream"
  | "invalid_payload";

export interface AntigravityQuotaModelWindow {
  /** Bounded safe quota model key (or stable Web id). */
  id: string;
  /** Bounded catalog-derived label. */
  label: string;
  /** Allowlisted package catalog public ids, bounded. */
  publicModelIds: string[];
  /** Remaining proportion in [0, 1]. */
  remainingFraction: number;
  /** usedPercent = 100 * (1 - remainingFraction), float-clamped after compute. */
  usedPercent: number;
  /** ISO reset time when present and parseable; display only. */
  resetsAt?: string;
}

/** In-memory + persisted cache entry. Only normalized fields; no raw payload. */
interface AntigravityQuotaCacheEntry {
  success: boolean;
  queriedAt: number;
  models: AntigravityQuotaModelWindow[];
  reauthRequired?: boolean;
}

interface AntigravityQuotaPersistedCache {
  schemaVersion: 1;
  entries: Record<string, AntigravityQuotaCacheEntry>;
}

/** Safe wire projection — the only shape returned to API consumers. */
export interface AntigravityQuotaResultV1 {
  kind: "antigravity_subscription_quota";
  schemaVersion: 1;
  provider: "google-antigravity";
  accountId: string;
  success: boolean;
  models: AntigravityQuotaModelWindow[];
  cache: {
    state: "live" | "fresh" | "stale" | "none";
    queriedAt: string | null;
    ageMs: number | null;
  };
  reauthRequired: boolean;
  error?: {
    code: AntigravityQuotaErrorCode;
    message: string;
    retryable: boolean;
  };
}

interface AntigravityCredentialMeta {
  projectId: string;
}

interface FetchAvailableModelsResult {
  models: AntigravityQuotaModelWindow[] | null;
  error: AntigravityQuotaResultV1["error"] | null;
  statusCode: number | null;
}

// ─── In-memory state ─────────────────────────────────────────────────────────

const quotaCache = new Map<string, AntigravityQuotaCacheEntry>();
const inflightRequests = new Map<string, Promise<AntigravityQuotaResultV1>>();

// ─── Path helpers ────────────────────────────────────────────────────────────

function antigravityQuotaDir(): string {
  return join(getAgentDir(), "auth-accounts", ANTIGRAVITY_PROVIDER_ID);
}

function quotaCacheFilePath(): string {
  return join(antigravityQuotaDir(), QUOTA_CACHE_FILE);
}

function credentialFilePath(accountId: string): string {
  return join(antigravityQuotaDir(), `${encodeURIComponent(accountId)}.json`);
}

function flightKey(accountId: string): string {
  return `${ANTIGRAVITY_PROVIDER_ID}:${accountId}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function nowMillis(): number {
  return Date.now();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeText(value: unknown, maxLen: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().replace(/[\u0000-\u001f\u007f]/g, "");
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLen);
}

/**
 * Convert resetTime to ISO. Accepts ISO strings only for display.
 * Never used as duration/rank evidence by callers.
 */
export function normalizeAntigravityResetAt(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed).toISOString();
}

/**
 * remainingFraction must be finite and in [0, 1].
 * Do not clamp out-of-range raw values — reject the entry.
 */
export function parseRemainingFraction(value: unknown): number | null {
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value)) return null;
  if (value < 0 || value > 1) return null;
  return value;
}

/**
 * usedPercent from remaining. Clamp only floating-point noise after multiply.
 */
export function computeUsedPercent(remainingFraction: number): number {
  // Round to 6 decimal places to absorb binary float noise (e.g. 0.42 → 58),
  // then clamp only residual out-of-range values.
  const raw = (1 - remainingFraction) * 100;
  if (!Number.isFinite(raw)) return 0;
  const rounded = Math.round(raw * 1e6) / 1e6;
  if (rounded < 0) return 0;
  if (rounded > 100) return 100;
  return rounded;
}

function fixedError(
  code: AntigravityQuotaErrorCode,
  message: string,
  retryable: boolean,
): NonNullable<AntigravityQuotaResultV1["error"]> {
  return { code, message, retryable };
}

// ─── Credential metadata (server-only) ───────────────────────────────────────

async function readAntigravityCredentialMeta(
  accountId: string,
): Promise<AntigravityCredentialMeta | { error: "missing" | "invalid" | "missing_project" }> {
  try {
    const raw = JSON.parse(await readFile(credentialFilePath(accountId), "utf8")) as unknown;
    if (!isRecord(raw)) return { error: "invalid" };
    const projectId =
      typeof raw.projectId === "string" && raw.projectId.trim() ? raw.projectId.trim() : "";
    if (!projectId) return { error: "missing_project" };
    // projectId stays server-side only; never projected.
    return { projectId };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") return { error: "missing" };
    return { error: "invalid" };
  }
}

// ─── Persisted cache ─────────────────────────────────────────────────────────

function normalizeCachedModelWindow(raw: unknown): AntigravityQuotaModelWindow | null {
  if (!isRecord(raw)) return null;
  const id = sanitizeText(raw.id, MAX_QUOTA_MODEL_KEY_LEN);
  if (!id) return null;
  const remaining = parseRemainingFraction(raw.remainingFraction);
  if (remaining === null) return null;
  const usedPercent =
    typeof raw.usedPercent === "number" && Number.isFinite(raw.usedPercent)
      ? Math.min(100, Math.max(0, raw.usedPercent))
      : computeUsedPercent(remaining);
  const label =
    sanitizeText(raw.label, MAX_QUOTA_MODEL_LABEL_LEN) ?? labelForAntigravityQuotaKey(id);
  const publicModelIds: string[] = [];
  if (Array.isArray(raw.publicModelIds)) {
    for (const item of raw.publicModelIds) {
      if (publicModelIds.length >= MAX_PUBLIC_MODEL_IDS_PER_WINDOW) break;
      const pid = sanitizeText(item, MAX_QUOTA_MODEL_KEY_LEN);
      if (pid && !publicModelIds.includes(pid)) publicModelIds.push(pid);
    }
  }
  if (publicModelIds.length === 0) {
    publicModelIds.push(...getPublicModelIdsForQuotaKey(id));
  }
  const resetsAt = normalizeAntigravityResetAt(raw.resetsAt);
  const window: AntigravityQuotaModelWindow = {
    id,
    label,
    publicModelIds,
    remainingFraction: remaining,
    usedPercent,
  };
  if (resetsAt) window.resetsAt = resetsAt;
  return window;
}

function normalizeCacheEntry(raw: unknown): AntigravityQuotaCacheEntry | null {
  if (!isRecord(raw) || typeof raw.queriedAt !== "number" || !Number.isFinite(raw.queriedAt)) {
    return null;
  }
  const modelsRaw = Array.isArray(raw.models) ? raw.models : [];
  const models: AntigravityQuotaModelWindow[] = [];
  for (let i = 0; i < modelsRaw.length && models.length < MAX_MODEL_WINDOWS; i++) {
    const window = normalizeCachedModelWindow(modelsRaw[i]);
    if (window) models.push(window);
  }
  return {
    success: raw.success === true && models.length > 0,
    queriedAt: raw.queriedAt,
    models,
    reauthRequired: raw.reauthRequired === true || undefined,
  };
}

async function loadPersistedCache(): Promise<AntigravityQuotaPersistedCache> {
  try {
    const raw = await readFile(quotaCacheFilePath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || parsed.schemaVersion !== 1) {
      return { schemaVersion: 1, entries: {} };
    }
    const entries: Record<string, AntigravityQuotaCacheEntry> = {};
    if (isRecord(parsed.entries)) {
      for (const [key, value] of Object.entries(parsed.entries)) {
        const entry = normalizeCacheEntry(value);
        if (entry) entries[key] = entry;
      }
    }
    return { schemaVersion: 1, entries };
  } catch {
    return { schemaVersion: 1, entries: {} };
  }
}

async function savePersistedCache(
  accountId: string,
  entry: AntigravityQuotaCacheEntry,
): Promise<void> {
  try {
    const dir = antigravityQuotaDir();
    await mkdir(dir, { recursive: true, mode: ACCOUNT_DIR_MODE });
    const filePath = quotaCacheFilePath();
    const persisted = await loadPersistedCache();
    persisted.entries[accountId] = entry;
    const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
    await writeFile(tmp, `${JSON.stringify(persisted, null, 2)}\n`, {
      encoding: "utf8",
      mode: JSON_FILE_MODE,
    });
    await rename(tmp, filePath);
  } catch {
    // Best-effort persistence; never let a cache write fail the quota request.
  }
}

async function readPersistedCacheEntry(
  accountId: string,
): Promise<AntigravityQuotaCacheEntry | null> {
  const persisted = await loadPersistedCache();
  return persisted.entries[accountId] ?? null;
}

// ─── Parsers ─────────────────────────────────────────────────────────────────

/**
 * Parse one models-map entry. Rejects invalid remainingFraction instead of
 * clamping. Empty/missing quotaInfo drops the entry.
 */
export function parseFetchAvailableModelsEntry(
  modelKey: string,
  raw: unknown,
): AntigravityQuotaModelWindow | null {
  const id = sanitizeText(modelKey, MAX_QUOTA_MODEL_KEY_LEN);
  if (!id) return null;
  if (!isRecord(raw)) return null;
  const quotaInfo = raw.quotaInfo;
  if (!isRecord(quotaInfo)) return null;

  const remaining = parseRemainingFraction(quotaInfo.remainingFraction);
  if (remaining === null) return null;

  const usedPercent = computeUsedPercent(remaining);
  const label = labelForAntigravityQuotaKey(id);
  const publicModelIds = getPublicModelIdsForQuotaKey(id).slice(
    0,
    MAX_PUBLIC_MODEL_IDS_PER_WINDOW,
  );
  const resetsAt = normalizeAntigravityResetAt(quotaInfo.resetTime);

  const window: AntigravityQuotaModelWindow = {
    id,
    label,
    publicModelIds,
    remainingFraction: remaining,
    usedPercent,
  };
  if (resetsAt) window.resetsAt = resetsAt;
  return window;
}

/**
 * Normalize fetchAvailableModels payload into wire-safe model windows.
 * `models` must be a record. Zero valid entries → invalid (caller treats as fail).
 * Does not sort by remaining/reset/id; preserves encounter order up to the cap.
 */
export function parseFetchAvailableModelsPayload(payload: unknown): {
  models: AntigravityQuotaModelWindow[];
} {
  if (!isRecord(payload)) {
    throw new Error("invalid fetchAvailableModels payload");
  }
  const modelsRaw = payload.models;
  if (!isRecord(modelsRaw)) {
    throw new Error("invalid fetchAvailableModels payload");
  }

  const models: AntigravityQuotaModelWindow[] = [];
  for (const [key, value] of Object.entries(modelsRaw)) {
    if (models.length >= MAX_MODEL_WINDOWS) break;
    const window = parseFetchAvailableModelsEntry(key, value);
    if (window) models.push(window);
  }
  return { models };
}

// ─── Upstream fetch ──────────────────────────────────────────────────────────

function fetchAvailableModelsHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": ANTIGRAVITY_USER_AGENT,
  };
}

/**
 * Classify HTTP status into fixed error codes.
 * 403 with project semantics → invalid_project; other 403 → access_denied.
 * Never embeds response body text.
 */
export function mapAntigravityQuotaHttpError(
  statusCode: number,
  payload: unknown,
): NonNullable<AntigravityQuotaResultV1["error"]> | null {
  if (statusCode === 401) {
    return fixedError("unauthorized", SAFE_ERROR_MESSAGES.unauthorized, true);
  }
  if (statusCode === 403) {
    // Project/permission failures are not reauth.
    const text = isRecord(payload)
      ? `${typeof payload.error === "string" ? payload.error : ""} ${
          isRecord(payload.error) && typeof payload.error.message === "string"
            ? payload.error.message
            : ""
        } ${typeof payload.message === "string" ? payload.message : ""}`
      : "";
    const lower = text.toLowerCase();
    if (
      /project|permission|forbidden|access.?denied|not.?authorized.?to|cloud.?code/.test(lower) ||
      /invalid.?project|missing.?project|project.?id/.test(lower)
    ) {
      // Prefer invalid_project when project language is present; otherwise access_denied.
      if (/project/.test(lower)) {
        return fixedError("invalid_project", SAFE_ERROR_MESSAGES.invalid_project, false);
      }
      return fixedError("access_denied", SAFE_ERROR_MESSAGES.access_denied, false);
    }
    return fixedError("access_denied", SAFE_ERROR_MESSAGES.access_denied, false);
  }
  if (statusCode === 429) {
    return fixedError("rate_limited", SAFE_ERROR_MESSAGES.rate_limited, true);
  }
  if (statusCode >= 500) {
    return fixedError("upstream", SAFE_ERROR_MESSAGES.upstream, true);
  }
  if (statusCode < 200 || statusCode >= 300) {
    return fixedError("upstream", SAFE_ERROR_MESSAGES.upstream, true);
  }
  return null;
}

async function postFetchAvailableModels(
  accessToken: string,
  projectId: string,
): Promise<{
  statusCode: number;
  payload: unknown;
  networkError?: boolean;
}> {
  let response: Response;
  try {
    response = await fetch(FETCH_AVAILABLE_MODELS_URL, {
      method: "POST",
      headers: fetchAvailableModelsHeaders(accessToken),
      // Body only contains server-side projectId; never credential URL/headers.
      body: JSON.stringify({ project: projectId }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    return {
      statusCode: 0,
      payload: null,
      networkError: true,
    };
  }

  let payload: unknown = null;
  const text = await response.text().catch(() => "");
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = null;
    }
  }
  return { statusCode: response.status, payload };
}

async function fetchAvailableModelsData(
  accessToken: string,
  projectId: string,
): Promise<FetchAvailableModelsResult> {
  const response = await postFetchAvailableModels(accessToken, projectId);

  if (response.networkError) {
    return {
      models: null,
      error: fixedError("network", SAFE_ERROR_MESSAGES.network, true),
      statusCode: null,
    };
  }

  const statusCode = response.statusCode;
  const httpError = mapAntigravityQuotaHttpError(statusCode, response.payload);
  if (httpError) {
    return {
      models: null,
      error: httpError,
      statusCode,
    };
  }

  try {
    const parsed = parseFetchAvailableModelsPayload(response.payload);
    if (parsed.models.length === 0) {
      return {
        models: null,
        error: fixedError("invalid_payload", SAFE_ERROR_MESSAGES.invalid_payload, false),
        statusCode,
      };
    }
    return {
      models: parsed.models,
      error: null,
      statusCode,
    };
  } catch {
    return {
      models: null,
      error: fixedError("invalid_payload", SAFE_ERROR_MESSAGES.invalid_payload, false),
      statusCode,
    };
  }
}

// ─── Build result projection ─────────────────────────────────────────────────

function buildQuotaResult(
  accountId: string,
  entry: AntigravityQuotaCacheEntry,
  cacheState: AntigravityQuotaResultV1["cache"]["state"],
  reauthRequired: boolean,
  error?: AntigravityQuotaResultV1["error"],
): AntigravityQuotaResultV1 {
  const ageMs = entry.queriedAt ? nowMillis() - entry.queriedAt : null;
  const result: AntigravityQuotaResultV1 = {
    kind: "antigravity_subscription_quota",
    schemaVersion: 1,
    provider: "google-antigravity",
    accountId,
    success: entry.success && entry.models.length > 0,
    models: entry.models.map((m) => ({
      ...m,
      publicModelIds: [...m.publicModelIds],
    })),
    cache: {
      state: cacheState,
      queriedAt: entry.queriedAt ? new Date(entry.queriedAt).toISOString() : null,
      ageMs,
    },
    reauthRequired,
  };
  if (error) result.error = error;
  return result;
}

function buildStaleResult(
  accountId: string,
  entry: AntigravityQuotaCacheEntry,
  error: AntigravityQuotaResultV1["error"],
): AntigravityQuotaResultV1 {
  // Keep showing last successful windows. Do not escalate to reauthRequired just
  // because a revalidation attempt returned unauthorized while cached models still exist.
  const reauthRequired =
    entry.reauthRequired === true
    || (error?.code === "unauthorized" && entry.success !== true);
  const displayError =
    entry.models.length > 0 && error?.code === "unauthorized" && !reauthRequired
      ? fixedError("upstream", "Antigravity quota revalidation failed; showing last successful data", true)
      : error;
  return buildQuotaResult(accountId, entry, "stale", reauthRequired, displayError);
}

function buildUnavailableResult(
  accountId: string,
  error?: AntigravityQuotaResultV1["error"],
): AntigravityQuotaResultV1 {
  return {
    kind: "antigravity_subscription_quota",
    schemaVersion: 1,
    provider: "google-antigravity",
    accountId,
    success: false,
    models: [],
    cache: { state: "none", queriedAt: null, ageMs: null },
    reauthRequired: error?.code === "unauthorized",
    error: error ?? fixedError("network", "No cached quota data available", true),
  };
}

function mapTokenErrorToQuotaError(
  err: unknown,
): NonNullable<AntigravityQuotaResultV1["error"]> {
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as AntigravityTokenError).code)
      : "";
  if (code === "unauthorized" || code === "missing_refresh" || code === "refresh_failed") {
    return fixedError("unauthorized", SAFE_ERROR_MESSAGES.unauthorized, true);
  }
  if (code === "missing_project") {
    return fixedError("invalid_project", SAFE_ERROR_MESSAGES.missing_project, false);
  }
  if (code === "network") {
    return fixedError("network", SAFE_ERROR_MESSAGES.network, true);
  }
  if (code === "account_not_found" || code === "invalid_credential") {
    return fixedError("unauthorized", SAFE_ERROR_MESSAGES.missing_credential, false);
  }
  return fixedError("unauthorized", SAFE_ERROR_MESSAGES.unauthorized, true);
}

// ─── Core query ──────────────────────────────────────────────────────────────

async function queryAntigravityQuota(
  accountId: string,
  forceRefresh: boolean,
): Promise<AntigravityQuotaResultV1> {
  // Cold quota/Auth routes may never open Chat; OAuth refresh needs the fixed
  // google-antigravity provider registered in the process-global registry.
  await ensureWebProvidersBootstrapped().catch(() => {});

  const memEntry = quotaCache.get(accountId);
  if (!forceRefresh && memEntry) {
    const age = nowMillis() - memEntry.queriedAt;
    if (age < FRESH_TTL_MS) {
      return buildQuotaResult(accountId, memEntry, "fresh", memEntry.reauthRequired === true);
    }
  }

  const key = flightKey(accountId);
  const existingFlight = inflightRequests.get(key);
  if (existingFlight) return existingFlight;

  const promise = (async (): Promise<AntigravityQuotaResultV1> => {
    try {
      // 1. Credential meta (projectId server-side only)
      const meta = await readAntigravityCredentialMeta(accountId);
      if ("error" in meta) {
        const error: AntigravityQuotaResultV1["error"] =
          meta.error === "missing_project"
            ? fixedError("invalid_project", SAFE_ERROR_MESSAGES.missing_project, false)
            : fixedError(
                "unauthorized",
                meta.error === "missing"
                  ? SAFE_ERROR_MESSAGES.missing_credential
                  : SAFE_ERROR_MESSAGES.invalid_credential,
                false,
              );
        if (memEntry && nowMillis() - memEntry.queriedAt < STALE_MAX_AGE_MS) {
          return buildStaleResult(accountId, memEntry, error);
        }
        const persisted = await readPersistedCacheEntry(accountId);
        if (persisted && nowMillis() - persisted.queriedAt < STALE_MAX_AGE_MS) {
          return buildStaleResult(accountId, persisted, error);
        }
        return buildUnavailableResult(accountId, error);
      }

      // 2. Access token (projectId never returned by resolver)
      let accessToken: string;
      try {
        const token = await getAntigravityAccessToken(accountId);
        accessToken = token.accessToken;
      } catch (err) {
        const error = mapTokenErrorToQuotaError(err);
        if (memEntry && nowMillis() - memEntry.queriedAt < STALE_MAX_AGE_MS) {
          return buildStaleResult(accountId, memEntry, error);
        }
        const persisted = await readPersistedCacheEntry(accountId);
        if (persisted && nowMillis() - persisted.queriedAt < STALE_MAX_AGE_MS) {
          return buildStaleResult(accountId, persisted, error);
        }
        return buildUnavailableResult(accountId, error);
      }

      // 3. Fixed fetchAvailableModels call
      let result = await fetchAvailableModelsData(accessToken, meta.projectId);

      // 4. 401 only → force-refresh credential + retry once.
      // Retry is unconditional after a successful force refresh, even when the
      // returned access token string is unchanged (metadata-only refresh).
      // Never loop beyond this single retry.
      if (result.error?.code === "unauthorized" && result.statusCode === 401) {
        try {
          const refreshed = await getAntigravityAccessToken(accountId, { forceRefresh: true });
          accessToken = refreshed.accessToken;
          result = await fetchAvailableModelsData(accessToken, meta.projectId);
        } catch {
          // Refresh failed — keep original unauthorized result.
        }
      }

      // 5. Success path — requires at least one valid model window.
      // Default project id alone never marks success.
      if (result.models && result.models.length > 0 && !result.error) {
        const entry: AntigravityQuotaCacheEntry = {
          success: true,
          queriedAt: nowMillis(),
          models: result.models,
        };
        quotaCache.set(accountId, entry);
        await savePersistedCache(accountId, entry);
        return buildQuotaResult(accountId, entry, "live", false);
      }

      // 6. Error path with stale fallback
      if (result.error) {
        const reauthRequired = result.error.code === "unauthorized";
        const staleSource = memEntry ?? (await readPersistedCacheEntry(accountId));
        if (staleSource && nowMillis() - staleSource.queriedAt < STALE_MAX_AGE_MS) {
          return buildStaleResult(
            accountId,
            {
              ...staleSource,
              reauthRequired: reauthRequired || staleSource.reauthRequired,
            },
            result.error,
          );
        }
        return buildQuotaResult(
          accountId,
          {
            success: false,
            queriedAt: nowMillis(),
            models: [],
            reauthRequired: reauthRequired || undefined,
          },
          "none",
          reauthRequired,
          result.error,
        );
      }

      return buildUnavailableResult(accountId);
    } catch (err) {
      // Never leak filesystem paths or raw upstream text through error messages.
      const error = fixedError("network", SAFE_ERROR_MESSAGES.network, true);
      void err;
      const staleSource = memEntry ?? (await readPersistedCacheEntry(accountId));
      if (staleSource && nowMillis() - staleSource.queriedAt < STALE_MAX_AGE_MS) {
        return buildStaleResult(accountId, staleSource, error);
      }
      return buildUnavailableResult(accountId, error);
    } finally {
      inflightRequests.delete(key);
    }
  })();

  inflightRequests.set(key, promise);
  return promise;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Get Antigravity subscription quota for a specific saved account (opaque storage id).
 */
export async function getAntigravityAccountSubscriptionQuota(
  accountId: string,
  opts: { forceRefresh?: boolean } = {},
): Promise<AntigravityQuotaResultV1> {
  if (!accountId?.trim()) {
    return buildUnavailableResult(accountId ?? "", {
      code: "unauthorized",
      message: SAFE_ERROR_MESSAGES.missing_account,
      retryable: false,
    });
  }
  return queryAntigravityQuota(accountId.trim(), opts.forceRefresh === true);
}

/**
 * Get Antigravity subscription quota for the currently active account.
 */
export async function getAntigravityActiveSubscriptionQuota(
  opts: { forceRefresh?: boolean } = {},
): Promise<AntigravityQuotaResultV1> {
  let activeId: string | null = null;
  try {
    activeId = await readOAuthActiveAccountId(ANTIGRAVITY_PROVIDER_ID);
  } catch {
    activeId = null;
  }
  if (!activeId) {
    return {
      kind: "antigravity_subscription_quota",
      schemaVersion: 1,
      provider: "google-antigravity",
      accountId: "",
      success: false,
      models: [],
      cache: { state: "none", queriedAt: null, ageMs: null },
      reauthRequired: false,
      error: {
        code: "unauthorized",
        message: SAFE_ERROR_MESSAGES.no_active,
        retryable: false,
      },
    };
  }
  return queryAntigravityQuota(activeId, opts.forceRefresh === true);
}

/** Clear the in-memory cache entry for a given account. */
export function invalidateAntigravityQuotaCache(accountId: string): void {
  quotaCache.delete(accountId);
}

/** Test-only: clear all in-memory cache and inflight maps. */
export function __resetAntigravityQuotaStateForTests(): void {
  quotaCache.clear();
  inflightRequests.clear();
}
