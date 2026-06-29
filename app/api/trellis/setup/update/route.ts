import { NextResponse } from "next/server";
import { getAllowedRoots, isPathAllowed } from "@/lib/allowed-roots";
import { canonicalizeCwd } from "@/lib/cwd";
import { updateTrellisProject } from "@/lib/trellis-manager";
import { readPiWebConfig } from "@/lib/pi-web-config";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({})) as { cwd?: unknown };
    const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
    if (!cwd) {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }

    const allowedRoots = await getAllowedRoots();
    const canonicalCwd = canonicalizeCwd(cwd);
    if (!isPathAllowed(cwd, allowedRoots) || !isPathAllowed(canonicalCwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const config = readPiWebConfig();
    return NextResponse.json(await updateTrellisProject({ cwd: canonicalCwd, config: config.trellis }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /does not have|cwd is required/i.test(message) ? 400 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
