export type ProjectId = `prj_${string}`;
export type ProjectSpaceId = "main" | `wt_${string}` | string;
export type ProjectSpaceKind = "main" | "worktree";

export interface ProjectPathInfo {
  inputPath: string;
  displayPath: string;
  realPath?: string;
  pathKey: string;
  missing: boolean;
}

export interface PiWebProjectSpaceWorktreeInfo {
  branch?: string;
  repoRoot?: string;
  mainWorktreePath?: string;
  mainWorktreeBranch?: string;
  baseRef?: string;
  discoveredAt?: string;
}

export interface PiWebProjectSpaceRecord {
  id: ProjectSpaceId;
  projectId: ProjectId;
  kind: ProjectSpaceKind;
  path: string;
  realPath?: string;
  pathKey: string;
  displayName?: string;
  tags: string[];
  pinned: boolean;
  archived: boolean;
  missing?: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string;
  worktree?: PiWebProjectSpaceWorktreeInfo;
}

export interface PiWebProjectRecord {
  id: ProjectId;
  rootPath: string;
  realRootPath?: string;
  pathKey: string;
  displayName?: string;
  tags: string[];
  pinned: boolean;
  archived: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string;
  spaces: Record<ProjectSpaceId, PiWebProjectSpaceRecord>;
}

export interface PiWebProjectRegistryFile {
  version: 1;
  projects: PiWebProjectRecord[];
  updatedAt?: string;
}

export interface ProjectPatchInput {
  displayName?: unknown;
  tags?: unknown;
  pinned?: unknown;
  archived?: unknown;
  metadata?: unknown;
  lastOpenedAt?: unknown;
}

export interface SpacePatchInput extends ProjectPatchInput {
  missing?: unknown;
}

export interface CreateProjectInput extends ProjectPatchInput {
  path?: unknown;
  rootPath?: unknown;
}
