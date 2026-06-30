import { NextResponse } from "next/server";
import {
  PiWebConfigValidationError,
  readPiWebConfigForApi,
  writePiWebConfigPatch,
} from "@/lib/pi-web-config";
import { ensureChatGptUsageRefreshScheduler } from "@/lib/chatgpt-usage-refresh-scheduler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const result = readPiWebConfigForApi();
  if (result.config.chatgpt.autoRefreshEnabled) await ensureChatGptUsageRefreshScheduler();
  return NextResponse.json(result);
}

export async function PUT(req: Request) {
  try {
    const body = await req.json().catch(() => ({})) as { worktree?: unknown; trellis?: unknown; usage?: unknown; chatgpt?: unknown };
    const result = writePiWebConfigPatch(body);
    await ensureChatGptUsageRefreshScheduler(true);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof PiWebConfigValidationError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
