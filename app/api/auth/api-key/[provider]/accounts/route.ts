/**
 * Managed API-key accounts list and create endpoints.
 *
 * GET  /api/auth/api-key/[provider]/accounts  — list all saved accounts (masked only)
 * POST /api/auth/api-key/[provider]/accounts  — create a new account
 *
 * v1: only opencode-go is allowlisted for managed accounts.  Other providers
 *     receive a 400 error from the service layer.
 */

import { NextResponse } from "next/server";
import {
  listApiKeyAccounts,
  createApiKeyAccount,
  ApiKeyAccountStoreError,
} from "@/lib/api-key-accounts";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ provider: string }> };

function errorResponse(error: unknown): NextResponse {
  if (error instanceof ApiKeyAccountStoreError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Internal server error";
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET(_req: Request, { params }: Params) {
  const { provider } = await params;
  try {
    return NextResponse.json(await listApiKeyAccounts(provider));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: Request, { params }: Params) {
  const { provider } = await params;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const displayName =
      body.displayName != null ? String(body.displayName).trim() || "Unnamed account" : "Unnamed account";

    const description =
      body.description != null ? String(body.description) : undefined;

    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";

    const activate =
      body.activate !== undefined ? Boolean(body.activate) : undefined;

    return NextResponse.json(
      await createApiKeyAccount(provider, { displayName, description, apiKey, activate }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
