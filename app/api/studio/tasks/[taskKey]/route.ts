import { NextRequest, NextResponse } from "next/server";
import { getAllowedRoots, isPathAllowed } from "@/lib/allowed-roots";
import { canonicalizeCwd } from "@/lib/cwd";
import {
  approveYpiStudioImprovementPlanFromWidget,
  approveYpiStudioPlanFromWidget,
  archiveYpiStudioTask,
  bindYpiStudioTaskToContext,
  claimYpiStudioImprovementSubtask,
  claimYpiStudioImplementationSubtask,
  createYpiStudioImprovement,
  getYpiStudioTaskDetail,
  isYpiStudioImprovementApprovalBody,
  isYpiStudioImprovementArtifactUpdateBody,
  isYpiStudioImprovementCreateBody,
  isYpiStudioImprovementDispositionBody,
  isYpiStudioImprovementPlanUpdateBody,
  isYpiStudioImprovementSubtaskClaimBody,
  isYpiStudioImprovementRevisionBody,
  isYpiStudioImprovementTransitionBody,
  isYpiStudioTaskArchiveBody,
  isYpiStudioTaskImplementationPlanUpdateBody,
  isYpiStudioTaskImplementationSubtaskClaimBody,
  isYpiStudioTaskImplementationSubtaskUpdateBody,
  isYpiStudioTaskArtifactUpdateBody,
  isYpiStudioTaskTransitionBody,
  isYpiStudioWidgetApproveImprovementPlanBody,
  isYpiStudioWidgetApprovePlanBody,
  isYpiStudioWidgetRequestPlanChangesBody,
  isYpiStudioWidgetReturnToUserAcceptanceBody,
  isYpiStudioWidgetStartUserAcceptanceBody,
  recordYpiStudioImprovementApproval,
  requestYpiStudioPlanChangesFromWidget,
  resolveYpiStudioImprovementDisposition,
  returnYpiStudioToUserAcceptanceFromWidget,
  reviseYpiStudioImprovementPlan,
  startYpiStudioUserAcceptanceFromWidget,
  transitionYpiStudioImprovement,
  transitionYpiStudioTask,
  updateYpiStudioImplementationPlan,
  updateYpiStudioImplementationSubtask,
  updateYpiStudioImprovementArtifact,
  updateYpiStudioImprovementPlan,
  updateYpiStudioTaskArtifact,
  YpiStudioTaskSecurityError,
} from "@/lib/ypi-studio-tasks";

export const dynamic = "force-dynamic";

type StudioWidgetActionErrorCode =
  | "bad_request"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "unprocessable"
  | "internal";

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

/**
 * Map domain helper failures for Phase 1 widget decision actions to stable HTTP + code.
 * Keeps messages safe (no absolute paths / stack) and never exposes material bodies.
 */
function mapWidgetDecisionError(error: unknown): {
  status: number;
  code: StudioWidgetActionErrorCode;
  error: string;
} {
  if (error instanceof YpiStudioTaskSecurityError) {
    return { status: 400, code: "bad_request", error: error.message || "Invalid request" };
  }
  const message = error instanceof Error ? error.message : String(error);
  const safe = message && !message.includes("/") && message.length <= 300
    ? message
    : "Widget decision failed";

  if (/Task not found|Improvement not found/i.test(message)) {
    return { status: 404, code: "not_found", error: safe };
  }
  if (
    /not bound to this session context|requires a bound session contextId|requires a session-class contextId/i.test(message)
    || /Archived tasks cannot/i.test(message)
    || /requires status|requires parent status|must be in waiting_plan_approval|plan revision changed|expectedRevision must be an integer|requires zero unresolved improvements/i.test(message)
  ) {
    return { status: 409, code: "conflict", error: safe };
  }
  if (
    /plan-review|HTML prototype|TBD placeholder|meaningful content|ui\.md indicates|requires non-empty feedback|feedback must be at most/i.test(message)
  ) {
    return { status: 422, code: "unprocessable", error: safe };
  }
  if (/requires improvementId|Invalid Studio transition|Unknown workflow state|Task has no improvements/i.test(message)) {
    return { status: 400, code: "bad_request", error: safe };
  }
  return { status: 500, code: "internal", error: "Widget decision failed" };
}

function widgetDecisionErrorResponse(error: unknown): NextResponse {
  const mapped = mapWidgetDecisionError(error);
  return NextResponse.json({ error: mapped.error, code: mapped.code }, { status: mapped.status });
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
    // Explicit widget decision actions must match before loose transition bodies so
    // approve_*/request_plan_changes never fall through to transitionYpiStudioTask.
    if (isYpiStudioWidgetApprovePlanBody(body)) {
      try {
        const task = approveYpiStudioPlanFromWidget(taskKey, { ...body, cwd: authorizedCwd });
        return NextResponse.json({ task });
      } catch (error) {
        return widgetDecisionErrorResponse(error);
      }
    }
    if (isYpiStudioWidgetRequestPlanChangesBody(body)) {
      try {
        const task = requestYpiStudioPlanChangesFromWidget(taskKey, { ...body, cwd: authorizedCwd });
        // Server wake removed: widget decision continuation now travels through the
        // Chat handleSend path (Hybrid B). Keep bestEffortContinueAfterWidgetRequestPlanChanges
        // and its helpers in lib/ypi-studio-session-link.ts for tests/emergency rollback.
        return NextResponse.json({ task });
      } catch (error) {
        return widgetDecisionErrorResponse(error);
      }
    }
    if (isYpiStudioWidgetApproveImprovementPlanBody(body)) {
      try {
        const task = approveYpiStudioImprovementPlanFromWidget(taskKey, { ...body, cwd: authorizedCwd });
        return NextResponse.json({ task });
      } catch (error) {
        return widgetDecisionErrorResponse(error);
      }
    }
    // Explicit start_user_acceptance must match before loose transition bodies.
    // No autocontinue: user_acceptance waits for the main-accept CTA.
    if (isYpiStudioWidgetStartUserAcceptanceBody(body)) {
      try {
        const task = startYpiStudioUserAcceptanceFromWidget(taskKey, { ...body, cwd: authorizedCwd });
        return NextResponse.json({ task });
      } catch (error) {
        return widgetDecisionErrorResponse(error);
      }
    }
    // Explicit return_to_user_acceptance must match before loose transition bodies.
    // No autocontinue: user_acceptance waits for the main-accept CTA.
    if (isYpiStudioWidgetReturnToUserAcceptanceBody(body)) {
      try {
        const task = returnYpiStudioToUserAcceptanceFromWidget(taskKey, { ...body, cwd: authorizedCwd });
        return NextResponse.json({ task });
      } catch (error) {
        return widgetDecisionErrorResponse(error);
      }
    }
    if (isYpiStudioTaskArtifactUpdateBody(body)) {
      const task = updateYpiStudioTaskArtifact(taskKey, { ...body, cwd: authorizedCwd });
      return NextResponse.json({ task });
    }
    // Improvement-scoped patches must be matched before the loose parent task transition body
    // (cwd + to), otherwise widget accept would hit transitionYpiStudioTask and fail with
    // "Invalid Studio transition: waiting_for_improvements -> accepted".
    if (isYpiStudioImprovementTransitionBody(body)) {
      const task = transitionYpiStudioImprovement(taskKey, { ...body, cwd: authorizedCwd });
      return NextResponse.json({ task });
    }
    if (isYpiStudioImprovementDispositionBody(body)) {
      const task = resolveYpiStudioImprovementDisposition(taskKey, { ...body, cwd: authorizedCwd });
      return NextResponse.json({ task });
    }
    if (isYpiStudioTaskTransitionBody(body)) {
      const task = transitionYpiStudioTask(taskKey, { ...body, cwd: authorizedCwd });
      return NextResponse.json({ task });
    }
    if (isYpiStudioTaskImplementationPlanUpdateBody(body)) {
      const task = updateYpiStudioImplementationPlan(taskKey, { ...body, cwd: authorizedCwd });
      return NextResponse.json({ task });
    }
    if (isYpiStudioTaskImplementationSubtaskClaimBody(body)) {
      const task = claimYpiStudioImplementationSubtask(taskKey, { ...body, cwd: authorizedCwd });
      return NextResponse.json({ task });
    }
    if (isYpiStudioImprovementSubtaskClaimBody(body)) {
      const task = claimYpiStudioImprovementSubtask(taskKey, { ...body, cwd: authorizedCwd });
      return NextResponse.json({ task });
    }
    if (isYpiStudioTaskImplementationSubtaskUpdateBody(body)) {
      const task = updateYpiStudioImplementationSubtask(taskKey, { ...body, cwd: authorizedCwd });
      return NextResponse.json({ task });
    }
    if (isYpiStudioTaskArchiveBody(body)) {
      const result = archiveYpiStudioTask(taskKey, { ...body, cwd: authorizedCwd });
      return NextResponse.json(result);
    }
    if (isYpiStudioImprovementCreateBody(body)) {
      const task = createYpiStudioImprovement(taskKey, { ...body, cwd: authorizedCwd });
      return NextResponse.json({ task });
    }
    if (isYpiStudioImprovementArtifactUpdateBody(body)) {
      const task = updateYpiStudioImprovementArtifact(taskKey, { ...body, cwd: authorizedCwd });
      return NextResponse.json({ task });
    }
    if (isYpiStudioImprovementPlanUpdateBody(body)) {
      const task = updateYpiStudioImprovementPlan(taskKey, { ...body, cwd: authorizedCwd });
      return NextResponse.json({ task });
    }
    if (isYpiStudioImprovementApprovalBody(body)) {
      const task = recordYpiStudioImprovementApproval(authorizedCwd, taskKey, body.improvementId, body.contextId, body.inputText);
      return NextResponse.json({ task });
    }
    if (isYpiStudioImprovementRevisionBody(body)) {
      const task = reviseYpiStudioImprovementPlan(taskKey, { ...body, cwd: authorizedCwd });
      return NextResponse.json({ task });
    }

    return NextResponse.json({ error: "Unsupported task patch body" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof YpiStudioTaskSecurityError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
