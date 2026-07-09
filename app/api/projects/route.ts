import { NextRequest, NextResponse } from "next/server";
import { listProjects, ProjectRegistryError, registerProject, reorderProjects, syncMissingWorktreeSpaces, syncProjectWorktreeSpaces } from "@/lib/project-registry";
import type { CreateProjectInput, PiWebProjectSpaceRecord } from "@/lib/project-registry-types";
import { invalidateAllowedRootsCache } from "@/lib/allowed-roots";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = error instanceof ProjectRegistryError ? error.status : 500;
  return NextResponse.json({ error: message }, { status });
}

export async function GET(req: NextRequest) {
  try {
    // Optional passive missing-only sync: enabled via ?sync=missing
    let sync: { archivedSpaces: PiWebProjectSpaceRecord[] } | undefined;
    if (req.nextUrl.searchParams.get("sync") === "missing") {
      const syncResult = await syncMissingWorktreeSpaces({ reason: "passive_missing" });
      if (syncResult.archivedSpaces.length > 0) {
        invalidateAllowedRootsCache();
      }
      sync = { archivedSpaces: syncResult.archivedSpaces };
    }

    const projects = await listProjects();
    return NextResponse.json({ projects, ...(sync ? { sync } : {}) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as CreateProjectInput;
    const result = await registerProject(body);
    const worktrees = await syncProjectWorktreeSpaces(result.project.id);
    return NextResponse.json({ ...result, project: worktrees.project, worktrees }, { status: result.created ? 201 : 200 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { orderedProjectIds?: string[] };
    const result = await reorderProjects(body.orderedProjectIds ?? []);
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
