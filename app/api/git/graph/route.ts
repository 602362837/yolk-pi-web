import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import type { GitGraphData, GitGraphCommit, GitCommitRef, GitBranchInfo } from "@/lib/types";

const execFileAsync = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  return stdout;
}

/**
 * Parse git log output with structured format.
 * Format: %H||P|%P||D|%D||A|%an||R|%ar||I|%ai||S|%s
 * Separators: || (double pipe) between fields, | single pipe within decorations
 */
function parseLogOutput(output: string): GitGraphCommit[] {
  const commits: GitGraphCommit[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;

    // Format: hash|||parent1 parent2|||refs|||author|||relativeDate|||isoDate|||subject
    const parts = line.split("|||");
    if (parts.length < 7) continue;

    const hash = parts[0].trim();
    const parentsStr = parts[1].trim();
    const refsStr = parts[2].trim();
    const author = parts[3].trim();
    const relativeDate = parts[4].trim();
    const date = parts[5].trim();
    const message = parts[6].trim();

    const parents = parentsStr ? parentsStr.split(/\s+/) : [];

    // Parse decorations with --decorate=full format:
    //   HEAD -> refs/heads/main
    //   refs/heads/feature-x
    //   refs/remotes/origin/main
    //   tag: refs/tags/v1.0
    const refs: GitCommitRef[] = [];
    if (refsStr) {
      const decorations = refsStr.split(",").map((s) => s.trim()).filter(Boolean);
      for (const deco of decorations) {
        let name = deco;
        let type: GitCommitRef["type"] = "branch";

        if (deco.startsWith("tag: ")) {
          type = "tag";
          name = deco.slice(5).trim();
          if (name.startsWith("refs/tags/")) name = name.slice(10);
        } else if (deco.startsWith("HEAD -> ")) {
          type = "head";
          name = deco.slice(8).trim();
          if (name.startsWith("refs/heads/")) name = name.slice(11);
        } else if (deco.startsWith("refs/heads/")) {
          type = "branch";
          name = deco.slice(11);
        } else if (deco.startsWith("refs/remotes/")) {
          type = "remote";
          name = deco.slice(13);
        } else if (deco.startsWith("refs/tags/")) {
          type = "tag";
          name = deco.slice(10);
        }

        refs.push({ name, type });
      }
    }

    commits.push({
      hash,
      message,
      author,
      date,
      relativeDate,
      parents,
      refs,
    });
  }
  return commits;
}

function parseBranchOutput(output: string): GitBranchInfo[] {
  const branches: GitBranchInfo[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    // Format: isCurrent|||refname|||objectname|||upstream|||ahead behind
    // isCurrent: "*" or " "
    const parts = line.split("|||");
    if (parts.length < 3) continue;

    const isCurrent = parts[0].trim() === "*";
    const name = parts[1].trim();
    const latestCommit = parts[2].trim();

    let upstream: string | null = null;
    let ahead = 0;
    let behind = 0;

    if (parts.length >= 4) {
      upstream = parts[3].trim() || null;
    }
    if (parts.length >= 5 && parts[4].trim()) {
      // Format: "ahead N" or "behind M" or "ahead N, behind M"
      const trackStr = parts[4].trim();
      const aheadMatch = trackStr.match(/ahead\s+(\d+)/);
      const behindMatch = trackStr.match(/behind\s+(\d+)/);
      if (aheadMatch) ahead = parseInt(aheadMatch[1], 10) || 0;
      if (behindMatch) behind = parseInt(behindMatch[1], 10) || 0;
    }

    branches.push({ name, isCurrent, upstream, ahead, behind, latestCommit });
  }
  return branches;
}

export async function GET(req: NextRequest) {
  const cwd = req.nextUrl.searchParams.get("cwd");
  if (!cwd) {
    return NextResponse.json({ error: "cwd is required" }, { status: 400 });
  }

  try {
    // Validate it's a git repo
    try {
      await git(["rev-parse", "--show-toplevel"], cwd);
    } catch {
      return NextResponse.json({ data: null });
    }

    const maxCount = parseInt(req.nextUrl.searchParams.get("maxCount") || "50", 10);
    const branch = req.nextUrl.searchParams.get("branch")?.trim() ?? "";

    if (branch) {
      try {
        await git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], cwd);
      } catch {
        return NextResponse.json({ data: null, error: `Local branch not found: ${branch}` }, { status: 404 });
      }
    }

    const logTargetArgs = branch ? [`refs/heads/${branch}`] : ["--all"];

    // Fetch all data in parallel
    const [logOutput, branchOutput] = await Promise.all([
      // Custom format that's easy to parse: hash|||parents|||decorations|||author|||relativeDate|||isoDate|||subject
      git([
        "log", ...logTargetArgs, "--decorate=full",
        `--max-count=${maxCount}`,
        "--format=%H|||%P|||%D|||%an|||%ar|||%ai|||%s",
      ], cwd).catch(() => ""),
      git([
        "branch", "--format=%(if)%(HEAD)%(then)*%(else) %(end)|||%(refname:short)|||%(objectname)|||%(upstream:short)|||%(upstream:track)",
      ], cwd).catch(() => ""),
    ]);

    const commits = parseLogOutput(logOutput);
    const branches = parseBranchOutput(branchOutput);

    const data: GitGraphData = { commits, branches };

    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ data: null });
  }
}
