import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import type { GitCommitFileDiffResponse } from "@/lib/types";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

const EMPTY_TREE_HASH = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const DIFF_BUFFER = 2 * 1024 * 1024;

interface GitExecError extends Error {
  code?: string;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
}

class GitDiffUserError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "GitDiffUserError";
  }
}

function getGitErrorMessage(error: unknown): string {
  const err = error as Partial<GitExecError>;
  const stderr = typeof err.stderr === "string" ? err.stderr : err.stderr?.toString();
  const stdout = typeof err.stdout === "string" ? err.stdout : err.stdout?.toString();
  const message = error instanceof Error ? error.message : String(error);
  return (stderr || stdout || message || "Git command failed").trim();
}

function isMaxBufferError(error: unknown): boolean {
  const err = error as Partial<GitExecError>;
  return err.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" || /maxBuffer/i.test(err.message ?? "");
}

async function git(args: string[], cwd: string, maxBuffer = DIFF_BUFFER): Promise<string> {
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
    throw new GitDiffUserError("Commit not found", 404);
  }
}

async function getFirstParent(cwd: string, hash: string): Promise<string | null> {
  const output = await git(["show", "-s", "--format=%P", hash], cwd);
  const parents = output.trim() ? output.trim().split(/\s+/) : [];
  return parents[0] ?? null;
}

function literalPathspec(path: string): string {
  return `:(literal)${path}`;
}

function looksBinaryDiff(diff: string): boolean {
  return /(^|\n)Binary files .+ differ(\n|$)/.test(diff) || /(^|\n)GIT binary patch(\n|$)/.test(diff);
}

async function buildDiff(cwd: string, hash: string, file: string, oldFile?: string): Promise<string> {
  const parent = await getFirstParent(cwd, hash);
  const pathspecs = [literalPathspec(file)];
  if (oldFile && oldFile !== file) pathspecs.push(literalPathspec(oldFile));

  const commonArgs = [
    "--no-ext-diff",
    "--no-color",
    "--find-renames",
    "--find-copies",
    "--patch",
  ];

  const args = parent
    ? ["diff", ...commonArgs, parent, hash, "--", ...pathspecs]
    : ["diff", ...commonArgs, EMPTY_TREE_HASH, hash, "--", ...pathspecs];

  return git(args, cwd, DIFF_BUFFER);
}

export async function GET(req: NextRequest) {
  const cwd = req.nextUrl.searchParams.get("cwd");
  const hash = req.nextUrl.searchParams.get("hash")?.trim() ?? "";
  const file = req.nextUrl.searchParams.get("path") ?? "";
  const oldFileParam = req.nextUrl.searchParams.get("oldPath");
  const oldFile = oldFileParam && oldFileParam.length > 0 ? oldFileParam : undefined;

  if (!cwd) {
    return NextResponse.json({ error: "cwd is required" }, { status: 400 });
  }
  if (!hash) {
    return NextResponse.json({ error: "hash is required" }, { status: 400 });
  }
  if (!file) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }

  try {
    const isRepo = await validateGitRepository(cwd);
    if (!isRepo) {
      const response: GitCommitFileDiffResponse = {
        hash,
        file,
        oldFile,
        diffAvailable: false,
        reason: "unavailable",
      };
      return NextResponse.json(response);
    }

    const normalizedHash = await normalizeCommitHash(cwd, hash);
    let diff: string;
    try {
      diff = await buildDiff(cwd, normalizedHash, file, oldFile);
    } catch (error) {
      if (isMaxBufferError(error)) {
        const response: GitCommitFileDiffResponse = {
          hash: normalizedHash,
          file,
          oldFile,
          diffAvailable: false,
          reason: "too-large",
        };
        return NextResponse.json(response);
      }
      throw error;
    }

    if (looksBinaryDiff(diff)) {
      const response: GitCommitFileDiffResponse = {
        hash: normalizedHash,
        file,
        oldFile,
        diffAvailable: false,
        reason: "binary",
      };
      return NextResponse.json(response);
    }

    if (!diff.trim()) {
      const response: GitCommitFileDiffResponse = {
        hash: normalizedHash,
        file,
        oldFile,
        diffAvailable: false,
        reason: "unavailable",
      };
      return NextResponse.json(response);
    }

    const response: GitCommitFileDiffResponse = {
      hash: normalizedHash,
      file,
      oldFile,
      diffAvailable: true,
      diff,
    };
    return NextResponse.json(response);
  } catch (error) {
    const status = error instanceof GitDiffUserError ? error.status : 500;
    const message = error instanceof GitDiffUserError ? error.message : getGitErrorMessage(error);
    return NextResponse.json({ error: message }, { status });
  }
}
