/**
 * github-automation-worktree — resolve Project Registry root + create fixed-main WorkTree (GHA-06).
 *
 * Rules:
 * - Canonical root comes only from automation config `projectRoot` + Project Registry match.
 * - Webhook / Issue / comment text never supplies cwd, branch, baseRef, or target path.
 * - Base ref is the repository config baseRef (default main), not Issue-provided.
 * - Branch name is sanitized from repo id + issue number + generation (deterministic).
 * - Does not use archiveGitWorktree (which merges/pushes) — create only.
 * - Exactly one WorkTree per job generation (reconcile existing effect marker / path).
 */

import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import {
  createGitWorktree,
  discoverGitRoot,
  listGitWorktrees,
  WorktreeUserError,
  type CreateWorktreeResult,
} from "./git-worktree";
import {
  GithubAutomationError,
} from "./github-automation-errors";
import type { GithubAutomationRepositoryConfig } from "./github-automation-types";
import {
  canonicalizeProjectPath,
  listProjects,
  syncRegisteredProjectWorktreeSpace,
} from "./project-registry";
import type { PiWebWorktreeConfig } from "./pi-web-config";
import { DEFAULT_PI_WEB_CONFIG } from "./pi-web-config";

export interface GithubAutomationResolvedProjectRoot {
  /** Canonical pathKey from Project Registry / realpath. */
  pathKey: string;
  /** Absolute display/real path used as git cwd. */
  rootPath: string;
  projectId: string | null;
  projectName: string | null;
  repositoryId: number;
  baseRef: string;
}

export interface GithubAutomationWorktreePlan {
  branchName: string;
  baseRef: string;
  /** Deterministic target path under `{repo}.worktrees/`. */
  targetPath: string;
  repoRoot: string;
}

export interface GithubAutomationWorktreeEnsureResult {
  created: boolean;
  reused: boolean;
  worktreePath: string;
  branchName: string;
  baseRef: string;
  repoRoot: string;
  projectId: string | null;
  spaceSynced: boolean;
}

/**
 * Sanitize a branch fragment: lowercase, alnum + hyphen, bounded length.
 */
export function sanitizeGithubAutomationBranchFragment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/-+/g, "-")
    .replace(/^[-./]+|[-./]+$/g, "")
    .slice(0, 80) || "issue";
}

/**
 * Fixed branch name for one Issue generation. Not derived from Issue title/body.
 */
export function buildGithubAutomationBranchName(input: {
  repositoryId: number;
  issueNumber: number;
  generation: number;
}): string {
  const issue = sanitizeGithubAutomationBranchFragment(`issue-${input.issueNumber}`);
  const gen = Math.max(1, Math.floor(input.generation));
  return `ypi/gha/${input.repositoryId}/${issue}/g${gen}`;
}

/**
 * Resolve canonical project root from repository config + Project Registry only.
 * Rejects empty projectRoot and paths that are not registered (or registerable as existing dir).
 */
export async function resolveGithubAutomationProjectRoot(
  repo: GithubAutomationRepositoryConfig,
): Promise<GithubAutomationResolvedProjectRoot> {
  const configured = typeof repo.projectRoot === "string" ? repo.projectRoot.trim() : "";
  if (!configured) {
    throw new GithubAutomationError(
      "invalid_config",
      "Repository projectRoot is not configured for unattended automation",
      { status: 400, details: { repositoryId: repo.repositoryId } },
    );
  }

  const pathInfo = await canonicalizeProjectPath(configured);
  if (pathInfo.missing || !pathInfo.realPath) {
    throw new GithubAutomationError(
      "invalid_config",
      "Repository projectRoot does not exist on this host",
      { status: 400, details: { repositoryId: repo.repositoryId } },
    );
  }

  const projects = await listProjects();
  const match = projects.find(
    (p) =>
      !p.archived &&
      (p.pathKey === pathInfo.pathKey ||
        p.rootPath === pathInfo.displayPath ||
        p.rootPath === pathInfo.realPath),
  );

  // Require registry membership so webhook cannot invent arbitrary roots.
  if (!match) {
    throw new GithubAutomationError(
      "invalid_config",
      "Repository projectRoot is not present in Project Registry",
      { status: 400, details: { repositoryId: repo.repositoryId } },
    );
  }

  let repoRoot: string;
  try {
    repoRoot = await discoverGitRoot(pathInfo.realPath);
  } catch {
    throw new GithubAutomationError(
      "invalid_config",
      "Repository projectRoot is not inside a Git repository",
      { status: 400, details: { repositoryId: repo.repositoryId } },
    );
  }

  const baseRef =
    typeof repo.baseRef === "string" && repo.baseRef.trim()
      ? repo.baseRef.trim()
      : "main";

  return {
    pathKey: match.pathKey,
    rootPath: repoRoot,
    projectId: match.id,
    projectName: match.displayName ?? null,
    repositoryId: repo.repositoryId,
    baseRef,
  };
}

function automationWorktreeConfig(baseRef: string): PiWebWorktreeConfig {
  // Fixed templates — Issue text cannot change branch/path patterns.
  return {
    baseRef,
    branchNameTemplate: "ypi/gha/{yyyyMMdd-HHmmss}",
    baseDirTemplate: DEFAULT_PI_WEB_CONFIG.worktree.baseDirTemplate,
    pathTemplate: DEFAULT_PI_WEB_CONFIG.worktree.pathTemplate,
    sessionDisplay: "separate",
  };
}

/**
 * Plan deterministic WorkTree target for a job generation.
 */
export async function planGithubAutomationWorktree(input: {
  repoRoot: string;
  baseRef: string;
  repositoryId: number;
  issueNumber: number;
  generation: number;
}): Promise<GithubAutomationWorktreePlan> {
  const branchName = buildGithubAutomationBranchName({
    repositoryId: input.repositoryId,
    issueNumber: input.issueNumber,
    generation: input.generation,
  });
  const repoName = basename(input.repoRoot);
  const repoParent = dirname(input.repoRoot);
  const branchSlug = sanitizeGithubAutomationBranchFragment(branchName).replace(/\//g, "-");
  const baseDir = join(repoParent, `${repoName}.worktrees`);
  const targetPath = join(baseDir, branchSlug);
  return {
    branchName,
    baseRef: input.baseRef,
    targetPath,
    repoRoot: input.repoRoot,
  };
}

/**
 * Ensure exactly one WorkTree for this job generation.
 * Reuses existing path/branch when already present (restart-safe).
 */
export async function ensureGithubAutomationWorktree(input: {
  repository: GithubAutomationRepositoryConfig;
  issueNumber: number;
  generation: number;
  /**
   * When reusing after restart, prefer the previously recorded worktree path
   * if it still exists and matches the planned branch.
   */
  existingWorktreePath?: string | null;
  existingBranchName?: string | null;
}): Promise<GithubAutomationWorktreeEnsureResult> {
  const resolved = await resolveGithubAutomationProjectRoot(input.repository);
  const plan = await planGithubAutomationWorktree({
    repoRoot: resolved.rootPath,
    baseRef: resolved.baseRef,
    repositoryId: input.repository.repositoryId,
    issueNumber: input.issueNumber,
    generation: input.generation,
  });

  // Reuse explicit existing path when still present.
  if (
    input.existingWorktreePath &&
    existsSync(input.existingWorktreePath) &&
    input.existingBranchName === plan.branchName
  ) {
    return {
      created: false,
      reused: true,
      worktreePath: input.existingWorktreePath,
      branchName: plan.branchName,
      baseRef: plan.baseRef,
      repoRoot: plan.repoRoot,
      projectId: resolved.projectId,
      spaceSynced: false,
    };
  }

  // Reuse if git already has this worktree path or branch.
  const existing = await listGitWorktrees(plan.repoRoot);
  const byPath = existing.find((w) => w.path === plan.targetPath);
  const byBranch = existing.find((w) => w.branch === plan.branchName);
  if (byPath || byBranch) {
    const record = byPath ?? byBranch!;
    return {
      created: false,
      reused: true,
      worktreePath: record.path,
      branchName: plan.branchName,
      baseRef: plan.baseRef,
      repoRoot: plan.repoRoot,
      projectId: resolved.projectId,
      spaceSynced: false,
    };
  }

  if (existsSync(plan.targetPath)) {
    throw new GithubAutomationError(
      "internal_error",
      "WorkTree target path exists but is not registered as a git worktree",
      { status: 500, details: { repositoryId: input.repository.repositoryId } },
    );
  }

  let created: CreateWorktreeResult;
  try {
    created = await createGitWorktree({
      cwd: plan.repoRoot,
      config: automationWorktreeConfig(plan.baseRef),
      baseRef: plan.baseRef,
      branchName: plan.branchName,
      targetPath: plan.targetPath,
    });
  } catch (err) {
    if (err instanceof WorktreeUserError) {
      throw new GithubAutomationError(
        "internal_error",
        "Failed to create automation WorkTree",
        {
          status: 500,
          details: {
            repositoryId: input.repository.repositoryId,
            reason: err.message.slice(0, 120),
          },
        },
      );
    }
    throw err;
  }

  let spaceSynced = false;
  if (resolved.projectId) {
    try {
      await syncRegisteredProjectWorktreeSpace(
        plan.repoRoot,
        created.targetPath,
        plan.branchName,
        plan.baseRef,
      );
      spaceSynced = true;
    } catch {
      // Registry sync is best-effort; WorkTree itself is the durable artifact.
      spaceSynced = false;
    }
  }

  return {
    created: true,
    reused: false,
    worktreePath: created.targetPath,
    branchName: plan.branchName,
    baseRef: plan.baseRef,
    repoRoot: plan.repoRoot,
    projectId: resolved.projectId,
    spaceSynced,
  };
}

/**
 * Reject Issue-provided path/branch overrides. Runner preflight / tests.
 */
export function assertWorktreeNotControlledByIssue(input: {
  issueProvidedCwd?: unknown;
  issueProvidedBranch?: unknown;
  issueProvidedBaseRef?: unknown;
  issueProvidedRemote?: unknown;
}): void {
  if (input.issueProvidedCwd != null) {
    throw new Error("Issue text cannot set WorkTree cwd/projectRoot.");
  }
  if (input.issueProvidedBranch != null) {
    throw new Error("Issue text cannot set branch name.");
  }
  if (input.issueProvidedBaseRef != null) {
    throw new Error("Issue text cannot set baseRef.");
  }
  if (input.issueProvidedRemote != null) {
    throw new Error("Issue text cannot set remote/publish values.");
  }
}
