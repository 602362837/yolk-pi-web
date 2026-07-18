/**
 * Client-safe wire contracts for OpenAI-compatible models.json /models sync.
 *
 * Privacy contract:
 * - No baseUrl, apiKey, headers, path, endpoint, rawBody, Authorization, or
 *   absolute filesystem paths.
 * - Error codes are stable and map to fixed UI copy; never carry upstream bodies.
 *
 * Implementation note: wire types/limits only. Core discovery/merge lives in
 * `lib/models-config-sync.ts` (MODEL-SYNC-02); HTTP route in MODEL-SYNC-03.
 */

// ── OpenAI-compatible API allowlist ───────────────────────────────────────────

/** Provider-level API values eligible for /models endpoint discovery. */
export const OPENAI_COMPATIBLE_MODELS_SYNC_APIS = [
  "openai-completions",
  "openai-responses",
] as const;

export type OpenAICompatibleModelsSyncApi =
  (typeof OPENAI_COMPATIBLE_MODELS_SYNC_APIS)[number];

export function isOpenAICompatibleModelsSyncApi(
  value: unknown,
): value is OpenAICompatibleModelsSyncApi {
  return (
    value === "openai-completions" || value === "openai-responses"
  );
}

// ── Bounds ────────────────────────────────────────────────────────────────────

/** Upstream GET timeout for /models discovery. */
export const MODELS_CONFIG_SYNC_TIMEOUT_MS = 10_000;

/** Max response body size (1 MiB). */
export const MODELS_CONFIG_SYNC_MAX_BODY_BYTES = 1 * 1024 * 1024;

/** Max models accepted from a remote list after dedupe. */
export const MODELS_CONFIG_SYNC_MAX_MODELS = 2_000;

/** Max UTF-8 byte length of a single model id. */
export const MODELS_CONFIG_SYNC_MAX_MODEL_ID_BYTES = 256;

/** Preview token TTL. */
export const MODELS_CONFIG_SYNC_PREVIEW_TTL_MS = 5 * 60 * 1000;

/** Max in-memory preview entries (process-local). */
export const MODELS_CONFIG_SYNC_PREVIEW_CACHE_MAX = 20;

/** Max same-origin redirects when following manual redirect chains. */
export const MODELS_CONFIG_SYNC_MAX_REDIRECTS = 3;

/** Max model ids accepted in a single apply request. */
export const MODELS_CONFIG_SYNC_APPLY_MAX_MODEL_IDS = MODELS_CONFIG_SYNC_MAX_MODELS;

// ── Error codes ───────────────────────────────────────────────────────────────

export type ModelsSyncErrorCode =
  | "invalid_request"
  | "provider_not_found"
  | "provider_not_custom"
  | "unsupported_protocol"
  | "invalid_base_url"
  | "credential_unavailable"
  | "unsupported_auth"
  | "auth_failed"
  | "endpoint_not_found"
  | "rate_limited"
  | "upstream_unavailable"
  | "timeout"
  | "network_error"
  | "redirect_blocked"
  | "response_too_large"
  | "invalid_response"
  | "too_many_models"
  | "preview_expired"
  | "preview_mismatch"
  | "stale_revision"
  | "models_config_invalid"
  | "write_failed"
  | "verification_failed";

export interface ModelsSyncErrorBody {
  error: {
    code: ModelsSyncErrorCode;
    /** Fixed, non-sensitive message suitable for UI display. */
    message: string;
  };
}

// ── Preview ───────────────────────────────────────────────────────────────────

export type ModelsSyncModelStatus = "new" | "existing";

export interface ModelsSyncPreviewModelRow {
  id: string;
  status: ModelsSyncModelStatus;
  /** Optional remote owned_by for preview only; never persisted. */
  ownedBy?: string;
}

export interface ModelsSyncPreviewTotals {
  remote: number;
  new: number;
  existing: number;
}

export interface ModelsConfigSyncPreviewRequest {
  action: "preview";
  providerId: string;
}

export interface ModelsConfigSyncPreviewResponse {
  kind: "models_config_sync_preview";
  providerId: string;
  previewId: string;
  revision: string;
  expiresAt: string;
  totals: ModelsSyncPreviewTotals;
  models: ModelsSyncPreviewModelRow[];
}

// ── Apply ─────────────────────────────────────────────────────────────────────

export type ModelsConfigSyncRuntimeReload = "ok" | "partial";

export interface ModelsConfigSyncApplyRequest {
  action: "apply";
  providerId: string;
  previewId: string;
  revision: string;
  modelIds: string[];
}

export interface ModelsConfigSyncApplyResponse {
  kind: "models_config_sync_apply";
  providerId: string;
  addedIds: string[];
  skippedExistingIds: string[];
  totalModels: number;
  revision: string;
  runtimeReload: ModelsConfigSyncRuntimeReload;
  /** Fixed non-sensitive warning when runtimeReload is partial. */
  warning?: string;
}

// ── Discriminated request union ───────────────────────────────────────────────

export type ModelsConfigSyncRequest =
  | ModelsConfigSyncPreviewRequest
  | ModelsConfigSyncApplyRequest;

/**
 * Fields that must never appear on the sync request body (SSRF / secret injection).
 * Presence of any of these is `invalid_request`.
 */
export const MODELS_CONFIG_SYNC_FORBIDDEN_BODY_KEYS = [
  "url",
  "baseUrl",
  "baseURL",
  "headers",
  "apiKey",
  "api_key",
  "authorization",
  "Authorization",
  "path",
  "endpoint",
  "rawBody",
  "body",
  "token",
  "secret",
] as const;
