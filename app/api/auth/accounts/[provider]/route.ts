import { isOAuthAccountImportMode } from "@/lib/oauth-account-converters";
import { invalidateProviderVerification } from "@/lib/models-provider-auth-summary";
import { bootstrapOAuthActiveAccountCredential, deleteOAuthAccount, importOAuthAccountCredential, listOAuthAccounts, OAuthAccountStoreError, updateOAuthAccountMetadata } from "@/lib/oauth-accounts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorResponse(error: unknown): Response {
  const status = error instanceof OAuthAccountStoreError ? error.status : 500;
  const message = error instanceof Error ? error.message : String(error);
  return Response.json({ error: message }, { status });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;

  try {
    await bootstrapOAuthActiveAccountCredential(provider);
    return Response.json(await listOAuthAccounts(provider));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  const body = await req.json().catch(() => ({})) as { mode?: unknown; credential?: unknown };

  if (!isOAuthAccountImportMode(body.mode)) {
    return Response.json({ error: "mode must be raw, cpa, or sub2api" }, { status: 400 });
  }

  try {
    const result = await importOAuthAccountCredential(provider, body.mode, body.credential);
    invalidateProviderVerification(provider);
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  const body = await req.json().catch(() => ({})) as { accountId?: unknown; label?: unknown; extraInfo?: unknown };

  if (typeof body.accountId !== "string" || !body.accountId.trim()) {
    return Response.json({ error: "accountId is required" }, { status: 400 });
  }

  try {
    const updates: { label?: unknown; extraInfo?: unknown } = {};
    if ("label" in body) updates.label = body.label;
    if ("extraInfo" in body) updates.extraInfo = body.extraInfo;
    const result = await updateOAuthAccountMetadata(provider, body.accountId, updates);
    invalidateProviderVerification(provider);
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  const body = await req.json().catch(() => ({})) as { accountId?: unknown };

  if (typeof body.accountId !== "string" || !body.accountId.trim()) {
    return Response.json({ error: "accountId is required" }, { status: 400 });
  }

  try {
    const result = await deleteOAuthAccount(provider, body.accountId);
    invalidateProviderVerification(provider);
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
