import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import type { GitStatusInfo, GitFileChange, GitCommitInfo } from "@/lib/types";

const execFileAsync = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  return stdout;
}

function parsePorcelainV1(output: string): {
  staged: GitFileChange[];
  unstaged: GitFileChange[];
  untracked: string[];
} {
  const staged: GitFileChange[] = [];
  const unstaged: GitFileChange[] = [];
  const untracked: string[] = [];

  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;

    // Untracked files
    if (line.startsWith("?? ")) {
      untracked.push(line.slice(3));
      continue;
    }

    // Renamed or copied files with origin path
    const renameMatch = line.match(/^([ MADRCU?!][ MADRCU?!])\s(.+?)\s*->\s*(.+)$/);
    if (renameMatch) {
      const [, xy, oldFile, file] = renameMatch;
      const xStatus = xy[0] !== " " ? xy[0] : undefined;
      const yStatus = xy[1] !== " " ? xy[1] : undefined;
      const statusChar = (yStatus ?? xStatus ?? "?") as GitFileChange["status"];

      if (xStatus) {
        staged.push({ status: statusChar, file, oldFile });
      }
      if (yStatus) {
        unstaged.push({ status: statusChar, file, oldFile });
      }
      continue;
    }

    // Standard two-character status
    const match = line.match(/^([ MADRCU?!])([ MADRCU?!])\s(.+)$/);
    if (!match) continue;

    const [, x, y, file] = match;
    const xStatus = x !== " " ? x : undefined;
    const yStatus = y !== " " ? y : undefined;

    if (xStatus) {
      staged.push({ status: xStatus as GitFileChange["status"], file });
    }
    if (yStatus) {
      unstaged.push({ status: yStatus as GitFileChange["status"], file });
    }
  }

  return { staged, unstaged, untracked };
}

function parseLog(output: string): GitCommitInfo[] {
  const commits: GitCommitInfo[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const tab1 = line.indexOf("\t");
    if (tab1 === -1) continue;
    const hash = line.slice(0, tab1);
    const rest = line.slice(tab1 + 1);

    const tab2 = rest.indexOf("\t");
    if (tab2 === -1) continue;
    const author = rest.slice(0, tab2);
    const rest2 = rest.slice(tab2 + 1);

    const tab3 = rest2.indexOf("\t");
    if (tab3 === -1) continue;
    const relativeDate = rest2.slice(0, tab3);
    const rest3 = rest2.slice(tab3 + 1);

    const tab4 = rest3.indexOf("\t");
    if (tab4 === -1) continue;
    const date = rest3.slice(0, tab4);
    const message = rest3.slice(tab4 + 1);

    commits.push({ hash, message, author, date, relativeDate });
  }
  return commits;
}

export async function GET(req: NextRequest) {
  const cwd = req.nextUrl.searchParams.get("cwd");
  if (!cwd) {
    return NextResponse.json({ error: "cwd is required" }, { status: 400 });
  }

  try {
    // Validate it's a git repo first
    try {
      await git(["rev-parse", "--show-toplevel"], cwd);
    } catch {
      // Not a git repository
      return NextResponse.json({ status: null });
    }

    // Run status, log, stash, branch info, and worktree detection in parallel
    const [
      statusOutput,
      logOutput,
      stashOutput,
      branchOutput,
      gitDir,
      gitCommonDir,
      upstreamOutput,
      aheadBehindOutput,
    ] = await Promise.all([
      git(["status", "--porcelain"], cwd).catch(() => ""),
      git(["log", "--format=%H\t%an\t%ar\t%ai\t%s", "-10"], cwd).catch(() => ""),
      git(["stash", "list"], cwd).catch(() => ""),
      git(["rev-parse", "--abbrev-ref", "HEAD"], cwd).catch(() => "HEAD"),
      git(["rev-parse", "--git-dir"], cwd).catch(() => ""),
      git(["rev-parse", "--git-common-dir"], cwd).catch(() => ""),
      git(["rev-parse", "--abbrev-ref", "@{upstream}"], cwd).catch(() => ""),
      git(["rev-list", "--count", "--left-right", "HEAD...@{upstream}"], cwd).catch(() => ""),
    ]).catch(() => {
      // If parallel fails, retry minimal set
      throw new Error("Git command failed");
    });

    const { staged, unstaged, untracked } = parsePorcelainV1(statusOutput.trim());
    const isDirty = staged.length > 0 || unstaged.length > 0 || untracked.length > 0;

    const isDetached = branchOutput.trim() === "HEAD";
    const branch = isDetached
      ? null
      : branchOutput.trim() || null;

    const upstream = upstreamOutput.trim() || null;

    let ahead = 0;
    let behind = 0;
    if (aheadBehindOutput.trim()) {
      const parts = aheadBehindOutput.trim().split(/\s+/);
      if (parts.length >= 2) {
        ahead = parseInt(parts[0], 10) || 0;
        behind = parseInt(parts[1], 10) || 0;
      }
    }

    // Worktree detection: compare --git-dir with --git-common-dir
    const gitDirStr = gitDir.trim();
    const gitCommonDirStr = gitCommonDir.trim();
    const isWorktree = gitDirStr !== gitCommonDirStr && gitDirStr.endsWith("/.git") === false &&
      Boolean(gitDirStr) && Boolean(gitCommonDirStr);

    const stashCount = stashOutput.trim() ? stashOutput.trim().split(/\r?\n/).length : 0;

    const recentCommits = parseLog(logOutput.trim());

    const status: GitStatusInfo = {
      branch,
      upstream,
      isDetached,
      isDirty,
      isWorktree,
      ahead,
      behind,
      staged,
      unstaged,
      untracked,
      recentCommits,
      stashCount,
    };

    return NextResponse.json({ status });
  } catch {
    return NextResponse.json({ status: null });
  }
}
