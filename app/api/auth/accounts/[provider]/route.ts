import { deleteOAuthAccount, importOAuthAccountCredential, listOAuthAccounts, OAuthAccountStoreError, type OAuthAccountImportMode, updateOAuthAccountLabel } from "@/lib/oauth-accounts";

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

  if (body.mode !== "raw" && body.mode !== "cpa" && body.mode !== "sub2api") {
    return Response.json({ error: "mode must be raw, cpa, or sub2api" }, { status: 400 });
  }

  try {
    return Response.json(await importOAuthAccountCredential(provider, body.mode as OAuthAccountImportMode, body.credential));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  const body = await req.json().catch(() => ({})) as { accountId?: unknown; label?: unknown };

  if (typeof body.accountId !== "string" || !body.accountId.trim()) {
    return Response.json({ error: "accountId is required" }, { status: 400 });
  }

  try {
    return Response.json(await updateOAuthAccountLabel(provider, body.accountId, body.label));
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
    return Response.json(await deleteOAuthAccount(provider, body.accountId));
  } catch (error) {
    return errorResponse(error);
  }
}
