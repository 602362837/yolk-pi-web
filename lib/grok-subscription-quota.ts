/**
 * grok-subscription-quota — Grok /billing quota service & safe API projection
 *
 * ## Contract
 *
 * - Reads billing from the pi-grok-cli backend (cli-chat-proxy.grok.com /billing)
 *   without importing private pi-grok-cli paths.
 * - Parses monthly (required) and weekly (optional) fields.
 * - 60s fresh TTL, 24h stale max age, single-flight per account.
 * - 10s fetch timeout.  401/403 triggers one credential refresh + retry.
 * - Persists only normalized cache; never returns raw payload or credentials.
 * - Every response projection carries Cache-Control: no-store in the route layer.
 *
 * ## Security
 *
 * No access/refresh/id-token, auth code, callback URL, raw billing payload,
 * upstream error body, base URL, or filesystem path reaches the wire projection.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { GROK_CLI_PROVIDER_ID } from "./oauth-account-providers";
import { getGrokAccessToken, type GrokTokenError } from "./grok-account-token";
import { withGrokProviderLock } from "./grok-account-lock";
import { getActiveGrokAccountId } from "./grok-session-account";

// ─── Constants ────────────────────────────────────────────────────────────────

const GROK_BILLING_BASE_URL = "https://cli-chat-proxy.grok.com/v1";
const FRESH_TTL_MS = 60_000;
const STALE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h
const FETCH_TIMEOUT_MS = 10_000;
const QUOTA_CACHE_FILE = ".quota-cache.json";
const JSON_FILE_MODE = 0o600;
const ACCOUNT_DIR_MODE = 0o700;

type QuotaErrorCode = "network" | "rate_limited" | "unauthorized" | "upstream" | "invalid_payload";

const SAFE_ERROR_MESSAGES = {
  network: "Grok billing network error. Please try again.",
  rate_limited: "Grok billing is rate limited. Please try again shortly.",
  unauthorized: "Grok authorization expired. Please re-authenticate.",
  upstream: "Grok billing is temporarily unavailable. Please try again.",
  invalid_payload: "Grok billing returned an invalid payload.",
  no_cache: "No cached quota data available",
  missing_credential: "Grok saved account credential is missing or invalid. Please re-authenticate.",
  provider_unavailable: "Grok OAuth provider is temporarily unavailable",
  refresh_failed: "Grok OAuth token refresh failed temporarily",
  unavailable: "Grok OAuth is temporarily unavailable",
  access_denied: "Grok billing access was denied.",
} as const;

function fixedError(
  code: QuotaErrorCode,
  message: string,
  retryable: boolean,
): NonNullable<GrokQuotaResultV1["error"]> {
  return { code, message, retryable };
}

// ─── Types ───────────────────────────────────────────────────────────────────

/** Raw monthly usage parsed from the /billing endpoint. */
interface GrokBillingMonthlyRaw {
  monthlyLimit: number;
  used: number;
  billingPeriodEnd: string;
}

/** Raw weekly usage parsed from /billing?format=credits when available. */
interface GrokBillingWeeklyRaw {
  creditUsagePercent: number;
  billingPeriodEnd: string;
}

/** In-memory + persisted cache entry. Only normalized fields; no raw payload. */
interface GrokQuotaCacheEntry {
  monthly: GrokBillingMonthlyRaw | null;
  weekly: GrokBillingWeeklyRaw | null;
  success: boolean;
  queriedAt: number;
  /** Set when the last fetch encountered a reauthRequired condition. */
  reauthRequired?: boolean;
}

/** Persisted cache file shape. */
interface GrokQuotaPersistedCache {
  schemaVersion: 1;
  entries: Record<string, GrokQuotaCacheEntry>;
}

/** Safe wire projection — the only shape returned to API consumers. */
export interface GrokQuotaResultV1 {
  kind: "grok_subscription_quota";
  schemaVersion: 1;
  success: boolean;
  provider: "grok-cli";
  accountId: string;
  monthly?: {
    limit: number;
    used: number;
    remaining: number;
    utilization: number;
    resetsAt: string;
  };
  weekly?: { usedPercent: number; resetsAt: string };
  cache: {
    state: "live" | "fresh" | "stale" | "none";
    queriedAt: string | null;
    ageMs: number | null;
  };
  reauthRequired: boolean;
  error?: {
    code: "network" | "rate_limited" | "unauthorized" | "upstream" | "invalid_payload";
    message: string;
    retryable: boolean;
  };
}

// ─── In-memory state ─────────────────────────────────────────────────────────

const quotaCache = new Map<string, GrokQuotaCacheEntry>();
const inflightRequests = new Map<string, Promise<GrokQuotaResultV1>>();

/**
 * Per-account generation counter bumped by reauth to invalidate in-flight
 * quota fetches that used the old credential.
 */
const quotaGenerations = new Map<string, number>();

// ─── Path helpers ────────────────────────────────────────────────────────────

function grokQuotaDir(): string {
  return join(getAgentDir(), "auth-accounts", GROK_CLI_PROVIDER_ID);
}

function quotaCacheFilePath(): string {
  return join(grokQuotaDir(), QUOTA_CACHE_FILE);
}

function flightKey(accountId: string): string {
  return `${GROK_CLI_PROVIDER_ID}:${accountId}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function nowMillis(): number {
  return Date.now();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toIsoString(iso: string): string | null {
  if (typeof iso !== "string") return null;
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString();
}

// ─── Persisted cache ─────────────────────────────────────────────────────────

async function loadPersistedCache(): Promise<GrokQuotaPersistedCache> {
  try {
    const raw = await readFile(quotaCacheFilePath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || parsed.schemaVersion !== 1) {
      return { schemaVersion: 1, entries: {} };
    }
    const entries: Record<string, GrokQuotaCacheEntry> = {};
    const rawEntries = parsed.entries;
    if (isRecord(rawEntries)) {
      for (const [key, value] of Object.entries(rawEntries)) {
        if (isRecord(value) && typeof value.queriedAt === "number") {
          const monthly = normalizeCacheMonthly(value.monthly);
          const weekly = normalizeCacheWeekly(value.weekly);
          const success = value.success === true && monthly !== null;
          entries[key] = normalizeQuotaCacheEntry({
            monthly,
            weekly,
            success,
            queriedAt: value.queriedAt,
            // Historical success+reauth must not stick as current credential evidence.
            reauthRequired: success ? undefined : value.reauthRequired === true || undefined,
          });
        }
      }
    }
    return { schemaVersion: 1, entries };
  } catch {
    return { schemaVersion: 1, entries: {} };
  }
}

function normalizeCacheMonthly(raw: unknown): GrokBillingMonthlyRaw | null {
  if (!isRecord(raw)) return null;
  const monthlyLimit = Number(raw.monthlyLimit);
  const used = Number(raw.used);
  const billingPeriodEnd = typeof raw.billingPeriodEnd === "string" ? raw.billingPeriodEnd : "";
  if (
    !Number.isFinite(monthlyLimit) || monthlyLimit < 0 ||
    !Number.isFinite(used) || used < 0 ||
    !billingPeriodEnd || !Number.isFinite(Date.parse(billingPeriodEnd))
  ) {
    return null;
  }
  return { monthlyLimit, used, billingPeriodEnd };
}

function normalizeCacheWeekly(raw: unknown): GrokBillingWeeklyRaw | null {
  if (!isRecord(raw)) return null;
  const creditUsagePercent = Number(raw.creditUsagePercent);
  const billingPeriodEnd = typeof raw.billingPeriodEnd === "string" ? raw.billingPeriodEnd : "";
  if (
    !Number.isFinite(creditUsagePercent) || creditUsagePercent < 0 ||
    !billingPeriodEnd || !Number.isFinite(Date.parse(billingPeriodEnd))
  ) {
    return null;
  }
  return { creditUsagePercent, billingPeriodEnd };
}

/**
 * Success entries never carry sticky reauthRequired. Stale reauth must come from
 * the current credential evidence, not a historical success cache mark.
 */
function normalizeQuotaCacheEntry(entry: GrokQuotaCacheEntry): GrokQuotaCacheEntry {
  const success = entry.success === true && entry.monthly !== null;
  return {
    monthly: entry.monthly ?? null,
    weekly: entry.weekly ?? null,
    success,
    queriedAt: entry.queriedAt,
    reauthRequired: success ? undefined : entry.reauthRequired === true || undefined,
  };
}

async function savePersistedCacheUnderLock(
  accountId: string,
  entry: GrokQuotaCacheEntry,
): Promise<void> {
  try {
    const dir = grokQuotaDir();
    await mkdir(dir, { recursive: true, mode: ACCOUNT_DIR_MODE });
    const filePath = quotaCacheFilePath();
    const persisted = await loadPersistedCache();
    persisted.entries[accountId] = entry;
    const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
    await writeFile(tmp, `${JSON.stringify(persisted, null, 2)}\n`, { encoding: "utf8", mode: JSON_FILE_MODE });
    await rename(tmp, filePath);
  } catch {
    // Best-effort persistence; never let a cache write fail the quota request.
  }
}

/**
 * Atomically decide whether an old quota flight may publish its outcome.
 * Reauth holds this same provider lock while it bumps the generation and
 * removes the persisted entry, so no old result can slip between a generation
 * check and its memory mutation, disk write, or returned projection.
 */
async function finalizeCurrentGeneration<T>(
  accountId: string,
  startGeneration: number,
  publish: () => Promise<T>,
): Promise<T | null> {
  return withGrokProviderLock(async () => {
    // Credential was replaced mid-flight; discard instead of publishing old quota.
    if (getGrokQuotaGeneration(accountId) !== startGeneration) return null;
    return publish();
  });
}

async function readPersistedCacheEntry(accountId: string): Promise<GrokQuotaCacheEntry | null> {
  const persisted = await loadPersistedCache();
  return persisted.entries[accountId] ?? null;
}

// ─── Parsers ─────────────────────────────────────────────────────────────────

/**
 * Parse the /billing response for monthly usage.
 * Throws on invalid payload (caller catches and maps to invalid_payload).
 */
function parseMonthlyBilling(payload: unknown): GrokBillingMonthlyRaw {
  if (!isRecord(payload)) throw new Error("invalid billing payload");
  const config = payload.config;
  if (!isRecord(config)) throw new Error("invalid billing payload");
  const monthlyLimit = (config.monthlyLimit as Record<string, unknown> | undefined)?.val;
  const used = (config.used as Record<string, unknown> | undefined)?.val;
  const billingPeriodEnd = config.billingPeriodEnd;
  if (
    typeof monthlyLimit !== "number" || !Number.isFinite(monthlyLimit) || monthlyLimit < 0 ||
    typeof used !== "number" || !Number.isFinite(used) || used < 0 ||
    typeof billingPeriodEnd !== "string" || !Number.isFinite(Date.parse(billingPeriodEnd))
  ) {
    throw new Error("invalid billing payload");
  }
  return { monthlyLimit, used, billingPeriodEnd };
}

/**
 * Parse the /billing?format=credits response for optional weekly usage.
 * Returns undefined when the current period is not weekly or the payload
 * is invalid — the caller treats missing weekly as a non-error.
 */
function parseWeeklyBilling(payload: unknown): GrokBillingWeeklyRaw | undefined {
  if (!isRecord(payload)) return undefined;
  const config = payload.config;
  if (!isRecord(config)) return undefined;
  const currentPeriod = config.currentPeriod as Record<string, unknown> | undefined;
  if (currentPeriod?.type !== "USAGE_PERIOD_TYPE_WEEKLY") return undefined;
  const creditUsagePercent = config.creditUsagePercent;
  const billingPeriodEnd = config.billingPeriodEnd;
  if (
    typeof creditUsagePercent !== "number" || !Number.isFinite(creditUsagePercent) || creditUsagePercent < 0 ||
    typeof billingPeriodEnd !== "string" || !Number.isFinite(Date.parse(billingPeriodEnd))
  ) {
    return undefined;
  }
  return { creditUsagePercent, billingPeriodEnd };
}

// ─── Billing fetch ───────────────────────────────────────────────────────────

function billingHeaders(accessToken: string): Record<string, string> {
  return {
    authorization: `Bearer ${accessToken}`,
    "x-xai-token-auth": "xai-grok-cli",
    accept: "application/json",
  };
}

interface BillingFetchResult {
  monthly: GrokBillingMonthlyRaw | null;
  weekly: GrokBillingWeeklyRaw | null;
  error: NonNullable<GrokQuotaResultV1["error"]> | null;
  statusCode: number | null;
}

/**
 * Classify billing HTTP status into fixed safe error codes.
 * First-pass 401/403 stay retryable so the caller can force-refresh once.
 * Final 403 after that path is mapped to non-reauth upstream/access-denied.
 */
export function mapGrokBillingHttpError(
  statusCode: number,
): NonNullable<GrokQuotaResultV1["error"]> | null {
  if (statusCode === 401) {
    return fixedError("unauthorized", SAFE_ERROR_MESSAGES.unauthorized, true);
  }
  if (statusCode === 403) {
    // 403 is access-denied / non-reauth. Callers may still force-refresh once
    // for compatibility, but the final classification stays non-reauth.
    return fixedError("upstream", SAFE_ERROR_MESSAGES.access_denied, true);
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

async function fetchBillingData(accessToken: string): Promise<BillingFetchResult> {
  const headers = billingHeaders(accessToken);

  // Fetch monthly (required)
  let monthlyResponse: Response;
  try {
    monthlyResponse = await fetch(`${GROK_BILLING_BASE_URL}/billing`, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    return {
      monthly: null,
      weekly: null,
      error: fixedError("network", SAFE_ERROR_MESSAGES.network, true),
      statusCode: null,
    };
  }

  const statusCode = monthlyResponse.status;
  const httpError = mapGrokBillingHttpError(statusCode);
  if (httpError) {
    return {
      monthly: null,
      weekly: null,
      error: httpError,
      statusCode,
    };
  }

  // Parse monthly
  let monthly: GrokBillingMonthlyRaw;
  try {
    const body = await monthlyResponse.json() as unknown;
    monthly = parseMonthlyBilling(body);
  } catch {
    return {
      monthly: null,
      weekly: null,
      error: fixedError("invalid_payload", SAFE_ERROR_MESSAGES.invalid_payload, false),
      statusCode,
    };
  }

  // Fetch weekly (best-effort)
  let weekly: GrokBillingWeeklyRaw | undefined;
  try {
    const weeklyResponse = await fetch(`${GROK_BILLING_BASE_URL}/billing?format=credits`, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (weeklyResponse.ok) {
      weekly = parseWeeklyBilling(await weeklyResponse.json() as unknown);
    }
  } catch {
    // Weekly failure is non-blocking
  }

  return { monthly, weekly: weekly ?? null, error: null, statusCode };
}

// ─── Build result projection ─────────────────────────────────────────────────

function buildQuotaResult(
  accountId: string,
  entry: GrokQuotaCacheEntry,
  cacheState: GrokQuotaResultV1["cache"]["state"],
  reauthRequired: boolean,
  error?: GrokQuotaResultV1["error"],
): GrokQuotaResultV1 {
  const ageMs = entry.queriedAt ? nowMillis() - entry.queriedAt : null;
  const result: GrokQuotaResultV1 = {
    kind: "grok_subscription_quota",
    schemaVersion: 1,
    success: entry.success && entry.monthly !== null,
    provider: "grok-cli",
    accountId,
    cache: {
      state: cacheState,
      queriedAt: entry.queriedAt ? new Date(entry.queriedAt).toISOString() : null,
      ageMs,
    },
    reauthRequired,
  };

  if (entry.monthly) {
    const limit = entry.monthly.monthlyLimit;
    const used = entry.monthly.used;
    const remaining = Math.max(0, limit - used);
    const utilization = limit > 0 ? Math.min(100, Math.max(0, (used / limit) * 100)) : 0;
    const resetsAt = toIsoString(entry.monthly.billingPeriodEnd);
    if (resetsAt) {
      result.monthly = { limit, used, remaining, utilization, resetsAt };
    }
  }

  if (entry.weekly) {
    const resetsAt = toIsoString(entry.weekly.billingPeriodEnd);
    if (resetsAt) {
      result.weekly = {
        usedPercent: Math.min(100, Math.max(0, entry.weekly.creditUsagePercent)),
        resetsAt,
      };
    }
  }

  if (error) result.error = error;
  return result;
}

function buildStaleResult(
  accountId: string,
  entry: GrokQuotaCacheEntry,
  error: GrokQuotaResultV1["error"],
): GrokQuotaResultV1 {
  // stale only means "showing last successful quota". reauthRequired comes from
  // the current error evidence, never sticky historical success+reauth marks.
  const normalized = normalizeQuotaCacheEntry(entry);
  const reauthRequired = error?.code === "unauthorized";
  return buildQuotaResult(accountId, normalized, "stale", reauthRequired, error);
}

function buildUnavailableResult(
  accountId: string,
  error?: GrokQuotaResultV1["error"],
): GrokQuotaResultV1 {
  return {
    kind: "grok_subscription_quota",
    schemaVersion: 1,
    success: false,
    provider: "grok-cli",
    accountId,
    cache: { state: "none", queriedAt: null, ageMs: null },
    reauthRequired: error?.code === "unauthorized",
    error: error ?? fixedError("network", SAFE_ERROR_MESSAGES.no_cache, true),
  };
}

/**
 * Map token-resolver failures to quota wire errors.
 *
 * Only confirmed credential problems become unauthorized/reauth:
 * - unauthorized (invalid_grant / revoked / reloginRequired)
 * - missing_refresh when AT is unusable
 * - missing/corrupt saved credential
 *
 * Provider bridge, storage/lock/mirror, network, and generic refresh failures
 * stay non-reauth (upstream/network).
 */
export function mapGrokTokenErrorToQuotaError(
  err: unknown,
): NonNullable<GrokQuotaResultV1["error"]> {
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as GrokTokenError).code)
      : "";
  if (code === "unauthorized" || code === "missing_refresh") {
    return fixedError("unauthorized", SAFE_ERROR_MESSAGES.unauthorized, true);
  }
  if (code === "network") {
    return fixedError("network", SAFE_ERROR_MESSAGES.network, true);
  }
  if (
    code === "provider_unavailable"
    || code === "unavailable"
    || code === "refresh_failed"
  ) {
    return fixedError(
      "upstream",
      code === "provider_unavailable"
        ? SAFE_ERROR_MESSAGES.provider_unavailable
        : code === "refresh_failed"
          ? SAFE_ERROR_MESSAGES.refresh_failed
          : SAFE_ERROR_MESSAGES.unavailable,
      true,
    );
  }
  if (
    code === "account_not_found"
    || code === "invalid_credential"
    || code === "missing_storage_id"
  ) {
    // Missing/corrupt local credential still requires re-login to restore a slot.
    return fixedError("unauthorized", SAFE_ERROR_MESSAGES.missing_credential, false);
  }
  // Unknown token errors default to non-reauth upstream. Confirmed unauthorized
  // must already be tagged by the token resolver.
  return fixedError("upstream", SAFE_ERROR_MESSAGES.upstream, true);
}

// ─── Core query ──────────────────────────────────────────────────────────────

async function queryGrokBilling(
  accountId: string,
  forceRefresh: boolean,
): Promise<GrokQuotaResultV1> {
  // 1. Check in-memory cache for fresh data. Success entries never sticky-reauth.
  const memEntryRaw = quotaCache.get(accountId);
  const memEntry = memEntryRaw ? normalizeQuotaCacheEntry(memEntryRaw) : null;
  if (memEntry && memEntry !== memEntryRaw) {
    quotaCache.set(accountId, memEntry);
  }
  if (!forceRefresh && memEntry) {
    const age = nowMillis() - memEntry.queriedAt;
    if (age < FRESH_TTL_MS) {
      return buildQuotaResult(accountId, memEntry, "fresh", memEntry.reauthRequired === true);
    }
  }

  const key = flightKey(accountId);
  const existingFlight = inflightRequests.get(key);
  if (existingFlight) return existingFlight;

  const promise = (async (): Promise<GrokQuotaResultV1> => {
    // Capture the generation at the start so a concurrent reauth bump
    // prevents this flight from writing stale data.
    const startGeneration = getGrokQuotaGeneration(accountId);

    try {
      // 2. Get access token — map structured evidence; never default unauthorized.
      let accessToken: string;
      try {
        const token = await getGrokAccessToken(accountId);
        accessToken = token.accessToken;
      } catch (err) {
        const tokenError = mapGrokTokenErrorToQuotaError(err);
        const published = await finalizeCurrentGeneration(accountId, startGeneration, async () => {
          const staleSource = memEntry ?? await readPersistedCacheEntry(accountId);
          if (staleSource && (nowMillis() - staleSource.queriedAt) < STALE_MAX_AGE_MS) {
            return buildStaleResult(accountId, staleSource, tokenError);
          }
          return buildUnavailableResult(accountId, tokenError);
        });
        return published ?? buildUnavailableResult(accountId, tokenError);
      }

      // 3. Fetch billing
      let result = await fetchBillingData(accessToken);

      // 4. 401/403 → exactly one force-refresh + one billing retry.
      // Trigger on status codes (not final error code): 403 stays non-reauth
      // even while still allowing a compatibility force refresh.
      // After a successful force refresh, always retry with the returned AT
      // (no token-string / refreshed-boolean gate). Refresh infrastructure
      // failures replace provisional billing errors via the structured mapper.
      if (result.statusCode === 401 || result.statusCode === 403) {
        try {
          const refreshed = await getGrokAccessToken(accountId, { forceRefresh: true });
          // Unconditional retry after a successful force refresh — no token
          // string comparison and no refreshed-boolean gate.
          accessToken = refreshed.accessToken;
          result = await fetchBillingData(accessToken);
        } catch (refreshErr) {
          // Structured token evidence always overrides the provisional billing
          // classification: confirmed unauthorized stays reauth; provider /
          // network / store / generic refresh stay non-reauth.
          const mapped = mapGrokTokenErrorToQuotaError(refreshErr);
          result = {
            monthly: null,
            weekly: null,
            error: mapped,
            statusCode: null,
          };
        }
      }

      // 5. Publish the live result only while reauth cannot interleave.
      // Live success always clears historical reauthRequired.
      if (result.monthly && !result.error) {
        const entry = normalizeQuotaCacheEntry({
          monthly: result.monthly,
          weekly: result.weekly,
          success: true,
          queriedAt: nowMillis(),
        });
        const published = await finalizeCurrentGeneration(accountId, startGeneration, async () => {
          quotaCache.set(accountId, entry);
          await savePersistedCacheUnderLock(accountId, entry);
          return buildQuotaResult(accountId, entry, "live", false);
        });
        return published ?? buildUnavailableResult(accountId);
      }

      // Error/stale paths also finalize under the provider lock. Reading the
      // persisted entry here keeps the stale-return decision in the same
      // boundary as reauth's generation bump and cache deletion.
      if (result.error) {
        const published = await finalizeCurrentGeneration(accountId, startGeneration, async () => {
          const staleSource = memEntry ?? await readPersistedCacheEntry(accountId);
          if (staleSource && (nowMillis() - staleSource.queriedAt) < STALE_MAX_AGE_MS) {
            // Current evidence decides reauth; do not mutate sticky reauth onto
            // a successful historical cache entry.
            return buildStaleResult(accountId, staleSource, result.error!);
          }
          const reauthRequired = result.error!.code === "unauthorized";
          const errorEntry = normalizeQuotaCacheEntry({
            monthly: null,
            weekly: null,
            success: false,
            queriedAt: nowMillis(),
            reauthRequired,
          });
          // Only non-success error entries may persist reauthRequired.
          quotaCache.set(accountId, errorEntry);
          await savePersistedCacheUnderLock(accountId, errorEntry);
          return buildQuotaResult(accountId, errorEntry, "none", reauthRequired, result.error!);
        });
        return published ?? buildUnavailableResult(accountId, result.error);
      }

      // Unexpected: monthly null but no error
      return buildUnavailableResult(accountId);
    } catch {
      const error = fixedError("network", SAFE_ERROR_MESSAGES.network, true);
      const published = await finalizeCurrentGeneration(accountId, startGeneration, async () => {
        const staleSource = memEntry ?? await readPersistedCacheEntry(accountId);
        if (staleSource && (nowMillis() - staleSource.queriedAt) < STALE_MAX_AGE_MS) {
          return buildStaleResult(accountId, staleSource, error);
        }
        return buildUnavailableResult(accountId, error);
      });
      return published ?? buildUnavailableResult(accountId, error);
    } finally {
      inflightRequests.delete(key);
    }
  })();

  inflightRequests.set(key, promise);
  return promise;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Get Grok subscription quota for a specific saved account.
 *
 * @param accountId Opaque storage id of the saved Grok account.
 * @param opts.forceRefresh Bypass the fresh cache and re-fetch from upstream.
 */
export async function getGrokAccountSubscriptionQuota(
  accountId: string,
  opts: { forceRefresh?: boolean } = {},
): Promise<GrokQuotaResultV1> {
  if (!accountId?.trim()) {
    return buildUnavailableResult(accountId ?? "");
  }
  return queryGrokBilling(accountId.trim(), opts.forceRefresh === true);
}

/**
 * Get Grok subscription quota for the currently active account.
 */
export async function getGrokActiveSubscriptionQuota(
  opts: { forceRefresh?: boolean } = {},
): Promise<GrokQuotaResultV1> {
  const activeId = await getActiveGrokAccountId();
  if (!activeId) {
    return {
      kind: "grok_subscription_quota",
      schemaVersion: 1,
      success: false,
      provider: "grok-cli",
      accountId: "",
      cache: { state: "none", queriedAt: null, ageMs: null },
      reauthRequired: false,
      error: { code: "unauthorized", message: "No active Grok account. Please log in or activate an account.", retryable: false },
    };
  }
  return queryGrokBilling(activeId, opts.forceRefresh === true);
}

/**
 * Clear the in-memory cache entry for a given account.
 * The persisted cache is not affected — it serves as a stale fallback.
 */
export function invalidateGrokQuotaCache(accountId: string): void {
  quotaCache.delete(accountId);
}

/** Test-only: clear process-local quota cache / flights / generations. */
export function __resetGrokQuotaStateForTests(): void {
  quotaCache.clear();
  inflightRequests.clear();
  quotaGenerations.clear();
}

// ─── Quota generation (reauth isolation) ─────────────────────────────────────

/**
 * Bump the quota generation for `accountId` so any in-flight fetches that
 * started before reauthentication discard their results.
 */
export function bumpGrokQuotaGeneration(accountId: string): void {
  const current = quotaGenerations.get(accountId) ?? 0;
  quotaGenerations.set(accountId, current + 1);
  // Also clear the in-memory cache so the next read is forced to re-fetch.
  quotaCache.delete(accountId);
}

/**
 * Return the current quota generation for `accountId`.
 * Used by fetchers to detect staleness before writing results.
 */
export function getGrokQuotaGeneration(accountId: string): number {
  return quotaGenerations.get(accountId) ?? 0;
}

/**
 * Delete the persisted quota cache entry for `accountId` so a reauth'd
 * account never displays stale quota from the previous credential.
 */
export async function deleteGrokQuotaPersistedCacheEntry(accountId: string): Promise<void> {
  try {
    const dir = grokQuotaDir();
    const filePath = quotaCacheFilePath();
    const persisted = await loadPersistedCache();
    if (!persisted.entries[accountId]) return;
    delete persisted.entries[accountId];
    const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
    await mkdir(dir, { recursive: true, mode: ACCOUNT_DIR_MODE });
    await writeFile(tmp, `${JSON.stringify(persisted, null, 2)}\n`, { encoding: "utf8", mode: JSON_FILE_MODE });
    await rename(tmp, filePath);
  } catch {
    // Best-effort; never let cache cleanup fail the reauth.
  }
}
