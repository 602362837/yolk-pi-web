import { NextRequest, NextResponse } from "next/server";
import { getAllowedRoots, isPathAllowed } from "@/lib/allowed-roots";
import { readTrellisWorkflow, TrellisWorkflowSecurityError } from "@/lib/trellis-workflow-reader";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const cwd = request.nextUrl.searchParams.get("cwd");
    if (!cwd) {
      return NextResponse.json({ error: "Missing cwd parameter" }, { status: 400 });
    }

    const allowedRoots = await getAllowedRoots();
    if (!isPathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    return NextResponse.json(readTrellisWorkflow(cwd));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof TrellisWorkflowSecurityError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
