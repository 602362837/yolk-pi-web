import { NextResponse } from "next/server";
import {
  PiWebConfigValidationError,
  readPiWebConfigForApi,
  writePiWebConfigPatch,
} from "@/lib/pi-web-config";
import { ensureOpenAICodexWarmupScheduler } from "@/lib/openai-codex-warmup-scheduler";
import { ensureChatGptUsageRefreshScheduler } from "@/lib/chatgpt-usage-refresh-scheduler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  ensureOpenAICodexWarmupScheduler();
  const result = readPiWebConfigForApi();
  if (result.config.chatgpt.autoRefreshEnabled) await ensureChatGptUsageRefreshScheduler();
  return NextResponse.json(result);
}

export async function PUT(req: Request) {
  try {
    const body = await req.json().catch(() => ({})) as { yolk?: unknown; worktree?: unknown; trellis?: unknown; studio?: unknown; usage?: unknown; terminal?: unknown; chatgpt?: unknown; opencodeGo?: unknown; grok?: unknown; kiro?: unknown; antigravity?: unknown; editor?: unknown };
    const result = writePiWebConfigPatch(body);
    ensureOpenAICodexWarmupScheduler();
    await ensureChatGptUsageRefreshScheduler(true);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof PiWebConfigValidationError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
