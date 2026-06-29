import { AuthStorage } from "@earendil-works/pi-coding-agent";
import { getOAuthApiKey } from "@earendil-works/pi-ai/oauth";
import { extractOpenAICodexAccountId, readOAuthAccountCredential, saveOAuthAccountCredential, syncActiveOAuthAccountCredential, updateOAuthAccountQuotaCache } from "@/lib/oauth-accounts";

export type CredentialStatus = "valid" | "expired" | "not_found" | "parse_error";

export interface QuotaTier {
  name: string;
  utilization: number;
  resetsAt: string | null;
}

export interface SubscriptionQuota {
  tool: string;
  credentialStatus: CredentialStatus;
  credentialMessage: string | null;
  success: boolean;
  tiers: QuotaTier[];
  error: string | null;
  queriedAt: number | null;
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
}

/**
 * 获取当前毫秒时间戳。
 *
 * @returns 当前 Unix 毫秒时间戳。
 */
function nowMillis(): number {
  return Date.now();
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

/**
 * 查询 ChatGPT Plus/Pro 的 Codex 订阅额度。
 *
 * @param accessToken ChatGPT OAuth access token。
 * @param accountId ChatGPT 账号 ID，缺省时不发送账号头。
 * @returns 标准订阅额度结果。
 */
async function queryOpenAICodexQuota(accessToken: string, accountId: string | null): Promise<SubscriptionQuota> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "User-Agent": "pi-web",
  };
  if (accountId) headers["ChatGPT-Account-Id"] = accountId;

  const response = await fetch("https://chatgpt.com/backend-api/wham/usage", {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(15000),
  });

  if (response.status === 401 || response.status === 403) {
    return quotaError("openai-codex", "expired", `Authentication failed (HTTP ${response.status}). Please re-login.`);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return quotaError("openai-codex", "valid", `API error (HTTP ${response.status}): ${body}`);
  }

  const body = (await response.json()) as CodexUsageResponse;
  const windows = [
    body.rate_limit?.primary_window,
    body.rate_limit?.secondary_window,
  ].filter((window): window is CodexRateLimitWindow => Boolean(window));

  return {
    tool: "openai-codex",
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
  };
}

/**
 * 使用 Pi 已保存的 OAuth 凭据查询 OpenAI Codex 订阅额度。
 *
 * @param provider OAuth provider 标识，目前仅支持 openai-codex。
 * @returns 标准订阅额度结果。
 */
async function cacheAccountQuota(provider: string, accountId: string | null, quota: SubscriptionQuota): Promise<void> {
  if (!accountId) return;
  await updateOAuthAccountQuotaCache(provider, accountId, {
    success: quota.success,
    tiers: quota.tiers,
    error: quota.error,
    queriedAt: quota.queriedAt,
  }).catch(() => {});
}

async function getSavedAccountAccessToken(provider: string, credential: StoredOAuthCredential): Promise<string | undefined> {
  if (provider !== "openai-codex") return undefined;
  const result = await getOAuthApiKey("openai-codex", { "openai-codex": credential });
  if (!result?.apiKey) return undefined;
  await saveOAuthAccountCredential(provider, { type: "oauth", ...result.newCredentials, accountId: credential.accountId }).catch(() => {});
  return result.apiKey;
}

export async function getOAuthProviderSubscriptionQuota(provider: string): Promise<SubscriptionQuota> {
  if (provider !== "openai-codex") return quotaNotFound(provider);

  const authStorage = AuthStorage.create();
  const storedCredential = authStorage.get(provider) as StoredOAuthCredential | undefined;
  if (storedCredential?.type !== "oauth") return quotaNotFound(provider);

  let accessToken: string | undefined;
  try {
    accessToken = await authStorage.getApiKey(provider, { includeFallback: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return quotaError(provider, "expired", message);
  }

  if (!accessToken) return quotaError(provider, "expired", "OAuth token unavailable. Please re-login.");

  const refreshedCredential = authStorage.get(provider) as StoredOAuthCredential | undefined;
  await syncActiveOAuthAccountCredential(provider, authStorage).catch(() => {});
  const accountId = refreshedCredential?.accountId ?? storedCredential.accountId ?? extractOpenAICodexAccountId(accessToken);

  try {
    const quota = await queryOpenAICodexQuota(accessToken, accountId);
    await cacheAccountQuota(provider, accountId, quota);
    return quota;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const quota = quotaError(provider, "valid", `Network error: ${message}`);
    await cacheAccountQuota(provider, accountId, quota);
    return quota;
  }
}

export async function getOAuthAccountSubscriptionQuota(provider: string, accountId: string): Promise<SubscriptionQuota> {
  if (provider !== "openai-codex") return quotaNotFound(provider);

  let credential: Awaited<ReturnType<typeof readOAuthAccountCredential>>;
  try {
    credential = await readOAuthAccountCredential(provider, accountId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return quotaError(provider, "not_found", message);
  }

  let accessToken: string | undefined;
  try {
    accessToken = await getSavedAccountAccessToken(provider, credential);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const quota = quotaError(provider, "expired", message);
    await cacheAccountQuota(provider, credential.accountId, quota);
    return quota;
  }

  if (!accessToken) {
    const quota = quotaError(provider, "expired", "OAuth token unavailable. Please re-login.");
    await cacheAccountQuota(provider, credential.accountId, quota);
    return quota;
  }

  try {
    const quota = await queryOpenAICodexQuota(accessToken, credential.accountId);
    await cacheAccountQuota(provider, credential.accountId, quota);
    return quota;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const quota = quotaError(provider, "valid", `Network error: ${message}`);
    await cacheAccountQuota(provider, credential.accountId, quota);
    return quota;
  }
}
