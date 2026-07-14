import { AuthStorage } from "@earendil-works/pi-coding-agent";
import { createGrokAwareModelRegistry } from "@/lib/pi-provider-extensions";
import {
  isManagedApiKeyProvider,
  getApiKeyProviderSummary,
} from "@/lib/api-key-accounts";

export const dynamic = "force-dynamic";

// Providers that use OAuth — handled separately via /api/auth/providers
const OAUTH_PROVIDER_IDS = new Set(["anthropic", "github-copilot", "openai-codex"]);

interface ProviderListItem {
  id: string;
  displayName: string;
  configured: boolean;
  source?: string;
  modelCount: number;
  authMode?: "managed_accounts" | "single";
  accountCount?: number;
  activeAccountDisplayName?: string | null;
}

export async function GET() {
  const authStorage = AuthStorage.create();
  const registry = await createGrokAwareModelRegistry(authStorage);
  const all = registry.getAll();

  // Deduplicate by provider, skip OAuth-only providers and custom providers (source=models_json_key)
  const seen = new Set<string>();
  const result: ProviderListItem[] = [];

  for (const m of all) {
    if (seen.has(m.provider)) continue;
    seen.add(m.provider);
    if (OAUTH_PROVIDER_IDS.has(m.provider)) continue;
    const status = registry.getProviderAuthStatus(m.provider);
    // Skip providers whose key comes from models.json (those are custom providers)
    if (status.source === "models_json_key") continue;
    const displayName = registry.getProviderDisplayName(m.provider);
    const modelCount = all.filter((x) => x.provider === m.provider).length;

    const item: ProviderListItem = {
      id: m.provider,
      displayName,
      configured: status.configured,
      source: status.source,
      modelCount,
    };

    // Include managed-account metadata for providers in the allowlist.
    // getApiKeyProviderSummary does not trigger legacy import, so this is
    // safe as a lightweight enrichment without side effects.
    if (isManagedApiKeyProvider(m.provider)) {
      const summary = await getApiKeyProviderSummary(m.provider);
      if (summary) {
        item.authMode = summary.authMode;
        item.accountCount = summary.accountCount;
        item.activeAccountDisplayName = summary.activeAccountDisplayName;
      }
    }

    result.push(item);
  }

  return Response.json({ providers: result });
}
