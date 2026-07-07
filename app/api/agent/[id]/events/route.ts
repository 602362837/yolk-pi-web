import { statSync } from "fs";
import { resolveSessionPath } from "@/lib/session-reader";
import { getRpcSession, startRpcSession } from "@/lib/rpc-manager";
import { readSessionHeaderFromFile } from "@/lib/session-project-link";
import type { SessionHeader, StudioChildSessionStatus } from "@/lib/types";
import { SessionManager } from "@earendil-works/pi-coding-agent";

export const dynamic = "force-dynamic";

const STUDIO_CHILD_ACTIVE_STATUSES = new Set<string>(["queued", "running"]);

function readSessionHeaderSafely(filePath: string): SessionHeader | null {
  try {
    return readSessionHeaderFromFile(filePath);
  } catch {
    return null;
  }
}

function isStudioChildTerminal(header: SessionHeader | null): boolean {
  const studioChild = header?.studioChild;
  if (!studioChild) return false;
  if (studioChild.finishedAt) return true;
  return Boolean(studioChild.status && !STUDIO_CHILD_ACTIVE_STATUSES.has(studioChild.status));
}

function createStudioChildAuditStream(req: Request, sessionId: string, filePath: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      let closed = false;
      let lastMtimeMs = 0;
      let lastSize = 0;
      let poll: ReturnType<typeof setInterval> | null = null;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let debounce: ReturnType<typeof setTimeout> | null = null;
      const encoder = new TextEncoder();

      const encode = (data: unknown) => {
        if (closed) return;
        try {
          const text = `data: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(text));
        } catch {
          cleanup();
        }
      };

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (poll) clearInterval(poll);
        if (heartbeat) clearInterval(heartbeat);
        if (debounce) clearTimeout(debounce);
        req.signal?.removeEventListener("abort", cleanup);
        try {
          controller.close();
        } catch {
          // The client may already have disconnected.
        }
      };

      const currentStat = () => {
        try {
          const stat = statSync(filePath);
          return { mtimeMs: stat.mtimeMs, size: stat.size };
        } catch {
          return null;
        }
      };

      const emitChanged = () => {
        if (closed) return;
        debounce = null;
        const stat = currentStat();
        const header = readSessionHeaderSafely(filePath);
        encode({
          type: "studio_child_audit_changed",
          sessionId,
          mtimeMs: stat?.mtimeMs,
          size: stat?.size,
          studioChildStatus: header?.studioChild?.status,
        });
        if (stat && !header) {
          debounce = setTimeout(emitChanged, 500);
          return;
        }
        if (!stat || isStudioChildTerminal(header)) {
          encode({
            type: "studio_child_audit_end",
            sessionId,
            status: (header?.studioChild?.status ?? (!stat ? "missing" : undefined)) as StudioChildSessionStatus | "missing" | undefined,
          });
          cleanup();
        }
      };

      const scheduleChanged = () => {
        if (closed || debounce) return;
        debounce = setTimeout(emitChanged, 150);
      };

      const initialStat = currentStat();
      if (initialStat) {
        lastMtimeMs = initialStat.mtimeMs;
        lastSize = initialStat.size;
      }

      // Studio child sessions are read-only audit views. This stream follows JSONL
      // file metadata only; it must not resume the child as a normal AgentSession.
      encode({ type: "connected", sessionId, mode: "studio_child_audit" });

      if (!initialStat || isStudioChildTerminal(readSessionHeaderSafely(filePath))) {
        scheduleChanged();
      } else {
        poll = setInterval(() => {
          const stat = currentStat();
          if (!stat) {
            scheduleChanged();
            return;
          }
          if (stat.mtimeMs !== lastMtimeMs || stat.size !== lastSize) {
            lastMtimeMs = stat.mtimeMs;
            lastSize = stat.size;
            scheduleChanged();
          }
        }, 1_000);
      }

      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(":\n\n"));
        } catch {
          cleanup();
        }
      }, 30_000);

      req.signal?.addEventListener("abort", cleanup);
    },
  });
}

function sseResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// GET /api/agent/[id]/events - SSE stream of agent events
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const filePath = await resolveSessionPath(id);
  if (!filePath) {
    return new Response("Session not found", { status: 404 });
  }

  const header = readSessionHeaderSafely(filePath);
  if (header?.studioChild) {
    return sseResponse(createStudioChildAuditStream(req, id, filePath));
  }

  // Fast path: already-running session
  let session = getRpcSession(id);
  if (!session || !session.isAlive()) {
    const cwd = header?.cwd ?? SessionManager.open(filePath).getHeader()?.cwd ?? process.cwd();
    try {
      ({ session } = await startRpcSession(id, filePath, cwd));
    } catch (error) {
      return new Response(`Failed to start agent: ${error}`, { status: 500 });
    }
  }

  const stream = new ReadableStream({
    start(controller) {
      const encode = (data: unknown) => {
        const text = `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(new TextEncoder().encode(text));
      };

      // Send initial connected event
      encode({ type: "connected", sessionId: id });

      const unsubscribe = session.onEvent((event) => {
        encode(event);
      });

      // Heartbeat every 30s to prevent server/proxy timeout (Next.js default ~120-150s)
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(":\n\n"));
        } catch {
          // controller already closed
        }
      }, 30_000);

      // Cleanup when client disconnects
      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        controller.close();
      };

      // Detect client disconnect via abort signal
      req.signal?.addEventListener("abort", cleanup);
    },
  });

  return sseResponse(stream);
}
