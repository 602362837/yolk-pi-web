import { NextRequest, NextResponse } from "next/server";
import { getAllowedRoots, isPathAllowed } from "@/lib/allowed-roots";
import { canonicalizeCwd } from "@/lib/cwd";
import {
  initializeYpiStudioWorkflows,
  listYpiStudioWorkflows,
  YpiStudioWorkflowSecurityError,
} from "@/lib/ypi-studio-workflows";

export const dynamic = "force-dynamic";

async function resolveAuthorizedCwd(cwd: string): Promise<string | NextResponse> {
  const allowedRoots = await getAllowedRoots();
  const canonicalCwd = canonicalizeCwd(cwd);
  if (!isPathAllowed(cwd, allowedRoots) || !isPathAllowed(canonicalCwd, allowedRoots)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  return canonicalCwd;
}

function isInitBody(value: unknown): value is { cwd: string; overwriteDefaults?: boolean } {
  return typeof value === "object" && value !== null && !Array.isArray(value) && typeof (value as { cwd?: unknown }).cwd === "string";
}

export async function GET(request: NextRequest) {
  try {
    const cwd = request.nextUrl.searchParams.get("cwd");
    if (!cwd) return NextResponse.json({ error: "Missing cwd parameter" }, { status: 400 });

    const authorizedCwd = await resolveAuthorizedCwd(cwd);
    if (authorizedCwd instanceof NextResponse) return authorizedCwd;

    return NextResponse.json(listYpiStudioWorkflows(authorizedCwd));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof YpiStudioWorkflowSecurityError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null) as unknown;
    if (!isInitBody(body)) return NextResponse.json({ error: "Missing cwd" }, { status: 400 });

    const authorizedCwd = await resolveAuthorizedCwd(body.cwd);
    if (authorizedCwd instanceof NextResponse) return authorizedCwd;

    return NextResponse.json(initializeYpiStudioWorkflows(authorizedCwd, { overwriteDefaults: body.overwriteDefaults === true }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof YpiStudioWorkflowSecurityError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
