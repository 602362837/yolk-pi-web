import { NextRequest, NextResponse } from "next/server";
import { createGitWorktree, getWorktreeStatus, removeGitWorktree, WorktreeUserError } from "@/lib/git-worktree";
import { readPiWebConfig } from "@/lib/pi-web-config";
import { destroyRpcSessionsForCwd } from "@/lib/rpc-manager";
import { deleteSessionsForCwd } from "@/lib/session-reader";
import { registerAllowedRoot } from "@/lib/allowed-roots";
import { markWorktreeSpaceArchivedByPath, syncRegisteredProjectWorktreeSpace } from "@/lib/project-registry";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const cwd = req.nextUrl.searchParams.get("cwd")?.trim();
  if (!cwd) return NextResponse.json({ error: "cwd is required" }, { status: 400 });

  try {
    const status = await getWorktreeStatus(cwd);
    return NextResponse.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof WorktreeUserError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({})) as {
      cwd?: unknown;
      baseRef?: unknown;
      branchName?: unknown;
      targetPath?: unknown;
    };

    const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
    if (!cwd) {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }

    const config = readPiWebConfig();
    const result = await createGitWorktree({
      cwd,
      config: config.worktree,
      baseRef: typeof body.baseRef === "string" ? body.baseRef : undefined,
      branchName: typeof body.branchName === "string" ? body.branchName : undefined,
      targetPath: typeof body.targetPath === "string" ? body.targetPath : undefined,
    });

    const registryLink = result.mainWorktreePath
      ? await syncRegisteredProjectWorktreeSpace(result.mainWorktreePath, result.cwd, result.branchName, result.baseRef)
      : null;

    registerAllowedRoot(result.cwd);
    return NextResponse.json({ ...result, registryLink });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof WorktreeUserError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(req: NextRequest) {
  const cwd = req.nextUrl.searchParams.get("cwd")?.trim();
  const force = req.nextUrl.searchParams.get("force") === "true";
  if (!cwd) return NextResponse.json({ error: "cwd is required" }, { status: 400 });

  try {
    const status = await getWorktreeStatus(cwd);
    if (status.dirty && !force) {
      return NextResponse.json({ error: "Worktree has uncommitted changes", status }, { status: 409 });
    }

    const cleanupAliases = [status.cwd, status.worktree.repoRoot].filter((alias): alias is string => Boolean(alias));
    const destroyedSessionIds = [...new Set([
      ...destroyRpcSessionsForCwd(cwd),
      ...cleanupAliases.flatMap((alias) => destroyRpcSessionsForCwd(alias)),
    ])];
    const result = await removeGitWorktree(cwd, { force, destroyedSessionIds });
    const archivedSpaces = await markWorktreeSpaceArchivedByPath(cwd);
    const deletedSessions = await deleteSessionsForCwd(cwd, cleanupAliases);
    return NextResponse.json({ ...result, archivedSpaces, deletedSessionIds: deletedSessions.map((session) => session.id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof WorktreeUserError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
