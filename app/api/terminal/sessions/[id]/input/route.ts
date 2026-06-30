import { NextResponse } from "next/server";
import { TerminalError, writeTerminalInput } from "@/lib/terminal-manager";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const body = await req.json().catch(() => ({})) as { data?: unknown };
    writeTerminalInput(id, body.data);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof TerminalError ? error.status : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
