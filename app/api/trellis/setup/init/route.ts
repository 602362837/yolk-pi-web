import { NextResponse } from "next/server";
import { getAllowedRoots, isPathAllowed } from "@/lib/allowed-roots";
import { canonicalizeCwd } from "@/lib/cwd";
import { initializeTrellisProject, validateTrellisDeveloperName } from "@/lib/trellis-manager";
import { PiWebConfigValidationError, readPiWebConfig, writePiWebConfigPatch } from "@/lib/pi-web-config";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({})) as { cwd?: unknown; developerName?: unknown };
    const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
    if (!cwd) {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }

    const allowedRoots = await getAllowedRoots();
    const canonicalCwd = canonicalizeCwd(cwd);
    if (!isPathAllowed(cwd, allowedRoots) || !isPathAllowed(canonicalCwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const developerName = validateTrellisDeveloperName(body.developerName);
    const config = readPiWebConfig();
    const result = await initializeTrellisProject({ cwd: canonicalCwd, developerName, config: config.trellis });
    const saved = writePiWebConfigPatch({ trellis: { ...config.trellis, enabled: true } });
    return NextResponse.json({ ...result, config: saved.config });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof PiWebConfigValidationError || /developerName|already has|cwd is required/i.test(message) ? 400 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
