import { execFile } from "child_process";
import { promisify } from "util";
import { basename, dirname, isAbsolute, resolve } from "path";
import { existsSync, mkdirSync } from "fs";
import type { PiWebWorktreeConfig } from "./pi-web-config";

const execFileAsync = promisify(execFile);

export interface GitMetadata {
  isWorktree?: boolean;
  branch?: string;
  repoRoot?: string;
  mainWorktreePath?: string;
  mainWorktreeBranch?: string;
}

export interface WorktreeMetadata extends GitMetadata {
  isWorktree: true;
}

export interface CreateWorktreeOptions {
  cwd: string;
  config: PiWebWorktreeConfig;
  baseRef?: string;
  branchName?: string;
  targetPath?: string;
}

export interface CreateWorktreeResult {
  success: true;
  cwd: string;
  repoRoot: string;
  mainWorktreePath?: string;
  branchName: string;
  baseRef: string;
  targetPath: string;
  isWorktree: true;
  worktree: WorktreeMetadata;
}

export interface WorktreeStatus {
  cwd: string;
  worktree: WorktreeMetadata;
  branch?: string;
  mainWorktreePath?: string;
  mainWorktreeBranch?: string;
  dirty: boolean;
  dirtySummary: string[];
  mergeBase?: string;
  hasChangesSinceBase?: boolean;
}

export interface RemoveWorktreeResult {
  success: true;
  cwd: string;
  fallbackCwd?: string;
  destroyedSessionIds: string[];
}

export interface ArchiveWorktreeResult extends RemoveWorktreeResult {
  branchName: string;
  pushed: boolean;
  merged: boolean;
  squashed: boolean;
}

export class WorktreeUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorktreeUserError";
  }
}

export class MainWorktreeDirtyError extends Error {
  /** @param dirtySummary — raw `git status --porcelain` output for the main worktree */
  constructor(public readonly dirtySummary: string) {
    super(`⛔ 主工作树（被合并目标）有未提交的修改。请先在主工作树提交、暂存或丢弃，再执行归档。`);
    this.name = "MainWorktreeDirtyError";
  }
}

export interface WorktreeRecord {
  path: string;
  branch?: string;
  head?: string;
  bare?: boolean;
  detached?: boolean;
}

async function git(args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    return String(stdout).trim();
  } catch (error) {
    const err = error as { stderr?: string; stdout?: string; message?: string };
    const detail = (err.stderr || err.stdout || err.message || "Git command failed").trim();
    throw new WorktreeUserError(detail);
  }
}

function formatTimestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function slugifyBranch(branchName: string): string {
  return branchName
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "worktree";
}

function expandTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z0-9_-]+)\}/g, (match, key: string) => vars[key] ?? match);
}

function resolveFromRepo(repoRoot: string, targetPath: string): string {
  return isAbsolute(targetPath) ? resolve(targetPath) : resolve(repoRoot, targetPath);
}

function parseWorktreePorcelain(output: string): WorktreeRecord[] {
  const records: WorktreeRecord[] = [];
  let current: WorktreeRecord | null = null;

  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [key, ...rest] = line.split(" ");
    const value = rest.join(" ");
    if (key === "worktree") {
      if (current) records.push(current);
      current = { path: value };
      continue;
    }
    if (!current) continue;
    if (key === "HEAD") current.head = value;
    if (key === "branch") current.branch = value.replace(/^refs\/heads\//, "");
    if (key === "bare") current.bare = true;
    if (key === "detached") current.detached = true;
  }

  if (current) records.push(current);
  return records;
}

export async function discoverGitRoot(cwd: string): Promise<string> {
  if (!cwd || typeof cwd !== "string") {
    throw new WorktreeUserError("cwd is required");
  }
  try {
    return await git(["-C", cwd, "rev-parse", "--show-toplevel"]);
  } catch {
    throw new WorktreeUserError(`Not a Git repository: ${cwd}`);
  }
}

export async function listGitWorktrees(repoRoot: string): Promise<WorktreeRecord[]> {
  const output = await git(["-C", repoRoot, "worktree", "list", "--porcelain"]);
  return parseWorktreePorcelain(output);
}

async function validateBranchName(repoRoot: string, branchName: string): Promise<void> {
  if (!branchName || branchName.trim() !== branchName) {
    throw new WorktreeUserError("Invalid branch name");
  }
  await git(["-C", repoRoot, "check-ref-format", "--branch", branchName]);
}

export async function getGitMetadataForCwd(cwd: string): Promise<GitMetadata | undefined> {
  const repoRoot = await discoverGitRoot(cwd);
  const worktrees = await listGitWorktrees(repoRoot);
  const mainWorktree = worktrees[0];
  const mainWorktreePath = mainWorktree?.path;
  const record = worktrees.find((w) => resolve(w.path) === resolve(repoRoot));
  if (!record) return undefined;

  const isWorktree = Boolean(mainWorktreePath && resolve(repoRoot) !== resolve(mainWorktreePath));
  return {
    isWorktree,
    branch: record.branch,
    repoRoot,
    mainWorktreePath,
    mainWorktreeBranch: mainWorktree?.branch,
  };
}

export async function getWorktreeMetadataForCwd(cwd: string): Promise<WorktreeMetadata | undefined> {
  const metadata = await getGitMetadataForCwd(cwd);
  if (!metadata?.isWorktree) return undefined;
  return {
    isWorktree: true,
    branch: metadata.branch,
    repoRoot: metadata.repoRoot,
    mainWorktreePath: metadata.mainWorktreePath,
    mainWorktreeBranch: metadata.mainWorktreeBranch,
  };
}

export async function getWorktreeStatus(cwd: string): Promise<WorktreeStatus> {
  const metadata = await getWorktreeMetadataForCwd(cwd);
  if (!metadata) {
    throw new WorktreeUserError(`Not a linked Git worktree: ${cwd}`);
  }

  const dirtyOutput = await git(["-C", cwd, "status", "--porcelain"]);
  const dirtySummary = dirtyOutput ? dirtyOutput.split(/\r?\n/).filter(Boolean) : [];
  let mergeBase: string | undefined;
  let hasChangesSinceBase: boolean | undefined;
  if (metadata.mainWorktreeBranch) {
    try {
      mergeBase = await git(["-C", cwd, "merge-base", "HEAD", metadata.mainWorktreeBranch]);
      const changes = await git(["-C", cwd, "diff", "--name-only", `${mergeBase}..HEAD`]);
      hasChangesSinceBase = Boolean(changes.trim());
    } catch {
      // Some repositories may not have the main branch ref locally. Status is still useful.
    }
  }

  return {
    cwd: resolve(cwd),
    worktree: metadata,
    branch: metadata.branch,
    mainWorktreePath: metadata.mainWorktreePath,
    mainWorktreeBranch: metadata.mainWorktreeBranch,
    dirty: dirtySummary.length > 0,
    dirtySummary,
    mergeBase,
    hasChangesSinceBase,
  };
}

export async function removeGitWorktree(cwd: string, options: { force?: boolean; destroyedSessionIds?: string[] } = {}): Promise<RemoveWorktreeResult> {
  const status = await getWorktreeStatus(cwd);
  if (status.dirty && !options.force) {
    throw new WorktreeUserError(`⛔ 当前 WorkTree（${status.branch}）有未提交的修改。请先提交、暂存或勾选强制删除再试：\n${status.dirtySummary.join("\n")}`);
  }

  const fallbackCwd = status.mainWorktreePath;
  const gitCwd = fallbackCwd || cwd;
  await git(["-C", gitCwd, "worktree", "remove", ...(options.force ? ["--force"] : []), cwd]);
  return {
    success: true,
    cwd: resolve(cwd),
    fallbackCwd,
    destroyedSessionIds: options.destroyedSessionIds ?? [],
  };
}

export async function archiveGitWorktree(cwd: string, options: { beforeRemove?: () => string[] | Promise<string[]> } = {}): Promise<ArchiveWorktreeResult> {
  const status = await getWorktreeStatus(cwd);
  if (status.dirty) {
    throw new WorktreeUserError(`⛔ 当前 WorkTree（${status.branch}）有未提交的修改。请先提交、暂存或丢弃，再执行归档：\n${status.dirtySummary.join("\n")}`);
  }
  if (!status.branch) throw new WorktreeUserError("Cannot archive a detached worktree");
  if (!status.mainWorktreePath) throw new WorktreeUserError("Main worktree path was not detected");
  if (!status.mainWorktreeBranch) throw new WorktreeUserError("Main worktree branch was not detected");
  if (status.branch === status.mainWorktreeBranch) {
    throw new WorktreeUserError("Archive requires a worktree branch that differs from the main worktree branch");
  }
  if (!status.mergeBase) {
    throw new WorktreeUserError(`Could not find a merge base between ${status.branch} and ${status.mainWorktreeBranch}`);
  }

  let squashed = false;
  if (status.hasChangesSinceBase) {
    await git(["-C", cwd, "reset", "--soft", status.mergeBase]);
    const staged = await git(["-C", cwd, "diff", "--cached", "--name-only"]);
    if (staged.trim()) {
      await git(["-C", cwd, "commit", "--no-verify", "-m", `archive: ${status.branch}`]);
      squashed = true;
    }
  }

  // Push worktree branch.
  await git(["-C", cwd, "push", "-u", "--force-with-lease", "origin", status.branch]);

  // Main worktree must be clean for checkout + merge.
  const mainDirty = (await git(["-C", status.mainWorktreePath, "status", "--porcelain"])).trim();
  if (mainDirty) {
    throw new MainWorktreeDirtyError(mainDirty);
  }

  await git(["-C", status.mainWorktreePath, "fetch", "origin", status.branch]);
  await git(["-C", status.mainWorktreePath, "checkout", status.mainWorktreeBranch]);
  await git(["-C", status.mainWorktreePath, "-c", "core.hooksPath=/dev/null", "merge", "--no-ff", status.branch, "-m", `merge archived worktree ${status.branch}`]);
  await git(["-C", status.mainWorktreePath, "push", "origin", status.mainWorktreeBranch]);
  const destroyedSessionIds = await options.beforeRemove?.() ?? [];
  await git(["-C", status.mainWorktreePath, "worktree", "remove", cwd]);

  return {
    success: true,
    cwd: resolve(cwd),
    fallbackCwd: status.mainWorktreePath,
    destroyedSessionIds,
    branchName: status.branch,
    pushed: true,
    merged: true,
    squashed,
  };
}

export async function createGitWorktree(options: CreateWorktreeOptions): Promise<CreateWorktreeResult> {
  const repoRoot = await discoverGitRoot(options.cwd);
  const worktrees = await listGitWorktrees(repoRoot);
  const mainWorktree = worktrees[0];
  const mainWorktreePath = mainWorktree?.path;
  const baseRef = options.baseRef?.trim() || options.config.baseRef;

  const repoParent = dirname(repoRoot);
  const repoName = basename(repoRoot);
  const timestamp = formatTimestamp();

  const branchName = options.branchName?.trim() || expandTemplate(options.config.branchNameTemplate, {
    repoRoot,
    repoParent,
    repoName,
    "yyyyMMdd-HHmmss": timestamp,
  });
  await validateBranchName(repoRoot, branchName);

  const branchSlug = slugifyBranch(branchName);
  const baseDir = resolveFromRepo(repoRoot, expandTemplate(options.config.baseDirTemplate, {
    repoRoot,
    repoParent,
    repoName,
    branchName,
    branchSlug,
    "yyyyMMdd-HHmmss": timestamp,
  }));
  const targetPath = resolveFromRepo(repoRoot, options.targetPath?.trim() || expandTemplate(options.config.pathTemplate, {
    repoRoot,
    repoParent,
    repoName,
    baseDir,
    branchName,
    branchSlug,
    "yyyyMMdd-HHmmss": timestamp,
  }));

  if (existsSync(targetPath)) {
    throw new WorktreeUserError(`Target path already exists: ${targetPath}`);
  }

  mkdirSync(dirname(targetPath), { recursive: true });
  await git(["-C", repoRoot, "worktree", "add", "-b", branchName, targetPath, baseRef]);

  const metadata: WorktreeMetadata = {
    isWorktree: true,
    branch: branchName,
    repoRoot: targetPath,
    mainWorktreePath,
    mainWorktreeBranch: mainWorktree?.branch,
  };

  return {
    success: true,
    cwd: targetPath,
    repoRoot,
    mainWorktreePath,
    branchName,
    baseRef,
    targetPath,
    isWorktree: true,
    worktree: metadata,
  };
}
