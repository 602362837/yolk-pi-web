import { getOAuthAccountSubscriptionQuota, getOAuthProviderSubscriptionQuota } from "@/lib/subscription-quota";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 查询 OAuth provider 的官方订阅额度。
 *
 * @param _req 当前 HTTP 请求对象。
 * @param context Next.js 动态路由参数，包含 provider 标识。
 * @returns provider 的订阅额度 JSON。
 */
export async function GET(
  req: Request,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider } = await context.params;
  const accountId = new URL(req.url).searchParams.get("accountId");
  const quota = accountId?.trim()
    ? await getOAuthAccountSubscriptionQuota(provider, accountId)
    : await getOAuthProviderSubscriptionQuota(provider);
  return Response.json(quota);
}
