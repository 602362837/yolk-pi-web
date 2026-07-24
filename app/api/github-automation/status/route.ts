/**
 * GET /api/github-automation/status
 *
 * Safe App / assignee / full-agent policy / job projection (GHA-09 / GHCRED-04).
 * - Cache-Control: no-store
 * - Does not enqueue work or start the scheduler
 * - Never returns credentials, absolute paths, Issue/comment bodies, prompts
 * - Consumes additive effective App credential projection (sources/local booleans only)
 * - Read-only: no credential store mutation
 */

import { NextResponse } from "next/server";

import {
  assertGithubAutomationProjectionSafe,
  buildGithubAutomationStatusProjection,
} from "@/lib/github-automation-projection";
import {
  isGithubAutomationError,
  safeGithubAutomationErrorMessage,
} from "@/lib/github-automation-errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
} as const;

export async function GET(): Promise<NextResponse> {
  try {
    const status = await buildGithubAutomationStatusProjection();
    assertGithubAutomationProjectionSafe(status);
    return NextResponse.json(
      {
        ok: true,
        status,
      },
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

export async function POST(): Promise<NextResponse> {
  return NextResponse.json(
    {
      ok: false,
      code: "method_not_allowed",
      message: "Use GET for status; status does not enqueue work",
    },
    { status: 405, headers: NO_STORE_HEADERS },
  );
}
