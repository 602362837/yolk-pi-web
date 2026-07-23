import {
  isManagedApiKeyProvider,
  getApiKeyProviderSummary,
} from "@/lib/api-key-accounts";
import { ANYROUTER_PROVIDER_ID } from "@/lib/anyrouter-config";
import { getLastAnyrouterProviderLoadError } from "@/lib/pi-provider-extensions";
import { getWebModelRuntime } from "@/lib/web-model-runtime";

export const dynamic = "force-dynamic";

// Providers that use OAuth — handled separately via /api/auth/providers
const OAUTH_PROVIDER_IDS = new Set(["anthropic", "github-copilot", "openai-codex"]);

const ANYROUTER_DISPLAY_NAME = "AnyRouter";

interface ProviderListItem {
  id: string;
  displayName: string;
  configured: boolean;
  source?: string;
  modelCount: number;
  authMode?: "managed_accounts" | "single";
  accountCount?: number;
  activeAccountDisplayName?: string | null;
  /**
   * Present only for the fixed AnyRouter entry when the runtime catalog did
   * not register models (0 models, config missing, or extension load failure).
   * Safe diagnostic only — never a path, key, or raw stack.
   */
  providerLoadError?: string | null;
}

export async function GET() {
  const runtime = await getWebModelRuntime();
  const all = runtime.getModels();

  // Deduplicate by provider, skip OAuth-only providers and custom providers (source=models_json_key)
  const seen = new Set<string>();
  const result: ProviderListItem[] = [];

  for (const m of all) {
    if (seen.has(m.provider)) continue;
    seen.add(m.provider);
    if (OAUTH_PROVIDER_IDS.has(m.provider)) continue;
    const status = runtime.getProviderAuthStatus(m.provider);
    // Skip providers whose key comes from models.json (those are custom providers)
    if (status.source === "models_json_key") continue;
    const providerMeta = runtime.getProvider(m.provider);
    const displayName =
      m.provider === ANYROUTER_PROVIDER_ID
        ? (providerMeta?.name ?? ANYROUTER_DISPLAY_NAME)
        : (providerMeta?.name ?? m.provider);
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
        // Prefer managed-account configured signal for AnyRouter so a source
        // legacy key / managed slot still shows as configured even when the
        // runtime catalog is empty.
        if (m.provider === ANYROUTER_PROVIDER_ID) {
          item.configured = summary.configured || status.configured;
        }
      }
    }

    if (m.provider === ANYROUTER_PROVIDER_ID) {
      item.providerLoadError = getLastAnyrouterProviderLoadError();
    }

    result.push(item);
  }

  // Recoverable fixed AnyRouter entry: always expose management UI even when
  // zero models or provider load failure prevents catalog registration.
  if (!seen.has(ANYROUTER_PROVIDER_ID)) {
    const status = runtime.getProviderAuthStatus(ANYROUTER_PROVIDER_ID);
    const summary = await getApiKeyProviderSummary(ANYROUTER_PROVIDER_ID);
    const providerMeta = runtime.getProvider(ANYROUTER_PROVIDER_ID);
    result.push({
      id: ANYROUTER_PROVIDER_ID,
      displayName: providerMeta?.name ?? ANYROUTER_DISPLAY_NAME,
      configured: summary?.configured ?? status.configured,
      source: status.source,
      modelCount: 0,
      authMode: "managed_accounts",
      accountCount: summary?.accountCount ?? 0,
      activeAccountDisplayName: summary?.activeAccountDisplayName ?? null,
      providerLoadError: getLastAnyrouterProviderLoadError(),
    });
  }

  return Response.json(
    { providers: result },
    { headers: { "Cache-Control": "no-store" } },
  );
}
