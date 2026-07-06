import { NextResponse } from "next/server";
import { getBrowserShareManager } from "@/lib/browser-share-manager";
import type { BrowserShareCommandResult } from "@/lib/browser-share-types";

function publicError(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to record browser share command result";
}

export async function POST(req: Request, { params }: { params: Promise<{ commandId: string }> }) {
  const { commandId } = await params;
  try {
    const body = await req.json() as Partial<BrowserShareCommandResult>;
    if (typeof body.ok !== "boolean") {
      return NextResponse.json({ error: "ok boolean is required" }, { status: 400 });
    }
    const command = getBrowserShareManager().recordCommandResult(commandId, {
      ok: body.ok,
      message: typeof body.message === "string" ? body.message : undefined,
      snapshot: body.snapshot,
    });
    return NextResponse.json(command);
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: 400 });
  }
}
