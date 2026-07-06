import { NextResponse } from "next/server";
import { getBrowserShareManager } from "@/lib/browser-share-manager";

export async function POST(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  try {
    const body = await req.json() as { shareCode?: string };
    if (!body.shareCode) return NextResponse.json({ error: "shareCode is required" }, { status: 400 });
    const state = getBrowserShareManager().bindSession(sessionId, body.shareCode);
    return NextResponse.json(state);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const state = getBrowserShareManager().unbindSession(sessionId);
  return NextResponse.json(state);
}
