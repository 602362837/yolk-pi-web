import { NextResponse } from "next/server";
import { closeTerminalSession } from "@/lib/terminal-manager";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  closeTerminalSession(id);
  return NextResponse.json({ success: true });
}
