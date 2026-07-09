/**
 * Managed API-key single-account update and delete endpoints.
 *
 * PATCH  /api/auth/api-key/[provider]/accounts/[accountId]  — update display name, description, or replace key
 * DELETE /api/auth/api-key/[provider]/accounts/[accountId]  — delete an account
 *
 * Deleting the active account triggers automatic fallback activation (see
 * lib/api-key-accounts.ts).  Deleting the last account disconnects the provider.
 */

import { NextResponse } from "next/server";
import {
  updateApiKeyAccount,
  deleteApiKeyAccount,
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
