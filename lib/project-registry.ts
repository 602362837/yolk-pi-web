import { mkdir, readFile, realpath, rename, writeFile } from "fs/promises";
import { createHash, randomUUID } from "crypto";
import { dirname, isAbsolute, normalize, resolve } from "path";
import { homedir } from "os";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type {
  CreateProjectInput,
  PiWebProjectRecord,
  PiWebProjectRegistryFile,
  PiWebProjectSpaceRecord,
  ProjectId,
  ProjectPatchInput,
  ProjectPathInfo,
  ProjectSpaceId,
  SpacePatchInput,
} from "./project-registry-types";
import { discoverGitRoot, listGitWorktrees, type WorktreeRecord } from "./git-worktree";

export class ProjectRegistryError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = "ProjectRegistryError";
  }
}

export function getProjectRegistryPath(): string {
  return `${getAgentDir()}/pi-web-projects.json`;
}

function stripTrailingSeparators(value: string): string {
  const stripped = value.replace(/[\\/]+$/, "");
  return stripped || value;
}

function expandProjectPath(inputPath: string): string {
  const trimmed = inputPath.trim();
  const expanded = trimmed === "~" ? homedir() : trimmed.startsWith("~/") ? resolve(homedir(), trimmed.slice(2)) : trimmed;
  return stripTrailingSeparators(normalize(isAbsolute(expanded) ? expanded : resolve(expanded)));
}

export async function canonicalizeProjectPath(inputPath: string): Promise<ProjectPathInfo> {
  const displayPath = expandProjectPath(inputPath);
  try {
    const resolvedRealPath = stripTrailingSeparators(normalize(await realpath(displayPath)));
    return { inputPath, displayPath, realPath: resolvedRealPath, pathKey: resolvedRealPath, missing: false };
  } catch {
    return { inputPath, displayPath, pathKey: displayPath, missing: true };
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function createProjectId(): ProjectId {
  return `prj_${randomUUID().replace(/-/g, "")}`;
}

function defaultRegistry(): PiWebProjectRegistryFile {
  return { version: 1, projects: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeStringArray(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ProjectRegistryError(`${field} must be an array of strings`);
  return [...new Set(value.map((item) => {
    if (typeof item !== "string") throw new ProjectRegistryError(`${field} must be an array of strings`);
    return item.trim();
  }).filter(Boolean))];
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new ProjectRegistryError("metadata must be an object");
  return { ...value };
}

function normalizeOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new ProjectRegistryError(`${field} must be a string`);
  const trimmed = value.trim();
  return trimmed || undefined;
}

function assertBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new ProjectRegistryError(`${field} must be a boolean`);
  return value;
}

function assertRegistry(value: unknown): PiWebProjectRegistryFile {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.projects)) {
    throw new ProjectRegistryError("Invalid project registry file", 500);
  }
  return value as unknown as PiWebProjectRegistryFile;
}

async function writeRegistry(registry: PiWebProjectRegistryFile): Promise<void> {
  const filePath = getProjectRegistryPath();
  await mkdir(dirname(filePath), { recursive: true });
  const nextRegistry = { ...registry, updatedAt: nowIso() };
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(nextRegistry, null, 2)}\n`, "utf8");
  await rename(tmpPath, filePath);
}

export async function readProjectRegistry(): Promise<PiWebProjectRegistryFile> {
  try {
    const raw = await readFile(getProjectRegistryPath(), "utf8");
    return assertRegistry(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaultRegistry();
    if (error instanceof ProjectRegistryError) throw error;
    if (error instanceof SyntaxError) throw new ProjectRegistryError("Invalid project registry JSON", 500);
    throw error;
  }
}

export async function listProjects(): Promise<PiWebProjectRecord[]> {
  const registry = await readProjectRegistry();
  return registry.projects;
}

export async function registerProject(input: CreateProjectInput): Promise<{ project: PiWebProjectRecord; created: boolean }> {
  const rawPath = typeof input.path === "string" ? input.path : typeof input.rootPath === "string" ? input.rootPath : "";
  if (!rawPath.trim()) throw new ProjectRegistryError("path is required");

  const pathInfo = await canonicalizeProjectPath(rawPath);
  const registry = await readProjectRegistry();
  const existing = registry.projects.find((project) => !project.archived && project.pathKey === pathInfo.pathKey);
  if (existing) return { project: existing, created: false };

  const timestamp = nowIso();
  const projectId = createProjectId();
  const mainSpace: PiWebProjectSpaceRecord = {
    id: "main",
    projectId,
    kind: "main",
    path: pathInfo.displayPath,
    realPath: pathInfo.realPath,
    pathKey: pathInfo.pathKey,
    displayName: normalizeOptionalString(input.displayName, "displayName"),
    tags: normalizeStringArray(input.tags, "tags"),
    pinned: typeof input.pinned === "boolean" ? input.pinned : false,
    archived: typeof input.archived === "boolean" ? input.archived : false,
    missing: pathInfo.missing || undefined,
    metadata: normalizeMetadata(input.metadata),
    createdAt: timestamp,
    updatedAt: timestamp,
    lastOpenedAt: normalizeOptionalString(input.lastOpenedAt, "lastOpenedAt"),
  };
  const project: PiWebProjectRecord = {
    id: projectId,
    rootPath: pathInfo.displayPath,
    realRootPath: pathInfo.realPath,
    pathKey: pathInfo.pathKey,
    displayName: mainSpace.displayName,
    tags: [...mainSpace.tags],
    pinned: mainSpace.pinned,
    archived: mainSpace.archived,
    metadata: { ...mainSpace.metadata },
    createdAt: timestamp,
    updatedAt: timestamp,
    lastOpenedAt: mainSpace.lastOpenedAt,
    spaces: { main: mainSpace },
  };

  registry.projects.push(project);
  await writeRegistry(registry);
  return { project, created: true };
}

function createWorktreeSpaceId(pathKey: string): ProjectSpaceId {
  return `wt_${createHash("sha256").update(pathKey).digest("hex").slice(0, 16)}`;
}

function worktreeInfoFromRecord(record: WorktreeRecord, mainWorktree?: WorktreeRecord): PiWebProjectSpaceRecord["worktree"] {
  return {
    branch: record.branch,
    repoRoot: record.path,
    mainWorktreePath: mainWorktree?.path,
    mainWorktreeBranch: mainWorktree?.branch,
    discoveredAt: nowIso(),
  };
}

async function upsertWorktreeSpace(
  project: PiWebProjectRecord,
  record: WorktreeRecord,
  mainWorktree?: WorktreeRecord,
): Promise<{ space: PiWebProjectSpaceRecord; created: boolean }> {
  const pathInfo = await canonicalizeProjectPath(record.path);
  const existingEntry = Object.entries(project.spaces).find(([, space]) => space.kind === "worktree" && space.pathKey === pathInfo.pathKey);
  const timestamp = nowIso();
  if (existingEntry) {
    const [spaceId, existing] = existingEntry;
    const space: PiWebProjectSpaceRecord = {
      ...existing,
      path: existing.path || pathInfo.displayPath,
      realPath: pathInfo.realPath,
      pathKey: pathInfo.pathKey,
      archived: false,
      missing: pathInfo.missing || undefined,
      worktree: worktreeInfoFromRecord(record, mainWorktree),
      updatedAt: timestamp,
    };
    project.spaces[spaceId as ProjectSpaceId] = space;
    return { space, created: false };
  }

  const spaceId = createWorktreeSpaceId(pathInfo.pathKey);
  const space: PiWebProjectSpaceRecord = {
    id: spaceId,
    projectId: project.id,
    kind: "worktree",
    path: pathInfo.displayPath,
    realPath: pathInfo.realPath,
    pathKey: pathInfo.pathKey,
    displayName: record.branch,
    tags: [],
    pinned: false,
    archived: false,
    missing: pathInfo.missing || undefined,
    metadata: {},
    createdAt: timestamp,
    updatedAt: timestamp,
    worktree: worktreeInfoFromRecord(record, mainWorktree),
  };
  project.spaces = { ...project.spaces, [spaceId]: space };
  return { space, created: true };
}

function applyProjectPatch<T extends PiWebProjectRecord | PiWebProjectSpaceRecord>(record: T, patch: ProjectPatchInput): T {
  let changed = false;
  const next: T = { ...record };
  if (patch.displayName !== undefined) {
    next.displayName = normalizeOptionalString(patch.displayName, "displayName");
    changed = true;
  }
  if (patch.tags !== undefined) {
    next.tags = normalizeStringArray(patch.tags, "tags");
    changed = true;
  }
  if (patch.pinned !== undefined) {
    next.pinned = assertBoolean(patch.pinned, "pinned");
    changed = true;
  }
  if (patch.archived !== undefined) {
    next.archived = assertBoolean(patch.archived, "archived");
    changed = true;
  }
  if (patch.metadata !== undefined) {
    next.metadata = normalizeMetadata(patch.metadata);
    changed = true;
  }
  if (patch.lastOpenedAt !== undefined) {
    next.lastOpenedAt = normalizeOptionalString(patch.lastOpenedAt, "lastOpenedAt");
    changed = true;
  }
  if (changed) next.updatedAt = nowIso();
  return next;
}

export async function updateProject(projectId: string, patch: ProjectPatchInput): Promise<PiWebProjectRecord> {
  const registry = await readProjectRegistry();
  const index = registry.projects.findIndex((project) => project.id === projectId);
  if (index < 0) throw new ProjectRegistryError("Project not found", 404);
  const updated = applyProjectPatch(registry.projects[index], patch);
  registry.projects[index] = updated;
  await writeRegistry(registry);
  return updated;
}

export async function listProjectSpaces(projectId: string): Promise<PiWebProjectSpaceRecord[]> {
  const project = await getProject(projectId);
  return Object.values(project.spaces);
}

export async function syncProjectWorktreeSpaces(projectId: string): Promise<{
  project: PiWebProjectRecord;
  spaces: PiWebProjectSpaceRecord[];
  created: string[];
  archivedMissing: string[];
}> {
  const registry = await readProjectRegistry();
  const projectIndex = registry.projects.findIndex((project) => project.id === projectId);
  if (projectIndex < 0) throw new ProjectRegistryError("Project not found", 404);
  const project = registry.projects[projectIndex];

  let repoRoot: string;
  try {
    repoRoot = await discoverGitRoot(project.rootPath);
  } catch {
    return { project, spaces: Object.values(project.spaces).filter((space) => space.kind === "worktree"), created: [], archivedMissing: [] };
  }

  const worktrees = await listGitWorktrees(repoRoot);
  const mainWorktree = worktrees[0];
  const discoveredKeys = new Set<string>();
  const created: string[] = [];

  for (const record of worktrees) {
    const pathInfo = await canonicalizeProjectPath(record.path);
    const mainPathInfo = mainWorktree ? await canonicalizeProjectPath(mainWorktree.path) : undefined;
    const isMain = mainPathInfo ? pathInfo.pathKey === mainPathInfo.pathKey : pathInfo.pathKey === project.pathKey;
    if (isMain || record.bare) continue;
    discoveredKeys.add(pathInfo.pathKey);
    const result = await upsertWorktreeSpace(project, record, mainWorktree);
    if (result.created) created.push(result.space.id);
  }

  const archivedMissing: string[] = [];
  for (const [spaceId, space] of Object.entries(project.spaces)) {
    if (space.kind !== "worktree" || discoveredKeys.has(space.pathKey) || space.archived && space.missing) continue;
    project.spaces[spaceId as ProjectSpaceId] = {
      ...space,
      archived: true,
      missing: true,
      updatedAt: nowIso(),
    };
    archivedMissing.push(spaceId);
  }

  project.updatedAt = nowIso();
  registry.projects[projectIndex] = project;
  await writeRegistry(registry);
  return { project, spaces: Object.values(project.spaces).filter((space) => space.kind === "worktree"), created, archivedMissing };
}

export async function syncRegisteredProjectWorktreeSpace(mainWorktreePath: string, worktreePath: string, branch?: string): Promise<{
  project: PiWebProjectRecord;
  space: PiWebProjectSpaceRecord;
  created: boolean;
} | null> {
  const mainPathInfo = await canonicalizeProjectPath(mainWorktreePath);
  const registry = await readProjectRegistry();
  const projectIndex = registry.projects.findIndex((project) => !project.archived && project.pathKey === mainPathInfo.pathKey);
  if (projectIndex < 0) return null;

  const project = registry.projects[projectIndex];
  const result = await upsertWorktreeSpace(project, { path: worktreePath, branch }, { path: mainWorktreePath });
  project.updatedAt = nowIso();
  registry.projects[projectIndex] = project;
  await writeRegistry(registry);
  return { project, space: result.space, created: result.created };
}

export async function markWorktreeSpaceArchivedByPath(worktreePath: string): Promise<PiWebProjectSpaceRecord[]> {
  const pathInfo = await canonicalizeProjectPath(worktreePath);
  const registry = await readProjectRegistry();
  const updated: PiWebProjectSpaceRecord[] = [];

  for (const project of registry.projects) {
    let projectChanged = false;
    for (const [spaceId, space] of Object.entries(project.spaces)) {
      if (space.kind !== "worktree" || space.pathKey !== pathInfo.pathKey) continue;
      const archivedSpace: PiWebProjectSpaceRecord = {
        ...space,
        archived: true,
        missing: true,
        updatedAt: nowIso(),
      };
      project.spaces[spaceId as ProjectSpaceId] = archivedSpace;
      updated.push(archivedSpace);
      projectChanged = true;
    }
    if (projectChanged) project.updatedAt = nowIso();
  }

  if (updated.length > 0) await writeRegistry(registry);
  return updated;
}

export async function getProject(projectId: string): Promise<PiWebProjectRecord> {
  const registry = await readProjectRegistry();
  const project = registry.projects.find((item) => item.id === projectId);
  if (!project) throw new ProjectRegistryError("Project not found", 404);
  return project;
}

export async function getProjectSpace(projectId: string, spaceId: string): Promise<PiWebProjectSpaceRecord> {
  const project = await getProject(projectId);
  const space = project.spaces[spaceId as ProjectSpaceId];
  if (!space) throw new ProjectRegistryError("Project space not found", 404);
  return space;
}

export async function updateProjectSpace(projectId: string, spaceId: string, patch: SpacePatchInput): Promise<PiWebProjectSpaceRecord> {
  const registry = await readProjectRegistry();
  const projectIndex = registry.projects.findIndex((project) => project.id === projectId);
  if (projectIndex < 0) throw new ProjectRegistryError("Project not found", 404);
  const project = registry.projects[projectIndex];
  const typedSpaceId = spaceId as ProjectSpaceId;
  const space = project.spaces[typedSpaceId];
  if (!space) throw new ProjectRegistryError("Project space not found", 404);

  const updatedSpace = applyProjectPatch(space, patch);
  if (patch.missing !== undefined) {
    updatedSpace.missing = assertBoolean(patch.missing, "missing") || undefined;
    updatedSpace.updatedAt = nowIso();
  }
  project.spaces = { ...project.spaces, [typedSpaceId]: updatedSpace };
  project.updatedAt = nowIso();
  registry.projects[projectIndex] = project;
  await writeRegistry(registry);
  return updatedSpace;
}
