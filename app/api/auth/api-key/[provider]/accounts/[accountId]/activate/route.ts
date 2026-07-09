/**
 * Activate an API-key account for the provider.
 *
 * POST /api/auth/api-key/[provider]/accounts/[accountId]/activate
 *
 * Sets the account as active, mirrors its credential to auth.json, and
 * reloads the RPC auth state so live sessions pick up the new key.
 */

import { NextResponse } from "next/server";
import { activateApiKeyAccount, ApiKeyAccountStoreError } from "@/lib/api-key-accounts";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ provider: string; accountId: string }> };

export async function POST(_req: Request, { params }: Params) {
  const { provider, accountId } = await params;
  try {
    return NextResponse.json(await activateApiKeyAccount(provider, accountId));
  } catch (error) {
    if (error instanceof ApiKeyAccountStoreError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
