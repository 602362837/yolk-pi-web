import { NextRequest, NextResponse } from "next/server";
import { getAllowedRoots, isPathAllowed } from "@/lib/allowed-roots";
import { readPiWebConfig } from "@/lib/pi-web-config";
import { getTrellisTaskDetail, TrellisReaderSecurityError } from "@/lib/trellis-reader";

export const dynamic = "force-dynamic";

function isValidTaskKey(taskKey: string): boolean {
  return /^active:[^/\\:]+$/.test(taskKey) || /^archive:\d{4}-\d{2}:[^/\\:]+$/.test(taskKey);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskKey: string }> },
) {
  try {
    const config = readPiWebConfig();
    if (!config.trellis.enabled) {
      return NextResponse.json({ error: "Trellis panel is disabled" }, { status: 403 });
    }

    const cwd = request.nextUrl.searchParams.get("cwd");
    if (!cwd) {
      return NextResponse.json({ error: "Missing cwd parameter" }, { status: 400 });
    }

    const { taskKey } = await params;
    if (!isValidTaskKey(taskKey)) {
      return NextResponse.json({ error: "Invalid task key" }, { status: 400 });
    }

    const allowedRoots = await getAllowedRoots();
    if (!isPathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const task = getTrellisTaskDetail(cwd, taskKey);
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    return NextResponse.json({ task });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof TrellisReaderSecurityError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
