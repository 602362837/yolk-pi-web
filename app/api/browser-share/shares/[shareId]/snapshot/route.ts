import { NextResponse } from "next/server";
import { getBrowserShareManager } from "@/lib/browser-share-manager";
import type { BrowserSharePageSnapshot } from "@/lib/browser-share-types";

export async function POST(req: Request, { params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await params;
  try {
    const body = await req.json() as Partial<BrowserSharePageSnapshot>;
    const state = getBrowserShareManager().updateSnapshot(shareId, body);
    return NextResponse.json(state);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 400 });
  }
}
