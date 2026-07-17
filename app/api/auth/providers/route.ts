import { createAgentSessionServices, getAgentDir } from "@earendil-works/pi-coding-agent";
import { isSupportedOAuthAccountProvider, listOAuthAccounts, syncActiveOAuthAccountCredential } from "@/lib/oauth-accounts";
import { webExtensionFactories } from "@/lib/pi-provider-extensions";

export const dynamic = "force-dynamic";

export async function GET() {
  const services = await createAgentSessionServices({
    cwd: process.cwd(),
    agentDir: getAgentDir(),
    resourceLoaderOptions: { extensionFactories: webExtensionFactories() },
  });
  const authStorage = services.authStorage;
  const providers = authStorage.getOAuthProviders();

  const EXCLUDED = new Set(["anthropic"]);
  const DISPLAY_NAMES: Record<string, string> = {
    "openai-codex": "ChatGPT Plus/Pro",
    "github-copilot": "GitHub Copilot",
    "grok-cli": "Grok CLI (SuperGrok / X Premium)",
    kiro: "Kiro (Builder ID / Google / GitHub)",
    "google-antigravity": "Antigravity (Gemini 3, Claude, GPT-OSS)",
  };

  const result = await Promise.all(
    providers
      .filter((p) => !EXCLUDED.has(p.id))
      .map(async (p) => {
        let authMode: "managed_accounts" | undefined;
        let accountCount = 0;
        let activeAccountDisplayName: string | null = null;

        if (isSupportedOAuthAccountProvider(p.id)) {
          await syncActiveOAuthAccountCredential(p.id, authStorage).catch(() => {});
          try {
            const accounts = await listOAuthAccounts(p.id);
            accountCount = accounts.accounts.length;
            activeAccountDisplayName = accounts.accounts.find((a) => a.active)?.displayName ?? null;
            authMode = "managed_accounts";
          } catch {
            // Account store not initialized yet; fall through to single-auth mode.
          }
        }
        const loggedIn = authStorage.has(p.id);
        const base = {
          id: p.id,
          name: DISPLAY_NAMES[p.id] ?? p.name,
          usesCallbackServer: p.usesCallbackServer ?? false,
          loggedIn,
        };
        if (authMode) {
          return { ...base, authMode, accountCount, activeAccountDisplayName };
        }
        return base;
      })
  );

  return Response.json({ providers: result });
}
