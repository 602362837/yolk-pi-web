import { NextResponse } from "next/server";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { getAllowedRoots, isPathAllowed } from "@/lib/allowed-roots";
import { readPiWebConfig } from "@/lib/pi-web-config";
import { resolveSessionPath } from "@/lib/session-reader";
import { resolveTrellisTaskForSession } from "@/lib/trellis-session-link";
import { TrellisReaderSecurityError } from "@/lib/trellis-reader";
import type { SessionEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const config = readPiWebConfig();
    if (!config.trellis.enabled) {
      return NextResponse.json({ error: "Trellis panel is disabled" }, { status: 403 });
    }

    const { id } = await params;
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const session = SessionManager.open(filePath);
    const header = session.getHeader();
    const cwd = header?.cwd;
    if (!cwd) {
      return NextResponse.json({ task: null, reason: "no-workspace" });
    }

    const allowedRoots = await getAllowedRoots();
    if (!isPathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const entries = session.getEntries() as unknown as SessionEntry[];
    const result = resolveTrellisTaskForSession({
      cwd,
      sessionId: id,
      sessionFilePath: filePath,
      entries,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof TrellisReaderSecurityError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
