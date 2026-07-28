import {
  isManagedApiKeyProvider,
  getApiKeyProviderSummary,
} from "@/lib/api-key-accounts";
import { ANYROUTER_PROVIDER_ID } from "@/lib/anyrouter-config";
import { getLastAnyrouterProviderLoadError } from "@/lib/pi-provider-extensions";
import { getWebModelRuntime } from "@/lib/web-model-runtime";

export const dynamic = "force-dynamic";

// Providers that use OAuth — handled separately via /api/auth/providers.
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
  providerLoadError?: string | null;
}

export async function GET() {
  const runtime = await getWebModelRuntime();
  const models = runtime.getModels();
  const firstModelByProvider = new Map<string, typeof models[number]>();
  const modelCountByProvider = new Map<string, number>();
  for (const model of models) {
    if (!firstModelByProvider.has(model.provider)) firstModelByProvider.set(model.provider, model);
    modelCountByProvider.set(model.provider, (modelCountByProvider.get(model.provider) ?? 0) + 1);
  }

  const providerIds = [...firstModelByProvider.keys()].filter((id) => {
    if (OAUTH_PROVIDER_IDS.has(id)) return false;
    return runtime.getProviderAuthStatus(id).source !== "models_json_key";
  });
  // Account summaries are metadata-only and independent, so never serialize
  // their filesystem reads behind a provider/catalog loop.
  const summaries = new Map(await Promise.all(providerIds
    .filter((id) => isManagedApiKeyProvider(id))
    .map(async (id) => [id, await getApiKeyProviderSummary(id)] as const)));

  const result: ProviderListItem[] = providerIds.map((id) => {
    const model = firstModelByProvider.get(id)!;
    const status = runtime.getProviderAuthStatus(id);
    const summary = summaries.get(id);
    const providerMeta = runtime.getProvider(id);
    const item: ProviderListItem = {
      id,
      displayName: id === ANYROUTER_PROVIDER_ID
        ? (providerMeta?.name ?? ANYROUTER_DISPLAY_NAME)
        : (providerMeta?.name ?? model.provider),
      configured: id === ANYROUTER_PROVIDER_ID
        ? Boolean(summary?.configured || status.configured)
        : status.configured,
      source: status.source,
      modelCount: modelCountByProvider.get(id) ?? 0,
    };
    if (summary) {
      item.authMode = summary.authMode;
      item.accountCount = summary.accountCount;
      item.activeAccountDisplayName = summary.activeAccountDisplayName;
    }
    if (id === ANYROUTER_PROVIDER_ID) item.providerLoadError = getLastAnyrouterProviderLoadError();
    return item;
  });

  if (!firstModelByProvider.has(ANYROUTER_PROVIDER_ID)) {
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
  return Response.json({ providers: result }, { headers: { "Cache-Control": "no-store" } });
}
