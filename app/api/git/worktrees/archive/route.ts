import { NextResponse } from "next/server";
import { archiveGitWorktree, getWorktreeStatus, MainWorktreeDirtyError, WorktreeUserError } from "@/lib/git-worktree";
import { destroyRpcSessionsForCwd } from "@/lib/rpc-manager";
import { deleteSessionsForCwd } from "@/lib/session-reader";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({})) as { cwd?: unknown; confirmedRisk?: unknown };
    const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
    if (!cwd) return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    if (body.confirmedRisk !== true) {
      return NextResponse.json({ error: "confirmedRisk is required" }, { status: 400 });
    }

    const status = await getWorktreeStatus(cwd);
    const cleanupAliases = [status.cwd, status.worktree.repoRoot].filter((alias): alias is string => Boolean(alias));
    const result = await archiveGitWorktree(cwd, {
      beforeRemove: () => [...new Set([
        ...destroyRpcSessionsForCwd(cwd),
        ...cleanupAliases.flatMap((alias) => destroyRpcSessionsForCwd(alias)),
      ])],
    });
    const deletedSessions = await deleteSessionsForCwd(cwd, cleanupAliases);
    return NextResponse.json({ ...result, deletedSessionIds: deletedSessions.map((session) => session.id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof MainWorktreeDirtyError) {
      return NextResponse.json({ error: message, dirtySummary: error.dirtySummary }, { status: 409 });
    }
    const status = error instanceof WorktreeUserError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
