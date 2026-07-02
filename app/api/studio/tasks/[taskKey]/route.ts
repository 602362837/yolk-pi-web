import { NextRequest, NextResponse } from "next/server";
import { getAllowedRoots, isPathAllowed } from "@/lib/allowed-roots";
import { canonicalizeCwd } from "@/lib/cwd";
import {
  archiveYpiStudioTask,
  bindYpiStudioTaskToContext,
  getYpiStudioTaskDetail,
  isYpiStudioTaskArchiveBody,
  isYpiStudioTaskArtifactUpdateBody,
  isYpiStudioTaskTransitionBody,
  transitionYpiStudioTask,
  updateYpiStudioTaskArtifact,
  YpiStudioTaskSecurityError,
} from "@/lib/ypi-studio-tasks";

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

function isBindBody(value: unknown): value is { cwd: string; contextId: string; action?: string } {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && typeof (value as { cwd?: unknown }).cwd === "string"
    && typeof (value as { contextId?: unknown }).contextId === "string"
    && (value as { action?: unknown }).action === "bind";
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskKey: string }> },
) {
  try {
    const cwd = request.nextUrl.searchParams.get("cwd");
    if (!cwd) return NextResponse.json({ error: "Missing cwd parameter" }, { status: 400 });

    const { taskKey } = await params;
    if (!isValidTaskKey(taskKey)) return NextResponse.json({ error: "Invalid task key" }, { status: 400 });

    const authorizedCwd = await resolveAuthorizedCwd(cwd);
    if (authorizedCwd instanceof NextResponse) return authorizedCwd;

    const task = getYpiStudioTaskDetail(authorizedCwd, taskKey);
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    return NextResponse.json({ task });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof YpiStudioTaskSecurityError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ taskKey: string }> },
) {
  try {
    const { taskKey } = await params;
    if (!isValidTaskKey(taskKey)) return NextResponse.json({ error: "Invalid task key" }, { status: 400 });

    const body = await request.json().catch(() => null) as unknown;
    const cwd = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as { cwd?: unknown }).cwd : undefined;
    if (typeof cwd !== "string") return NextResponse.json({ error: "Missing cwd" }, { status: 400 });

    const authorizedCwd = await resolveAuthorizedCwd(cwd);
    if (authorizedCwd instanceof NextResponse) return authorizedCwd;

    if (isBindBody(body)) {
      const task = bindYpiStudioTaskToContext(authorizedCwd, taskKey, body.contextId);
      return NextResponse.json({ task });
    }
    if (isYpiStudioTaskArtifactUpdateBody(body)) {
      const task = updateYpiStudioTaskArtifact(taskKey, { ...body, cwd: authorizedCwd });
      return NextResponse.json({ task });
    }
    if (isYpiStudioTaskTransitionBody(body)) {
      const task = transitionYpiStudioTask(taskKey, { ...body, cwd: authorizedCwd });
      return NextResponse.json({ task });
    }
    if (isYpiStudioTaskArchiveBody(body)) {
      const result = archiveYpiStudioTask(taskKey, { ...body, cwd: authorizedCwd });
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: "Unsupported task patch body" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof YpiStudioTaskSecurityError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
