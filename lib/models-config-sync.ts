/**
 * OpenAI-compatible models.json /models discovery + minimal merge core.
 *
 * Server-only. Responsibilities (MODEL-SYNC-02):
 * - Provider eligibility (custom + OpenAI-compatible only)
 * - Endpoint candidate generation and bounded same-origin fetch
 * - Credential/header resolution (auth.json api_key first, models.json fallback)
 * - OpenAI list parse, preview cache, pure merge
 *
 * Privacy:
 * - Never accepts client-supplied URL/path/headers/apiKey.
 * - Errors and cache never store secrets, Authorization, raw bodies, or endpoints.
 * - Fingerprint is a one-way hash of secret-bearing config, not the secrets.
 *
 * Write-path apply under the shared models.json lock lives here; post-write
 * ModelRuntime verification / live runtime reload are orchestrated by the API
 * layer (MODEL-SYNC-03).
 */

import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Credential, CredentialStore } from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import {
  ANTIGRAVITY_PROVIDER_ID,
  GROK_CLI_PROVIDER_ID,
  KIRO_PROVIDER_ID,
} from "@/lib/oauth-account-providers";
import {
  getModelsJsonBackupPath,
  mutateModelsJsonUnderLock,
  readModelsJsonRaw,
  restoreModelsJsonFromBackup,
  withModelsJsonWriteLock,
} from "@/lib/models-config-store";
import {
  isOpenAICompatibleModelsSyncApi,
  MODELS_CONFIG_SYNC_APPLY_MAX_MODEL_IDS,
  MODELS_CONFIG_SYNC_FORBIDDEN_BODY_KEYS,
  MODELS_CONFIG_SYNC_MAX_BODY_BYTES,
  MODELS_CONFIG_SYNC_MAX_MODEL_ID_BYTES,
  MODELS_CONFIG_SYNC_MAX_MODELS,
  MODELS_CONFIG_SYNC_MAX_REDIRECTS,
  MODELS_CONFIG_SYNC_PREVIEW_CACHE_MAX,
  MODELS_CONFIG_SYNC_PREVIEW_TTL_MS,
  MODELS_CONFIG_SYNC_TIMEOUT_MS,
  type ModelsConfigSyncApplyResponse,
  type ModelsConfigSyncPreviewResponse,
  type ModelsConfigSyncRuntimeReload,
  type ModelsSyncErrorCode,
  type ModelsSyncPreviewModelRow,
  type OpenAICompatibleModelsSyncApi,
} from "@/lib/models-config-sync-types";
import { resolveConfigValue } from "@/lib/web-auth-config-value";
import { getWebCredentialStore } from "@/lib/web-credential-store";

// ── Fixed denylist ────────────────────────────────────────────────────────────

/** Fixed OAuth/extension providers that must never use generic /models sync. */
export const MODELS_SYNC_FIXED_EXTENSION_PROVIDER_IDS = [
  GROK_CLI_PROVIDER_ID,
  KIRO_PROVIDER_ID,
  ANTIGRAVITY_PROVIDER_ID,
] as const;

const FIXED_EXTENSION_PROVIDER_ID_SET = new Set<string>(
  MODELS_SYNC_FIXED_EXTENSION_PROVIDER_IDS,
);

/** Headers that must never be forwarded (hop-by-hop / auto-managed). */
const FORBIDDEN_REQUEST_HEADER_NAMES = new Set([
  "host",
  "content-length",
  "connection",
  "transfer-encoding",
  "keep-alive",
  "upgrade",
  "te",
  "trailer",
  "proxy-authorization",
  "proxy-authenticate",
  "proxy-connection",
]);

// ── Error surface ─────────────────────────────────────────────────────────────

const FIXED_ERROR_MESSAGES: Record<ModelsSyncErrorCode, string> = {
  invalid_request: "Invalid models sync request.",
  provider_not_found: "Provider was not found in the saved models configuration.",
  provider_not_custom: "Only custom providers can sync models from an endpoint.",
  unsupported_protocol: "Only OpenAI-compatible provider APIs support model sync.",
  invalid_base_url: "Provider Base URL is missing or not a valid http(s) URL.",
  credential_unavailable:
    "Unable to resolve the provider's saved credentials. Check the API Key configuration and retry.",
  unsupported_auth:
    "This provider uses an authentication mode that cannot be used for generic model sync.",
  auth_failed: "The endpoint rejected the credentials. Check the API Key or custom auth headers.",
  endpoint_not_found: "No /models or /v1/models endpoint was found under the saved Base URL.",
  rate_limited: "The endpoint rate-limited the request. Retry later.",
  upstream_unavailable: "The model service returned a temporary error.",
  timeout: "Reading the model list timed out. Check the service and retry.",
  network_error: "Unable to connect to the configured model service.",
  redirect_blocked: "The endpoint redirect was blocked for safety.",
  response_too_large: "The remote model list exceeded the safe read limit.",
  invalid_response: "The endpoint did not return a recognizable OpenAI model list.",
  too_many_models: "The remote model list exceeded the maximum number of models.",
  preview_expired: "The model list preview expired. Preview again before writing.",
  preview_mismatch: "The preview no longer matches the saved provider configuration.",
  stale_revision: "Models configuration changed. Preview again before writing.",
  models_config_invalid: "models.json is invalid and cannot be updated safely.",
  write_failed: "Failed to write models configuration.",
  verification_failed: "Updated models configuration failed verification and was rolled back.",
};

export class ModelsConfigSyncError extends Error {
  readonly code: ModelsSyncErrorCode;

  constructor(code: ModelsSyncErrorCode, message?: string) {
    super(message ?? FIXED_ERROR_MESSAGES[code]);
    this.name = "ModelsConfigSyncError";
    this.code = code;
  }
}

export function modelsSyncErrorMessage(code: ModelsSyncErrorCode): string {
  return FIXED_ERROR_MESSAGES[code];
}

/**
 * Map stable sync error codes to HTTP status for the API route.
 * Only uses 400/401/403/404/409/413/422/429/502/504/500 as designed.
 */
export function modelsSyncErrorHttpStatus(code: ModelsSyncErrorCode): number {
  switch (code) {
    case "invalid_request":
    case "invalid_base_url":
      return 400;
    case "auth_failed":
      return 401;
    case "provider_not_custom":
    case "unsupported_protocol":
      return 403;
    case "provider_not_found":
    case "endpoint_not_found":
      return 404;
    case "preview_expired":
    case "preview_mismatch":
    case "stale_revision":
      return 409;
    case "response_too_large":
    case "too_many_models":
      return 413;
    case "credential_unavailable":
    case "unsupported_auth":
    case "invalid_response":
    case "models_config_invalid":
      return 422;
    case "rate_limited":
      return 429;
    case "timeout":
      return 504;
    case "upstream_unavailable":
    case "network_error":
    case "redirect_blocked":
      return 502;
    case "write_failed":
    case "verification_failed":
      return 500;
    default: {
      const _exhaustive: never = code;
      void _exhaustive;
      return 500;
    }
  }
}

/** Fixed non-sensitive warning when live runtime reload is only partial. */
export const MODELS_CONFIG_SYNC_PARTIAL_RELOAD_WARNING =
  "Models were saved, but live sessions may need a refresh before the new models appear.";

// ── Small utils ───────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
    .join(",")}}`;
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function newOpaqueId(bytes = 18): string {
  return randomBytes(bytes).toString("base64url");
}

function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export function isValidModelsSyncModelId(id: string): boolean {
  if (typeof id !== "string") return false;
  if (id.length === 0) return false;
  if (utf8ByteLength(id) > MODELS_CONFIG_SYNC_MAX_MODEL_ID_BYTES) return false;
  if (hasControlChars(id)) return false;
  return true;
}

// ── Builtin / fixed sets ──────────────────────────────────────────────────────

let cachedBuiltinProviderIds: Set<string> | null = null;

/** Pi SDK built-in provider ids (catalog). Cached for the process lifetime. */
export function getBuiltinModelsSyncProviderIds(): ReadonlySet<string> {
  if (!cachedBuiltinProviderIds) {
    cachedBuiltinProviderIds = new Set(builtinProviders().map((provider) => provider.id));
  }
  return cachedBuiltinProviderIds;
}

/** Test-only: clear builtin id cache (e.g. after mocking). */
export function __resetBuiltinModelsSyncProviderIdsForTests(): void {
  cachedBuiltinProviderIds = null;
}

// ── Provider eligibility ──────────────────────────────────────────────────────

export interface EligibleModelsSyncProvider {
  id: string;
  api: OpenAICompatibleModelsSyncApi;
  baseUrl: string;
  /** Unresolved models.json apiKey template/literal, if present. */
  apiKey?: string;
  /** Unresolved provider headers map (string values only). */
  headers?: Record<string, string>;
  /** Provider-scoped env map from models.json, if present. */
  env?: Record<string, string>;
  /** Original provider object reference from parsed config (read-only use). */
  raw: Record<string, unknown>;
}

export type ModelsSyncEligibilityResult =
  | { ok: true; provider: EligibleModelsSyncProvider }
  | { ok: false; code: ModelsSyncErrorCode };

/**
 * Fail-closed eligibility for OpenAI-compatible custom provider model sync.
 * Re-run on every preview and apply; never trust client UI.
 */
export function assessModelsSyncProviderEligibility(
  providerId: string,
  providerValue: unknown,
): ModelsSyncEligibilityResult {
  if (typeof providerId !== "string" || providerId.trim().length === 0) {
    return { ok: false, code: "invalid_request" };
  }
  const id = providerId.trim();

  if (!isRecord(providerValue)) {
    return { ok: false, code: "provider_not_found" };
  }

  if (getBuiltinModelsSyncProviderIds().has(id) || FIXED_EXTENSION_PROVIDER_ID_SET.has(id)) {
    return { ok: false, code: "provider_not_custom" };
  }

  const apiRaw = providerValue.api;
  if (!isOpenAICompatibleModelsSyncApi(apiRaw)) {
    // Missing api fails closed as unsupported protocol (guide user to pick API).
    return { ok: false, code: "unsupported_protocol" };
  }

  const baseUrlRaw =
    typeof providerValue.baseUrl === "string"
      ? providerValue.baseUrl
      : typeof providerValue.baseURL === "string"
        ? providerValue.baseURL
        : "";
  const baseUrl = baseUrlRaw.trim();
  if (!baseUrl) {
    return { ok: false, code: "invalid_base_url" };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    return { ok: false, code: "invalid_base_url" };
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return { ok: false, code: "invalid_base_url" };
  }

  const apiKey =
    typeof providerValue.apiKey === "string" && providerValue.apiKey.length > 0
      ? providerValue.apiKey
      : undefined;

  let headers: Record<string, string> | undefined;
  if (isRecord(providerValue.headers)) {
    const next: Record<string, string> = {};
    for (const [key, value] of Object.entries(providerValue.headers)) {
      if (typeof key !== "string" || key.trim().length === 0) continue;
      if (typeof value !== "string") continue;
      next[key] = value;
    }
    if (Object.keys(next).length > 0) headers = next;
  }

  let env: Record<string, string> | undefined;
  if (isRecord(providerValue.env)) {
    const next: Record<string, string> = {};
    for (const [key, value] of Object.entries(providerValue.env)) {
      if (typeof key !== "string" || key.trim().length === 0) continue;
      if (typeof value !== "string") continue;
      next[key] = value;
    }
    if (Object.keys(next).length > 0) env = next;
  }

  return {
    ok: true,
    provider: {
      id,
      api: apiRaw,
      baseUrl,
      apiKey,
      headers,
      env,
      raw: providerValue,
    },
  };
}

export function getProviderFromModelsConfig(
  parsed: Record<string, unknown>,
  providerId: string,
): unknown {
  if (!isRecord(parsed.providers)) return undefined;
  return parsed.providers[providerId];
}

// ── Endpoint candidates ───────────────────────────────────────────────────────

/**
 * Normalize a saved provider baseUrl into one or two /models candidates.
 * Never accepts client path overrides. Query/hash are dropped.
 */
export function buildModelsEndpointCandidates(baseUrl: string): string[] {
  const trimmed = baseUrl.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ModelsConfigSyncError("invalid_base_url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ModelsConfigSyncError("invalid_base_url");
  }

  // Drop query/hash; keep origin + path prefix.
  url.search = "";
  url.hash = "";

  let pathname = url.pathname || "/";
  if (pathname.length > 1 && pathname.endsWith("/")) {
    pathname = pathname.slice(0, -1);
  }
  url.pathname = pathname;

  const lower = pathname.toLowerCase();
  if (lower.endsWith("/v1/models") || lower.endsWith("/models")) {
    return [url.toString()];
  }

  if (lower.endsWith("/v1")) {
    const only = new URL(url.toString());
    only.pathname = `${pathname}/models`;
    return [only.toString()];
  }

  const primary = new URL(url.toString());
  primary.pathname = pathname === "/" || pathname === "" ? "/models" : `${pathname}/models`;

  const fallback = new URL(url.toString());
  fallback.pathname =
    pathname === "/" || pathname === "" ? "/v1/models" : `${pathname}/v1/models`;

  return [primary.toString(), fallback.toString()];
}

// ── Fingerprint ───────────────────────────────────────────────────────────────

/**
 * One-way fingerprint of secret-bearing provider config used to bind a preview
 * to the exact saved provider state. Never stores secret plaintext.
 */
export function computeModelsSyncProviderFingerprint(
  provider: EligibleModelsSyncProvider,
): string {
  const material = stableStringify({
    id: provider.id,
    api: provider.api,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey ?? null,
    headers: provider.headers ?? null,
    env: provider.env ?? null,
  });
  return sha256Hex(material);
}

// ── Auth + headers ────────────────────────────────────────────────────────────

export interface ResolvedModelsSyncRequestAuth {
  /** Resolved bearer key, if any. Never log/project. */
  apiKey: string;
  /** Outbound headers including Accept and optional Authorization. */
  headers: Record<string, string>;
}

function headerNameEquals(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((key) => headerNameEquals(key, name));
}

/**
 * Resolve outbound auth for a models list request.
 * Order: auth.json api_key credential → models.json apiKey config-value.
 * OAuth credentials are unsupported for generic custom providers.
 */
export async function resolveModelsSyncRequestAuth(
  provider: EligibleModelsSyncProvider,
  credentials: CredentialStore,
): Promise<ResolvedModelsSyncRequestAuth> {
  let apiKey: string | undefined;

  let stored: Credential | undefined;
  try {
    stored = await credentials.read(provider.id);
  } catch {
    // Storage failure treated as unavailable rather than leaking details.
    throw new ModelsConfigSyncError("credential_unavailable");
  }

  if (stored) {
    if (stored.type === "oauth") {
      throw new ModelsConfigSyncError("unsupported_auth");
    }
    if (stored.type === "api_key") {
      const key = typeof stored.key === "string" ? stored.key.trim() : "";
      if (key) {
        apiKey = key;
      }
    }
  }

  if (!apiKey && typeof provider.apiKey === "string") {
    const resolved = resolveConfigValue(provider.apiKey, provider.env);
    if (typeof resolved === "string" && resolved.trim().length > 0) {
      apiKey = resolved.trim();
    }
  }

  if (!apiKey) {
    throw new ModelsConfigSyncError("credential_unavailable");
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (provider.headers) {
    for (const [rawName, rawValue] of Object.entries(provider.headers)) {
      const name = rawName.trim();
      if (!name) continue;
      if (FORBIDDEN_REQUEST_HEADER_NAMES.has(name.toLowerCase())) continue;
      const resolved = resolveConfigValue(rawValue, provider.env);
      if (typeof resolved !== "string") continue;
      headers[name] = resolved;
    }
  }

  if (!hasHeader(headers, "Authorization")) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return { apiKey, headers };
}

// ── Remote list parse ─────────────────────────────────────────────────────────

export interface ParsedRemoteModel {
  id: string;
  ownedBy?: string;
}

/**
 * Parse a bounded OpenAI-style `{ data: [{ id, owned_by? }] }` payload.
 * Dedupes by first-seen id order. Throws ModelsConfigSyncError on invalid input.
 */
export function parseOpenAIModelsListPayload(payload: unknown): ParsedRemoteModel[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new ModelsConfigSyncError("invalid_response");
  }

  const models: ParsedRemoteModel[] = [];
  const seen = new Set<string>();

  for (const entry of payload.data) {
    if (!isRecord(entry)) {
      throw new ModelsConfigSyncError("invalid_response");
    }
    if (typeof entry.id !== "string") {
      throw new ModelsConfigSyncError("invalid_response");
    }
    const id = entry.id;
    if (!isValidModelsSyncModelId(id)) {
      throw new ModelsConfigSyncError("invalid_response");
    }
    if (seen.has(id)) continue;
    seen.add(id);

    let ownedBy: string | undefined;
    if (typeof entry.owned_by === "string") {
      const owned = entry.owned_by;
      // Bound optional preview metadata; never persisted.
      if (
        owned.length > 0 &&
        utf8ByteLength(owned) <= MODELS_CONFIG_SYNC_MAX_MODEL_ID_BYTES &&
        !hasControlChars(owned)
      ) {
        ownedBy = owned;
      }
    }

    models.push(ownedBy ? { id, ownedBy } : { id });

    if (models.length > MODELS_CONFIG_SYNC_MAX_MODELS) {
      throw new ModelsConfigSyncError("too_many_models");
    }
  }

  return models;
}

// ── Bounded fetch ─────────────────────────────────────────────────────────────

export type ModelsSyncFetch = (
  input: string,
  init: {
    method: "GET";
    headers: Record<string, string>;
    redirect: "manual";
    signal: AbortSignal;
  },
) => Promise<Response>;

export interface FetchOpenAIModelsListOptions {
  fetchImpl?: ModelsSyncFetch;
  timeoutMs?: number;
  maxBodyBytes?: number;
  maxRedirects?: number;
  now?: () => number;
}

function mapHttpStatusToSyncError(status: number): ModelsSyncErrorCode | null {
  if (status === 401 || status === 403) return "auth_failed";
  if (status === 404 || status === 405) return "endpoint_not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500 && status <= 599) return "upstream_unavailable";
  return null;
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function readResponseBodyBounded(
  response: Response,
  maxBodyBytes: number,
): Promise<string> {
  if (!response.body) {
    // Fallback for environments without a web stream body.
    const text = await response.text();
    if (utf8ByteLength(text) > maxBodyBytes) {
      throw new ModelsConfigSyncError("response_too_large");
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBodyBytes) {
        try {
          await reader.cancel();
        } catch {
          // ignore
        }
        throw new ModelsConfigSyncError("response_too_large");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ModelsConfigSyncError) throw error;
    throw new ModelsConfigSyncError("network_error");
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return Buffer.from(merged).toString("utf8");
}

async function fetchWithManualRedirects(
  startUrl: string,
  headers: Record<string, string>,
  options: {
    fetchImpl: ModelsSyncFetch;
    signal: AbortSignal;
    maxRedirects: number;
  },
): Promise<Response> {
  let currentUrl = startUrl;
  for (let hop = 0; hop <= options.maxRedirects; hop += 1) {
    let response: Response;
    try {
      response = await options.fetchImpl(currentUrl, {
        method: "GET",
        headers,
        redirect: "manual",
        signal: options.signal,
      });
    } catch (error) {
      if (options.signal.aborted) {
        throw new ModelsConfigSyncError("timeout");
      }
      if (error instanceof ModelsConfigSyncError) throw error;
      throw new ModelsConfigSyncError("network_error");
    }

    if (!isRedirectStatus(response.status)) {
      return response;
    }

    if (hop === options.maxRedirects) {
      throw new ModelsConfigSyncError("redirect_blocked");
    }

    const location = response.headers.get("location");
    if (!location) {
      throw new ModelsConfigSyncError("redirect_blocked");
    }

    let nextUrl: URL;
    try {
      nextUrl = new URL(location, currentUrl);
    } catch {
      throw new ModelsConfigSyncError("redirect_blocked");
    }

    const current = new URL(currentUrl);
    if (nextUrl.origin !== current.origin) {
      // Do not follow cross-origin redirects — prevents Authorization leakage.
      throw new ModelsConfigSyncError("redirect_blocked");
    }
    if (nextUrl.protocol !== "http:" && nextUrl.protocol !== "https:") {
      throw new ModelsConfigSyncError("redirect_blocked");
    }

    currentUrl = nextUrl.toString();
  }

  throw new ModelsConfigSyncError("redirect_blocked");
}

/**
 * Fetch and parse models from candidate endpoints.
 * Only 404/405 advances to the next candidate; other errors fail immediately.
 */
export async function fetchOpenAICompatibleModelsList(
  candidates: string[],
  headers: Record<string, string>,
  options: FetchOpenAIModelsListOptions = {},
): Promise<ParsedRemoteModel[]> {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new ModelsConfigSyncError("invalid_base_url");
  }

  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as ModelsSyncFetch);
  const timeoutMs = options.timeoutMs ?? MODELS_CONFIG_SYNC_TIMEOUT_MS;
  const maxBodyBytes = options.maxBodyBytes ?? MODELS_CONFIG_SYNC_MAX_BODY_BYTES;
  const maxRedirects = options.maxRedirects ?? MODELS_CONFIG_SYNC_MAX_REDIRECTS;

  let lastPathMiss = false;

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i]!;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchWithManualRedirects(candidate, headers, {
        fetchImpl,
        signal: controller.signal,
        maxRedirects,
      });

      if (response.status === 404 || response.status === 405) {
        lastPathMiss = true;
        // Drain body best-effort without retaining content.
        try {
          await readResponseBodyBounded(response, Math.min(maxBodyBytes, 64 * 1024));
        } catch {
          // ignore
        }
        continue;
      }

      const statusCode = mapHttpStatusToSyncError(response.status);
      if (statusCode) {
        throw new ModelsConfigSyncError(statusCode);
      }

      if (response.status < 200 || response.status >= 300) {
        // Unexpected non-success: treat as invalid rather than leaking status details.
        throw new ModelsConfigSyncError("invalid_response");
      }

      const bodyText = await readResponseBodyBounded(response, maxBodyBytes);
      let payload: unknown;
      try {
        payload = JSON.parse(bodyText) as unknown;
      } catch {
        throw new ModelsConfigSyncError("invalid_response");
      }

      return parseOpenAIModelsListPayload(payload);
    } catch (error) {
      if (error instanceof ModelsConfigSyncError) {
        // Path miss continues only for endpoint_not_found from 404/405 loop above.
        if (error.code === "timeout" && controller.signal.aborted) {
          throw error;
        }
        throw error;
      }
      if (controller.signal.aborted) {
        throw new ModelsConfigSyncError("timeout");
      }
      throw new ModelsConfigSyncError("network_error");
    } finally {
      clearTimeout(timer);
    }
  }

  if (lastPathMiss) {
    throw new ModelsConfigSyncError("endpoint_not_found");
  }
  throw new ModelsConfigSyncError("endpoint_not_found");
}

// ── Existing local model ids ──────────────────────────────────────────────────

export function collectExistingModelIds(providerValue: unknown): Set<string> {
  const existing = new Set<string>();
  if (!isRecord(providerValue) || !Array.isArray(providerValue.models)) {
    return existing;
  }
  for (const entry of providerValue.models) {
    if (!isRecord(entry)) continue;
    if (typeof entry.id !== "string") continue;
    if (!isValidModelsSyncModelId(entry.id)) continue;
    existing.add(entry.id);
  }
  return existing;
}

export function buildPreviewModelRows(
  remote: ParsedRemoteModel[],
  existingIds: ReadonlySet<string>,
): ModelsSyncPreviewModelRow[] {
  return remote.map((model) => {
    const status = existingIds.has(model.id) ? "existing" : "new";
    if (model.ownedBy) {
      return { id: model.id, status, ownedBy: model.ownedBy };
    }
    return { id: model.id, status };
  });
}

// ── Preview cache ─────────────────────────────────────────────────────────────

interface ModelsSyncPreviewCacheEntry {
  previewId: string;
  providerId: string;
  revision: string;
  fingerprint: string;
  /** Deduped remote ids in first-seen order. */
  remoteIds: string[];
  /** Local existing ids at preview time (for skip reporting). */
  existingIds: string[];
  expiresAt: number;
  createdAt: number;
}

interface ModelsSyncPreviewCacheState {
  entries: Map<string, ModelsSyncPreviewCacheEntry>;
}

const PREVIEW_CACHE_GLOBAL_KEY = "__piModelsConfigSyncPreviewCache";

function getPreviewCacheState(): ModelsSyncPreviewCacheState {
  const g = globalThis as typeof globalThis & {
    [PREVIEW_CACHE_GLOBAL_KEY]?: ModelsSyncPreviewCacheState;
  };
  if (!g[PREVIEW_CACHE_GLOBAL_KEY]) {
    g[PREVIEW_CACHE_GLOBAL_KEY] = { entries: new Map() };
  }
  return g[PREVIEW_CACHE_GLOBAL_KEY];
}

function prunePreviewCache(now: number): void {
  const state = getPreviewCacheState();
  for (const [id, entry] of state.entries) {
    if (entry.expiresAt <= now) {
      state.entries.delete(id);
    }
  }

  if (state.entries.size <= MODELS_CONFIG_SYNC_PREVIEW_CACHE_MAX) return;

  const ordered = [...state.entries.values()].sort((a, b) => {
    if (a.expiresAt !== b.expiresAt) return a.expiresAt - b.expiresAt;
    return a.createdAt - b.createdAt;
  });
  const overflow = state.entries.size - MODELS_CONFIG_SYNC_PREVIEW_CACHE_MAX;
  for (let i = 0; i < overflow; i += 1) {
    state.entries.delete(ordered[i]!.previewId);
  }
}

export function storeModelsSyncPreview(entry: Omit<ModelsSyncPreviewCacheEntry, "createdAt"> & {
  createdAt?: number;
}): ModelsSyncPreviewCacheEntry {
  const now = entry.createdAt ?? Date.now();
  const full: ModelsSyncPreviewCacheEntry = {
    previewId: entry.previewId,
    providerId: entry.providerId,
    revision: entry.revision,
    fingerprint: entry.fingerprint,
    remoteIds: [...entry.remoteIds],
    existingIds: [...entry.existingIds],
    expiresAt: entry.expiresAt,
    createdAt: now,
  };
  const state = getPreviewCacheState();
  state.entries.set(full.previewId, full);
  prunePreviewCache(now);
  return full;
}

export function getModelsSyncPreview(
  previewId: string,
  now = Date.now(),
): ModelsSyncPreviewCacheEntry | null {
  const state = getPreviewCacheState();
  const entry = state.entries.get(previewId);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    state.entries.delete(previewId);
    return null;
  }
  return entry;
}

export function deleteModelsSyncPreview(previewId: string): void {
  getPreviewCacheState().entries.delete(previewId);
}

export function __resetModelsConfigSyncPreviewCacheForTests(): void {
  const g = globalThis as typeof globalThis & {
    [PREVIEW_CACHE_GLOBAL_KEY]?: ModelsSyncPreviewCacheState;
  };
  g[PREVIEW_CACHE_GLOBAL_KEY] = { entries: new Map() };
}

export function __getModelsConfigSyncPreviewCacheSizeForTests(): number {
  return getPreviewCacheState().entries.size;
}

// ── Pure merge ────────────────────────────────────────────────────────────────

export interface MergeNewModelIdsResult {
  /** New top-level config object (other providers share prior references). */
  config: Record<string, unknown>;
  addedIds: string[];
  skippedExistingIds: string[];
  totalModels: number;
}

/**
 * Append selected new model ids as `{ id }` to one provider.
 * Existing model objects are never rewritten. Other providers untouched.
 *
 * `selectedIds` should already be filtered to remote-order subset; this function
 * still skips ids already present and preserves append order of first occurrence.
 */
export function mergeNewModelIdsIntoModelsConfig(
  config: Record<string, unknown>,
  providerId: string,
  selectedIds: string[],
): MergeNewModelIdsResult {
  if (!isRecord(config.providers)) {
    throw new ModelsConfigSyncError("provider_not_found");
  }
  const providers = config.providers;
  const providerValue = providers[providerId];
  if (!isRecord(providerValue)) {
    throw new ModelsConfigSyncError("provider_not_found");
  }

  const previousModels = Array.isArray(providerValue.models) ? providerValue.models : [];
  // Do not rewrite/dedupe the existing array; only track known string ids.
  const existingIds = new Set<string>();
  for (const entry of previousModels) {
    if (isRecord(entry) && typeof entry.id === "string") {
      existingIds.add(entry.id);
    }
  }

  const addedIds: string[] = [];
  const skippedExistingIds: string[] = [];
  const seenSelected = new Set<string>();
  const appendModels: Array<{ id: string }> = [];

  for (const id of selectedIds) {
    if (typeof id !== "string" || !isValidModelsSyncModelId(id)) {
      throw new ModelsConfigSyncError("invalid_request");
    }
    if (seenSelected.has(id)) continue;
    seenSelected.add(id);

    if (existingIds.has(id)) {
      skippedExistingIds.push(id);
      continue;
    }
    existingIds.add(id);
    addedIds.push(id);
    appendModels.push({ id });
  }

  if (addedIds.length === 0) {
    return {
      config,
      addedIds,
      skippedExistingIds,
      totalModels: previousModels.length,
    };
  }

  const nextModels = [...previousModels, ...appendModels];
  const nextProvider: Record<string, unknown> = {
    ...providerValue,
    models: nextModels,
  };
  const nextProviders: Record<string, unknown> = {
    ...providers,
    [providerId]: nextProvider,
  };
  const nextConfig: Record<string, unknown> = {
    ...config,
    providers: nextProviders,
  };

  return {
    config: nextConfig,
    addedIds,
    skippedExistingIds,
    totalModels: nextModels.length,
  };
}

/**
 * Order selected ids by the preview remote list order and ensure each is a
 * member of that remote set. Rejects unknown ids.
 */
export function orderSelectedIdsByRemote(
  remoteIds: readonly string[],
  selectedIds: readonly string[],
): string[] {
  if (!Array.isArray(selectedIds) || selectedIds.length === 0) {
    throw new ModelsConfigSyncError("invalid_request");
  }
  if (selectedIds.length > MODELS_CONFIG_SYNC_APPLY_MAX_MODEL_IDS) {
    throw new ModelsConfigSyncError("invalid_request");
  }

  const remoteSet = new Set(remoteIds);
  const selectedSet = new Set<string>();
  for (const id of selectedIds) {
    if (typeof id !== "string" || !isValidModelsSyncModelId(id)) {
      throw new ModelsConfigSyncError("invalid_request");
    }
    if (!remoteSet.has(id)) {
      throw new ModelsConfigSyncError("preview_mismatch");
    }
    selectedSet.add(id);
  }

  const ordered: string[] = [];
  for (const id of remoteIds) {
    if (selectedSet.has(id)) ordered.push(id);
  }
  return ordered;
}

// ── High-level preview ────────────────────────────────────────────────────────

export interface PreviewModelsConfigSyncOptions {
  credentials?: CredentialStore;
  fetchImpl?: ModelsSyncFetch;
  timeoutMs?: number;
  maxBodyBytes?: number;
  now?: () => number;
  /** Optional pre-read config; defaults to current models.json. */
  parsedConfig?: Record<string, unknown>;
  revision?: string;
}

/**
 * Discover remote models for a saved provider and store a short-lived preview.
 * Never writes models.json.
 */
export async function previewModelsConfigSync(
  providerId: string,
  options: PreviewModelsConfigSyncOptions = {},
): Promise<ModelsConfigSyncPreviewResponse> {
  const now = options.now?.() ?? Date.now();

  let revision = options.revision;
  let parsed = options.parsedConfig;
  if (!parsed || !revision) {
    const current = readModelsJsonRaw();
    if (current.parseError) {
      throw new ModelsConfigSyncError("models_config_invalid");
    }
    parsed = current.parsed;
    revision = current.revision;
  }

  const providerValue = getProviderFromModelsConfig(parsed, providerId);
  if (providerValue === undefined) {
    throw new ModelsConfigSyncError("provider_not_found");
  }

  const eligibility = assessModelsSyncProviderEligibility(providerId, providerValue);
  if (!eligibility.ok) {
    throw new ModelsConfigSyncError(eligibility.code);
  }
  const provider = eligibility.provider;

  const credentials = options.credentials ?? (await getWebCredentialStore());
  const auth = await resolveModelsSyncRequestAuth(provider, credentials);
  const candidates = buildModelsEndpointCandidates(provider.baseUrl);

  const remote = await fetchOpenAICompatibleModelsList(candidates, auth.headers, {
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
    maxBodyBytes: options.maxBodyBytes,
  });

  const existingIds = collectExistingModelIds(providerValue);
  const rows = buildPreviewModelRows(remote, existingIds);
  const totals = {
    remote: rows.length,
    new: rows.filter((row) => row.status === "new").length,
    existing: rows.filter((row) => row.status === "existing").length,
  };

  const previewId = newOpaqueId();
  const expiresAt = now + MODELS_CONFIG_SYNC_PREVIEW_TTL_MS;
  storeModelsSyncPreview({
    previewId,
    providerId: provider.id,
    revision,
    fingerprint: computeModelsSyncProviderFingerprint(provider),
    remoteIds: remote.map((model) => model.id),
    existingIds: [...existingIds],
    expiresAt,
    createdAt: now,
  });

  return {
    kind: "models_config_sync_preview",
    providerId: provider.id,
    previewId,
    revision,
    expiresAt: new Date(expiresAt).toISOString(),
    totals,
    models: rows,
  };
}

// ── High-level apply (merge under shared lock; no runtime verify) ─────────────

export interface ApplyModelsConfigSyncOptions {
  now?: () => number;
  /**
   * Optional post-write verification hook for MODEL-SYNC-03.
   * On throw, apply restores the pre-write backup under the shared write lock
   * and rethrows `verification_failed`.
   */
  verifyWrittenConfig?: (args: {
    providerId: string;
    addedIds: string[];
    revision: string;
  }) => Promise<void> | void;
  /**
   * When true (default if verifyWrittenConfig is set), restore models.json from
   * the pre-write backup after verification failure.
   */
  rollbackOnVerificationFailure?: boolean;
  /** Defaults to "ok"; API layer may override after live runtime reload. */
  runtimeReload?: ModelsConfigSyncRuntimeReload;
  warning?: string;
}

/**
 * Validate preview binding and merge selected ids under the shared write lock.
 * Does not accept URL/path/headers/key from the caller.
 *
 * Sync errors raised inside the lock are tagged and rethrown as
 * ModelsConfigSyncError (mutateModelsJsonUnderLock would otherwise map them to
 * write_failed).
 */
export async function applyModelsConfigSync(
  input: {
    providerId: string;
    previewId: string;
    revision: string;
    modelIds: string[];
  },
  options: ApplyModelsConfigSyncOptions = {},
): Promise<ModelsConfigSyncApplyResponse> {
  const now = options.now?.() ?? Date.now();
  const providerId =
    typeof input.providerId === "string" ? input.providerId.trim() : "";
  const previewId = typeof input.previewId === "string" ? input.previewId : "";
  const revision = typeof input.revision === "string" ? input.revision : "";

  if (!providerId || !previewId || !revision) {
    throw new ModelsConfigSyncError("invalid_request");
  }

  const preview = getModelsSyncPreview(previewId, now);
  if (!preview) {
    throw new ModelsConfigSyncError("preview_expired");
  }
  if (preview.providerId !== providerId || preview.revision !== revision) {
    throw new ModelsConfigSyncError("preview_mismatch");
  }

  const orderedIds = orderSelectedIdsByRemote(preview.remoteIds, input.modelIds);

  type Tagged =
    | { kind: "sync_error"; code: ModelsSyncErrorCode }
    | { kind: "merge"; merge: MergeNewModelIdsResult; data?: Record<string, unknown>; skip: boolean };

  const outcome = await mutateModelsJsonUnderLock<Tagged>({
    expectedRevision: revision,
    failClosedOnParseError: true,
    backup: true,
    mutate: ({ parsed }) => {
      try {
        const providerValue = getProviderFromModelsConfig(parsed, providerId);
        if (providerValue === undefined) {
          return {
            skip: true as const,
            result: { kind: "sync_error" as const, code: "provider_not_found" as const },
          };
        }
        const eligibility = assessModelsSyncProviderEligibility(providerId, providerValue);
        if (!eligibility.ok) {
          return {
            skip: true as const,
            result: { kind: "sync_error" as const, code: eligibility.code },
          };
        }
        const fingerprint = computeModelsSyncProviderFingerprint(eligibility.provider);
        if (fingerprint !== preview.fingerprint) {
          return {
            skip: true as const,
            result: { kind: "sync_error" as const, code: "preview_mismatch" as const },
          };
        }

        const merged = mergeNewModelIdsIntoModelsConfig(parsed, providerId, orderedIds);
        if (merged.addedIds.length === 0) {
          return {
            skip: true as const,
            result: { kind: "merge" as const, merge: merged, skip: true },
          };
        }
        return {
          data: merged.config,
          result: { kind: "merge" as const, merge: merged, data: merged.config, skip: false },
        };
      } catch (error) {
        if (error instanceof ModelsConfigSyncError) {
          return {
            skip: true as const,
            result: { kind: "sync_error" as const, code: error.code },
          };
        }
        throw error;
      }
    },
  });

  if (!outcome.ok) {
    if (outcome.status === "stale_revision") {
      throw new ModelsConfigSyncError("stale_revision");
    }
    if (outcome.status === "parse_error") {
      throw new ModelsConfigSyncError("models_config_invalid");
    }
    throw new ModelsConfigSyncError("write_failed");
  }

  if (outcome.result.kind === "sync_error") {
    throw new ModelsConfigSyncError(outcome.result.code);
  }

  const merged = outcome.result.merge;

  if (options.verifyWrittenConfig && outcome.written) {
    try {
      await options.verifyWrittenConfig({
        providerId,
        addedIds: merged.addedIds,
        revision: outcome.revision,
      });
    } catch {
      const shouldRollback = options.rollbackOnVerificationFailure !== false;
      if (shouldRollback) {
        try {
          await rollbackModelsJsonFromPreWriteBackup();
        } catch {
          // Still surface verification_failed; backup restore is best-effort under lock.
        }
      }
      // Keep preview so the client can re-apply only after a successful re-preview
      // if the config was restored; do not delete on verification failure.
      throw new ModelsConfigSyncError("verification_failed");
    }
  }

  deleteModelsSyncPreview(previewId);

  const response: ModelsConfigSyncApplyResponse = {
    kind: "models_config_sync_apply",
    providerId,
    addedIds: merged.addedIds,
    skippedExistingIds: merged.skippedExistingIds,
    totalModels: merged.totalModels,
    revision: outcome.revision,
    runtimeReload: options.runtimeReload ?? "ok",
  };
  if (options.warning) {
    response.warning = options.warning;
  }
  return response;
}

/**
 * Restore models.json from the shared pre-write backup path under the write lock.
 * No-op when the backup file is missing (e.g. first-ever write).
 */
export async function rollbackModelsJsonFromPreWriteBackup(): Promise<boolean> {
  return withModelsJsonWriteLock(() => {
    const backupPath = getModelsJsonBackupPath();
    if (!existsSync(backupPath)) return false;
    restoreModelsJsonFromBackup(backupPath);
    return true;
  });
}

/**
 * Fresh provider-aware ModelRuntime verification of a successful sync write.
 * Never reuses the admin runtime cache. Does not log secrets or paths.
 */
export async function verifyModelsConfigSyncWrite(args: {
  providerId: string;
  addedIds: string[];
  agentDir?: string;
  modelsPath?: string;
}): Promise<void> {
  const { getAgentDir } = await import("@earendil-works/pi-coding-agent");
  const { createWebModelRuntime } = await import("@/lib/web-model-runtime");

  const agentDir = args.agentDir ?? getAgentDir();
  const modelsPath = args.modelsPath ?? join(agentDir, "models.json");

  let runtime;
  try {
    runtime = await createWebModelRuntime({
      agentDir,
      modelsPath,
      allowModelNetwork: false,
    });
  } catch {
    throw new ModelsConfigSyncError("verification_failed");
  }

  const loadError = runtime.getError();
  if (typeof loadError === "string" && loadError.length > 0) {
    throw new ModelsConfigSyncError("verification_failed");
  }

  for (const modelId of args.addedIds) {
    let model: unknown;
    try {
      model = runtime.getModel(args.providerId, modelId);
    } catch {
      throw new ModelsConfigSyncError("verification_failed");
    }
    if (!model) {
      throw new ModelsConfigSyncError("verification_failed");
    }
  }
}

/**
 * Best-effort live ModelRuntime refresh after a verified models.json write.
 * Partial failures never roll back disk and never project paths/secrets.
 */
export async function reloadLiveModelRuntimesAfterModelsSync(): Promise<
  ModelsConfigSyncRuntimeReload
> {
  let adminOk = false;
  let sessionsOk = false;

  try {
    const { getWebModelRuntime } = await import("@/lib/web-model-runtime");
    await getWebModelRuntime({ allowModelNetwork: false });
    adminOk = true;
  } catch {
    adminOk = false;
  }

  try {
    const { reloadRpcAuthState } = await import("@/lib/rpc-manager");
    await Promise.resolve(reloadRpcAuthState());
    sessionsOk = true;
  } catch {
    sessionsOk = false;
  }

  return adminOk && sessionsOk ? "ok" : "partial";
}

/**
 * Full apply path used by the HTTP route: shared-lock merge, fresh runtime
 * verification with backup rollback, then best-effort live reload.
 */
// ── HTTP request parsing (route-agnostic; no Next.js import) ──────────────────

const ALLOWED_PREVIEW_BODY_KEYS = new Set(["action", "providerId"]);
const ALLOWED_APPLY_BODY_KEYS = new Set([
  "action",
  "providerId",
  "previewId",
  "revision",
  "modelIds",
]);

export type ParsedModelsConfigSyncRequest =
  | { action: "preview"; providerId: string }
  | {
      action: "apply";
      providerId: string;
      previewId: string;
      revision: string;
      modelIds: string[];
    };

function hasForbiddenSyncBodyKey(body: Record<string, unknown>): boolean {
  for (const key of MODELS_CONFIG_SYNC_FORBIDDEN_BODY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) return true;
  }
  return false;
}

function hasDisallowedSyncBodyKeys(
  body: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): boolean {
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) return true;
  }
  return false;
}

/**
 * Strict allowlist parse for POST /api/models-config/sync bodies.
 * Rejects forbidden URL/key/header fields and any unknown keys.
 */
export function parseModelsConfigSyncRequest(
  body: unknown,
): ParsedModelsConfigSyncRequest {
  if (!isRecord(body)) {
    throw new ModelsConfigSyncError("invalid_request");
  }
  if (hasForbiddenSyncBodyKey(body)) {
    throw new ModelsConfigSyncError("invalid_request");
  }

  const action = body.action;
  if (action !== "preview" && action !== "apply") {
    throw new ModelsConfigSyncError("invalid_request");
  }

  if (action === "preview") {
    if (hasDisallowedSyncBodyKeys(body, ALLOWED_PREVIEW_BODY_KEYS)) {
      throw new ModelsConfigSyncError("invalid_request");
    }
    const providerId =
      typeof body.providerId === "string" ? body.providerId.trim() : "";
    if (!providerId) {
      throw new ModelsConfigSyncError("invalid_request");
    }
    return { action: "preview", providerId };
  }

  if (hasDisallowedSyncBodyKeys(body, ALLOWED_APPLY_BODY_KEYS)) {
    throw new ModelsConfigSyncError("invalid_request");
  }

  const providerId =
    typeof body.providerId === "string" ? body.providerId.trim() : "";
  const previewId = typeof body.previewId === "string" ? body.previewId : "";
  const revision = typeof body.revision === "string" ? body.revision : "";
  if (!providerId || !previewId || !revision) {
    throw new ModelsConfigSyncError("invalid_request");
  }
  if (!Array.isArray(body.modelIds)) {
    throw new ModelsConfigSyncError("invalid_request");
  }
  if (
    body.modelIds.length === 0 ||
    body.modelIds.length > MODELS_CONFIG_SYNC_APPLY_MAX_MODEL_IDS
  ) {
    throw new ModelsConfigSyncError("invalid_request");
  }
  const modelIds: string[] = [];
  for (const id of body.modelIds) {
    if (typeof id !== "string") {
      throw new ModelsConfigSyncError("invalid_request");
    }
    modelIds.push(id);
  }

  return {
    action: "apply",
    providerId,
    previewId,
    revision,
    modelIds,
  };
}

/**
 * Full HTTP-facing handler without Next.js types: parse → preview|apply.
 * Used by the route and by unit tests that cannot load `next/server`.
 */
export async function handleModelsConfigSyncRequest(
  body: unknown,
  options: {
    now?: () => number;
    credentials?: CredentialStore;
    fetchImpl?: ModelsSyncFetch;
    verifyWrittenConfig?: ApplyModelsConfigSyncOptions["verifyWrittenConfig"];
    reloadLiveRuntimes?: () => Promise<ModelsConfigSyncRuntimeReload>;
  } = {},
): Promise<
  | ModelsConfigSyncPreviewResponse
  | ModelsConfigSyncApplyResponse
> {
  const parsed = parseModelsConfigSyncRequest(body);
  if (parsed.action === "preview") {
    return previewModelsConfigSync(parsed.providerId, {
      now: options.now,
      credentials: options.credentials,
      fetchImpl: options.fetchImpl,
    });
  }
  return applyModelsConfigSyncWithVerification(
    {
      providerId: parsed.providerId,
      previewId: parsed.previewId,
      revision: parsed.revision,
      modelIds: parsed.modelIds,
    },
    {
      now: options.now,
      verifyWrittenConfig: options.verifyWrittenConfig,
      reloadLiveRuntimes: options.reloadLiveRuntimes,
    },
  );
}

export async function applyModelsConfigSyncWithVerification(
  input: {
    providerId: string;
    previewId: string;
    revision: string;
    modelIds: string[];
  },
  options: {
    now?: () => number;
    /** Injected for tests; defaults to verifyModelsConfigSyncWrite. */
    verifyWrittenConfig?: ApplyModelsConfigSyncOptions["verifyWrittenConfig"];
    /** Injected for tests; defaults to reloadLiveModelRuntimesAfterModelsSync. */
    reloadLiveRuntimes?: () => Promise<ModelsConfigSyncRuntimeReload>;
  } = {},
): Promise<ModelsConfigSyncApplyResponse> {
  const verify =
    options.verifyWrittenConfig ??
    (async (args) => {
      await verifyModelsConfigSyncWrite({
        providerId: args.providerId,
        addedIds: args.addedIds,
      });
    });

  // First apply without runtimeReload so we can set it after best-effort reload.
  const applied = await applyModelsConfigSync(input, {
    now: options.now,
    verifyWrittenConfig: verify,
    rollbackOnVerificationFailure: true,
    runtimeReload: "ok",
  });

  // Skip-only apply (no disk write) still returns success; live reload optional.
  if (applied.addedIds.length === 0) {
    return applied;
  }

  const reloadFn = options.reloadLiveRuntimes ?? reloadLiveModelRuntimesAfterModelsSync;
  let runtimeReload: ModelsConfigSyncRuntimeReload = "ok";
  try {
    runtimeReload = await reloadFn();
  } catch {
    runtimeReload = "partial";
  }

  if (runtimeReload === "partial") {
    return {
      ...applied,
      runtimeReload: "partial",
      warning: MODELS_CONFIG_SYNC_PARTIAL_RELOAD_WARNING,
    };
  }
  return { ...applied, runtimeReload: "ok" };
}
