import { NextResponse } from "next/server";
import { getBrowserShareManager } from "@/lib/browser-share-manager";
import type { BrowserShareCreateRequest } from "@/lib/browser-share-types";

export async function POST(req: Request) {
  try {
    const body = await req.json() as Partial<BrowserShareCreateRequest>;
    if (!body.extensionInstanceId || !body.tab?.url || !body.tab?.title) {
      return NextResponse.json({ error: "extensionInstanceId and tab are required" }, { status: 400 });
    }
    const result = getBrowserShareManager().createShare(body as BrowserShareCreateRequest);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
