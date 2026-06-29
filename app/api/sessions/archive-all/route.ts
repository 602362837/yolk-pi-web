import { NextResponse } from "next/server";
import {
  archiveSessionFile,
  invalidateSessionPathCache,
} from "@/lib/session-reader";
import { getRpcSession } from "@/lib/rpc-manager";
import { canonicalizeCwd } from "@/lib/cwd";
import { SessionManager } from "@earendil-works/pi-coding-agent";

export async function POST(req: Request) {
  try {
    const { cwd } = (await req.json()) as { cwd: string };
    if (!cwd) {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }

    const resolvedCwd = canonicalizeCwd(cwd);
    // List all sessions and filter by cwd
    const allSessions = await SessionManager.listAll();
    const targetSessions = allSessions.filter((s) => {
      if (!s.cwd) return false;
      try {
        return canonicalizeCwd(s.cwd) === resolvedCwd;
      } catch {
        return false;
      }
    });

    const archived: Array<{ id: string; path: string }> = [];
    const errors: Array<{ id: string; error: string }> = [];

    for (const session of targetSessions) {
      try {
        // Destroy active RPC session if alive
        const rpc = getRpcSession(session.id);
        if (rpc?.isAlive()) {
          try { rpc.destroy(); } catch { /* ignore */ }
        }
        const newPath = archiveSessionFile(session.path);
        invalidateSessionPathCache(session.id);
        archived.push({ id: session.id, path: newPath });
      } catch (error) {
        errors.push({ id: session.id, error: String(error) });
      }
    }

    return NextResponse.json({ archived, errors });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
