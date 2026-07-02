import { NextResponse } from "next/server";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { getAllowedRoots, isPathAllowed } from "@/lib/allowed-roots";
import { resolveSessionPath } from "@/lib/session-reader";
import { resolveYpiStudioTaskForSession } from "@/lib/ypi-studio-session-link";
import { YpiStudioTaskSecurityError } from "@/lib/ypi-studio-tasks";
import type { SessionEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const filePath = await resolveSessionPath(id);
    if (!filePath) return NextResponse.json({ error: "Session not found" }, { status: 404 });

    const session = SessionManager.open(filePath);
    const header = session.getHeader();
    const cwd = header?.cwd;
    if (!cwd) return NextResponse.json({ task: null, reason: "no-workspace" });

    const allowedRoots = await getAllowedRoots();
    if (!isPathAllowed(cwd, allowedRoots)) return NextResponse.json({ error: "Access denied" }, { status: 403 });

    const entries = session.getEntries() as unknown as SessionEntry[];
    const leafId = new URL(request.url).searchParams.get("leafId");
    if (leafId && !entries.some((entry) => entry.id === leafId)) {
      return NextResponse.json({ error: "Invalid leafId" }, { status: 400 });
    }

    const result = resolveYpiStudioTaskForSession({ cwd, sessionId: id, sessionFilePath: filePath, entries, leafId });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof YpiStudioTaskSecurityError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
