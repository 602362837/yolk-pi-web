import { join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { bootstrapOAuthActiveAccountCredential } from "@/lib/oauth-accounts";
import {
  projectLocalOAuthProviderSummary,
  verifyProviderAuth,
} from "@/lib/models-provider-auth-summary";
import { getWebModelRuntime } from "@/lib/web-model-runtime";

export const dynamic = "force-dynamic";

const EXCLUDED = new Set(["anthropic"]);
const DISPLAY_NAMES: Record<string, string> = {
  "openai-codex": "ChatGPT Plus/Pro",
  "github-copilot": "GitHub Copilot",
  "grok-cli": "Grok CLI (SuperGrok / X Premium)",
  kiro: "Kiro (Builder ID / Google / GitHub)",
  "google-antigravity": "Antigravity (Gemini 3, Claude, GPT-OSS)",
};

function providerHasOAuth(provider: { auth?: { oauth?: unknown } } | undefined): boolean {
  return Boolean(provider?.auth?.oauth);
}

function runtimeKey(agentDir: string): string {
  // Mirror the administrative runtime identity. This stays server-only; the
  // browser receives only process-salted revision tokens.
  return `${resolve(agentDir)}\u0000${resolve(join(agentDir, "models.json"))}`;
}

export async function GET(req: Request) {
  const agentDir = getAgentDir();
  const runtime = await getWebModelRuntime({ agentDir });
  const providers = runtime.getProviders().filter((provider) => providerHasOAuth(provider) && !EXCLUDED.has(provider.id));
  const mode = new URL(req.url).searchParams.get("mode");

  if (mode === "summary") {
    const result = await Promise.all(providers.map(async (provider) => {
      const summary = await projectLocalOAuthProviderSummary(runtime, provider, { agentDir });
      return { ...summary, name: DISPLAY_NAMES[provider.id] ?? summary.name };
    }));
    return Response.json({ providers: result }, { headers: { "Cache-Control": "no-store" } });
  }

  if (mode === "verify") {
    // Verify receives a fresh local projection so its revision is the exact
    // state being checked. Each provider failure is contained in its own safe
    // verification result rather than failing/clearing the whole catalog.
    const summaries = await Promise.all(providers.map((provider) => projectLocalOAuthProviderSummary(runtime, provider, { agentDir })));
    const result = await Promise.all(summaries.map((summary) => verifyProviderAuth(
      runtimeKey(agentDir), runtime, summary.id, summary.localStateRevision,
    ).then((verification) => ({ id: summary.id, verification }))));
    return Response.json({ providers: result }, { headers: { "Cache-Control": "no-store" } });
  }

  // Preserve the legacy endpoint semantics for callers that do not opt into
  // two-stage Models loading: bootstrap historical managed Active credentials,
  // then perform the full auth check.
  const result = await Promise.all(providers.map(async (provider) => {
    await bootstrapOAuthActiveAccountCredential(provider.id).catch(() => {});
    const summary = await projectLocalOAuthProviderSummary(runtime, provider, { agentDir });
    let loggedIn = false;
    try {
      loggedIn = Boolean(await runtime.checkAuth(provider.id));
    } catch {
      const status = runtime.getProviderAuthStatus(provider.id);
      loggedIn = status.configured === true && status.source === "stored";
    }
    return { ...summary, name: DISPLAY_NAMES[provider.id] ?? summary.name, loggedIn };
  }));
  return Response.json({ providers: result }, { headers: { "Cache-Control": "no-store" } });
}
