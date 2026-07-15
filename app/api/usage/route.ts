import { NextResponse, type NextRequest } from "next/server";
import { readPiWebConfig } from "@/lib/pi-web-config";
import { getUsageStatsForSessionRollup, parseLocalDateParam } from "@/lib/usage-stats";

export const dynamic = "force-dynamic";

/**
 * Session rollup only: Chat top-bar / SessionStatsChips usage for one sessionId.
 * Global date-range Session scanning is retired; use `/api/usage/calls` for the ledger.
 *
 * @param request Query params: required `sessionId`; optional `from` / `to` (YYYY-MM-DD).
 * @returns session_rollup JSON, or 400 when sessionId is missing.
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const sessionId = searchParams.get("sessionId") || undefined;
    if (!sessionId) {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }

    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");
    const from = fromParam ? parseLocalDateParam(fromParam, false) : undefined;
    const to = toParam ? parseLocalDateParam(toParam, true) : undefined;

    if ((fromParam && !from) || (toParam && !to)) {
      return NextResponse.json({ error: "from and to must use YYYY-MM-DD" }, { status: 400 });
    }
    if (from && to && from.getTime() > to.getTime()) {
      return NextResponse.json({ error: "from must be earlier than or equal to to" }, { status: 400 });
    }

    const config = readPiWebConfig();
    const rollup = await getUsageStatsForSessionRollup({
      sessionId,
      from: from ?? undefined,
      to: to ?? undefined,
      includeArchived: config.usage.includeArchived,
    });
    if (!rollup) {
      return NextResponse.json({ error: "session not found" }, { status: 404 });
    }
    return NextResponse.json(rollup);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
