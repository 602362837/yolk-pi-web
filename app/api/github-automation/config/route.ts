/**
 * GET/PATCH /api/github-automation/config
 *
 * Non-secret analysis config projection + revision CAS patch (GIA-04).
 * - Cache-Control: no-store
 * - Wire surface: enabled, paused, analysis.maxConcurrency, repositories, revision
 * - Rejects legacy mode/unattended/baseRef/owner ids/secrets/paths
 * - repositories: full-list replacement with GitHub identity cross-check,
 *   Project Registry projectId → projectRoot binding, and active-job delete gate
 * - Client cannot set absolute projectRoot / secrets / tokens
 * - Does not enqueue jobs or wake the scheduler
 */

import { NextResponse } from "next/server";

import {
  assertGithubAutomationProjectionSafe,
  applyGithubAutomationConfigWirePatch,
  buildGithubAutomationConfigGetPayload,
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
    const { config, projectChoices } = await buildGithubAutomationConfigGetPayload();
    assertGithubAutomationProjectionSafe(config);
    assertGithubAutomationProjectionSafe(projectChoices);
    return NextResponse.json(
      {
        ok: true,
        config,
        projectChoices,
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

export async function PATCH(request: Request): Promise<NextResponse> {
  try {
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

    // Production path always performs fixed-host GitHub lookup + Project Registry bind.
    // skipNetworkLookup is intentionally not accepted from the request body.
    const { projection } = await applyGithubAutomationConfigWirePatch(body, {
      requireProjectId: true,
    });
    assertGithubAutomationProjectionSafe(projection);

    return NextResponse.json(
      {
        ok: true,
        config: projection,
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
