/**
 * Managed API-key accounts list and create endpoints.
 *
 * GET  /api/auth/api-key/[provider]/accounts  — list all saved accounts (masked only)
 * POST /api/auth/api-key/[provider]/accounts  — create a new account
 *
 * Managed-account providers (opencode-go, xai, anyrouter) are allowlisted in
 * lib/api-key-accounts.ts.  Other providers receive a 400 from the service layer.
 *
 * AnyRouter accepts optional account-level `baseUrlOverride`. List responses
 * never include apiKey / fingerprint.
 */

import {
  listApiKeyAccounts,
  createApiKeyAccount,
} from "@/lib/api-key-accounts";
import {
  assertBodyAllowlist,
  apiKeyRouteErrorResponse,
  jsonNoStore,
  readJsonObjectBody,
} from "@/lib/api-key-route-helpers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ provider: string }> };

const CREATE_ALLOWED_KEYS = new Set([
  "displayName",
  "description",
  "apiKey",
  "activate",
  "baseUrlOverride",
]);

export async function GET(_req: Request, { params }: Params) {
  const { provider } = await params;
  try {
    return jsonNoStore(await listApiKeyAccounts(provider));
  } catch (error) {
    return apiKeyRouteErrorResponse(error, "Failed to list accounts");
  }
}

export async function POST(req: Request, { params }: Params) {
  const { provider } = await params;
  try {
    const body = await readJsonObjectBody(req, { allowEmpty: true });
    assertBodyAllowlist(body, CREATE_ALLOWED_KEYS, "create account body");

    const displayName =
      body.displayName != null ? String(body.displayName).trim() || "Unnamed account" : "Unnamed account";

    const description =
      body.description != null ? String(body.description) : undefined;

    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";

    const activate =
      body.activate !== undefined ? Boolean(body.activate) : undefined;

    const hasBaseUrlOverride = Object.prototype.hasOwnProperty.call(body, "baseUrlOverride");
    const baseUrlOverride = hasBaseUrlOverride
      ? (body.baseUrlOverride as string | null)
      : undefined;

    return jsonNoStore(
      await createApiKeyAccount(provider, {
        displayName,
        description,
        apiKey,
        activate,
        ...(hasBaseUrlOverride ? { baseUrlOverride } : {}),
      }),
    );
  } catch (error) {
    return apiKeyRouteErrorResponse(error, "Failed to create account");
  }
}
