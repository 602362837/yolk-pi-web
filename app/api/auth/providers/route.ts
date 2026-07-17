import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { isSupportedOAuthAccountProvider, listOAuthAccounts, syncActiveOAuthAccountCredential } from "@/lib/oauth-accounts";
import { getWebModelRuntime } from "@/lib/web-model-runtime";

export const dynamic = "force-dynamic";

function providerHasOAuth(provider: { auth?: { oauth?: unknown } } | undefined): boolean {
  return Boolean(provider?.auth?.oauth);
}

export async function GET() {
  const runtime = await getWebModelRuntime({ agentDir: getAgentDir() });
  const providers = runtime.getProviders().filter((p) => providerHasOAuth(p));

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
          await syncActiveOAuthAccountCredential(p.id).catch(() => {});
          try {
            const accounts = await listOAuthAccounts(p.id);
            accountCount = accounts.accounts.length;
            activeAccountDisplayName = accounts.accounts.find((a) => a.active)?.displayName ?? null;
            authMode = "managed_accounts";
          } catch {
            // Account store not initialized yet; fall through to single-auth mode.
          }
        }

        // Prefer async auth check (may refresh status); fall back to stored credential presence.
        let loggedIn = false;
        try {
          const check = await runtime.checkAuth(p.id);
          loggedIn = Boolean(check);
        } catch {
          const status = runtime.getProviderAuthStatus(p.id);
          loggedIn = status.configured === true && status.source === "stored";
        }

        // Historical wire field: extension oauth used to expose usesCallbackServer.
        // 0.80.10 Provider.auth.oauth no longer surfaces it publicly; default false.
        const usesCallbackServer =
          (p.auth?.oauth as { usesCallbackServer?: boolean } | undefined)?.usesCallbackServer ?? false;

        const base = {
          id: p.id,
          name: DISPLAY_NAMES[p.id] ?? p.name,
          usesCallbackServer,
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
