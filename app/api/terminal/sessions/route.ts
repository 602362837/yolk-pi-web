import { NextResponse } from "next/server";
import { createTerminalSession, TerminalError, type CreateTerminalSessionInput } from "@/lib/terminal-manager";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({})) as CreateTerminalSessionInput;
    const session = await createTerminalSession(body);
    return NextResponse.json({ session });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof TerminalError ? error.status : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
