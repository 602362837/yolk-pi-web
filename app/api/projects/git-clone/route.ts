import { execFile } from "child_process";
import { access, constants, stat } from "fs/promises";
import { promisify } from "util";
import { isAbsolute, normalize, resolve } from "path";
import { homedir } from "os";
import { NextResponse } from "next/server";
import {
  ProjectRegistryError,
  registerProject,
  syncProjectWorktreeSpaces,
} from "@/lib/project-registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

type GitCloneErrorCode =
  | "invalid_parent_path"
  | "invalid_remote_repository"
  | "git_not_available"
  | "target_exists"
  | "clone_failed"
  | "clone_timeout"
  | "register_failed";

interface GitCloneErrorResponse {
  error: string;
  code?: GitCloneErrorCode;
  clonedPath?: string;
}

interface GitCloneRequest {
  parentPath?: unknown;
  remoteRepository?: unknown;
}

interface GitCloneResult {
  project: Awaited<ReturnType<typeof registerProject>>["project"];
  created: boolean;
  worktrees: Awaited<ReturnType<typeof syncProjectWorktreeSpaces>>;
  clone: {
    parentPath: string;
    targetPath: string;
    repositoryName: string;
    remoteRepository: string;
  };
}

const CLONE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

function cloneError(
  error: string,
  code: GitCloneErrorCode,
  status = 400,
  clonedPath?: string,
): NextResponse<GitCloneErrorResponse> {
  const body: GitCloneErrorResponse = { error, code };
  if (clonedPath) body.clonedPath = clonedPath;
  return NextResponse.json(body, { status });
}

function expandParentPath(inputPath: string): string {
  const trimmed = inputPath.trim();
  const expanded =
    trimmed === "~"
      ? homedir()
      : trimmed.startsWith("~/")
        ? resolve(homedir(), trimmed.slice(2))
        : trimmed;
  const normalized = normalize(isAbsolute(expanded) ? expanded : resolve(expanded));
  // Strip trailing separators but keep filesystem root.
  return normalized.replace(/[\\/]+$/, "") || normalized;
}

// Derive the directory name git would create from a remote URL. Mirrors git's
// own basename derivation for the final path segment, without invoking a shell.
function deriveRepositoryName(remoteRepository: string): string {
  let raw = remoteRepository.trim();
  // Drop a trailing .git (case-insensitive) if present.
  if (raw.toLowerCase().endsWith(".git")) raw = raw.slice(0, -4);
  // Take the last path segment. Handles scp-like `git@host:user/repo` and
  // URL forms `https://host/user/repo` or `file:///path/to/repo`.
  raw = raw.replace(/[\\/]+$/, "");
  const segments = raw.split(/[\\/]/);
  const last = segments[segments.length - 1] || "";
  // scp-like syntax: `git@host:user/repo` -> the segment after the colon.
  if (segments.length === 1 && last.includes(":")) {
    return last.slice(last.lastIndexOf(":") + 1) || "";
  }
  return last;
}

function isValidRemoteRepository(remoteRepository: string): boolean {
  const trimmed = remoteRepository.trim();
  if (!trimmed) return false;
  // Reject obvious shell metacharacters that have no place in a remote URL.
  // execFile is used so these would not be interpreted anyway, but blocking them
  // here gives clearer errors and avoids surprising argument boundaries.
  if (/[\s;|&$`<>]/.test(trimmed)) return false;
  // Accept git's supported transports: https://, http://, ssh://, git://,
  // file://, scp-like `user@host:path`, and local paths.
  return true;
}

export async function POST(request: Request) {
  let body: GitCloneRequest;
  try {
    body = (await request.json().catch(() => ({}))) as GitCloneRequest;
  } catch {
    return cloneError("Invalid JSON body.", "invalid_remote_repository");
  }

  const parentPathRaw = typeof body.parentPath === "string" ? body.parentPath : "";
  const remoteRepositoryRaw =
    typeof body.remoteRepository === "string" ? body.remoteRepository : "";

  if (!parentPathRaw.trim()) {
    return cloneError("Local parent path is required.", "invalid_parent_path");
  }
  if (!remoteRepositoryRaw.trim()) {
    return cloneError("Remote repository is required.", "invalid_remote_repository");
  }
  if (!isValidRemoteRepository(remoteRepositoryRaw)) {
    return cloneError(
      "Remote repository contains invalid characters.",
      "invalid_remote_repository",
    );
  }

  const parentPath = expandParentPath(parentPathRaw);
  const remoteRepository = remoteRepositoryRaw.trim();
  const repositoryName = deriveRepositoryName(remoteRepository);
  if (!repositoryName) {
    return cloneError(
      "Could not derive a repository directory name from the remote repository URL.",
      "invalid_remote_repository",
    );
  }
  const targetPath = resolve(parentPath, repositoryName);

  // Validate parent path: must exist, be a directory, and be writable.
  let parentStat;
  try {
    parentStat = await stat(parentPath);
  } catch {
    return cloneError(
      `Parent directory does not exist: ${parentPath}`,
      "invalid_parent_path",
      404,
    );
  }
  if (!parentStat.isDirectory()) {
    return cloneError(
      `Parent path is not a directory: ${parentPath}`,
      "invalid_parent_path",
    );
  }
  try {
    await access(parentPath, constants.W_OK);
  } catch {
    return cloneError(
      `Parent directory is not writable: ${parentPath}`,
      "invalid_parent_path",
      403,
    );
  }

  // Reject if target already exists to avoid overwriting user files.
  try {
    await stat(targetPath);
    return cloneError(
      `Target directory already exists: ${targetPath}`,
      "target_exists",
      409,
    );
  } catch {
    // expected: target does not exist
  }

  // Check git availability.
  try {
    await execFileAsync("git", ["--version"], { timeout: 10_000 });
  } catch {
    return cloneError(
      "Git is not available on the server PATH.",
      "git_not_available",
      500,
    );
  }

  // Execute the clone using execFile argument array (no shell), and disable
  // interactive credential prompts so private-repo auth hangs fail fast instead
  // of waiting for terminal input that will never arrive.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "0",
    GIT_ASKPASS: "",
    SSH_ASKPASS: "",
  };
  try {
    await execFileAsync("git", ["clone", "--", remoteRepository, targetPath], {
      cwd: parentPath,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: CLONE_TIMEOUT_MS,
      env,
    });
  } catch (error) {
    const err = error as { stderr?: string; stdout?: string; message?: string; code?: string; killed?: boolean; signal?: string };
    if (err.killed || err.signal === "SIGTERM") {
      return cloneError(
        `Git clone timed out after ${Math.round(CLONE_TIMEOUT_MS / 1000)}s.`,
        "clone_timeout",
        504,
        targetPath,
      );
    }
    const detail = (err.stderr || err.stdout || err.message || "Git clone failed.")
      .trim()
      .split("\n")
      .slice(-8)
      .join("\n")
      .slice(0, 2000);
    return cloneError(detail || "Git clone failed.", "clone_failed", 502, targetPath);
  }

  // Verify the clone produced the expected directory.
  let targetStat;
  try {
    targetStat = await stat(targetPath);
  } catch {
    return cloneError(
      `Clone reported success but target directory was not created: ${targetPath}`,
      "clone_failed",
      500,
    );
  }
  if (!targetStat.isDirectory()) {
    return cloneError(
      `Clone target is not a directory: ${targetPath}`,
      "clone_failed",
      500,
    );
  }

  // Register the cloned project path (not the parent directory).
  let registered;
  try {
    registered = await registerProject({ path: targetPath });
  } catch (error) {
    const message = error instanceof ProjectRegistryError ? error.message : "Project registration failed.";
    const status = error instanceof ProjectRegistryError ? error.status : 500;
    const resp = cloneError(message, "register_failed", status, targetPath);
    return resp;
  }

  let worktrees;
  try {
    worktrees = await syncProjectWorktreeSpaces(registered.project.id);
  } catch (error) {
    // Worktree sync is best-effort; surface a warning but keep the registration.
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({
      ...registered,
      project: registered.project,
      worktrees: { project: registered.project, spaces: [], created: [], archivedMissing: [], syncWarning: message },
      clone: {
        parentPath,
        targetPath,
        repositoryName,
        remoteRepository,
      },
    } as unknown as GitCloneResult, { status: 201 });
  }

  const result: GitCloneResult = {
    project: worktrees.project,
    created: registered.created,
    worktrees,
    clone: {
      parentPath,
      targetPath,
      repositoryName,
      remoteRepository,
    },
  };
  return NextResponse.json(result, { status: registered.created ? 201 : 200 });
}
