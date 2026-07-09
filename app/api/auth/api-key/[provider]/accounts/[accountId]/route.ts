/**
 * Managed API-key single-account update, enable, disable, and delete endpoints.
 *
 * PATCH  /api/auth/api-key/[provider]/accounts/[accountId]  — update display name, description,
 *         replace key, or action-based enable/disable.
 * DELETE /api/auth/api-key/[provider]/accounts/[accountId]  — delete an account
 *
 * PATCH actions:
 *   { action: "enable" } — enable a disabled account so it can be activated again.
 *   { action: "disable", reason?, replacementAccountId?, clearActive? } — disable an account.
 *     If the account is currently active, a replacementAccountId or explicit clearActive
 *     must be provided; otherwise a 409 error is returned.
 *
 * Deleting the active account triggers automatic fallback activation (see
 * lib/api-key-accounts.ts).  Deleting the last account disconnects the provider.
 */

import { NextResponse } from "next/server";
import {
  updateApiKeyAccount,
  deleteApiKeyAccount,
  enableApiKeyAccount,
  disableApiKeyAccount,
  ApiKeyAccountStoreError,
} from "@/lib/api-key-accounts";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ provider: string; accountId: string }> };

function errorResponse(error: unknown): NextResponse {
  if (error instanceof ApiKeyAccountStoreError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Internal server error";
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function PATCH(req: Request, { params }: Params) {
  const { provider, accountId } = await params;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    // Action-based enable / disable
    if (body.action === "enable") {
      return NextResponse.json(await enableApiKeyAccount(provider, accountId));
    }
    if (body.action === "disable") {
      return NextResponse.json(
        await disableApiKeyAccount(provider, accountId, {
          reason: typeof body.reason === "string" ? body.reason.trim() : undefined,
          disabledBy: body.disabledBy === "system" ? "system" : "user",
          autoDisabledReason: body.autoDisabledReason === "account_unusable" ? "account_unusable" : undefined,
          replacementAccountId:
            typeof body.replacementAccountId === "string"
              ? body.replacementAccountId.trim()
              : undefined,
          clearActive: body.clearActive === true ? true : undefined,
        }),
      );
    }

    // Legacy field-based update
    const input: Record<string, string | undefined> = {};
    if (body.displayName !== undefined) input.displayName = String(body.displayName);
    if (body.description !== undefined) input.description = String(body.description);
    if (body.apiKey !== undefined) input.apiKey = String(body.apiKey);

    return NextResponse.json(await updateApiKeyAccount(provider, accountId, input));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const { provider, accountId } = await params;
  try {
    return NextResponse.json(await deleteApiKeyAccount(provider, accountId));
  } catch (error) {
    return errorResponse(error);
  }
}
