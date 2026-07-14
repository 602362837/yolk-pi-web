import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { ensureGrokBootstrapped } from "@/lib/pi-provider-extensions";

const DEEPSEEK_PROVIDER_ID = "deepseek";
const DEEPSEEK_BALANCE_URL = "https://api.deepseek.com/user/balance";
const DEEPSEEK_BALANCE_TIMEOUT_MS = 15_000;

export interface DeepSeekBalanceInfo {
  currency: string;
  totalBalance: string;
  grantedBalance: string;
  toppedUpBalance: string;
}

export interface DeepSeekBalanceResult {
  provider: string;
  configured: boolean;
  success: boolean;
  isAvailable: boolean | null;
  balanceInfos: DeepSeekBalanceInfo[];
  error: string | null;
  queriedAt: number | null;
}

interface DeepSeekBalanceApiInfo {
  currency?: unknown;
  total_balance?: unknown;
  granted_balance?: unknown;
  topped_up_balance?: unknown;
}

interface DeepSeekBalanceApiResponse {
  is_available?: unknown;
  balance_infos?: unknown;
}

/**
 * 将未知错误转换为可展示的短消息。
 *
 * @param error 捕获到的未知错误对象。
 * @returns 错误消息文本。
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 构造未配置 API Key 的余额结果。
 *
 * @param provider 当前查询的 provider 标识。
 * @returns 标准 DeepSeek 余额查询结果。
 */
function notConfiguredResult(provider: string): DeepSeekBalanceResult {
  return {
    provider,
    configured: false,
    success: false,
    isAvailable: null,
    balanceInfos: [],
    error: null,
    queriedAt: null,
  };
}

/**
 * 构造余额查询失败结果。
 *
 * @param provider 当前查询的 provider 标识。
 * @param configured 当前 provider 是否已配置 API Key。
 * @param message 失败原因。
 * @returns 标准 DeepSeek 余额查询结果。
 */
function errorResult(provider: string, configured: boolean, message: string): DeepSeekBalanceResult {
  return {
    provider,
    configured,
    success: false,
    isAvailable: null,
    balanceInfos: [],
    error: message,
    queriedAt: Date.now(),
  };
}

/**
 * 判断输入是否是普通对象。
 *
 * @param value 待判断的未知值。
 * @returns 如果输入是非数组对象则返回 true。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 将 DeepSeek 官方字段转换为前端使用的驼峰格式。
 *
 * @param info DeepSeek 官方余额条目。
 * @returns 前端展示使用的余额条目。
 */
function normalizeBalanceInfo(info: DeepSeekBalanceApiInfo): DeepSeekBalanceInfo {
  return {
    currency: typeof info.currency === "string" ? info.currency : "UNKNOWN",
    totalBalance: typeof info.total_balance === "string" ? info.total_balance : "0",
    grantedBalance: typeof info.granted_balance === "string" ? info.granted_balance : "0",
    toppedUpBalance: typeof info.topped_up_balance === "string" ? info.topped_up_balance : "0",
  };
}

/**
 * 解析 DeepSeek 官方余额响应。
 *
 * @param body DeepSeek 官方接口返回的 JSON。
 * @returns 规范化后的余额字段。
 */
function parseDeepSeekBalance(body: DeepSeekBalanceApiResponse): Pick<DeepSeekBalanceResult, "isAvailable" | "balanceInfos"> {
  const balanceInfos = Array.isArray(body.balance_infos)
    ? body.balance_infos
        .filter(isRecord)
        .map((info) => normalizeBalanceInfo(info))
    : [];

  return {
    isAvailable: typeof body.is_available === "boolean" ? body.is_available : null,
    balanceInfos,
  };
}

/**
 * 查询 DeepSeek 官方账号余额。
 *
 * @param provider 当前查询的 provider 标识，仅支持 deepseek。
 * @returns 脱敏后的余额查询结果。
 */
export async function getDeepSeekProviderBalance(provider: string): Promise<DeepSeekBalanceResult> {
  if (provider !== DEEPSEEK_PROVIDER_ID) {
    return errorResult(provider, false, `Unsupported provider: ${provider}`);
  }

  await ensureGrokBootstrapped();
  const authStorage = AuthStorage.create();
  const registry = ModelRegistry.create(authStorage);
  const status = registry.getProviderAuthStatus(provider);
  if (!status.configured) return notConfiguredResult(provider);

  let apiKey: string | undefined;
  try {
    apiKey = await registry.getApiKeyForProvider(provider);
  } catch (error) {
    return errorResult(provider, true, errorMessage(error));
  }

  if (!apiKey) return errorResult(provider, true, "DeepSeek API key unavailable.");

  try {
    const response = await fetch(DEEPSEEK_BALANCE_URL, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(DEEPSEEK_BALANCE_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const suffix = body ? `: ${body.slice(0, 300)}` : "";
      return errorResult(provider, true, `DeepSeek balance API error (HTTP ${response.status})${suffix}`);
    }

    const parsed = parseDeepSeekBalance((await response.json()) as DeepSeekBalanceApiResponse);
    return {
      provider,
      configured: true,
      success: true,
      isAvailable: parsed.isAvailable,
      balanceInfos: parsed.balanceInfos,
      error: null,
      queriedAt: Date.now(),
    };
  } catch (error) {
    return errorResult(provider, true, `Network error: ${errorMessage(error)}`);
  }
}
