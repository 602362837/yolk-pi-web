import { NextRequest, NextResponse } from "next/server";
import { getAllowedRoots, isPathAllowed } from "@/lib/allowed-roots";
import { canonicalizeCwd } from "@/lib/cwd";
import { getTrellisSetupStatus } from "@/lib/trellis-manager";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const cwd = request.nextUrl.searchParams.get("cwd");
    if (!cwd) {
      return NextResponse.json({ error: "Missing cwd parameter" }, { status: 400 });
    }

    const allowedRoots = await getAllowedRoots();
    const canonicalCwd = canonicalizeCwd(cwd);
    if (!isPathAllowed(cwd, allowedRoots) || !isPathAllowed(canonicalCwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    return NextResponse.json({ status: await getTrellisSetupStatus(canonicalCwd) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
