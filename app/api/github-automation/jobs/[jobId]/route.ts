/**
 * GET /api/github-automation/jobs/[jobId]
 * POST /api/github-automation/jobs/[jobId]  { action: "retry"|"pause"|"resume" }
 *
 * Safe job projection + fixed state-gated actions (GHA-09).
 * - Cache-Control: no-store
 * - Actions are idempotent-ish, rate-limited, state-gated
 * - Client cannot pass phase/repo/policy/token/command
 */

import { NextResponse } from "next/server";

import {
  applyGithubAutomationJobAction,
  assertGithubAutomationProjectionSafe,
  toGithubAutomationJobSafeProjection,
  type GithubAutomationJobActionName,
} from "@/lib/github-automation-projection";
import { readGithubAutomationConfig } from "@/lib/github-automation-config";
import {
  isGithubAutomationError,
  safeGithubAutomationErrorMessage,
} from "@/lib/github-automation-errors";
import {
  readGithubAutomationIssueState,
  readGithubAutomationJob,
} from "@/lib/github-automation-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
} as const;

const ALLOWED_ACTIONS = new Set<GithubAutomationJobActionName>([
  "retry",
  "pause",
  "resume",
]);

interface RouteContext {
  params: Promise<{ jobId: string }>;
}

async function resolveJobId(context: RouteContext): Promise<string | null> {
  const params = await context.params;
  const jobId = typeof params.jobId === "string" ? params.jobId.trim() : "";
  if (!jobId || jobId.length > 200) return null;
  if (jobId.includes("..") || jobId.includes("/") || jobId.includes("\\")) {
    return null;
  }
  return jobId;
}

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const jobId = await resolveJobId(context);
    if (!jobId) {
      return NextResponse.json(
        { ok: false, code: "invalid_config", message: "Invalid jobId" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const job = await readGithubAutomationJob(jobId);
    if (!job) {
      return NextResponse.json(
        { ok: false, code: "not_found", message: "Job not found" },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }

    const config = await readGithubAutomationConfig();
    const issue = await readGithubAutomationIssueState(
      job.repositoryId,
      job.issueNumber,
    );
    const claimStatus =
      issue?.claimStatus === "complete"
        ? "complete"
        : issue?.claimStatus === "blocked_claim_assignee"
          ? "blocked_claim_assignee"
          : issue?.claimStatus === "incomplete"
            ? "incomplete"
            : "unknown";

    const projection = toGithubAutomationJobSafeProjection(job, {
      claimStatus,
      automationEnabled: config.enabled,
      mode: config.mode,
      globalPaused: config.paused,
    });
    assertGithubAutomationProjectionSafe(projection);

    return NextResponse.json(
      { ok: true, job: projection },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    if (isGithubAutomationError(err)) {
      return NextResponse.json(
        {
          ok: false,
          code: err.code,
          message: err.message,
          details: err.details ?? null,
        },
        { status: err.status, headers: NO_STORE_HEADERS },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        code: "internal_error",
        message: safeGithubAutomationErrorMessage(err),
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const jobId = await resolveJobId(context);
    if (!jobId) {
      return NextResponse.json(
        { ok: false, code: "invalid_config", message: "Invalid jobId" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        {
          ok: false,
          code: "invalid_config",
          message: "Request body must be JSON",
        },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        {
          ok: false,
          code: "invalid_config",
          message: "Request body must be an object",
        },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const rec = body as Record<string, unknown>;
    // Reject any attempt to smuggle state/policy/token/command.
    for (const key of Object.keys(rec)) {
      const lower = key.toLowerCase();
      if (
        key !== "action" &&
        key !== "revision" &&
        (lower.includes("token") ||
          lower.includes("secret") ||
          lower.includes("command") ||
          lower.includes("phase") ||
          lower.includes("policy") ||
          lower.includes("repo") ||
          lower.includes("password"))
      ) {
        return NextResponse.json(
          {
            ok: false,
            code: "invalid_config",
            message: "Action body contains disallowed field",
          },
          { status: 400, headers: NO_STORE_HEADERS },
        );
      }
    }

    const actionRaw = rec.action;
    if (typeof actionRaw !== "string" || !ALLOWED_ACTIONS.has(actionRaw as GithubAutomationJobActionName)) {
      return NextResponse.json(
        {
          ok: false,
          code: "invalid_config",
          message: 'action must be "retry", "pause", or "resume"',
        },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const result = await applyGithubAutomationJobAction({
      jobId,
      action: actionRaw as GithubAutomationJobActionName,
    });

    if (result.job) {
      assertGithubAutomationProjectionSafe(result.job);
    }

    const status =
      result.code === "not_found"
        ? 404
        : result.code === "not_allowed"
          ? 409
          : result.code === "rate_limited"
            ? 429
            : result.ok
              ? 200
              : 400;

    return NextResponse.json(
      {
        ok: result.ok,
        code: result.code,
        message: result.message,
        job: result.job,
        partial: result.partial,
      },
      { status, headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    if (isGithubAutomationError(err)) {
      return NextResponse.json(
        {
          ok: false,
          code: err.code,
          message: err.message,
          details: err.details ?? null,
        },
        { status: err.status, headers: NO_STORE_HEADERS },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        code: "internal_error",
        message: safeGithubAutomationErrorMessage(err),
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
