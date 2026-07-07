import { NextResponse } from "next/server";
import { createTerminalSshProfile, listTerminalSshProfiles, TerminalSshProfileError } from "@/lib/terminal-ssh-profiles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = error instanceof TerminalSshProfileError ? error.status : 500;
  return NextResponse.json({ error: message }, { status });
}

export async function GET() {
  try {
    const { profiles, ssh } = listTerminalSshProfiles();
    return NextResponse.json({ profiles, ssh: { ...ssh, profiles } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as unknown;
    const profile = createTerminalSshProfile(body);
    return NextResponse.json({ profile }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
