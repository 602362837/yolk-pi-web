import { createAgentSessionServices, getAgentDir } from "@earendil-works/pi-coding-agent";
import { reloadRpcAuthState } from "@/lib/rpc-manager";
import { webExtensionFactories } from "@/lib/pi-provider-extensions";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const services = await createAgentSessionServices({
    cwd: process.cwd(),
    agentDir: getAgentDir(),
    resourceLoaderOptions: { extensionFactories: webExtensionFactories() },
  });
  const authStorage = services.authStorage;
  const providers = authStorage.getOAuthProviders();
  if (!providers.find((p) => p.id === provider)) {
    return Response.json({ error: `Unknown provider: ${provider}` }, { status: 400 });
  }
  authStorage.logout(provider);
  reloadRpcAuthState();
  return Response.json({ ok: true });
}
