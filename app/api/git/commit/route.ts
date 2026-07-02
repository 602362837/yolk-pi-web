import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { GIT_LONG_ACTION_TIMEOUT_MS, GitActionUserError, getGitErrorMessage as getGitActionErrorMessage, jsonGitActionError, resolveAuthorizedGitRepo, runGit } from "@/lib/git-actions";
import type { GitCommitChangedFile, GitCommitCreateResponse, GitCommitDetail, GitCommitFileStatus, GitCommitRef } from "@/lib/types";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

const GIT_BUFFER = 4 * 1024 * 1024;

class GitCommitUserError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "GitCommitUserError";
  }
}

function getGitErrorMessage(error: unknown): string {
  return getGitActionErrorMessage(error);
}

async function git(args: string[], cwd: string, maxBuffer = GIT_BUFFER): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer,
  });
  return String(stdout);
}

async function validateGitRepository(cwd: string): Promise<boolean> {
  try {
    await git(["rev-parse", "--show-toplevel"], cwd);
    return true;
  } catch {
    return false;
  }
}

async function normalizeCommitHash(cwd: string, hash: string): Promise<string> {
  try {
    return (await git(["rev-parse", "--verify", `${hash}^{commit}`], cwd)).trim();
  } catch {
    throw new GitCommitUserError("Commit not found", 404);
  }
}

function parseRefs(refsStr: string): GitCommitRef[] {
  const refs: GitCommitRef[] = [];
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
  return refs;
}

function normalizeStatus(raw: string): GitCommitFileStatus {
  const status = raw.charAt(0);
  if (["M", "A", "D", "R", "C", "T", "U"].includes(status)) {
    return status as GitCommitFileStatus;
  }
  return "?";
}

function parseNameStatus(output: string): GitCommitChangedFile[] {
  const tokens = output.split("\0").filter((token) => token.length > 0);
  const files: GitCommitChangedFile[] = [];
  for (let i = 0; i < tokens.length;) {
    const rawStatus = tokens[i++] ?? "";
    const status = normalizeStatus(rawStatus);
    if (status === "R" || status === "C") {
      const oldFile = tokens[i++];
      const file = tokens[i++];
      if (file) files.push({ status, file, oldFile });
      continue;
    }

    const file = tokens[i++];
    if (file) files.push({ status, file });
  }
  return files;
}

function parseNumstat(output: string): Map<string, { additions?: number; deletions?: number; binary?: boolean }> {
  const stats = new Map<string, { additions?: number; deletions?: number; binary?: boolean }>();
  const tokens = output.split("\0").filter((token) => token.length > 0);

  for (let i = 0; i < tokens.length;) {
    const head = tokens[i++] ?? "";
    const parts = head.split("\t");
    if (parts.length < 3) continue;

    const addRaw = parts[0];
    const delRaw = parts[1];
    let file = parts.slice(2).join("\t");
    let oldFile: string | undefined;

    if (!file) {
      oldFile = tokens[i++];
      file = tokens[i++] ?? "";
    }

    if (!file) continue;
    const binary = addRaw === "-" || delRaw === "-";
    stats.set(file, {
      additions: binary ? undefined : parseInt(addRaw, 10) || 0,
      deletions: binary ? undefined : parseInt(delRaw, 10) || 0,
      binary,
    });
    if (oldFile && !stats.has(oldFile)) {
      stats.set(oldFile, stats.get(file)!);
    }
  }

  return stats;
}

async function getChangedFiles(cwd: string, hash: string, parents: string[]): Promise<GitCommitChangedFile[]> {
  const nameStatusArgs = parents.length === 0
    ? ["diff-tree", "--root", "--no-commit-id", "-r", "--find-renames", "--find-copies", "--name-status", "-z", hash]
    : ["diff", "--find-renames", "--find-copies", "--name-status", "-z", parents[0], hash];
  const numstatArgs = parents.length === 0
    ? ["diff-tree", "--root", "--no-commit-id", "-r", "--find-renames", "--find-copies", "--numstat", "-z", hash]
    : ["diff", "--find-renames", "--find-copies", "--numstat", "-z", parents[0], hash];

  const [nameStatusOutput, numstatOutput] = await Promise.all([
    git(nameStatusArgs, cwd).catch(() => ""),
    git(numstatArgs, cwd).catch(() => ""),
  ]);

  const files = parseNameStatus(nameStatusOutput);
  const stats = parseNumstat(numstatOutput);
  return files.map((file) => ({
    ...file,
    ...stats.get(file.file),
  }));
}

async function getCommitDetail(cwd: string, hash: string): Promise<GitCommitDetail> {
  const format = "%H%x00%h%x00%P%x00%an%x00%ae%x00%ai%x00%ar%x00%cn%x00%ce%x00%ci%x00%s%x00%b%x00%D";
  const metadata = await git(["show", "-s", "--decorate=full", `--format=${format}`, hash], cwd);
  const parts = metadata.split("\0");
  if (parts.length < 13) {
    throw new GitCommitUserError("Unable to parse commit metadata", 500);
  }

  const [
    fullHash,
    shortHash,
    parentsRaw,
    authorName,
    authorEmail,
    authorDate,
    authorRelativeDate,
    committerName,
    committerEmail,
    committerDate,
    subject,
    body,
    refsRaw,
  ] = parts;
  const parents = parentsRaw.trim() ? parentsRaw.trim().split(/\s+/) : [];
  const files = await getChangedFiles(cwd, fullHash.trim(), parents);

  return {
    hash: fullHash.trim(),
    shortHash: shortHash.trim(),
    parents,
    author: {
      name: authorName.trim(),
      email: authorEmail.trim(),
      date: authorDate.trim(),
      relativeDate: authorRelativeDate.trim(),
    },
    committer: {
      name: committerName.trim(),
      email: committerEmail.trim(),
      date: committerDate.trim(),
    },
    subject: subject.trim(),
    body: body.trim(),
    refs: parseRefs((refsRaw ?? "").trim()),
    files,
  };
}

export async function GET(req: NextRequest) {
  const cwd = req.nextUrl.searchParams.get("cwd");
  const hash = req.nextUrl.searchParams.get("hash")?.trim() ?? "";

  if (!cwd) {
    return NextResponse.json({ error: "cwd is required" }, { status: 400 });
  }
  if (!hash) {
    return NextResponse.json({ error: "hash is required" }, { status: 400 });
  }

  try {
    const isRepo = await validateGitRepository(cwd);
    if (!isRepo) return NextResponse.json({ detail: null });

    const normalizedHash = await normalizeCommitHash(cwd, hash);
    const detail = await getCommitDetail(cwd, normalizedHash);
    return NextResponse.json({ detail });
  } catch (error) {
    const status = error instanceof GitCommitUserError ? error.status : 500;
    const message = error instanceof GitCommitUserError ? error.message : getGitErrorMessage(error);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({})) as { cwd?: unknown; message?: unknown };
    const cwd = typeof body.cwd === "string" ? body.cwd : "";
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) throw new GitActionUserError("Commit message is required", 400);
    if (message.length > 64 * 1024) throw new GitActionUserError("Commit message is too large", 400);

    const repo = await resolveAuthorizedGitRepo(cwd);
    const branch = (await runGit(["rev-parse", "--abbrev-ref", "HEAD"], repo.repoRoot)).trim();
    if (!branch || branch === "HEAD") {
      throw new GitActionUserError("Detached HEAD cannot be committed from the Git panel. Switch to a local branch first.", 409);
    }

    try {
      await runGit(["diff", "--cached", "--quiet", "--exit-code"], repo.repoRoot);
      throw new GitActionUserError("No staged changes to commit", 409);
    } catch (error) {
      if (error instanceof GitActionUserError) throw error;
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
      if (code !== 1) throw error;
    }

    await runGit(["commit", "-m", message], repo.repoRoot, { timeout: GIT_LONG_ACTION_TIMEOUT_MS });
    const hash = (await runGit(["rev-parse", "HEAD"], repo.repoRoot)).trim();
    const shortHash = (await runGit(["rev-parse", "--short", "HEAD"], repo.repoRoot)).trim();

    const response: GitCommitCreateResponse = { success: true, hash, shortHash, branch };
    return NextResponse.json(response);
  } catch (error) {
    const details = jsonGitActionError(error);
    return NextResponse.json({ error: details.error }, { status: details.status });
  }
}
