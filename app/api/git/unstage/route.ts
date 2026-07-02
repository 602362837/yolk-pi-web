import { NextResponse } from "next/server";
import { jsonGitActionError, resolveAuthorizedGitRepo, runGit, toRepoRelativeGitPathspecs } from "@/lib/git-actions";
import type { GitFileMutationResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({})) as { cwd?: unknown; files?: unknown };
    const cwd = typeof body.cwd === "string" ? body.cwd : "";
    const repo = await resolveAuthorizedGitRepo(cwd);
    const pathspecs = toRepoRelativeGitPathspecs(body.files, repo);

    try {
      await runGit(["--literal-pathspecs", "restore", "--staged", "--", ...pathspecs], repo.repoRoot);
    } catch {
      await runGit(["--literal-pathspecs", "reset", "--", ...pathspecs], repo.repoRoot);
    }

    const response: GitFileMutationResponse = { success: true, count: pathspecs.length };
    return NextResponse.json(response);
  } catch (error) {
    const details = jsonGitActionError(error);
    return NextResponse.json({ error: details.error }, { status: details.status });
  }
}
