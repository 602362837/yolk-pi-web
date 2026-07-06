import { NextResponse } from "next/server";
import { getBrowserShareManager } from "@/lib/browser-share-manager";

export async function POST(req: Request, { params }: { params: Promise<{ sessionId: string; commandId: string }> }) {
  const { sessionId, commandId } = await params;
  try {
    const body = await req.json() as { approved?: boolean };
    const command = getBrowserShareManager().approveCommand(sessionId, commandId, body.approved === true);
    return NextResponse.json(command);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 400 });
  }
}
