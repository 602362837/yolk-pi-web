import { NextResponse } from "next/server";
import { getBrowserShareManager } from "@/lib/browser-share-manager";
import type { BrowserShareCommandResult } from "@/lib/browser-share-types";

export async function POST(req: Request, { params }: { params: Promise<{ commandId: string }> }) {
  const { commandId } = await params;
  try {
    const body = await req.json() as BrowserShareCommandResult;
    const command = getBrowserShareManager().recordCommandResult(commandId, { ok: body.ok === true, message: body.message, snapshot: body.snapshot });
    return NextResponse.json(command);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 400 });
  }
}
