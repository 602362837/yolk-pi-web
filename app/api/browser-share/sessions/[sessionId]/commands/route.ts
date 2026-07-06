import { NextResponse } from "next/server";
import { getBrowserShareManager } from "@/lib/browser-share-manager";
import type { BrowserShareCommandType } from "@/lib/browser-share-types";

const COMMAND_TYPES = new Set<BrowserShareCommandType>(["click", "type", "scroll", "navigate"]);

export async function POST(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  try {
    const body = await req.json() as { type?: BrowserShareCommandType; elementId?: string; text?: string; url?: string; deltaX?: number; deltaY?: number; reason?: string };
    if (!body.type || !COMMAND_TYPES.has(body.type)) return NextResponse.json({ error: "Valid command type is required" }, { status: 400 });
    const command = getBrowserShareManager().enqueueCommand(sessionId, body.type, body);
    return NextResponse.json(command);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 400 });
  }
}
