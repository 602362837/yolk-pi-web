import { randomUUID } from "node:crypto";
import { adoptOAuthActiveAccountCredential, extractOpenAICodexAccountId, getOAuthAccountAccessToken, readOAuthAccountCredential, readOAuthActiveAccountId, updateOAuthAccountQuotaCache } from "@/lib/oauth-accounts";
import { getWebCredentialStore } from "@/lib/web-credential-store";
import { getWebModelRuntime } from "@/lib/web-model-runtime";

export type CredentialStatus = "valid" | "expired" | "not_found" | "parse_error";

export interface QuotaTier {
  name: string;
  utilization: number;
  resetsAt: string | null;
}

export interface CodexRateLimitResetCredit {
  id: string;
  status: string;
  grantedAt: string;
  expiresAt: string;
}

export interface SubscriptionQuota {
  tool: string;
  credentialStatus: CredentialStatus;
  credentialMessage: string | null;
  success: boolean;
  tiers: QuotaTier[];
  error: string | null;
  queriedAt: number | null;
  resetCreditsAvailableCount: number | null;
  resetCredits: CodexRateLimitResetCredit[];
  resetCreditsError: string | null;
}

interface StoredOAuthCredential {
  type: "oauth";
  access: string;
  refresh: string;
  expires: number;
  accountId?: string;
  [key: string]: unknown;
}

interface CodexRateLimitWindow {
  used_percent?: number;
  limit_window_seconds?: number;
  reset_at?: number;
}

interface CodexUsageResponse {
  rate_limit?: {
    primary_window?: CodexRateLimitWindow;
    secondary_window?: CodexRateLimitWindow;
  };
  rate_limit_reset_credits?: CodexResetCreditsCountPayload;
  rateLimitResetCredits?: CodexResetCreditsCountPayload;
}

interface CodexResetCreditsCountPayload {
  available_count?: unknown;
  availableCount?: unknown;
}

interface CodexResetCreditsSummary {
  availableCount: number | null;
  credits: CodexRateLimitResetCredit[];
  error: string | null;
}

interface CodexResetCreditsParseResult {
  availableCount: number | null;
  credits: CodexRateLimitResetCredit[];
  invalidPayload: boolean;
}

interface ResolvedActiveCredential {
  accessToken: string;
  /** Opaque saved-account id for cache writes and other store operations. */
  storageId: string | null;
  /** Real ChatGPT account id used only for outbound OpenAI headers. */
  chatgptAccountId: string | null;
}

const OPENAI_CODEX_PROVIDER = "openai-codex";
const OPENAI_CODEX_USER_AGENT = "codex_cli_rs/0.76.0 (Debian 13.0.0; x86_64) WindowsTerminal";
const OPENAI_CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const OPENAI_CODEX_RESET_CREDITS_URL = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";
const OPENAI_CODEX_RESET_CREDITS_CONSUME_URL = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume";

/**
 * 获取当前毫秒时间戳。
 *
 * @returns 当前 Unix 毫秒时间戳。
 */
function nowMillis(): number {
  return Date.now();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeNumber(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function defaultResetCreditFields(): Pick<SubscriptionQuota, "resetCreditsAvailableCount" | "resetCredits" | "resetCreditsError"> {
  return {
    resetCreditsAvailableCount: null,
    resetCredits: [],
    resetCreditsError: null,
  };
}

/**
 * 构造无可用凭据的订阅额度结果。
 *
 * @param tool 额度所属工具或 provider 标识。
 * @returns 标准订阅额度结果。
 */
function quotaNotFound(tool: string): SubscriptionQuota {
  return {
    tool,
    credentialStatus: "not_found",
    credentialMessage: null,
    success: false,
    tiers: [],
    error: null,
    queriedAt: null,
    ...defaultResetCreditFields(),
  };
}

/**
 * 构造失败的订阅额度结果。
 *
 * @param tool 额度所属工具或 provider 标识。
 * @param status 凭据状态。
 * @param message 失败说明。
 * @returns 标准订阅额度结果。
 */
function quotaError(tool: string, status: CredentialStatus, message: string): SubscriptionQuota {
  return {
    tool,
    credentialStatus: status,
    credentialMessage: message,
    success: false,
    tiers: [],
    error: message,
    queriedAt: nowMillis(),
    ...defaultResetCreditFields(),
  };
}

/**
 * 将额度窗口秒数转换为展示 tier 名称。
 *
 * @param seconds ChatGPT 返回的窗口长度秒数。
 * @returns 统一的 tier 名称。
 */
function windowSecondsToTierName(seconds: number): string {
  if (seconds === 18000) return "five_hour";
  if (seconds === 604800) return "seven_day";

  const hours = Math.floor(seconds / 3600);
  if (hours >= 24) return `${Math.floor(hours / 24)}_day`;
  return `${hours}_hour`;
}

/**
 * 将 Unix 秒时间戳转换为 ISO 字符串。
 *
 * @param timestampSeconds Unix 秒时间戳。
 * @returns ISO 时间字符串，输入无效时返回 null。
 */
function unixSecondsToIso(timestampSeconds: number): string | null {
  if (!Number.isFinite(timestampSeconds)) return null;
  return new Date(timestampSeconds * 1000).toISOString();
}

function openAICodexHeaders(accessToken: string, accountId: string | null, extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "User-Agent": OPENAI_CODEX_USER_AGENT,
    ...(extra ?? {}),
  };
  if (accountId) headers["ChatGPT-Account-Id"] = accountId;
  return headers;
}

function resetCreditsAvailableCountFromUsage(body: CodexUsageResponse): number | null {
  const raw = body.rate_limit_reset_credits ?? body.rateLimitResetCredits;
  if (!raw) return null;
  return normalizeNumber(raw.available_count ?? raw.availableCount);
}

function normalizeResetCredit(raw: unknown): CodexRateLimitResetCredit | null {
  if (!isRecord(raw)) return null;
  const resetType = String(raw.reset_type ?? raw.resetType ?? "").trim();
  if (resetType !== "codex_rate_limits") return null;

  const status = String(raw.status ?? "").trim();
  if (status !== "available") return null;

  const expiresAt = String(raw.expires_at ?? raw.expiresAt ?? "").trim();
  if (!expiresAt) return null;

  return {
    id: String(raw.id ?? "").trim(),
    status,
    grantedAt: String(raw.granted_at ?? raw.grantedAt ?? "").trim(),
    expiresAt,
  };
}

function parseResetCreditsPayload(payload: unknown): CodexResetCreditsParseResult {
  let value = payload;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return { availableCount: null, credits: [], invalidPayload: true };
    try {
      value = JSON.parse(trimmed) as unknown;
    } catch {
      return { availableCount: null, credits: [], invalidPayload: true };
    }
  }

  if (!isRecord(value)) return { availableCount: null, credits: [], invalidPayload: true };

  const hasExpectedShape = "credits" in value || "available_count" in value || "availableCount" in value;
  const creditsPayloadInvalid = "credits" in value && !Array.isArray(value.credits);
  const credits = Array.isArray(value.credits)
    ? value.credits.map(normalizeResetCredit).filter((credit): credit is CodexRateLimitResetCredit => Boolean(credit))
    : [];
  const parsedAvailableCount = normalizeNumber(value.available_count ?? value.availableCount);
  const availableCount = hasExpectedShape
    ? parsedAvailableCount ?? (Array.isArray(value.credits) ? credits.length : null)
    : null;

  return {
    availableCount,
    credits,
    invalidPayload: !hasExpectedShape || creditsPayloadInvalid,
  };
}

async function queryOpenAICodexResetCredits(accessToken: string, accountId: string | null): Promise<CodexResetCreditsSummary> {
  const response = await fetch(OPENAI_CODEX_RESET_CREDITS_URL, {
    method: "GET",
    headers: openAICodexHeaders(accessToken, accountId, {
      Accept: "application/json",
      "OpenAI-Beta": "codex-1",
      Originator: "Codex Desktop",
    }),
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const suffix = body.trim() ? `: ${body.trim()}` : "";
    return { availableCount: null, credits: [], error: `Reset credits API error (HTTP ${response.status})${suffix}` };
  }

  const text = await response.text().catch(() => "");
  const parsed = parseResetCreditsPayload(text);
  return {
    availableCount: parsed.availableCount,
    credits: parsed.credits,
    error: parsed.invalidPayload ? "Invalid reset credits payload" : null,
  };
}

function createRedeemRequestId(): string {
  try {
    return randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

async function consumeOpenAICodexResetCredit(accessToken: string, accountId: string | null): Promise<void> {
  const response = await fetch(OPENAI_CODEX_RESET_CREDITS_CONSUME_URL, {
    method: "POST",
    headers: openAICodexHeaders(accessToken, accountId),
    body: JSON.stringify({ redeem_request_id: createRedeemRequestId() }),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const suffix = body.trim() ? `: ${body.trim()}` : "";
    throw new Error(`Reset credit consume failed (HTTP ${response.status})${suffix}`);
  }
}

/**
 * 查询 ChatGPT Plus/Pro 的 Codex 订阅额度。
 *
 * @param accessToken ChatGPT OAuth access token。
 * @param accountId ChatGPT 账号 ID，缺省时不发送账号头。
 * @returns 标准订阅额度结果。
 */
async function queryOpenAICodexQuota(accessToken: string, accountId: string | null): Promise<SubscriptionQuota> {
  const response = await fetch(OPENAI_CODEX_USAGE_URL, {
    method: "GET",
    headers: openAICodexHeaders(accessToken, accountId),
    signal: AbortSignal.timeout(15000),
  });

  if (response.status === 401 || response.status === 403) {
    return quotaError(OPENAI_CODEX_PROVIDER, "expired", `Authentication failed (HTTP ${response.status}). Please re-login.`);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return quotaError(OPENAI_CODEX_PROVIDER, "valid", `API error (HTTP ${response.status}): ${body}`);
  }

  const body = (await response.json()) as CodexUsageResponse;
  const windows = [
    body.rate_limit?.primary_window,
    body.rate_limit?.secondary_window,
  ].filter((window): window is CodexRateLimitWindow => Boolean(window));

  const usageResetCreditsAvailableCount = resetCreditsAvailableCountFromUsage(body);
  let resetCreditsAvailableCount = usageResetCreditsAvailableCount;
  let resetCredits: CodexRateLimitResetCredit[] = [];
  let resetCreditsError: string | null = null;

  try {
    const resetSummary = await queryOpenAICodexResetCredits(accessToken, accountId);
    resetCreditsAvailableCount = resetSummary.availableCount ?? usageResetCreditsAvailableCount;
    resetCredits = resetSummary.credits;
    resetCreditsError = resetSummary.error;
  } catch (error) {
    resetCreditsError = error instanceof Error ? error.message : String(error);
  }

  return {
    tool: OPENAI_CODEX_PROVIDER,
    credentialStatus: "valid",
    credentialMessage: null,
    success: true,
    tiers: windows
      .filter((window) => typeof window.used_percent === "number")
      .map((window) => ({
        name: typeof window.limit_window_seconds === "number"
          ? windowSecondsToTierName(window.limit_window_seconds)
          : "unknown",
        utilization: window.used_percent ?? 0,
        resetsAt: typeof window.reset_at === "number" ? unixSecondsToIso(window.reset_at) : null,
      })),
    error: null,
    queriedAt: nowMillis(),
    resetCreditsAvailableCount,
    resetCredits,
    resetCreditsError,
  };
}

/**
 * 使用 Pi 已保存的 OAuth 凭据查询 OpenAI Codex 订阅额度。
 *
 * @param provider OAuth provider 标识，目前仅支持 openai-codex。
 * @returns 标准订阅额度结果。
 */
async function cacheAccountQuota(provider: string, storageId: string | null, quota: SubscriptionQuota): Promise<void> {
  if (!storageId) return;
  await updateOAuthAccountQuotaCache(provider, storageId, {
    success: quota.success,
    tiers: quota.tiers,
    error: quota.error,
    queriedAt: quota.queriedAt,
    resetCreditsAvailableCount: quota.resetCreditsAvailableCount,
    resetCredits: quota.resetCredits,
    resetCreditsError: quota.resetCreditsError,
  }).catch(() => {});
}

async function resolveActiveOpenAICodexCredential(provider: string): Promise<ResolvedActiveCredential | SubscriptionQuota> {
  if (provider !== OPENAI_CODEX_PROVIDER) return quotaNotFound(provider);

  const store = await getWebCredentialStore();
  const storedCredential = await store.read(provider) as StoredOAuthCredential | undefined;
  if (storedCredential?.type !== "oauth") return quotaNotFound(provider);
  if (Date.now() >= storedCredential.expires && !storedCredential.refresh.trim()) {
    return quotaError(provider, "expired", "OAuth access token expired and no refresh token is available. Please re-import the credential or log in again.");
  }

  let accessToken: string | undefined;
  try {
    // ModelRuntime.getAuth performs OAuth refresh under the credential store lock
    // and applies provider headers/env through the canonical path.
    const runtime = await getWebModelRuntime();
    const auth = await runtime.getAuth(provider);
    accessToken = auth?.auth.apiKey;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return quotaError(provider, "expired", message);
  }

  if (!accessToken) return quotaError(provider, "expired", "OAuth token unavailable. Please re-login.");

  const adopted = await adoptOAuthActiveAccountCredential(provider, store);
  if (!adopted) return quotaError(provider, "expired", "OAuth token unavailable. Please re-login.");
  const refreshedCredential = await store.read(provider) as StoredOAuthCredential | undefined;
  // The active entry is the saved-account identity. The credential account id remains
  // the real ChatGPT id and must never be used as a metadata/cache key.
  const activeStorageId = await readOAuthActiveAccountId(provider);
  const chatgptAccountId = refreshedCredential?.accountId ?? storedCredential.accountId ?? extractOpenAICodexAccountId(accessToken);

  return { accessToken, storageId: activeStorageId, chatgptAccountId };
}

function isSubscriptionQuota(value: ResolvedActiveCredential | SubscriptionQuota): value is SubscriptionQuota {
  return "success" in value;
}

export async function getOAuthProviderSubscriptionQuota(provider: string): Promise<SubscriptionQuota> {
  const resolved = await resolveActiveOpenAICodexCredential(provider);
  if (isSubscriptionQuota(resolved)) return resolved;

  try {
    const quota = await queryOpenAICodexQuota(resolved.accessToken, resolved.chatgptAccountId);
    await cacheAccountQuota(provider, resolved.storageId, quota);
    return quota;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const quota = quotaError(provider, "valid", `Network error: ${message}`);
    await cacheAccountQuota(provider, resolved.storageId, quota);
    return quota;
  }
}

export async function getOAuthAccountSubscriptionQuota(provider: string, accountId: string): Promise<SubscriptionQuota> {
  if (provider !== OPENAI_CODEX_PROVIDER) return quotaNotFound(provider);

  let credential: Awaited<ReturnType<typeof readOAuthAccountCredential>>;
  try {
    credential = await readOAuthAccountCredential(provider, accountId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return quotaError(provider, "not_found", message);
  }

  let accessToken: string | undefined;
  try {
    accessToken = await getOAuthAccountAccessToken(provider, credential);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const quota = quotaError(provider, "expired", message);
    await cacheAccountQuota(provider, accountId, quota);
    return quota;
  }

  if (!accessToken) {
    const quota = quotaError(provider, "expired", "OAuth token unavailable. Please re-login.");
    await cacheAccountQuota(provider, accountId, quota);
    return quota;
  }

  try {
    const quota = await queryOpenAICodexQuota(accessToken, credential.accountId);
    await cacheAccountQuota(provider, accountId, quota);
    return quota;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const quota = quotaError(provider, "valid", `Network error: ${message}`);
    await cacheAccountQuota(provider, accountId, quota);
    return quota;
  }
}

export async function consumeOAuthProviderResetCredit(provider: string): Promise<SubscriptionQuota> {
  const resolved = await resolveActiveOpenAICodexCredential(provider);
  if (isSubscriptionQuota(resolved)) return resolved;

  let consumed = false;
  try {
    await consumeOpenAICodexResetCredit(resolved.accessToken, resolved.chatgptAccountId);
    consumed = true;
    const quota = await queryOpenAICodexQuota(resolved.accessToken, resolved.chatgptAccountId);
    await cacheAccountQuota(provider, resolved.storageId, quota);
    return quota;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return quotaError(provider, "valid", consumed ? `Reset consumed, but quota refresh failed: ${message}` : `Reset failed: ${message}`);
  }
}

export async function consumeOAuthAccountResetCredit(provider: string, accountId: string): Promise<SubscriptionQuota> {
  if (provider !== OPENAI_CODEX_PROVIDER) return quotaNotFound(provider);

  let credential: Awaited<ReturnType<typeof readOAuthAccountCredential>>;
  try {
    credential = await readOAuthAccountCredential(provider, accountId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return quotaError(provider, "not_found", message);
  }

  let accessToken: string | undefined;
  try {
    accessToken = await getOAuthAccountAccessToken(provider, credential);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return quotaError(provider, "expired", message);
  }

  if (!accessToken) return quotaError(provider, "expired", "OAuth token unavailable. Please re-login.");

  let consumed = false;
  try {
    await consumeOpenAICodexResetCredit(accessToken, credential.accountId);
    consumed = true;
    const quota = await queryOpenAICodexQuota(accessToken, credential.accountId);
    await cacheAccountQuota(provider, accountId, quota);
    return quota;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return quotaError(provider, "valid", consumed ? `Reset consumed, but quota refresh failed: ${message}` : `Reset failed: ${message}`);
  }
}
