import { NextResponse } from "next/server";
import {
  archiveSessionFile,
  invalidateSessionPathCache,
  resolveSessionPath,
} from "@/lib/session-reader";
import { getRpcSession } from "@/lib/rpc-manager";
import { readSessionHeaderFromFile } from "@/lib/session-project-link";
import { removeProjectSpaceSessionByHeader } from "@/lib/project-space-session-lifecycle";

export async function POST(req: Request) {
  try {
    const { sessionIds } = (await req.json()) as { sessionIds: string[] };
    if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
      return NextResponse.json({ error: "sessionIds must be a non-empty array" }, { status: 400 });
    }

    const archived: Array<{ id: string; path: string }> = [];
    const errors: Array<{ id: string; error: string }> = [];

    for (const id of sessionIds) {
      try {
        const filePath = await resolveSessionPath(id);
        if (!filePath) {
          errors.push({ id, error: "Session not found" });
          continue;
        }
        if (filePath.includes("/sessions-archive/")) {
          errors.push({ id, error: "Session is already archived" });
          continue;
        }
        // Capture project/space before move so active index can drop the entry.
        let header: ReturnType<typeof readSessionHeaderFromFile> = null;
        try {
          header = readSessionHeaderFromFile(filePath);
        } catch {
          header = null;
        }
        // Destroy active RPC session if alive
        const rpc = getRpcSession(id);
        if (rpc?.isAlive()) {
          try { rpc.destroy(); } catch { /* ignore */ }
        }
        const newPath = archiveSessionFile(filePath);
        invalidateSessionPathCache(id);
        await removeProjectSpaceSessionByHeader({
          sessionId: id,
          header,
        });
        archived.push({ id, path: newPath });
      } catch (error) {
        errors.push({ id, error: String(error) });
      }
    }

    return NextResponse.json({ archived, errors });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
