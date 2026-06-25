import { AuthStorage } from "@earendil-works/pi-coding-agent";
import { OPENAI_CODEX_PROVIDER_ID, syncActiveOAuthAccountCredential } from "@/lib/oauth-accounts";

export const dynamic = "force-dynamic";

export async function GET() {
  const authStorage = AuthStorage.create();
  const providers = authStorage.getOAuthProviders();

  const EXCLUDED = new Set(["anthropic"]);
  const DISPLAY_NAMES: Record<string, string> = {
    "openai-codex": "ChatGPT Plus/Pro",
    "github-copilot": "GitHub Copilot",
  };

  const result = await Promise.all(
    providers
      .filter((p) => !EXCLUDED.has(p.id))
      .map(async (p) => {
        if (p.id === OPENAI_CODEX_PROVIDER_ID) {
          await syncActiveOAuthAccountCredential(p.id, authStorage).catch(() => {});
        }
        const loggedIn = authStorage.has(p.id);
        return {
          id: p.id,
          name: DISPLAY_NAMES[p.id] ?? p.name,
          usesCallbackServer: p.usesCallbackServer ?? false,
          loggedIn,
        };
      })
  );

  return Response.json({ providers: result });
}
