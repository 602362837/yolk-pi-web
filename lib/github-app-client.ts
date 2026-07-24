/**
 * github-app-client — fixed-host GitHub App REST client (GHA-01).
 *
 * ## Contracts
 *
 * - Host is fixed to `https://api.github.com` (no caller-controlled base URL).
 * - redirect: "manual" — any 3xx is rejected.
 * - Response body size capped; timeouts via AbortController.
 * - Auth is App JWT or installation token only — never Links, personal PAT, or gh auth.
 * - Installation tokens are cached in-process until expiry - 60s.
 * - Safe errors only; raw bodies / tokens never appear in thrown messages.
 *
 * GHA-01 ships the transport + token cache + permission helpers. Issue mutation
 * helpers land with GHA-03.
 */

import {
  createGithubAppJwt,
  loadGithubAppCredentials,
  type GithubAppCredentials,
} from "./github-app-credentials";
import { GithubAutomationError } from "./github-automation-errors";
import {
  deriveGithubAppCapability,
  emptyPermissionSnapshot,
  type GithubAppCapabilitySnapshot,
  type GithubAppPermissionLevel,
  type GithubAppPermissionSnapshot,
} from "./github-automation-types";

// ─── Constants ───────────────────────────────────────────────────────────────

export const GITHUB_API_ORIGIN = "https://api.github.com";
export const GITHUB_API_VERSION = "2022-11-28";
export const GITHUB_API_ACCEPT = "application/vnd.github+json";
export const GITHUB_APP_USER_AGENT = "yolk-pi-web-github-automation";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 512 * 1024; // 512 KiB
const INSTALLATION_TOKEN_EXPIRY_SKEW_MS = 60_000;

// ─── Test hooks ──────────────────────────────────────────────────────────────

let _testTimeoutMs: number | undefined;
let _testFetch: typeof fetch | undefined;
let _testNowMs: number | null = null;

export function _testOverrideGithubAppClientTimeoutMs(
  timeoutMs: number | undefined,
): void {
  _testTimeoutMs =
    typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs >= 0
      ? timeoutMs
      : undefined;
}

export function _testOverrideGithubAppClientFetch(
  fetchImpl: typeof fetch | undefined,
): void {
  _testFetch = fetchImpl;
}

export function _testOverrideGithubAppClientNowMs(now: number | null): void {
  _testNowMs =
    typeof now === "number" && Number.isFinite(now) ? Math.floor(now) : null;
}

/**
 * Clear every cached installation access token.
 * Call after successful local credential upsert/delete so a rotated App/key
 * cannot reuse tokens minted under the previous identity.
 * Safe to call when the cache is empty.
 */
export function clearGithubAppInstallationTokenCache(): void {
  installationTokenCache.clear();
}

/** Test alias for clearGithubAppInstallationTokenCache. */
export function _testClearGithubAppInstallationTokenCache(): void {
  clearGithubAppInstallationTokenCache();
}

function nowMs(): number {
  return _testNowMs ?? Date.now();
}

function timeoutMs(): number {
  return _testTimeoutMs ?? DEFAULT_TIMEOUT_MS;
}

function activeFetch(): typeof fetch {
  return _testFetch ?? globalThis.fetch.bind(globalThis);
}

// ─── Installation token cache ────────────────────────────────────────────────

interface CachedInstallationToken {
  token: string;
  expiresAtMs: number;
}

const installationTokenCache = new Map<number, CachedInstallationToken>();

interface InstallationTokenResponse {
  token: string;
  expires_at: string;
}

// ─── HTTP helpers ────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createDeadline(caller?: AbortSignal): {
  signal: AbortSignal;
  didTimeout(): boolean;
  dispose(): void;
} {
  const controller = new AbortController();
  let timedOut = false;
  let callerAborted = false;

  const onCallerAbort = (): void => {
    if (timedOut || callerAborted) return;
    callerAborted = true;
    controller.abort();
  };

  if (caller?.aborted) {
    onCallerAbort();
  } else {
    caller?.addEventListener("abort", onCallerAbort, { once: true });
  }

  const timer = setTimeout(() => {
    if (callerAborted || timedOut) return;
    timedOut = true;
    controller.abort();
  }, timeoutMs());

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      caller?.removeEventListener("abort", onCallerAbort);
    },
  };
}

function assertFixedGithubApiUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new GithubAutomationError("github_bad_response", undefined, {
      status: 500,
      details: { reason: "invalid_url" },
    });
  }
  if (parsed.origin !== GITHUB_API_ORIGIN) {
    throw new GithubAutomationError("github_redirect_rejected", undefined, {
      status: 502,
      details: { reason: "host_not_allowed" },
    });
  }
  if (parsed.protocol !== "https:") {
    throw new GithubAutomationError("github_redirect_rejected", undefined, {
      status: 502,
      details: { reason: "protocol_not_allowed" },
    });
  }
  return parsed;
}

export interface GithubAppHttpResult {
  status: number;
  headers: Headers;
  body: unknown;
  bodyText: string;
}

async function githubAppFetch(
  pathOrUrl: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
    maxBytes?: number;
  } = {},
): Promise<GithubAppHttpResult> {
  const url =
    pathOrUrl.startsWith("https://") || pathOrUrl.startsWith("http://")
      ? assertFixedGithubApiUrl(pathOrUrl).toString()
      : `${GITHUB_API_ORIGIN}${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`;

  assertFixedGithubApiUrl(url);

  const deadline = createDeadline(init.signal);
  const maxBytes = init.maxBytes ?? MAX_RESPONSE_BYTES;

  try {
    let response: Response;
    try {
      response = await activeFetch()(url, {
        method: init.method ?? "GET",
        headers: init.headers,
        body: init.body,
        redirect: "manual",
        signal: deadline.signal,
      });
    } catch {
      if (deadline.didTimeout()) {
        throw new GithubAutomationError("github_timeout");
      }
      throw new GithubAutomationError("github_network_error");
    }

    if (response.status >= 300 && response.status < 400) {
      throw new GithubAutomationError("github_redirect_rejected");
    }

    const reader = response.body?.getReader();
    let bodyText = "";
    if (reader) {
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > maxBytes) {
            try {
              await reader.cancel();
            } catch {
              // ignore
            }
            throw new GithubAutomationError("github_oversized_response");
          }
          chunks.push(value);
        }
      } catch (err) {
        if (err instanceof GithubAutomationError) throw err;
        if (deadline.didTimeout()) {
          throw new GithubAutomationError("github_timeout");
        }
        throw new GithubAutomationError("github_network_error");
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      bodyText = new TextDecoder().decode(bytes);
    }

    let body: unknown = null;
    if (bodyText.length > 0) {
      try {
        body = JSON.parse(bodyText) as unknown;
      } catch {
        body = null;
      }
    }

    return {
      status: response.status,
      headers: response.headers,
      body,
      bodyText,
    };
  } finally {
    deadline.dispose();
  }
}

function mapAuthFailure(status: number): never {
  if (status === 401 || status === 403) {
    throw new GithubAutomationError("github_auth_failed", undefined, {
      status: status === 401 ? 401 : 403,
    });
  }
  if (status === 404) {
    throw new GithubAutomationError("installation_missing");
  }
  if (status === 429) {
    throw new GithubAutomationError("github_rate_limited");
  }
  throw new GithubAutomationError("github_bad_response", undefined, {
    status: 502,
    details: { httpStatus: status },
  });
}

// ─── App JWT authenticated requests ──────────────────────────────────────────

async function withAppJwtHeaders(
  credentials: GithubAppCredentials,
  extra?: Record<string, string>,
): Promise<Record<string, string>> {
  const jwt = createGithubAppJwt(credentials);
  return {
    Accept: GITHUB_API_ACCEPT,
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
    "User-Agent": GITHUB_APP_USER_AGENT,
    Authorization: `Bearer ${jwt.token}`,
    ...extra,
  };
}

// ─── Installation tokens ─────────────────────────────────────────────────────

/**
 * Obtain an installation access token (cached until expiry - 60s).
 * Never falls back to personal credentials.
 */
export async function getGithubInstallationToken(
  installationId: number,
  options?: { signal?: AbortSignal; forceRefresh?: boolean },
): Promise<{ token: string; expiresAtMs: number }> {
  if (!Number.isInteger(installationId) || installationId <= 0) {
    throw new GithubAutomationError("invalid_config", "Invalid installationId", {
      status: 400,
    });
  }

  const cached = installationTokenCache.get(installationId);
  if (
    !options?.forceRefresh &&
    cached &&
    cached.expiresAtMs - INSTALLATION_TOKEN_EXPIRY_SKEW_MS > nowMs()
  ) {
    return { token: cached.token, expiresAtMs: cached.expiresAtMs };
  }

  const credentials = await loadGithubAppCredentials();
  const headers = await withAppJwtHeaders(credentials, {
    Accept: GITHUB_API_ACCEPT,
  });

  const result = await githubAppFetch(
    `/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers,
      signal: options?.signal,
    },
  );

  if (result.status < 200 || result.status >= 300) {
    mapAuthFailure(result.status);
  }

  if (!isRecord(result.body)) {
    throw new GithubAutomationError("github_bad_response");
  }

  const token = result.body.token;
  const expiresAt = result.body.expires_at;
  if (typeof token !== "string" || token.length === 0) {
    throw new GithubAutomationError("github_bad_response");
  }
  if (typeof expiresAt !== "string" || expiresAt.length === 0) {
    throw new GithubAutomationError("github_bad_response");
  }

  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    throw new GithubAutomationError("github_bad_response");
  }

  // Defensive: never put token into thrown messages / logs from this module.
  const entry: CachedInstallationToken = { token, expiresAtMs };
  installationTokenCache.set(installationId, entry);

  // Touch InstallationTokenResponse type for documentation completeness.
  void (null as unknown as InstallationTokenResponse);

  return { token, expiresAtMs };
}

async function withInstallationHeaders(
  installationId: number,
  extra?: Record<string, string>,
  options?: { signal?: AbortSignal },
): Promise<Record<string, string>> {
  const { token } = await getGithubInstallationToken(installationId, options);
  return {
    Accept: GITHUB_API_ACCEPT,
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
    "User-Agent": GITHUB_APP_USER_AGENT,
    Authorization: `Bearer ${token}`,
    ...extra,
  };
}

/**
 * Low-level installation-authenticated GET helper (fixed host).
 * Exported for later phases; GHA-01 tests exercise via permission fetch.
 */
export async function githubAppInstallationRequest(
  installationId: number,
  path: string,
  options?: {
    method?: string;
    body?: unknown;
    signal?: AbortSignal;
  },
): Promise<GithubAppHttpResult> {
  if (!path.startsWith("/")) {
    throw new GithubAutomationError("invalid_config", "Path must start with /", {
      status: 400,
    });
  }

  const headers = await withInstallationHeaders(
    installationId,
    options?.body !== undefined
      ? { "Content-Type": "application/json" }
      : undefined,
    { signal: options?.signal },
  );

  const result = await githubAppFetch(path, {
    method: options?.method ?? "GET",
    headers,
    body:
      options?.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options?.signal,
  });

  if (result.status === 401 || result.status === 403) {
    // Force token refresh once on auth failure (token may have been revoked).
    if (result.status === 401) {
      installationTokenCache.delete(installationId);
    }
    mapAuthFailure(result.status);
  }
  if (result.status === 429) {
    throw new GithubAutomationError("github_rate_limited");
  }

  return result;
}

// ─── Permissions ─────────────────────────────────────────────────────────────

function parsePermissionLevel(value: unknown): GithubAppPermissionLevel {
  if (value === "read") return "read";
  if (value === "write" || value === "admin") return "write";
  return "none";
}

/**
 * Fetch installation permissions and derive separate P0/P1 capability.
 * Uses App JWT (not installation token) against `/app/installations/{id}`.
 */
export async function getGithubInstallationCapability(
  installationId: number,
  options?: { signal?: AbortSignal },
): Promise<GithubAppCapabilitySnapshot> {
  if (!Number.isInteger(installationId) || installationId <= 0) {
    throw new GithubAutomationError("invalid_config", "Invalid installationId", {
      status: 400,
    });
  }

  const credentials = await loadGithubAppCredentials();
  const headers = await withAppJwtHeaders(credentials);
  const result = await githubAppFetch(`/app/installations/${installationId}`, {
    method: "GET",
    headers,
    signal: options?.signal,
  });

  if (result.status === 404) {
    throw new GithubAutomationError("installation_missing");
  }
  if (result.status < 200 || result.status >= 300) {
    mapAuthFailure(result.status);
  }
  if (!isRecord(result.body)) {
    throw new GithubAutomationError("github_bad_response");
  }

  const permissionsRaw = isRecord(result.body.permissions)
    ? result.body.permissions
    : {};

  const permissions: GithubAppPermissionSnapshot = {
    ...emptyPermissionSnapshot(),
    metadata: parsePermissionLevel(permissionsRaw.metadata ?? "read"),
    issues: parsePermissionLevel(permissionsRaw.issues),
    pull_requests: parsePermissionLevel(permissionsRaw.pull_requests),
    contents: parsePermissionLevel(permissionsRaw.contents),
  };

  // GitHub always grants metadata read for Apps; treat missing as read when
  // the installation payload is otherwise valid.
  if (permissions.metadata === "none") {
    permissions.metadata = "read";
  }

  return deriveGithubAppCapability(permissions);
}

function encodeGithubPathSegment(value: string): string {
  return encodeURIComponent(value);
}

/**
 * Safe repository identity returned by fixed-host App installation lookup.
 * Never includes tokens or absolute local paths.
 */
export interface GithubRepositoryIdentity {
  repositoryId: number;
  fullName: string;
  ownerId: number | null;
  ownerLogin: string | null;
  ownerType: string | null;
  defaultBranch: string | null;
}

/**
 * Cross-check a GitHub repository via installation-authenticated GET
 * `/repos/{owner}/{repo}` on the fixed `api.github.com` host.
 * Client-supplied repositoryId/fullName are untrusted until this confirms them.
 */
export async function lookupGithubRepositoryIdentity(options: {
  installationId: number;
  owner: string;
  repo: string;
  signal?: AbortSignal;
}): Promise<GithubRepositoryIdentity> {
  if (!Number.isInteger(options.installationId) || options.installationId <= 0) {
    throw new GithubAutomationError("invalid_config", "Invalid installationId", {
      status: 400,
    });
  }
  const owner = typeof options.owner === "string" ? options.owner.trim() : "";
  const repo = typeof options.repo === "string" ? options.repo.trim() : "";
  if (!owner || !repo || owner.includes("/") || repo.includes("/")) {
    throw new GithubAutomationError("invalid_config", "Invalid repository fullName", {
      status: 400,
    });
  }

  const result = await githubAppInstallationRequest(
    options.installationId,
    `/repos/${encodeGithubPathSegment(owner)}/${encodeGithubPathSegment(repo)}`,
    { method: "GET", signal: options.signal },
  );

  if (result.status === 404) {
    throw new GithubAutomationError(
      "repository_not_allowlisted",
      "GitHub repository was not found for this installation",
      { status: 400, details: { reason: "repository_not_found" } },
    );
  }
  if (result.status === 401 || result.status === 403) {
    mapAuthFailure(result.status);
  }
  if (result.status === 429) {
    throw new GithubAutomationError("github_rate_limited");
  }
  if (result.status < 200 || result.status >= 300 || !isRecord(result.body)) {
    throw new GithubAutomationError("github_bad_response", undefined, {
      status: 502,
      details: { httpStatus: result.status },
    });
  }

  const repositoryId = result.body.id;
  if (
    typeof repositoryId !== "number" ||
    !Number.isInteger(repositoryId) ||
    repositoryId <= 0
  ) {
    throw new GithubAutomationError("github_bad_response");
  }

  const fullName =
    typeof result.body.full_name === "string" && result.body.full_name.trim()
      ? result.body.full_name.trim()
      : `${owner}/${repo}`;

  const ownerRaw = isRecord(result.body.owner) ? result.body.owner : null;
  const ownerId =
    ownerRaw && typeof ownerRaw.id === "number" && Number.isInteger(ownerRaw.id) && ownerRaw.id > 0
      ? ownerRaw.id
      : null;
  const ownerLogin =
    ownerRaw && typeof ownerRaw.login === "string" && ownerRaw.login.trim()
      ? ownerRaw.login.trim()
      : null;
  const ownerType =
    ownerRaw && typeof ownerRaw.type === "string" && ownerRaw.type.trim()
      ? ownerRaw.type.trim()
      : null;
  const defaultBranch =
    typeof result.body.default_branch === "string" && result.body.default_branch.trim()
      ? result.body.default_branch.trim()
      : null;

  return {
    repositoryId,
    fullName,
    ownerId,
    ownerLogin,
    ownerType,
    defaultBranch,
  };
}

/**
 * Authenticated GET https://api.github.com/user with a bearer token.
 * Used only by the machine-assignee resolver for canonical login discovery.
 * Does NOT use App credentials and does NOT cache the personal token.
 */
export async function githubGetUserWithBearerToken(
  token: string,
  options?: { signal?: AbortSignal },
): Promise<{ login: string; id: number }> {
  if (typeof token !== "string" || token.length === 0) {
    throw new GithubAutomationError("credential_invalid");
  }

  const result = await githubAppFetch("/user", {
    method: "GET",
    headers: {
      Accept: GITHUB_API_ACCEPT,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      "User-Agent": GITHUB_APP_USER_AGENT,
      Authorization: `Bearer ${token}`,
    },
    signal: options?.signal,
    maxBytes: 64 * 1024,
  });

  if (result.status === 401 || result.status === 403) {
    throw new GithubAutomationError("credential_invalid");
  }
  if (result.status === 429) {
    throw new GithubAutomationError("github_rate_limited");
  }
  if (result.status < 200 || result.status >= 300) {
    throw new GithubAutomationError("github_bad_response", undefined, {
      status: 502,
      details: { httpStatus: result.status },
    });
  }
  if (!isRecord(result.body)) {
    throw new GithubAutomationError("github_bad_response");
  }

  const login = result.body.login;
  const id = result.body.id;
  if (typeof login !== "string" || !login.trim()) {
    throw new GithubAutomationError("github_bad_response");
  }
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
    throw new GithubAutomationError("github_bad_response");
  }

  return { login: login.trim(), id };
}
