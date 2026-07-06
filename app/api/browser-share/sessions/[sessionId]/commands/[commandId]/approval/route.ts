import { NextResponse } from "next/server";
import { getBrowserShareManager } from "@/lib/browser-share-manager";

function publicError(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to update browser share command approval";
}

export async function POST(req: Request, { params }: { params: Promise<{ sessionId: string; commandId: string }> }) {
  const { sessionId, commandId } = await params;
  try {
    const body = await req.json() as { approved?: unknown };
    if (typeof body.approved !== "boolean") {
      return NextResponse.json({ error: "approved boolean is required" }, { status: 400 });
    }
    const command = getBrowserShareManager().approveCommand(sessionId, commandId, body.approved);
    return NextResponse.json(command);
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: 400 });
  }
}
