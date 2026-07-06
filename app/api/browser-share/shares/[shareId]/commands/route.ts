import { NextResponse } from "next/server";
import { getBrowserShareManager } from "@/lib/browser-share-manager";

const MAX_WAIT_MS = 30_000;
const POLL_INTERVAL_MS = 500;

function parseWaitMs(req: Request): number {
  const url = new URL(req.url);
  const raw = url.searchParams.get("waitMs");
  if (!raw) return 0;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(Math.floor(parsed), MAX_WAIT_MS);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted || ms <= 0) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timeout);
      resolve();
    };
    const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function GET(req: Request, { params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await params;
  const manager = getBrowserShareManager();
  const waitMs = parseWaitMs(req);
  const deadline = Date.now() + waitMs;

  do {
    const commands = manager.listCommandsForShare(shareId, false);
    if (commands.length > 0 || Date.now() >= deadline || req.signal.aborted) {
      return NextResponse.json({ commands }, { headers: { "Cache-Control": "no-store" } });
    }
    await sleep(Math.min(POLL_INTERVAL_MS, deadline - Date.now()), req.signal);
  } while (Date.now() < deadline && !req.signal.aborted);

  return NextResponse.json({ commands: [] }, { headers: { "Cache-Control": "no-store" } });
}
