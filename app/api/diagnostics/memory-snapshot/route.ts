import { NextResponse } from "next/server";
import { triggerMemorySnapshot } from "@/lib/memory-diagnostics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * POST /api/diagnostics/memory-snapshot
 *
 * Captures a bounded, read-only memory diagnostic snapshot in the current
 * Next.js server process and atomically persists it as a schema-v1 JSON under
 * `<getAgentDir()>/diagnostics/`. The response is metadata only (file path,
 * size, duration, schema version, partial/compacted flags, bounded section
 * summary); the full snapshot JSON is never returned over HTTP. Concurrent
 * triggers are rejected with `409 snapshot_in_progress`. No request body or
 * parameters are accepted — the collector uses fixed, safe defaults and never
 * accepts a custom output path or a content-inclusion toggle.
 */
export async function POST() {
  const result = await triggerMemorySnapshot();
  if (result.ok) {
    return NextResponse.json(result, { status: 201, headers: NO_STORE });
  }
  if (result.code === "snapshot_in_progress") {
    return NextResponse.json(result, { status: 409, headers: NO_STORE });
  }
  return NextResponse.json(result, { status: 500, headers: NO_STORE });
}