import { execFile } from "child_process";
import { statSync } from "fs";
import path from "path";
import { promisify } from "util";
import { getAllowedRoots, isPathAllowed } from "@/lib/allowed-roots";
import { canonicalizeCwd } from "@/lib/cwd";
import type { GitFileActionTarget } from "@/lib/types";

const execFileAsync = promisify(execFile);

export const GIT_ACTION_BUFFER = 4 * 1024 * 1024;
export const GIT_ACTION_TIMEOUT_MS = 30_000;
export const GIT_LONG_ACTION_TIMEOUT_MS = 120_000;

interface GitExecError extends Error {
  stdout?: string | Buffer;
  stderr?: string | Buffer;
}

export class GitActionUserError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "GitActionUserError";
  }
}

export interface AuthorizedGitRepo {
  cwd: string;
  repoRoot: string;
}

export function getGitErrorMessage(error: unknown): string {
  const err = error as Partial<GitExecError>;
  const stderr = typeof err.stderr === "string" ? err.stderr : err.stderr?.toString();
  const stdout = typeof err.stdout === "string" ? err.stdout : err.stdout?.toString();
  const message = error instanceof Error ? error.message : String(error);
  return (stderr || stdout || message || "Git command failed").trim();
}

export async function runGit(
  args: string[],
  cwd: string,
  options: { timeout?: number; maxBuffer?: number } = {},
): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: options.maxBuffer ?? GIT_ACTION_BUFFER,
    timeout: options.timeout ?? GIT_ACTION_TIMEOUT_MS,
  });
  return String(stdout);
}

export async function resolveAuthorizedGitRepo(rawCwd: string): Promise<AuthorizedGitRepo> {
  const cwd = rawCwd.trim();
  if (!cwd) throw new GitActionUserError("cwd is required", 400);

  const canonicalCwd = canonicalizeCwd(cwd);
  try {
    if (!statSync(canonicalCwd).isDirectory()) {
      throw new GitActionUserError("cwd is not a directory", 400);
    }
  } catch (error) {
    if (error instanceof GitActionUserError) throw error;
    throw new GitActionUserError("cwd does not exist", 400);
  }

  const allowedRoots = await getAllowedRoots();
  if (!isPathAllowed(canonicalCwd, allowedRoots)) {
    throw new GitActionUserError("cwd is outside the authorized workspace roots", 403);
  }

  let repoRoot: string;
  try {
    repoRoot = (await runGit(["rev-parse", "--show-toplevel"], canonicalCwd)).trim();
  } catch {
    throw new GitActionUserError("Not a Git repository", 404);
  }

  const canonicalRepoRoot = canonicalizeCwd(repoRoot);
  if (!isPathAllowed(canonicalRepoRoot, allowedRoots)) {
    throw new GitActionUserError("Git repository root is outside the authorized workspace roots", 403);
  }

  return { cwd: canonicalCwd, repoRoot: canonicalRepoRoot };
}

function validateOnePathspec(file: unknown): string {
  if (typeof file !== "string") throw new GitActionUserError("file must be a string", 400);
  const value = file;
  if (value.length === 0) throw new GitActionUserError("file must not be empty", 400);
  if (value.includes("\0")) throw new GitActionUserError("file must not contain NUL bytes", 400);
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
    throw new GitActionUserError("file pathspec must be repository-relative", 400);
  }
  const normalized = value.replace(/\\/g, "/");
  const parts = normalized.split("/");
  if (parts.includes("..")) {
    throw new GitActionUserError("file pathspec must not traverse parent directories", 400);
  }
  if (parts.includes(".")) {
    throw new GitActionUserError("file pathspec must identify a file or directory, not '.'", 400);
  }
  return value;
}

export function normalizeGitPathspecs(files: unknown): string[] {
  if (!Array.isArray(files) || files.length === 0) {
    throw new GitActionUserError("files must be a non-empty array", 400);
  }
  if (files.length > 500) {
    throw new GitActionUserError("too many files in one Git operation", 400);
  }

  const pathspecs = new Set<string>();
  for (const item of files) {
    if (!item || typeof item !== "object") {
      throw new GitActionUserError("each file target must be an object", 400);
    }
    const target = item as Partial<GitFileActionTarget>;
    pathspecs.add(validateOnePathspec(target.file));
    if (typeof target.oldFile !== "undefined" && target.oldFile !== null && target.oldFile !== "") {
      pathspecs.add(validateOnePathspec(target.oldFile));
    }
  }

  return [...pathspecs];
}

export function toRepoRelativeGitPathspecs(files: unknown, repo: AuthorizedGitRepo): string[] {
  const pathspecs = normalizeGitPathspecs(files);
  const repoRelative = new Set<string>();

  for (const pathspec of pathspecs) {
    const absoluteTarget = path.resolve(repo.cwd, pathspec);
    const relativeTarget = path.relative(repo.repoRoot, absoluteTarget).replace(/\\/g, "/");
    if (!relativeTarget || relativeTarget === "" || relativeTarget.startsWith("../") || relativeTarget === "..") {
      throw new GitActionUserError("file pathspec must stay inside the current Git repository", 400);
    }
    repoRelative.add(relativeTarget);
  }

  return [...repoRelative];
}

export function jsonGitActionError(error: unknown): { error: string; status: number } {
  if (error instanceof GitActionUserError) return { error: error.message, status: error.status };
  return { error: getGitErrorMessage(error), status: 500 };
}
