import type { PiWebProjectRecord, PiWebProjectSpaceRecord } from "@/lib/project-registry-types";
import type { WorktreeInfo } from "@/lib/types";

export function displayProjectName(project: PiWebProjectRecord): string {
  return project.displayName?.trim() || project.rootPath.split(/[\\/]+/).filter(Boolean).pop() || project.rootPath;
}

export function displaySpaceName(space: PiWebProjectSpaceRecord): string {
  if (space.displayName?.trim()) return space.displayName.trim();
  if (space.kind === "main") return "主空间";
  return space.worktree?.branch || space.path.split(/[\\/]+/).filter(Boolean).pop() || space.path;
}

export function activeProjectSpaces(project: PiWebProjectRecord): PiWebProjectSpaceRecord[] {
  const active = Object.values(project.spaces).filter((space) => !space.archived);

  const mainSpace = active.find((s) => s.id === "main");
  const nonMain = active.filter((s) => s.id !== "main");

  // Sort non-main spaces by user sortOrder; do not use pinned for space ordering.
  // Legacy spaces without sortOrder fall back to createdAt then displayName.
  nonMain.sort((a, b) => {
    const aOrder = typeof a.sortOrder === "number" ? a.sortOrder : Infinity;
    const bOrder = typeof b.sortOrder === "number" ? b.sortOrder : Infinity;
    if (aOrder !== bOrder) return aOrder - bOrder;
    // Stable fallback for legacy spaces without sortOrder
    const timeCompare = a.createdAt.localeCompare(b.createdAt);
    return timeCompare || displaySpaceName(a).localeCompare(displaySpaceName(b));
  });

  return mainSpace ? [mainSpace, ...nonMain] : nonMain;
}

export function sortProjectsForSidebar(projects: PiWebProjectRecord[]): PiWebProjectRecord[] {
  return projects
    .filter((project) => !project.archived)
    .sort((a, b) => {
      const aOrder = typeof a.sortOrder === "number" ? a.sortOrder : Infinity;
      const bOrder = typeof b.sortOrder === "number" ? b.sortOrder : Infinity;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return 0;
    });
}

export function worktreeInfoFromSpace(space: PiWebProjectSpaceRecord): WorktreeInfo | undefined {
  if (space.kind !== "worktree") return undefined;
  return {
    isWorktree: true,
    branch: space.worktree?.branch,
    repoRoot: space.worktree?.repoRoot,
    mainWorktreePath: space.worktree?.mainWorktreePath,
    mainWorktreeBranch: space.worktree?.mainWorktreeBranch,
    baseRef: space.worktree?.baseRef,
  };
}

export function shortenCwd(cwd: string, homeDir?: string): string {
  const path = (homeDir && cwd.startsWith(homeDir)) ? "~" + cwd.slice(homeDir.length) : cwd;
  const sep = path.includes("/") ? "/" : "\\";
  const parts = path.split(sep).filter(Boolean);
  if (parts.length <= 2) return path;
  return "…/" + parts.slice(-2).join(sep);
}
