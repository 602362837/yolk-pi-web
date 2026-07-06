import { NextResponse } from "next/server";
import { getBrowserShareManager } from "@/lib/browser-share-manager";

export async function GET(req: Request, { params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await params;
  const url = new URL(req.url);
  const includePendingApproval = url.searchParams.get("includePendingApproval") === "1";
  return NextResponse.json({ commands: getBrowserShareManager().listCommandsForShare(shareId, includePendingApproval) });
}
