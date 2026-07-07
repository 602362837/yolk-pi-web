import { NextResponse } from "next/server";
import { getProject, ProjectRegistryError, updateProject } from "@/lib/project-registry";
import type { ProjectPatchInput } from "@/lib/project-registry-types";

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

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { projectId } = await context.params;
    const project = await getProject(decodeURIComponent(projectId));
    return NextResponse.json({ project });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { projectId } = await context.params;
    const body = await request.json().catch(() => ({})) as ProjectPatchInput;
    const project = await updateProject(decodeURIComponent(projectId), body);
    return NextResponse.json({ project });
  } catch (error) {
    return errorResponse(error);
  }
}
