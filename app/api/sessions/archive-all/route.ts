import { NextResponse } from "next/server";
import {
  archiveSessionFile,
  invalidateSessionPathCache,
} from "@/lib/session-reader";
import { getRpcSession } from "@/lib/rpc-manager";
import { canonicalizeCwd, expandCwd } from "@/lib/cwd";
import { scanSessionInventory } from "@/lib/session-metadata-scanner";

function cwdKeys(cwd: string | undefined): Set<string> {
  const keys = new Set<string>();
  if (!cwd) return keys;
  for (const candidate of [cwd, expandCwd(cwd), canonicalizeCwd(cwd)]) {
    if (candidate) keys.add(candidate.replace(/[\\/]+$/, ""));
  }
  return keys;
}

function cwdMatchesAny(cwd: string | undefined, targets: Set<string>): boolean {
  for (const key of cwdKeys(cwd)) {
    if (targets.has(key)) return true;
  }
  return false;
}

export async function POST(req: Request) {
  try {
    const { cwd } = (await req.json()) as { cwd: string };
    if (!cwd) {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }

    const targets = cwdKeys(cwd);
    // Lightweight inventory — do not call SessionManager.listAll() (retains full message text).
    const allSessions = await scanSessionInventory();
    const targetSessions = allSessions.filter((session) => cwdMatchesAny(session.cwd, targets));

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
