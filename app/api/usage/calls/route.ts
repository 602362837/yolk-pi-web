import { type NextRequest, NextResponse } from "next/server";
import { queryLlmUsage, QueryValidationError } from "@/lib/llm-usage-query";
import { parseLocalDateParam } from "@/lib/local-date-range";
import type { LlmUsageSourceKind, LlmUsageStatus } from "@/lib/llm-usage-types";
import { LLM_USAGE_SOURCE_KINDS } from "@/lib/llm-usage-types";

export const dynamic = "force-dynamic";

const VALID_STATUSES: LlmUsageStatus[] = ["success", "error", "aborted"];

/**
 * GET /api/usage/calls
 *
 * Versioned (v1) query API for the independent LLM usage ledger.
 * Reads ONLY the immutable event store; does NOT depend on session inventory.
 *
 * Query params:
 * - from (required): YYYY-MM-DD start date (local time, inclusive)
 * - to (required): YYYY-MM-DD end date (local time, inclusive)
 * - cwd (optional): filter by workspace path
 * - provider (optional): filter by exact provider name
 * - model (optional): filter by exact model name
 * - source (optional): filter by source kind
 * - status (optional): filter by completion status
 *
 * Returns: { kind: "llm_usage_stats", schemaVersion: 1, ... }
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");
    const cwd = searchParams.get("cwd") || undefined;
    const provider = searchParams.get("provider") || undefined;
    const model = searchParams.get("model") || undefined;
    const sourceParam = searchParams.get("source") || undefined;
    const statusParam = searchParams.get("status") || undefined;

    // Validate required params
    if (!fromParam || !toParam) {
      return NextResponse.json(
        { error: "from and to are required (YYYY-MM-DD)" },
        { status: 400 },
      );
    }

    // Parse dates using local time semantics (matching legacy API)
    const from = parseLocalDateParam(fromParam, false);
    const to = parseLocalDateParam(toParam, true);

    if (!from || !to) {
      return NextResponse.json(
        { error: "from and to must be valid YYYY-MM-DD dates" },
        { status: 400 },
      );
    }

    if (from.getTime() > to.getTime()) {
      return NextResponse.json(
        { error: "from must be earlier than or equal to to" },
        { status: 400 },
      );
    }

    // Validate optional filters
    let source: LlmUsageSourceKind | undefined;
    if (sourceParam) {
      if (!LLM_USAGE_SOURCE_KINDS.includes(sourceParam as LlmUsageSourceKind)) {
        return NextResponse.json(
          {
            error: `invalid source. Must be one of: ${LLM_USAGE_SOURCE_KINDS.join(", ")}`,
          },
          { status: 400 },
        );
      }
      source = sourceParam as LlmUsageSourceKind;
    }

    let status: LlmUsageStatus | undefined;
    if (statusParam) {
      if (!VALID_STATUSES.includes(statusParam as LlmUsageStatus)) {
        return NextResponse.json(
          {
            error: `invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`,
          },
          { status: 400 },
        );
      }
      status = statusParam as LlmUsageStatus;
    }

    const result = await queryLlmUsage({
      from,
      to,
      // Echo the original local calendar labels so clients see the same day
      // strings they sent, not a UTC re-format of the boundary instants.
      fromLabel: fromParam,
      toLabel: toParam,
      cwd,
      provider,
      model,
      source,
      status,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof QueryValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    // Do NOT leak absolute paths or internal stack traces
    console.error("[api/usage/calls] query failed:", error);
    return NextResponse.json(
      { error: "Failed to query usage ledger. Check server logs for details." },
      { status: 500 },
    );
  }
}
