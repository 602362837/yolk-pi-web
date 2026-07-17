import { consumeOAuthAccountResetCredit, consumeOAuthProviderResetCredit, getOAuthAccountSubscriptionQuota, getOAuthProviderSubscriptionQuota } from "@/lib/subscription-quota";
import { getGrokAccountSubscriptionQuota, getGrokActiveSubscriptionQuota, type GrokQuotaResultV1 } from "@/lib/grok-subscription-quota";
import { getKiroAccountSubscriptionQuota, getKiroActiveSubscriptionQuota, type KiroQuotaResultV1 } from "@/lib/kiro-subscription-quota";
import {
  getAntigravityAccountSubscriptionQuota,
  getAntigravityActiveSubscriptionQuota,
  type AntigravityQuotaResultV1,
} from "@/lib/antigravity-subscription-quota";
import { ANTIGRAVITY_PROVIDER_ID, GROK_CLI_PROVIDER_ID, KIRO_PROVIDER_ID } from "@/lib/oauth-account-providers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function accountIdFromBody(body: unknown): string | null {
  if (!isRecord(body) || typeof body.accountId !== "string") return null;
  const accountId = body.accountId.trim();
  return accountId ? accountId : null;
}

/**
 * 查询 OAuth provider 的官方订阅额度。
 *
 * - openai-codex: 返回 ChatGPT Codex SubscriptionQuota。
 * - grok-cli: 返回 GrokQuotaResultV1（月度+可选周额度，缓存状态，安全投影）。
 * - kiro: 返回 KiroQuotaResultV1（GetUsageLimits buckets，缓存状态，安全投影）。
 * - google-antigravity: 返回 AntigravityQuotaResultV1（按模型 remainingFraction，缓存状态，安全投影）。
 *
 * @param req 当前 HTTP 请求对象。
 * @param context Next.js 动态路由参数，包含 provider 标识。
 * @returns provider 的订阅额度 JSON。
 */
export async function GET(
  req: Request,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider } = await context.params;

  // ── Grok CLI ───────────────────────────────────────────────────────────
  if (provider === GROK_CLI_PROVIDER_ID) {
    const url = new URL(req.url);
    const accountId = url.searchParams.get("accountId")?.trim();
    const forceRefresh = url.searchParams.get("refresh") === "1";
    const result: GrokQuotaResultV1 = accountId
      ? await getGrokAccountSubscriptionQuota(accountId, { forceRefresh })
      : await getGrokActiveSubscriptionQuota({ forceRefresh });
    const status = result.success ? 200 : result.reauthRequired ? 401 : 502;
    return new Response(JSON.stringify(result), {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  }

  // ── Kiro ───────────────────────────────────────────────────────────────
  if (provider === KIRO_PROVIDER_ID) {
    const url = new URL(req.url);
    const accountId = url.searchParams.get("accountId")?.trim();
    const forceRefresh = url.searchParams.get("refresh") === "1";
    const result: KiroQuotaResultV1 = accountId
      ? await getKiroAccountSubscriptionQuota(accountId, { forceRefresh })
      : await getKiroActiveSubscriptionQuota({ forceRefresh });
    const status = result.success ? 200 : result.reauthRequired ? 401 : 502;
    return new Response(JSON.stringify(result), {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  }

  // ── Google Antigravity ─────────────────────────────────────────────────
  if (provider === ANTIGRAVITY_PROVIDER_ID) {
    const url = new URL(req.url);
    const accountId = url.searchParams.get("accountId")?.trim();
    const forceRefresh = url.searchParams.get("refresh") === "1";
    const result: AntigravityQuotaResultV1 = accountId
      ? await getAntigravityAccountSubscriptionQuota(accountId, { forceRefresh })
      : await getAntigravityActiveSubscriptionQuota({ forceRefresh });
    const status = result.success ? 200 : result.reauthRequired ? 401 : 502;
    return new Response(JSON.stringify(result), {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  }

  // ── OpenAI Codex / other ───────────────────────────────────────────────
  const accountId = new URL(req.url).searchParams.get("accountId");
  const quota = accountId?.trim()
    ? await getOAuthAccountSubscriptionQuota(provider, accountId)
    : await getOAuthProviderSubscriptionQuota(provider);
  return Response.json(quota);
}

/**
 * 消耗一个 OAuth provider 的 Codex rate-limit reset credit 并刷新订阅额度。
 *
 * grok-cli / kiro / google-antigravity 不支持 reset-credit 消费，POST 返回 405。
 *
 * @param req 当前 HTTP 请求对象，可包含可选 accountId。
 * @param context Next.js 动态路由参数，包含 provider 标识。
 * @returns 刷新后的订阅额度 JSON，失败时包含用户可见错误。
 */
export async function POST(
  req: Request,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider } = await context.params;

  // grok-cli does not support reset-credit consumption
  if (provider === GROK_CLI_PROVIDER_ID) {
    return Response.json(
      {
        kind: "grok_subscription_quota",
        schemaVersion: 1,
        success: false,
        provider: "grok-cli",
        accountId: "",
        error: {
          code: "upstream" as const,
          message: "Grok does not support reset-credit consumption. Use GET to view quota.",
          retryable: false,
        },
      },
      { status: 405 },
    );
  }

  // kiro does not support reset-credit consumption
  if (provider === KIRO_PROVIDER_ID) {
    return new Response(
      JSON.stringify({
        kind: "kiro_subscription_quota",
        schemaVersion: 1,
        success: false,
        provider: "kiro",
        accountId: "",
        buckets: [],
        cache: { state: "none", queriedAt: null, ageMs: null },
        reauthRequired: false,
        error: {
          code: "upstream" as const,
          message: "Kiro does not support reset-credit consumption. Use GET to view quota.",
          retryable: false,
        },
      }),
      {
        status: 405,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      },
    );
  }

  // google-antigravity does not support reset-credit consumption
  if (provider === ANTIGRAVITY_PROVIDER_ID) {
    return new Response(
      JSON.stringify({
        kind: "antigravity_subscription_quota",
        schemaVersion: 1,
        success: false,
        provider: "google-antigravity",
        accountId: "",
        models: [],
        cache: { state: "none", queriedAt: null, ageMs: null },
        reauthRequired: false,
        error: {
          code: "upstream" as const,
          message: "Antigravity does not support reset-credit consumption. Use GET to view quota.",
          retryable: false,
        },
      }),
      {
        status: 405,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      },
    );
  }

  const body = await req.json().catch(() => null) as unknown;
  const accountId = accountIdFromBody(body);
  const quota = accountId
    ? await consumeOAuthAccountResetCredit(provider, accountId)
    : await consumeOAuthProviderResetCredit(provider);
  return Response.json(quota, { status: quota.success ? 200 : 502 });
}
