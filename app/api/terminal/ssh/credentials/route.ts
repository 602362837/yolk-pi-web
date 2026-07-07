import { NextResponse } from "next/server";
import { createTerminalCredential, listTerminalCredentials, TerminalSshVaultError } from "@/lib/terminal-ssh-vault";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = error instanceof TerminalSshVaultError ? error.status : 500;
  const body: { error: string; references?: string[] } = { error: message };
  if (error instanceof TerminalSshVaultError && error.references) body.references = error.references;
  return NextResponse.json(body, { status });
}

export async function GET() {
  try {
    const credentials = await listTerminalCredentials();
    return NextResponse.json({ credentials });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as unknown;
    const credential = await createTerminalCredential(body);
    return NextResponse.json({ credential }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
