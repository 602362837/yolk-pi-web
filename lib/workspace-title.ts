import type { GitInfo } from "./types";

export const WORKSPACE_TITLE_FALLBACK = "Pi Agent Web";

export function getPathBaseName(path: string | null | undefined): string | null {
  if (!path) return null;
  const normalized = path.replace(/[\\/]+$/, "");
  if (!normalized) return path;
  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

export function formatWorkspaceTitle(cwd: string | null | undefined, git?: GitInfo): string {
  const cwdName = getPathBaseName(cwd);
  if (!cwdName) return WORKSPACE_TITLE_FALLBACK;

  const projectName = git?.isWorktree
    ? getPathBaseName(git.mainWorktreePath) ?? cwdName
    : cwdName;

  if (git?.branch) {
    return git.isWorktree ? `${projectName}.worktree(${git.branch})` : `${projectName}(${git.branch})`;
  }

  const normalized = cwd?.replace(/[\\/]+$/, "") ?? "";
  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  const parentName = parts.length >= 2 ? parts[parts.length - 2] : null;
  if (parentName?.endsWith(".worktrees")) {
    const fallbackProjectName = parentName.slice(0, -".worktrees".length) || parentName;
    return `${fallbackProjectName}.worktree(${cwdName})`;
  }

  return cwdName;
}

export function formatWorkspaceHeaderTitle(cwd: string | null | undefined, git?: GitInfo): string {
  const cwdName = getPathBaseName(cwd);
  if (!cwdName) return WORKSPACE_TITLE_FALLBACK;
  if (git?.isWorktree) return getPathBaseName(git.mainWorktreePath) ?? cwdName;

  const normalized = cwd?.replace(/[\\/]+$/, "") ?? "";
  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  const parentName = parts.length >= 2 ? parts[parts.length - 2] : null;
  if (parentName?.endsWith(".worktrees")) {
    return parentName.slice(0, -".worktrees".length) || parentName;
  }

  return cwdName;
}

export function formatWorkspaceSubtitle(cwd: string | null | undefined, git?: GitInfo): string {
  if (!cwd) return "No project selected";
  if (!git?.branch) return "No Git branch detected";

  if (git.isWorktree) {
    const fromBranch = git.mainWorktreeBranch ? ` ← ${git.mainWorktreeBranch}` : "";
    return `worktree · ${git.branch}${fromBranch}`;
  }

  return `branch · ${git.branch}`;
}
