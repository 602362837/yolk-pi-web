import { NextRequest, NextResponse } from "next/server";
import { getGitMetadataForCwd } from "@/lib/git-worktree";

export async function GET(req: NextRequest) {
  const cwd = req.nextUrl.searchParams.get("cwd");
  if (!cwd) {
    return NextResponse.json({ error: "cwd is required" }, { status: 400 });
  }

  try {
    const git = await getGitMetadataForCwd(cwd);
    return NextResponse.json({ git });
  } catch {
    return NextResponse.json({ git: undefined });
  }
}
