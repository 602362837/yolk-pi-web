import { NextResponse } from "next/server";
import { listProjectSpaces, ProjectRegistryError } from "@/lib/project-registry";

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
    const spaces = await listProjectSpaces(decodeURIComponent(projectId));
    return NextResponse.json({ spaces });
  } catch (error) {
    return errorResponse(error);
  }
}
