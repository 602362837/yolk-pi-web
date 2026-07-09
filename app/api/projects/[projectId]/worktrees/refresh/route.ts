import { NextResponse } from "next/server";
import { ProjectRegistryError, syncMissingWorktreeSpaces, syncProjectWorktreeSpaces } from "@/lib/project-registry";
import { invalidateAllowedRootsCache } from "@/lib/allowed-roots";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = error instanceof ProjectRegistryError ? error.status : 500;
  return NextResponse.json({ error: message }, { status });
}

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { projectId } = await context.params;
    const decodedProjectId = decodeURIComponent(projectId);
    const result = await syncProjectWorktreeSpaces(decodedProjectId);

    // Passive missing-only sync after full git refresh to catch CLI removals
    let missingSync: { archivedSpaces: typeof result.archivedMissing } | undefined;
    try {
      const syncResult = await syncMissingWorktreeSpaces({ projectId: decodedProjectId, reason: "passive_git_sync" });
      if (syncResult.archivedSpaces.length > 0) {
        missingSync = { archivedSpaces: syncResult.archivedSpaces.map((s) => s.id) };
      }
    } catch {
      // missing-only is best-effort; full refresh result is authoritative
    }

    if (result.archivedMissing.length > 0 || missingSync?.archivedSpaces.length) {
      invalidateAllowedRootsCache();
    }

    return NextResponse.json({ ...result, ...(missingSync ? { missingSync } : {}) });
  } catch (error) {
    return errorResponse(error);
  }
}
