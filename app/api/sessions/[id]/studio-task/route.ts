import { NextResponse } from "next/server";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { getAllowedRoots, isPathAllowed } from "@/lib/allowed-roots";
import { resolveSessionPath } from "@/lib/session-reader";
import { getRpcSession } from "@/lib/rpc-manager";
import { resolveYpiStudioTaskForSession } from "@/lib/ypi-studio-session-link";
import { YpiStudioTaskSecurityError } from "@/lib/ypi-studio-tasks";
import type { SessionEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

function buildStudioReadyFallbackPrompt(input: { taskId: string; readySubtaskCount: number; availableSlots: number }): string {
  return [
    "YPI Studio implementationPlan 仍有 ready 子任务且存在空闲并发槽，请继续自动推进，不要等待用户输入。",
    "",
    `- taskId: ${input.taskId}`,
    `- readySubtaskCount: ${input.readySubtaskCount}`,
    `- availableSlots: ${input.availableSlots}`,
    "- reason: studio-task poll observed ready subtasks with free concurrency slots",
    "",
    "请按现有 Studio 状态机继续：先调用 ypi_studio_task(action=current) 或 ypi_studio_task(action=get, taskId=<上面的 taskId>) 确认状态；若 task 仍是 implementing，调用 implementation_next(limit=<available slots>)，claim ready 子任务，并为每个 claimed subtaskId 启动一个 async implementer，直到 maxConcurrency 填满或无 ready。每个 implementer run 只处理一个 subtaskId。",
  ].join("\n");
}

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
    if (result.task && !result.task.archived && result.task.status === "implementing") {
      const projection = result.task.implementationProjection;
      const counts = projection?.statusCounts;
      const activeCount = (counts?.running ?? 0) + (counts?.queued ?? 0);
      const readyCount = counts?.ready ?? 0;
      const availableSlots = projection ? Math.max(0, projection.maxConcurrency - activeCount) : 0;
      if (readyCount > 0 && availableSlots > 0) {
        const session = getRpcSession(id);
        if (session?.isAlive()) {
          const fallbackPrompt = buildStudioReadyFallbackPrompt({ taskId: result.task.id, readySubtaskCount: readyCount, availableSlots });
          session.send({
            type: "studio_autocontinue",
            taskId: result.task.id,
            readySubtaskCount: readyCount,
            availableSlots,
            stateKey: `${result.task.updatedAt}:${activeCount}:${readyCount}:${availableSlots}:${projection?.nextSubtaskIds?.join(",") ?? ""}`,
            reason: "studio-task poll observed ready subtasks with free concurrency slots",
          }).then((outcome) => {
            const data = outcome as { queued?: boolean; skippedReason?: string } | null | undefined;
            if (data?.queued === false && data.skippedReason === "unsupported_command") {
              return session.send({ type: "prompt", message: fallbackPrompt });
            }
            return undefined;
          }).catch(() => {
            void session.send({ type: "prompt", message: fallbackPrompt }).catch(() => {});
          });
        }
      }
    }
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof YpiStudioTaskSecurityError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
