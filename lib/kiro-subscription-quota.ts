/**
 * kiro-subscription-quota — AWS CodeWhisperer GetUsageLimits service & safe API projection
 *
 * ## Contract
 *
 * - Calls only `https://q.<validated-region>.amazonaws.com/` with
 *   `X-Amz-Target: AmazonCodeWhispererService.GetUsageLimits`.
 * - Never accepts an arbitrary endpoint/URL from credentials.
 * - Parses usageBreakdownList (preferred) / usageBreakdown with precision-first
 *   numeric fields; normalizes a primary bucket and optional subscription title.
 * - 60s fresh TTL, 24h stale max age, single-flight per account.
 * - 10s fetch timeout. 401 triggers one force-refresh + retry.
 * - Persists only normalized cache; never returns raw payload, profileArn,
 *   tokens, userInfo, paths, or upstream bodies.
 *
 * ## Security
 *
 * Wire projection is KiroQuotaResultV1 only. Credential profileArn/region are
 * used server-side and never projected. Route layer must set Cache-Control: no-store.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { KIRO_PROVIDER_ID } from "./oauth-account-providers";
import { readOAuthActiveAccountId } from "./oauth-accounts";
import { getKiroAccessToken } from "./kiro-account-token";

// ─── Constants ────────────────────────────────────────────────────────────────

const FRESH_TTL_MS = 60_000;
const STALE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h
const FETCH_TIMEOUT_MS = 10_000;
const QUOTA_CACHE_FILE = ".quota-cache.json";
const JSON_FILE_MODE = 0o600;
const ACCOUNT_DIR_MODE = 0o700;
const DEFAULT_REGION = "us-east-1";
const MAX_BUCKETS = 8;
const MAX_LABEL_LEN = 64;
const MAX_UNIT_LEN = 32;
const MAX_TITLE_LEN = 80;
const GET_USAGE_LIMITS_TARGET = "AmazonCodeWhispererService.GetUsageLimits";
const ORIGIN = "AI_EDITOR";

/** Strict commercial AWS region format; never trust free-form credential strings. */
const AWS_COMMERCIAL_REGION_RE =
  /^(af|ap|ca|eu|il|me|mx|sa|us)-(central|east|north|northeast|northwest|south|southeast|southwest|west)-\d+$/;

const RESOURCE_TYPE_ALLOWLIST = new Set([
  "CREDIT",
  "VIBE",
  "SPEC",
  "AGENTIC_REQUEST",
  "OTHER",
] as const);

// ─── Types ───────────────────────────────────────────────────────────────────

export type KiroQuotaResourceType = "CREDIT" | "VIBE" | "SPEC" | "AGENTIC_REQUEST" | "OTHER";

export type KiroQuotaErrorCode =
  | "network"
  | "rate_limited"
  | "unauthorized"
  | "access_denied"
  | "upstream"
  | "invalid_payload"
  | "unsupported_region";

export interface KiroQuotaBucket {
  id: string;
  label: string;
  resourceType?: KiroQuotaResourceType;
  used: number;
  limit: number;
  remaining: number;
  utilization: number;
  unit?: string;
  resetsAt?: string;
}

/** In-memory + persisted cache entry. Only normalized fields; no raw payload. */
interface KiroQuotaCacheEntry {
  success: boolean;
  queriedAt: number;
  subscriptionTitle?: string;
  buckets: KiroQuotaBucket[];
  primaryBucketId?: string;
  reauthRequired?: boolean;
}

interface KiroQuotaPersistedCache {
  schemaVersion: 1;
  entries: Record<string, KiroQuotaCacheEntry>;
}

/** Safe wire projection — the only shape returned to API consumers. */
export interface KiroQuotaResultV1 {
  kind: "kiro_subscription_quota";
  schemaVersion: 1;
  provider: "kiro";
  accountId: string;
  success: boolean;
  subscription?: { title?: string };
  buckets: KiroQuotaBucket[];
  primaryBucketId?: string;
  cache: {
    state: "live" | "fresh" | "stale" | "none";
    queriedAt: string | null;
    ageMs: number | null;
  };
  reauthRequired: boolean;
  error?: {
    code: KiroQuotaErrorCode;
    message: string;
    retryable: boolean;
  };
}

interface KiroCredentialMeta {
  region: string;
  profileArn?: string;
}

interface UsageLimitsFetchResult {
  buckets: KiroQuotaBucket[] | null;
  subscriptionTitle?: string;
  primaryBucketId?: string;
  error: KiroQuotaResultV1["error"] | null;
  statusCode: number | null;
  validationException: boolean;
}

// ─── In-memory state ─────────────────────────────────────────────────────────

const quotaCache = new Map<string, KiroQuotaCacheEntry>();
const inflightRequests = new Map<string, Promise<KiroQuotaResultV1>>();

// ─── Path helpers ────────────────────────────────────────────────────────────

function kiroQuotaDir(): string {
  return join(getAgentDir(), "auth-accounts", KIRO_PROVIDER_ID);
}

function quotaCacheFilePath(): string {
  return join(kiroQuotaDir(), QUOTA_CACHE_FILE);
}

function credentialFilePath(accountId: string): string {
  return join(kiroQuotaDir(), `${encodeURIComponent(accountId)}.json`);
}

function flightKey(accountId: string): string {
  return `${KIRO_PROVIDER_ID}:${accountId}`;
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
 * Validate and normalize an AWS commercial region. Rejects free-form URLs,
 * gov/cn partitions, and any non-matching string.
 */
export function validateKiroRegion(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const region = raw.trim().toLowerCase();
  if (!region || region.includes("/") || region.includes(".") || region.includes(":")) {
    return null;
  }
  if (!AWS_COMMERCIAL_REGION_RE.test(region)) return null;
  if (region.includes("gov") || region.startsWith("cn-")) return null;
  return region;
}

function buildUsageLimitsUrl(region: string): string {
  // Region already validated; never interpolate untrusted host fragments.
  return `https://q.${region}.amazonaws.com/`;
}

function toFiniteNonNegative(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
  }
  return null;
}

/**
 * Convert AWS nextDateReset-style values to ISO. Accepts ISO strings,
 * epoch seconds, and epoch milliseconds.
 */
export function normalizeResetAt(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Date.parse(trimmed);
    if (!Number.isFinite(parsed)) return undefined;
    return new Date(parsed).toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    // Heuristic: values below 1e12 are epoch seconds.
    const ms = value < 1e12 ? value * 1000 : value;
    const date = new Date(ms);
    if (!Number.isFinite(date.getTime())) return undefined;
    return date.toISOString();
  }
  return undefined;
}

function mapResourceType(raw: unknown): KiroQuotaResourceType | undefined {
  if (typeof raw !== "string") return undefined;
  const upper = raw.trim().toUpperCase();
  if (RESOURCE_TYPE_ALLOWLIST.has(upper as KiroQuotaResourceType)) {
    return upper as KiroQuotaResourceType;
  }
  if (!upper) return undefined;
  return "OTHER";
}

function defaultLabelFor(resourceType: KiroQuotaResourceType | undefined, index: number): string {
  switch (resourceType) {
    case "CREDIT":
      return "Credits";
    case "AGENTIC_REQUEST":
      return "Agentic Requests";
    case "VIBE":
      return "Vibe";
    case "SPEC":
      return "Spec";
    default:
      return `Usage ${index + 1}`;
  }
}

// ─── Credential metadata (server-only) ───────────────────────────────────────

async function readKiroCredentialMeta(
  accountId: string,
): Promise<KiroCredentialMeta | { error: "missing" | "invalid" | "unsupported_region" }> {
  try {
    const raw = JSON.parse(await readFile(credentialFilePath(accountId), "utf8")) as unknown;
    if (!isRecord(raw)) return { error: "invalid" };

    // Missing region defaults to us-east-1; present-but-invalid fails closed.
    const hasRegionField = typeof raw.region === "string" && raw.region.trim().length > 0;
    const region = hasRegionField ? validateKiroRegion(raw.region) : DEFAULT_REGION;
    if (!region) return { error: "unsupported_region" };

    const profileArn =
      typeof raw.profileArn === "string" && raw.profileArn.trim()
        ? raw.profileArn.trim()
        : undefined;
    return { region, profileArn };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") return { error: "missing" };
    return { error: "invalid" };
  }
}

// ─── Persisted cache ─────────────────────────────────────────────────────────

function normalizeCachedBucket(raw: unknown, index: number): KiroQuotaBucket | null {
  if (!isRecord(raw)) return null;
  const used = toFiniteNonNegative(raw.used);
  const limit = toFiniteNonNegative(raw.limit);
  if (used === null || limit === null || limit <= 0) return null;
  const remaining = Math.max(0, limit - used);
  const utilization = Math.min(100, Math.max(0, (used / limit) * 100));
  const resourceType = mapResourceType(raw.resourceType);
  const id =
    sanitizeText(raw.id, MAX_LABEL_LEN) ??
    `${(resourceType ?? "bucket").toLowerCase()}-${index}`;
  const label =
    sanitizeText(raw.label, MAX_LABEL_LEN) ?? defaultLabelFor(resourceType, index);
  const unit = sanitizeText(raw.unit, MAX_UNIT_LEN);
  const resetsAt = normalizeResetAt(raw.resetsAt);
  const bucket: KiroQuotaBucket = { id, label, used, limit, remaining, utilization };
  if (resourceType) bucket.resourceType = resourceType;
  if (unit) bucket.unit = unit;
  if (resetsAt) bucket.resetsAt = resetsAt;
  return bucket;
}

function normalizeCacheEntry(raw: unknown): KiroQuotaCacheEntry | null {
  if (!isRecord(raw) || typeof raw.queriedAt !== "number" || !Number.isFinite(raw.queriedAt)) {
    return null;
  }
  const bucketsRaw = Array.isArray(raw.buckets) ? raw.buckets : [];
  const buckets: KiroQuotaBucket[] = [];
  for (let i = 0; i < bucketsRaw.length && buckets.length < MAX_BUCKETS; i++) {
    const bucket = normalizeCachedBucket(bucketsRaw[i], i);
    if (bucket) buckets.push(bucket);
  }
  const primaryBucketId =
    typeof raw.primaryBucketId === "string" && buckets.some((b) => b.id === raw.primaryBucketId)
      ? raw.primaryBucketId
      : buckets.find((b) => b.resourceType === "CREDIT")?.id ?? buckets[0]?.id;
  const subscriptionTitle = sanitizeText(raw.subscriptionTitle, MAX_TITLE_LEN);
  return {
    success: raw.success === true && buckets.length > 0,
    queriedAt: raw.queriedAt,
    subscriptionTitle,
    buckets,
    primaryBucketId,
    reauthRequired: raw.reauthRequired === true || undefined,
  };
}

async function loadPersistedCache(): Promise<KiroQuotaPersistedCache> {
  try {
    const raw = await readFile(quotaCacheFilePath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || parsed.schemaVersion !== 1) {
      return { schemaVersion: 1, entries: {} };
    }
    const entries: Record<string, KiroQuotaCacheEntry> = {};
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

async function savePersistedCache(accountId: string, entry: KiroQuotaCacheEntry): Promise<void> {
  try {
    const dir = kiroQuotaDir();
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

async function readPersistedCacheEntry(accountId: string): Promise<KiroQuotaCacheEntry | null> {
  const persisted = await loadPersistedCache();
  return persisted.entries[accountId] ?? null;
}

// ─── Parsers ─────────────────────────────────────────────────────────────────

function extractUsageNumber(record: Record<string, unknown>, precisionKey: string, intKey: string): number | null {
  const precision = toFiniteNonNegative(record[precisionKey]);
  if (precision !== null) return precision;
  return toFiniteNonNegative(record[intKey]);
}

/**
 * Parse a single usage breakdown object into a safe bucket.
 * limit <= 0 is treated as unknown and dropped (never projected as 0%).
 */
export function parseUsageBreakdownItem(raw: unknown, index: number): KiroQuotaBucket | null {
  if (!isRecord(raw)) return null;

  const used = extractUsageNumber(raw, "currentUsageWithPrecision", "currentUsage");
  const limit = extractUsageNumber(raw, "usageLimitWithPrecision", "usageLimit");
  if (used === null || limit === null || limit <= 0) return null;

  const resourceType = mapResourceType(raw.resourceType ?? raw.resource_type);
  const unit = sanitizeText(raw.unit ?? raw.displayUnit ?? raw.display_unit, MAX_UNIT_LEN);
  const label =
    sanitizeText(raw.displayName ?? raw.display_name ?? raw.name ?? raw.resourceType, MAX_LABEL_LEN) ??
    defaultLabelFor(resourceType, index);
  const idBase = (resourceType ?? label).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "bucket";
  const id = `${idBase}-${index}`;
  const resetsAt = normalizeResetAt(
    raw.nextDateReset ?? raw.next_date_reset ?? raw.resetDate ?? raw.resetsAt,
  );

  const remaining = Math.max(0, limit - used);
  const utilization = Math.min(100, Math.max(0, (used / limit) * 100));

  const bucket: KiroQuotaBucket = {
    id,
    label,
    used,
    limit,
    remaining,
    utilization,
  };
  if (resourceType) bucket.resourceType = resourceType;
  if (unit) bucket.unit = unit;
  if (resetsAt) bucket.resetsAt = resetsAt;
  return bucket;
}

/**
 * Normalize GetUsageLimits payload into wire-safe buckets + subscription title.
 * Prefer usageBreakdownList; fall back to singular usageBreakdown.
 */
export function parseGetUsageLimitsPayload(payload: unknown): {
  buckets: KiroQuotaBucket[];
  subscriptionTitle?: string;
  primaryBucketId?: string;
} {
  if (!isRecord(payload)) {
    throw new Error("invalid usage limits payload");
  }

  let items: unknown[] = [];
  if (Array.isArray(payload.usageBreakdownList)) {
    items = payload.usageBreakdownList;
  } else if (isRecord(payload.usageBreakdown)) {
    items = [payload.usageBreakdown];
  } else if (Array.isArray(payload.usageBreakdown)) {
    items = payload.usageBreakdown;
  }

  const buckets: KiroQuotaBucket[] = [];
  for (let i = 0; i < items.length && buckets.length < MAX_BUCKETS; i++) {
    const bucket = parseUsageBreakdownItem(items[i], i);
    if (bucket) buckets.push(bucket);
  }

  let subscriptionTitle: string | undefined;
  const subInfo = payload.subscriptionInfo ?? payload.subscription_info;
  if (isRecord(subInfo)) {
    subscriptionTitle = sanitizeText(
      subInfo.subscriptionTitle ?? subInfo.subscription_title ?? subInfo.title ?? subInfo.planName ?? subInfo.plan_name,
      MAX_TITLE_LEN,
    );
  } else {
    subscriptionTitle = sanitizeText(payload.subscriptionTitle, MAX_TITLE_LEN);
  }

  // Top-level nextDateReset can fill missing per-bucket resets.
  const topReset = normalizeResetAt(payload.nextDateReset ?? payload.next_date_reset);
  if (topReset) {
    for (const bucket of buckets) {
      if (!bucket.resetsAt) bucket.resetsAt = topReset;
    }
  }

  const primary =
    buckets.find((b) => b.resourceType === "CREDIT") ??
    buckets[0];

  return {
    buckets,
    subscriptionTitle,
    primaryBucketId: primary?.id,
  };
}

function isValidationExceptionPayload(payload: unknown, statusCode: number): boolean {
  if (statusCode === 400 && isRecord(payload)) {
    const type = typeof payload.__type === "string" ? payload.__type : "";
    const message = typeof payload.message === "string" ? payload.message : "";
    if (/ValidationException/i.test(type) || /ValidationException/i.test(message)) {
      return true;
    }
  }
  return false;
}

// ─── Upstream fetch ──────────────────────────────────────────────────────────

function usageLimitsHeaders(accessToken: string): Record<string, string> {
  return {
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/x-amz-json-1.0",
    accept: "application/x-amz-json-1.0",
    "x-amz-target": GET_USAGE_LIMITS_TARGET,
  };
}

function buildPrimaryBody(profileArn?: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    origin: ORIGIN,
    resourceType: "CREDIT",
    isEmailRequired: false,
  };
  if (profileArn) body.profileArn = profileArn;
  return body;
}

function buildFallbackBody(profileArn?: string): Record<string, unknown> {
  return profileArn ? { profileArn } : {};
}

async function postUsageLimits(
  url: string,
  accessToken: string,
  body: Record<string, unknown>,
): Promise<{
  statusCode: number;
  payload: unknown;
  networkError?: string;
}> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: usageLimitsHeaders(accessToken),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    return {
      statusCode: 0,
      payload: null,
      networkError: err instanceof Error ? err.message : "Network error",
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

function mapHttpError(
  statusCode: number,
): { error: NonNullable<KiroQuotaResultV1["error"]>; validationCandidate: boolean } | null {
  if (statusCode === 401) {
    return {
      error: { code: "unauthorized", message: "Usage limits endpoint returned 401", retryable: true },
      validationCandidate: false,
    };
  }
  if (statusCode === 403) {
    return {
      error: { code: "access_denied", message: "Usage limits endpoint returned 403", retryable: false },
      validationCandidate: false,
    };
  }
  if (statusCode === 429) {
    return {
      error: { code: "rate_limited", message: "Rate limited by usage limits endpoint", retryable: true },
      validationCandidate: false,
    };
  }
  if (statusCode >= 500) {
    return {
      error: { code: "upstream", message: `Usage limits endpoint returned ${statusCode}`, retryable: true },
      validationCandidate: false,
    };
  }
  if (statusCode === 400) {
    return {
      error: { code: "upstream", message: "Usage limits endpoint returned 400", retryable: false },
      validationCandidate: true,
    };
  }
  if (statusCode < 200 || statusCode >= 300) {
    return {
      error: { code: "upstream", message: `Usage limits endpoint returned ${statusCode}`, retryable: true },
      validationCandidate: false,
    };
  }
  return null;
}

async function fetchUsageLimitsOnce(
  accessToken: string,
  region: string,
  profileArn: string | undefined,
  body: Record<string, unknown>,
): Promise<UsageLimitsFetchResult> {
  const url = buildUsageLimitsUrl(region);
  const response = await postUsageLimits(url, accessToken, body);

  if (response.networkError) {
    return {
      buckets: null,
      error: { code: "network", message: "Network error contacting usage limits endpoint", retryable: true },
      statusCode: null,
      validationException: false,
    };
  }

  const statusCode = response.statusCode;
  const httpError = mapHttpError(statusCode);
  if (httpError) {
    const validationException =
      httpError.validationCandidate && isValidationExceptionPayload(response.payload, statusCode);
    return {
      buckets: null,
      error: httpError.error,
      statusCode,
      validationException,
    };
  }

  try {
    const parsed = parseGetUsageLimitsPayload(response.payload);
    if (parsed.buckets.length === 0) {
      return {
        buckets: null,
        subscriptionTitle: parsed.subscriptionTitle,
        error: {
          code: "invalid_payload",
          message: "Usage limits response contained no usable buckets",
          retryable: false,
        },
        statusCode,
        validationException: false,
      };
    }
    return {
      buckets: parsed.buckets,
      subscriptionTitle: parsed.subscriptionTitle,
      primaryBucketId: parsed.primaryBucketId,
      error: null,
      statusCode,
      validationException: false,
    };
  } catch {
    return {
      buckets: null,
      error: { code: "invalid_payload", message: "Invalid usage limits payload", retryable: false },
      statusCode,
      validationException: false,
    };
  }
}

/**
 * Fetch usage limits with primary body; on ValidationException only, retry once
 * with the minimal fallback body.
 */
async function fetchUsageLimitsData(
  accessToken: string,
  region: string,
  profileArn?: string,
): Promise<UsageLimitsFetchResult> {
  const primary = await fetchUsageLimitsOnce(
    accessToken,
    region,
    profileArn,
    buildPrimaryBody(profileArn),
  );
  if (!primary.error) return primary;
  if (!primary.validationException) return primary;

  // At most one ValidationException fallback — no multi-round guessing.
  return fetchUsageLimitsOnce(accessToken, region, profileArn, buildFallbackBody(profileArn));
}

// ─── Build result projection ─────────────────────────────────────────────────

function buildQuotaResult(
  accountId: string,
  entry: KiroQuotaCacheEntry,
  cacheState: KiroQuotaResultV1["cache"]["state"],
  reauthRequired: boolean,
  error?: KiroQuotaResultV1["error"],
): KiroQuotaResultV1 {
  const ageMs = entry.queriedAt ? nowMillis() - entry.queriedAt : null;
  const result: KiroQuotaResultV1 = {
    kind: "kiro_subscription_quota",
    schemaVersion: 1,
    provider: "kiro",
    accountId,
    success: entry.success && entry.buckets.length > 0,
    buckets: entry.buckets.map((b) => ({ ...b })),
    cache: {
      state: cacheState,
      queriedAt: entry.queriedAt ? new Date(entry.queriedAt).toISOString() : null,
      ageMs,
    },
    reauthRequired,
  };
  if (entry.subscriptionTitle) {
    result.subscription = { title: entry.subscriptionTitle };
  }
  if (entry.primaryBucketId) {
    result.primaryBucketId = entry.primaryBucketId;
  }
  if (error) result.error = error;
  return result;
}

function buildStaleResult(
  accountId: string,
  entry: KiroQuotaCacheEntry,
  error: KiroQuotaResultV1["error"],
): KiroQuotaResultV1 {
  return buildQuotaResult(accountId, entry, "stale", entry.reauthRequired === true, error);
}

function buildUnavailableResult(
  accountId: string,
  error?: KiroQuotaResultV1["error"],
): KiroQuotaResultV1 {
  return {
    kind: "kiro_subscription_quota",
    schemaVersion: 1,
    provider: "kiro",
    accountId,
    success: false,
    buckets: [],
    cache: { state: "none", queriedAt: null, ageMs: null },
    reauthRequired: error?.code === "unauthorized",
    error: error ?? {
      code: "network",
      message: "No cached quota data available",
      retryable: true,
    },
  };
}

// ─── Core query ──────────────────────────────────────────────────────────────

async function queryKiroUsageLimits(
  accountId: string,
  forceRefresh: boolean,
): Promise<KiroQuotaResultV1> {
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

  const promise = (async (): Promise<KiroQuotaResultV1> => {
    try {
      // 1. Credential meta (region / profileArn server-side only)
      const meta = await readKiroCredentialMeta(accountId);
      if ("error" in meta) {
        const error: KiroQuotaResultV1["error"] =
          meta.error === "unsupported_region"
            ? {
                code: "unsupported_region",
                message: "Kiro credential region is not a supported commercial AWS region",
                retryable: false,
              }
            : {
                code: "unauthorized",
                message:
                  meta.error === "missing"
                    ? "Kiro account credential not found"
                    : "Kiro account credential is invalid",
                retryable: false,
              };
        if (memEntry && nowMillis() - memEntry.queriedAt < STALE_MAX_AGE_MS) {
          return buildStaleResult(accountId, memEntry, error);
        }
        const persisted = await readPersistedCacheEntry(accountId);
        if (persisted && nowMillis() - persisted.queriedAt < STALE_MAX_AGE_MS) {
          return buildStaleResult(accountId, persisted, error);
        }
        return buildUnavailableResult(accountId, error);
      }

      // 2. Access token
      let accessToken: string;
      try {
        const token = await getKiroAccessToken(accountId);
        accessToken = token.accessToken;
      } catch {
        const error: KiroQuotaResultV1["error"] = {
          code: "unauthorized",
          message: "OAuth token unavailable",
          retryable: true,
        };
        if (memEntry && nowMillis() - memEntry.queriedAt < STALE_MAX_AGE_MS) {
          return buildStaleResult(accountId, memEntry, error);
        }
        const persisted = await readPersistedCacheEntry(accountId);
        if (persisted && nowMillis() - persisted.queriedAt < STALE_MAX_AGE_MS) {
          return buildStaleResult(accountId, persisted, error);
        }
        return buildUnavailableResult(accountId, error);
      }

      // 3. Fetch usage limits
      let result = await fetchUsageLimitsData(accessToken, meta.region, meta.profileArn);

      // 4. 401 only → force-refresh credential + retry GetUsageLimits once.
      // Retry is unconditional after a successful force refresh, even when the
      // returned access token string is unchanged (metadata-only refresh).
      // Never loop beyond this single retry.
      if (result.error?.code === "unauthorized" && result.statusCode === 401) {
        try {
          const refreshed = await getKiroAccessToken(accountId, { forceRefresh: true });
          accessToken = refreshed.accessToken;
          result = await fetchUsageLimitsData(accessToken, meta.region, meta.profileArn);
        } catch {
          // Refresh failed — keep original unauthorized result.
        }
      }

      // 5. Success path
      if (result.buckets && result.buckets.length > 0 && !result.error) {
        const entry: KiroQuotaCacheEntry = {
          success: true,
          queriedAt: nowMillis(),
          subscriptionTitle: result.subscriptionTitle,
          buckets: result.buckets,
          primaryBucketId: result.primaryBucketId,
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
          return buildStaleResult(accountId, {
            ...staleSource,
            reauthRequired: reauthRequired || staleSource.reauthRequired,
          }, result.error);
        }
        return buildQuotaResult(
          accountId,
          {
            success: false,
            queriedAt: nowMillis(),
            buckets: [],
            reauthRequired: reauthRequired || undefined,
          },
          "none",
          reauthRequired,
          result.error,
        );
      }

      return buildUnavailableResult(accountId);
    } catch (err) {
      const error: KiroQuotaResultV1["error"] = {
        code: "network",
        message: err instanceof Error ? err.message : "Unexpected error",
        retryable: true,
      };
      // Never leak filesystem paths through error messages.
      if (error.message.includes("/") || error.message.includes("\\")) {
        error.message = "Unexpected error reading Kiro quota";
      }
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
 * Get Kiro subscription quota for a specific saved account (opaque storage id).
 */
export async function getKiroAccountSubscriptionQuota(
  accountId: string,
  opts: { forceRefresh?: boolean } = {},
): Promise<KiroQuotaResultV1> {
  if (!accountId?.trim()) {
    return buildUnavailableResult(accountId ?? "", {
      code: "unauthorized",
      message: "Kiro account id is required",
      retryable: false,
    });
  }
  return queryKiroUsageLimits(accountId.trim(), opts.forceRefresh === true);
}

/**
 * Get Kiro subscription quota for the currently active account.
 */
export async function getKiroActiveSubscriptionQuota(
  opts: { forceRefresh?: boolean } = {},
): Promise<KiroQuotaResultV1> {
  let activeId: string | null = null;
  try {
    activeId = await readOAuthActiveAccountId(KIRO_PROVIDER_ID);
  } catch {
    activeId = null;
  }
  if (!activeId) {
    return {
      kind: "kiro_subscription_quota",
      schemaVersion: 1,
      provider: "kiro",
      accountId: "",
      success: false,
      buckets: [],
      cache: { state: "none", queriedAt: null, ageMs: null },
      reauthRequired: false,
      error: {
        code: "unauthorized",
        message: "No active Kiro account. Please log in or activate an account.",
        retryable: false,
      },
    };
  }
  return queryKiroUsageLimits(activeId, opts.forceRefresh === true);
}

/** Clear the in-memory cache entry for a given account. */
export function invalidateKiroQuotaCache(accountId: string): void {
  quotaCache.delete(accountId);
}
