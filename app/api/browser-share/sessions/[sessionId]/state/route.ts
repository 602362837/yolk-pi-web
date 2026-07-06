import { NextResponse } from "next/server";
import { getBrowserShareManager } from "@/lib/browser-share-manager";

const STALE_AFTER_MS = 30_000;
const OFFLINE_AFTER_MS = 90_000;

function ageMs(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Date.now() - parsed;
}

function getConnectionStatus(bound: boolean, heartbeatAgeMs?: number): "active" | "stale" | "offline" | "disconnected" {
  if (!bound) return "disconnected";
  if (heartbeatAgeMs === undefined || heartbeatAgeMs <= STALE_AFTER_MS) return "active";
  if (heartbeatAgeMs <= OFFLINE_AFTER_MS) return "stale";
  return "offline";
}

export async function GET(_req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const state = getBrowserShareManager().getSessionState(sessionId);
  const lastHeartbeatAt = state.lastCommandPollAt ?? state.lastSeenAt;
  const heartbeatAgeMs = ageMs(lastHeartbeatAt);
  const connectionStatus = getConnectionStatus(state.bound, heartbeatAgeMs);

  return NextResponse.json({
    ...state,
    connection: {
      status: connectionStatus,
      lastHeartbeatAt,
      lastSeenAt: state.lastSeenAt,
      lastCommandPollAt: state.lastCommandPollAt,
      lastSnapshotAt: state.lastSnapshotAt,
      lastResultAt: state.lastResultAt,
      heartbeatAgeMs,
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
