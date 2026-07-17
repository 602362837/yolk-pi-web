/**
 * Model prices API — sanitized price listing and revision-gated patch.
 *
 * GET  — Lists resolved model prices from a provider-aware ModelRuntime (never
 *         exposes secrets, absolute paths, or full models.json).
 * PATCH — Applies batched price changes to models.json with revision-based
 *         concurrency control (409 on conflict). Always returns no-store.
 */

import { NextRequest, NextResponse } from "next/server";
import { stat } from "fs/promises";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getAllowedRoots, isPathAllowed } from "@/lib/allowed-roots";
import { getWebModelRuntime } from "@/lib/web-model-runtime";
import {
  buildModelPriceListResponse,
  applyPricePatch,
  readModelsJsonRaw,
} from "@/lib/model-price-config";
import {
  validatePricePatchChanges,
} from "@/lib/model-price-types";
import type {
  ModelPricePatchRequest,
  ModelPricePatchResponse,
} from "@/lib/model-price-types";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

// ── Helpers ──────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Return an opaque error response. Never includes raw file paths, stack
 * traces, or internal data in production-like responses.
 */
function errorResponse(status: number, message: string, extra?: Record<string, unknown>): NextResponse {
  const body: Record<string, unknown> = { error: message };
  if (extra) Object.assign(body, extra);
  return NextResponse.json(body, { status, headers: NO_STORE });
}

// ── GET /api/model-prices ────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const cwd = req.nextUrl.searchParams.get("cwd") || process.cwd();

    // Validate cwd is an existing directory
    try {
      const cwdStat = await stat(cwd);
      if (!cwdStat.isDirectory()) {
        return errorResponse(400, "cwd must be a directory");
      }
    } catch {
      return errorResponse(400, "cwd directory does not exist");
    }

    // Allowed-root authorization (same policy as Trellis assist)
    const allowedRoots = await getAllowedRoots();
    if (!isPathAllowed(cwd, allowedRoots)) {
      return errorResponse(403, "Access denied");
    }

    // Fixed-provider administrative ModelRuntime (keyed cache; offline refresh).
    // Does not load cwd-local project extensions.
    const agentDir = getAgentDir();
    const runtime = await getWebModelRuntime({ agentDir, cwd });

    // Read models.json raw for override/custom-model detection
    const raw = readModelsJsonRaw();

    // Build the sanitized projection
    const response = buildModelPriceListResponse(runtime, raw.parsed, raw.revision);

    return NextResponse.json(response, { headers: NO_STORE });
  } catch {
    return errorResponse(500, "Internal server error");
  }
}

// ── PATCH /api/model-prices ──────────────────────────────────────────────────

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  try {
    // Parse and validate the JSON body
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return errorResponse(400, "Request body must be valid JSON");
    }

    if (!isRecord(body)) {
      return errorResponse(400, "Request body must be a JSON object");
    }

    // Validate revision
    const revision = body.revision;
    if (typeof revision !== "string" || !revision.trim()) {
      return errorResponse(400, "revision must be a non-empty string");
    }

    // Validate changes array
    const validation = validatePricePatchChanges(body.changes);
    if (!validation.valid) {
      return errorResponse(400, "Invalid changes", {
        details: validation.errors,
      });
    }

    const request: ModelPricePatchRequest = {
      revision: revision.trim(),
      changes: validation.changes,
    };

    // Apply the patch atomically (backup + merge + write)
    const result = applyPricePatch(request);

    // Map internal status to HTTP responses
    switch (result.status) {
      case 409:
        return NextResponse.json(
          {
            error:
              "Revision conflict: the configuration was modified by another request. " +
              "Please reload and retry.",
            currentRevision: result.revision,
          },
          { status: 409, headers: NO_STORE },
        );

      case 422:
        return NextResponse.json(
          {
            error: "One or more changes could not be applied",
            results: result.results
              .filter((r) => !r.success)
              .map((r) => ({
                provider: r.provider,
                model: r.model,
                error: r.error ?? "Unknown error",
              })),
          },
          { status: 422, headers: NO_STORE },
        );

      case 500:
        return NextResponse.json(
          {
            error:
              "Failed to save configuration. The previous configuration was preserved. " +
              "Please check the server logs and try again.",
            results: result.results,
          },
          { status: 500, headers: NO_STORE },
        );

      default:
        break;
    }

    // Build the success response
    const response: ModelPricePatchResponse = {
      schemaVersion: 1,
      revision: result.revision,
      results: result.results,
    };

    return NextResponse.json(response, { status: 200, headers: NO_STORE });
  } catch {
    return errorResponse(500, "Internal server error");
  }
}
