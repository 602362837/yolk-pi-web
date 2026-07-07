import { NextResponse } from "next/server";
import { listProjects, ProjectRegistryError, registerProject, syncProjectWorktreeSpaces } from "@/lib/project-registry";
import type { CreateProjectInput } from "@/lib/project-registry-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = error instanceof ProjectRegistryError ? error.status : 500;
  return NextResponse.json({ error: message }, { status });
}

export async function GET() {
  try {
    const projects = await listProjects();
    return NextResponse.json({ projects });
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
