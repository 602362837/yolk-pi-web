import { NextResponse } from "next/server";
import { getBrowserShareManager } from "@/lib/browser-share-manager";
import type { BrowserShareRuntimeUpdate } from "@/lib/browser-share-types";

export async function POST(req: Request, { params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await params;
  try {
    const body = await req.json() as Partial<BrowserShareRuntimeUpdate>;
    const share = getBrowserShareManager().updateShareRuntime(shareId, body);
    return NextResponse.json({ share }, {
      status: share.detachRequested ? 410 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 400 });
  }
}
