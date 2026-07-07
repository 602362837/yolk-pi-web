import { NextResponse } from "next/server";
import { deleteTerminalCredential, getTerminalCredentialSummary, TerminalSshVaultError, updateTerminalCredential } from "@/lib/terminal-ssh-vault";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = error instanceof TerminalSshVaultError ? error.status : 500;
  const body: { error: string; references?: string[] } = { error: message };
  if (error instanceof TerminalSshVaultError && error.references) body.references = error.references;
  return NextResponse.json(body, { status });
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const credential = await getTerminalCredentialSummary(decodeURIComponent(id));
    return NextResponse.json({ credential });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({})) as unknown;
    const credential = await updateTerminalCredential(decodeURIComponent(id), body);
    return NextResponse.json({ credential });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const url = new URL(request.url);
    const credentials = await deleteTerminalCredential(decodeURIComponent(id), { force: url.searchParams.get("force") === "true" });
    return NextResponse.json({ credentials });
  } catch (error) {
    return errorResponse(error);
  }
}
