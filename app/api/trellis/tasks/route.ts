import { NextRequest, NextResponse } from "next/server";
import { getAllowedRoots, isPathAllowed } from "@/lib/allowed-roots";
import { readPiWebConfig } from "@/lib/pi-web-config";
import { listTrellisTasks, TrellisReaderSecurityError } from "@/lib/trellis-reader";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const config = readPiWebConfig();
    if (!config.trellis.enabled) {
      return NextResponse.json({ error: "Trellis panel is disabled" }, { status: 403 });
    }

    const cwd = request.nextUrl.searchParams.get("cwd");
    if (!cwd) {
      return NextResponse.json({ error: "Missing cwd parameter" }, { status: 400 });
    }

    const allowedRoots = await getAllowedRoots();
    if (!isPathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const includeArchived = request.nextUrl.searchParams.get("includeArchived") === "true";
    return NextResponse.json(listTrellisTasks(cwd, includeArchived));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof TrellisReaderSecurityError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
