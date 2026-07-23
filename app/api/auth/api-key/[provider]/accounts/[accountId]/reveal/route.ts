/**
 * Reveal the plaintext API key for a single account.
 *
 * POST /api/auth/api-key/[provider]/accounts/[accountId]/reveal
 *
 * Security boundaries:
 * - Only returns plaintext for the requested single account (no bulk reveal).
 * - Response includes `Cache-Control: no-store` to prevent browser / CDN caching.
 * - Error responses use generic messages; the API key is never embedded in
 *   error text, logs, or toast messages.
 * - The calling frontend must discard the plaintext when the settings panel
 *   closes, the provider is switched, or the page is refreshed.
 */

import { revealApiKeyAccount } from "@/lib/api-key-accounts";
import {
  apiKeyRouteErrorResponse,
  jsonNoStore,
} from "@/lib/api-key-route-helpers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ provider: string; accountId: string }> };

export async function POST(_req: Request, { params }: Params) {
  const { provider, accountId } = await params;
  try {
    const result = await revealApiKeyAccount(provider, accountId);
    return jsonNoStore(result);
  } catch (error) {
    // Security: ApiKeyAccountStoreError messages are generic (e.g. "Account not found")
    // and never contain the API key.  For unexpected errors we return an
    // opaque message to prevent any accidental secret leakage.
    return apiKeyRouteErrorResponse(error, "Reveal failed");
  }
}
