import { NextResponse } from "next/server";
import { getBrowserShareManager } from "@/lib/browser-share-manager";

export async function GET(_req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return NextResponse.json(getBrowserShareManager().getSessionState(sessionId));
}
