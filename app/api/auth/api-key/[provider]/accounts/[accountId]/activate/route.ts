/**
 * Activate an API-key account for the provider.
 *
 * POST /api/auth/api-key/[provider]/accounts/[accountId]/activate
 *
 * Sets the account as active, mirrors its credential to auth.json (and for
 * AnyRouter rebuilds the Active runtime bridge), then reloads the RPC auth
 * state so live sessions pick up the new key. Success is only returned after
 * bridge/auth/reload completes.
 */

import { activateApiKeyAccount } from "@/lib/api-key-accounts";
import {
  apiKeyRouteErrorResponse,
  jsonNoStore,
} from "@/lib/api-key-route-helpers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ provider: string; accountId: string }> };

export async function POST(_req: Request, { params }: Params) {
  const { provider, accountId } = await params;
  try {
    return jsonNoStore(await activateApiKeyAccount(provider, accountId));
  } catch (error) {
    return apiKeyRouteErrorResponse(error, "Failed to activate account");
  }
}
