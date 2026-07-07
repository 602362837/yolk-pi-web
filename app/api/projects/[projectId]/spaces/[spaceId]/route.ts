import { NextResponse } from "next/server";
import { getProjectSpace, ProjectRegistryError, updateProjectSpace } from "@/lib/project-registry";
import type { SpacePatchInput } from "@/lib/project-registry-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ projectId: string; spaceId: string }>;
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = error instanceof ProjectRegistryError ? error.status : 500;
  return NextResponse.json({ error: message }, { status });
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { projectId, spaceId } = await context.params;
    const space = await getProjectSpace(decodeURIComponent(projectId), decodeURIComponent(spaceId));
    return NextResponse.json({ space });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { projectId, spaceId } = await context.params;
    const body = await request.json().catch(() => ({})) as SpacePatchInput;
    const space = await updateProjectSpace(decodeURIComponent(projectId), decodeURIComponent(spaceId), body);
    return NextResponse.json({ space });
  } catch (error) {
    return errorResponse(error);
  }
}
