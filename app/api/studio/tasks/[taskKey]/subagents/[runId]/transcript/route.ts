import { NextRequest, NextResponse } from "next/server";
import { getAllowedRoots, isPathAllowed } from "@/lib/allowed-roots";
import { canonicalizeCwd } from "@/lib/cwd";
import { getYpiStudioTaskDetail, YpiStudioTaskSecurityError } from "@/lib/ypi-studio-tasks";
import { readYpiStudioSubagentTranscript } from "@/lib/ypi-studio-transcripts";

export const dynamic = "force-dynamic";

async function resolveAuthorizedCwd(cwd: string): Promise<string | NextResponse> {
  const allowedRoots = await getAllowedRoots();
  const canonicalCwd = canonicalizeCwd(cwd);
  if (!isPathAllowed(cwd, allowedRoots) || !isPathAllowed(canonicalCwd, allowedRoots)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  return canonicalCwd;
}

function isValidTaskKey(taskKey: string): boolean {
  return /^active:[^/\\:]+$/.test(taskKey) || /^[^/\\:]+$/.test(taskKey);
}

function isValidRunId(runId: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(runId) && runId !== "." && runId !== "..";
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskKey: string; runId: string }> },
) {
  try {
    const cwd = request.nextUrl.searchParams.get("cwd");
    if (!cwd) return NextResponse.json({ error: "Missing cwd parameter" }, { status: 400 });

    const { taskKey, runId } = await params;
    if (!isValidTaskKey(taskKey)) return NextResponse.json({ error: "Invalid task key" }, { status: 400 });
    if (!isValidRunId(runId)) return NextResponse.json({ error: "Invalid run id" }, { status: 400 });

    const authorizedCwd = await resolveAuthorizedCwd(cwd);
    if (authorizedCwd instanceof NextResponse) return authorizedCwd;

    const task = getYpiStudioTaskDetail(authorizedCwd, taskKey);
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

    const run = task.subagents.find((item) => item.id === runId);
    if (!run) return NextResponse.json({ error: "Subagent run not found" }, { status: 404 });
    if (!run.transcript) return NextResponse.json({ error: "Transcript was not captured for this Studio member run." }, { status: 404 });

    const limitRaw = request.nextUrl.searchParams.get("limit");
    const cursorRaw = request.nextUrl.searchParams.get("cursor");
    const full = request.nextUrl.searchParams.get("full") === "1";
    const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
    const cursor = cursorRaw ? Number.parseInt(cursorRaw, 10) : undefined;

    const response = readYpiStudioSubagentTranscript(authorizedCwd, task.id, run, {
      limit: Number.isFinite(limit) ? limit : undefined,
      cursor: Number.isFinite(cursor) ? cursor : undefined,
      full,
    });
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof YpiStudioTaskSecurityError || /Transcript .*escapes|outside|symlink|Invalid/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
