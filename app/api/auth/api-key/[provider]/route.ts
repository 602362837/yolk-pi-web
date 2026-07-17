import { NextResponse } from "next/server";
import { reloadRpcAuthState } from "@/lib/rpc-manager";
import {
  isManagedApiKeyProvider,
  getApiKeyProviderSummary,
  hasManagedApiKeyAccounts,
  listApiKeyAccounts,
  createApiKeyAccount,
  updateApiKeyAccount,
  activateApiKeyAccount,
  ApiKeyAccountStoreError,
} from "@/lib/api-key-accounts";
import { getWebCredentialStore } from "@/lib/web-credential-store";
import { getWebModelRuntime } from "@/lib/web-model-runtime";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ provider: string }> };

// GET /api/auth/api-key/[provider] — returns auth status (never returns the actual key).
// For managed-account providers (currently opencode-go, xai) the response is extended with
// authMode, accountCount, activeAccountId, and activeAccountDisplayName so
// consumers can detect managed mode without calling /api/auth/all-providers.
export async function GET(_req: Request, { params }: Params) {
  const { provider } = await params;
  const runtime = await getWebModelRuntime();
  const status = runtime.getProviderAuthStatus(provider);
  const providerMeta = runtime.getProvider(provider);
  const displayName = providerMeta?.name ?? provider;
  const models = runtime.getModels(provider).length;

  const base: Record<string, unknown> = {
    provider,
    displayName,
    configured: status.configured,
    source: status.source,
    models,
  };

  // Enrich managed-account providers with lightweight summary fields.
  // Does not trigger legacy import — the import is deferred until the
  // first call to the managed-accounts list / CRUD endpoints.
  if (isManagedApiKeyProvider(provider)) {
    const summary = await getApiKeyProviderSummary(provider);
    if (summary) {
      base.authMode = summary.authMode;
      base.accountCount = summary.accountCount;
      base.activeAccountId = summary.activeAccountId;
      base.activeAccountDisplayName = summary.activeAccountDisplayName;
    }
  }

  return NextResponse.json(base);
}

// POST /api/auth/api-key/[provider]  body: { apiKey: string }
//
// For single-key providers this continues to write directly to auth.json.
// For managed-account providers (currently opencode-go, xai) this preserves the legacy
// "replace current active key" semantics:
//   1. If an active managed account exists — update its secret in place.
//   2. If managed accounts exist but none is active — pick the most recent
//      account, update its secret, and activate it.
//   3. If no managed accounts exist yet — create a new account and activate it
//      (which also triggers legacy import if a legacy key exists in auth.json).
export async function POST(req: Request, { params }: Params) {
  const { provider } = await params;
  try {
    const { apiKey } = await req.json() as { apiKey?: string };
    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      return NextResponse.json({ error: "apiKey is required" }, { status: 400 });
    }
    const newKey = apiKey.trim();

    if (isManagedApiKeyProvider(provider)) {
      // Managed-account path: replace current active key (legacy compat).
      // listApiKeyAccounts triggers legacy import if needed.
      const list = await listApiKeyAccounts(provider);

      if (list.activeAccountId) {
        // Update existing active account's secret in place.
        await updateApiKeyAccount(provider, list.activeAccountId, { apiKey: newKey });
      } else if (list.accounts.length > 0) {
        // Accounts exist but no active — pick the first and activate.
        const first = list.accounts[0];
        await updateApiKeyAccount(provider, first.accountId, { apiKey: newKey });
        await activateApiKeyAccount(provider, first.accountId);
      } else {
        // No accounts at all — create one.
        await createApiKeyAccount(provider, {
          displayName: "API Key",
          apiKey: newKey,
          activate: true,
        });
      }

      return NextResponse.json({ success: true });
    }

    // Single-key provider: original behaviour via CredentialStore.
    const store = await getWebCredentialStore();
    await store.modify(provider, async () => ({ type: "api_key" as const, key: newKey }));
    await Promise.resolve(reloadRpcAuthState());
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ApiKeyAccountStoreError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/auth/api-key/[provider] — removes stored API key.
//
// For single-key providers this directly clears auth.json as before.
// For managed-account providers where accounts already exist, the endpoint
// returns 409 to prevent accidental bulk deletion.  Callers should use the
// provider-scoped managed-account delete endpoints instead.  When no managed
// accounts exist yet (pure legacy state), the legacy delete is still allowed.
export async function DELETE(_req: Request, { params }: Params) {
  const { provider } = await params;
  try {
    if (isManagedApiKeyProvider(provider)) {
      // Check for existing managed accounts *without* triggering legacy import.
      if (await hasManagedApiKeyAccounts(provider)) {
        return NextResponse.json(
          {
            error: "managed_accounts_enabled",
            message:
              `Provider "${provider}" uses managed API-key accounts. ` +
              "Remove individual accounts through the account management UI instead.",
          },
          { status: 409 },
        );
      }
      // No managed accounts exist yet — allow the legacy delete to clear
      // the auth.json single key directly.
    }

    const store = await getWebCredentialStore();
    await store.delete(provider);
    await Promise.resolve(reloadRpcAuthState());
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
