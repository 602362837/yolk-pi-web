import { NextResponse } from "next/server";
import { getBrowserShareManager } from "@/lib/browser-share-manager";

export async function DELETE(req: Request, { params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await params;
  let reason = "Browser share was stopped by the extension";
  try {
    const body = await req.json() as { reason?: unknown };
    if (typeof body.reason === "string" && body.reason.trim()) reason = body.reason.trim();
  } catch {
    // DELETE callers may omit a body; keep the default user-facing reason.
  }
  const share = getBrowserShareManager().stopShareFromExtension(shareId, reason);
  return NextResponse.json({ share }, { headers: { "Cache-Control": "no-store" } });
}
