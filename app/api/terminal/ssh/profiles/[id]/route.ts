import { NextResponse } from "next/server";
import { deleteTerminalSshProfile, getTerminalSshProfile, TerminalSshProfileError, updateTerminalSshProfile } from "@/lib/terminal-ssh-profiles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = error instanceof TerminalSshProfileError ? error.status : 500;
  return NextResponse.json({ error: message }, { status });
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const profile = getTerminalSshProfile(decodeURIComponent(id));
    return NextResponse.json({ profile });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({})) as unknown;
    const profile = updateTerminalSshProfile(decodeURIComponent(id), body);
    return NextResponse.json({ profile });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const profiles = deleteTerminalSshProfile(decodeURIComponent(id));
    return NextResponse.json({ profiles });
  } catch (error) {
    return errorResponse(error);
  }
}
