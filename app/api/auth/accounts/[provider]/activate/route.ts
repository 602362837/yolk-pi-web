import { activateOAuthAccount, OAuthAccountStoreError } from "@/lib/oauth-accounts";
import { reloadRpcAuthState } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  const body = await req.json().catch(() => ({})) as { accountId?: unknown };

  if (typeof body.accountId !== "string" || !body.accountId.trim()) {
    return Response.json({ error: "accountId is required" }, { status: 400 });
  }

  try {
    const result = await activateOAuthAccount(provider, body.accountId);
    reloadRpcAuthState();
    return Response.json(result);
  } catch (error) {
    const status = error instanceof OAuthAccountStoreError ? error.status : 500;
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status });
  }
}
