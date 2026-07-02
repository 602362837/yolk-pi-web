import { NextResponse } from "next/server";
import { GIT_LONG_ACTION_TIMEOUT_MS, GitActionUserError, jsonGitActionError, resolveAuthorizedGitRepo, runGit } from "@/lib/git-actions";
import type { GitPushResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

async function getCurrentBranch(repoRoot: string): Promise<string> {
  const branch = (await runGit(["rev-parse", "--abbrev-ref", "HEAD"], repoRoot)).trim();
  if (!branch || branch === "HEAD") {
    throw new GitActionUserError("Detached HEAD cannot be pushed from the Git panel. Switch to a local branch first.", 409);
  }
  return branch;
}

async function getUpstream(repoRoot: string): Promise<string | null> {
  try {
    const upstream = (await runGit(["rev-parse", "--abbrev-ref", "@{upstream}"], repoRoot)).trim();
    return upstream || null;
  } catch {
    return null;
  }
}

async function getBehindCount(repoRoot: string): Promise<number> {
  try {
    const output = (await runGit(["rev-list", "--count", "--left-right", "HEAD...@{upstream}"], repoRoot)).trim();
    const parts = output.split(/\s+/);
    return parseInt(parts[1] ?? "0", 10) || 0;
  } catch {
    return 0;
  }
}

async function assertOriginRemote(repoRoot: string): Promise<void> {
  try {
    await runGit(["remote", "get-url", "origin"], repoRoot);
  } catch {
    throw new GitActionUserError("Cannot publish branch because remote 'origin' is not configured.", 409);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({})) as { cwd?: unknown; setUpstream?: unknown };
    const cwd = typeof body.cwd === "string" ? body.cwd : "";
    const setUpstream = body.setUpstream === true;
    const repo = await resolveAuthorizedGitRepo(cwd);
    const branch = await getCurrentBranch(repo.repoRoot);
    const upstream = await getUpstream(repo.repoRoot);

    if (upstream) {
      const behind = await getBehindCount(repo.repoRoot);
      if (behind > 0) {
        throw new GitActionUserError("Branch is behind upstream. Pull or rebase before pushing.", 409);
      }
      await runGit(["push"], repo.repoRoot, { timeout: GIT_LONG_ACTION_TIMEOUT_MS });
      const updatedUpstream = await getUpstream(repo.repoRoot);
      const response: GitPushResponse = { success: true, branch, upstream: updatedUpstream };
      return NextResponse.json(response);
    }

    if (!setUpstream) {
      throw new GitActionUserError("No upstream is configured. Confirm Publish branch to push to origin/currentBranch.", 409);
    }

    await assertOriginRemote(repo.repoRoot);
    await runGit(["push", "-u", "origin", branch], repo.repoRoot, { timeout: GIT_LONG_ACTION_TIMEOUT_MS });
    const updatedUpstream = await getUpstream(repo.repoRoot);
    const response: GitPushResponse = { success: true, branch, upstream: updatedUpstream };
    return NextResponse.json(response);
  } catch (error) {
    const details = jsonGitActionError(error);
    return NextResponse.json({ error: details.error }, { status: details.status });
  }
}
