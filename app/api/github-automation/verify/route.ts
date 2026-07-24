/**
 * POST /api/github-automation/verify
 *
 * Fixed setup readiness re-check (IMP-001 / IMP-03).
 * - Cache-Control: no-store
 * - No request body fields required (body ignored / rejected if secret-like)
 * - Does not enqueue jobs, wake the scheduler, or mutate GitHub (read-only App probes)
 * - Never returns secrets, absolute paths, or raw webhook bodies
 */

import { NextResponse } from "next/server";

import { isGithubAutomationError } from "@/lib/github-automation-errors";
import { assertGithubAutomationProjectionSafe } from "@/lib/github-automation-projection";
import {
  runGithubAutomationSetupVerify,
  safeGithubAutomationSetupVerifyFailure,
} from "@/lib/github-automation-setup-verify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
} as const;

function hasDisallowedBodyKeys(body: unknown): string | null {
  if (body === null || body === undefined) return null;
  if (typeof body !== "object" || Array.isArray(body)) {
    return "body_not_object";
  }
  for (const key of Object.keys(body as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (
      lower.includes("token") ||
      lower.includes("secret") ||
      lower.includes("private") ||
      lower.includes("password") ||
      lower.includes("credential") ||
      lower.includes("pem") ||
      lower === "projectroot" ||
      lower === "command" ||
      lower === "shell" ||
      lower === "path" ||
      lower === "cwd"
    ) {
      return key;
    }
  }
  // Empty object is fine; any other fields are ignored (verify is fixed, not parameterized).
  return null;
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    // Body is optional. If present, only allow empty/ignored JSON — never secrets/paths/commands.
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const text = await request.text();
      if (text.trim()) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          return NextResponse.json(
            {
              ok: false,
              code: "invalid_config",
              message: "Request body must be valid JSON when provided",
            },
            { status: 400, headers: NO_STORE_HEADERS },
          );
        }
        const bad = hasDisallowedBodyKeys(parsed);
        if (bad === "body_not_object") {
          return NextResponse.json(
            {
              ok: false,
              code: "invalid_config",
              message: "Verify does not accept a non-object body",
            },
            { status: 400, headers: NO_STORE_HEADERS },
          );
        }
        if (bad) {
          return NextResponse.json(
            {
              ok: false,
              code: "invalid_config",
              message: "Verify rejects credential/path/command fields",
              details: { field: bad },
            },
            { status: 400, headers: NO_STORE_HEADERS },
          );
        }
      }
    }

    const result = await runGithubAutomationSetupVerify();
    assertGithubAutomationProjectionSafe(result);

    return NextResponse.json(result, {
      status: 200,
      headers: NO_STORE_HEADERS,
    });
  } catch (err) {
    if (isGithubAutomationError(err)) {
      return NextResponse.json(
        {
          ok: false,
          code: err.code,
          message: err.message,
          details: err.details ?? null,
          sideEffects: {
            enqueuedJobs: false,
            schedulerWoken: false,
            githubMutations: false,
          },
        },
        { status: err.status, headers: NO_STORE_HEADERS },
      );
    }
    const failure = safeGithubAutomationSetupVerifyFailure(err);
    return NextResponse.json(
      {
        ok: false,
        code: failure.code,
        message: failure.message,
        sideEffects: {
          enqueuedJobs: false,
          schedulerWoken: false,
          githubMutations: false,
        },
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    {
      ok: false,
      code: "method_not_allowed",
      message: "Use POST /api/github-automation/verify to re-check setup readiness",
    },
    { status: 405, headers: NO_STORE_HEADERS },
  );
}
