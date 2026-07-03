import { NextRequest, NextResponse } from "next/server";
import { getAllowedRoots, isPathAllowed } from "@/lib/allowed-roots";
import { canonicalizeCwd } from "@/lib/cwd";
import { abortYpiStudioChildRun, getYpiStudioChildRun } from "@/lib/ypi-studio-subagent-runtime";
import { getYpiStudioTaskDetail, reconcileYpiStudioRuntimeLostSubagentRun, recordYpiStudioSubagentRun, YpiStudioTaskSecurityError } from "@/lib/ypi-studio-tasks";
import { readYpiStudioSubagentTranscriptPreview } from "@/lib/ypi-studio-transcripts";
import type { YpiStudioTaskSubagentRun } from "@/lib/ypi-studio-types";

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
  return /^active:[^/\\:]+$/.test(taskKey) || /^archived:\d{4}-\d{2}:[^/\\:]+$/.test(taskKey) || /^[^/\\:]+$/.test(taskKey);
}

function isValidRunId(runId: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(runId) && runId !== "." && runId !== "..";
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function projectRun(cwd: string, taskId: string, run: YpiStudioTaskSubagentRun) {
  const handle = getYpiStudioChildRun(run.id);
  let transcriptPreview: unknown;
  if (run.transcript) {
    try {
      transcriptPreview = readYpiStudioSubagentTranscriptPreview(cwd, taskId, run, { limit: 5, maxItemBytes: 500 });
    } catch (error) {
      transcriptPreview = { error: error instanceof Error ? error.message : String(error) };
    }
  }
  const progress = handle?.progress ?? run.progress;
  return {
    id: run.id,
    runId: run.id,
    taskId,
    subtaskId: run.subtaskId,
    member: run.member,
    status: handle?.status === "runtime_lost" ? run.status : handle?.status ?? run.status,
    registryStatus: handle?.status,
    registryActive: !!handle,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    summary: run.summary,
    error: run.error,
    terminationReason: run.terminationReason,
    progress,
    transcript: run.transcript,
    transcriptPreview,
  };
}

function findRun(cwd: string, taskKey: string, runId: string) {
  const task = getYpiStudioTaskDetail(cwd, taskKey);
  const run = task?.subagents.find((item) => item.id === runId);
  return { task, run };
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

    const { task, run } = findRun(authorizedCwd, taskKey, runId);
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    if (!run) return NextResponse.json({ error: "Subagent run not found" }, { status: 404 });

    const reconciledRun = reconcileYpiStudioRuntimeLostSubagentRun(authorizedCwd, task.id, run);
    const updatedTask = getYpiStudioTaskDetail(authorizedCwd, task.id) ?? task;
    return NextResponse.json({ task: { key: updatedTask.key, id: updatedTask.id, title: updatedTask.title, status: updatedTask.status, implementationProjection: updatedTask.implementationProjection }, run: projectRun(authorizedCwd, updatedTask.id, reconciledRun) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof YpiStudioTaskSecurityError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ taskKey: string; runId: string }> },
) {
  try {
    const { taskKey, runId } = await params;
    if (!isValidTaskKey(taskKey)) return NextResponse.json({ error: "Invalid task key" }, { status: 400 });
    if (!isValidRunId(runId)) return NextResponse.json({ error: "Invalid run id" }, { status: 400 });

    const body = await request.json().catch(() => null) as unknown;
    const cwd = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as { cwd?: unknown }).cwd : undefined;
    if (typeof cwd !== "string") return NextResponse.json({ error: "Missing cwd" }, { status: 400 });
    const action = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as { action?: unknown }).action : undefined;
    if (action !== "cancel") return NextResponse.json({ error: "Unsupported subagent run action" }, { status: 400 });

    const authorizedCwd = await resolveAuthorizedCwd(cwd);
    if (authorizedCwd instanceof NextResponse) return authorizedCwd;

    const { task, run } = findRun(authorizedCwd, taskKey, runId);
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    if (!run) return NextResponse.json({ error: "Subagent run not found" }, { status: 404 });

    const reason = optionalString((body as { reason?: unknown; cancelReason?: unknown }).reason) ?? optionalString((body as { cancelReason?: unknown }).cancelReason) ?? "cancel_requested";
    const aborted = abortYpiStudioChildRun(runId, reason);
    const finishedAt = new Date().toISOString();
    const cancelled: YpiStudioTaskSubagentRun = {
      ...run,
      status: "cancelled",
      finishedAt,
      summary: run.summary ?? `Studio subagent run cancelled: ${reason}`,
      error: `Studio subagent run cancelled: ${reason}`,
      terminationReason: reason,
      transcript: run.transcript ? { ...run.transcript, status: "cancelled", finishedAt, updatedAt: finishedAt } : run.transcript,
    };
    const updatedTask = recordYpiStudioSubagentRun(authorizedCwd, task.id, cancelled);
    return NextResponse.json({ task: { key: updatedTask.key, id: updatedTask.id, title: updatedTask.title, status: updatedTask.status, implementationProjection: updatedTask.implementationProjection }, run: projectRun(authorizedCwd, updatedTask.id, cancelled), aborted });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof YpiStudioTaskSecurityError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ taskKey: string; runId: string }> },
) {
  const url = new URL(request.url);
  const body = { cwd: url.searchParams.get("cwd"), action: "cancel", cancelReason: url.searchParams.get("reason") ?? "cancel_requested" };
  return PATCH(new NextRequest(request.url, { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), context);
}
