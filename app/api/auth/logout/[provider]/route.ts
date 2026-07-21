import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { clearOAuthActiveAccount, isSupportedOAuthAccountProvider } from "@/lib/oauth-accounts";
import { reloadRpcAuthState } from "@/lib/rpc-manager";
import { getWebModelRuntime } from "@/lib/web-model-runtime";

export const dynamic = "force-dynamic";

function providerHasOAuth(provider: { auth?: { oauth?: unknown } } | undefined): boolean {
  return Boolean(provider?.auth?.oauth);
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const runtime = await getWebModelRuntime({ agentDir: getAgentDir() });
  const providers = runtime.getProviders();
  if (!providers.find((p) => p.id === provider && providerHasOAuth(p))) {
    return Response.json({ error: `Unknown provider: ${provider}` }, { status: 400 });
  }
  await runtime.logout(provider);
  if (isSupportedOAuthAccountProvider(provider)) {
    await clearOAuthActiveAccount(provider);
  }
  await Promise.resolve(reloadRpcAuthState());
  return Response.json({ ok: true });
}
