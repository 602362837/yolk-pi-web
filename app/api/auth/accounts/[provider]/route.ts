import { listOAuthAccounts, OAuthAccountStoreError } from "@/lib/oauth-accounts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;

  try {
    return Response.json(await listOAuthAccounts(provider));
  } catch (error) {
    const status = error instanceof OAuthAccountStoreError ? error.status : 500;
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status });
  }
}
