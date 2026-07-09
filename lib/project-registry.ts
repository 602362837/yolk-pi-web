import { mkdir, readFile, realpath, rename, writeFile } from "fs/promises";
import { createHash, randomUUID } from "crypto";
import { dirname, isAbsolute, normalize, resolve } from "path";
import { homedir } from "os";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type {
  ArchiveWorktreeSpacesOptions,
  ArchiveWorktreeSpacesResult,
  CreateProjectInput,
  PiWebProjectRecord,
  PiWebProjectRegistryFile,
  PiWebProjectSpaceRecord,
  PiWebProjectSpaceWorktreeInfo,
  ProjectId,
  ProjectPatchInput,
  ProjectPathInfo,
  ProjectSpaceId,
  SpacePatchInput,
  SyncMissingWorktreeSpacesOptions,
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
  const projectSortOrder = computeNextProjectSortOrder(registry.projects);
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
    sortOrder: projectSortOrder,
    spaces: { main: mainSpace },
  };

  registry.projects.push(project);
  await writeRegistry(registry);
  return { project, created: true };
}

function createWorktreeSpaceId(pathKey: string): ProjectSpaceId {
  return `wt_${createHash("sha256").update(pathKey).digest("hex").slice(0, 16)}`;
}

/**
 * Compute the next sortOrder value for a new active project.
 * Returns max(existing active project sortOrder, 0) + 1024.
 */
export function computeNextProjectSortOrder(projects: PiWebProjectRecord[]): number {
  const maxOrder = projects
    .filter((project) => !project.archived && typeof project.sortOrder === "number")
    .reduce((max, project) => Math.max(max, project.sortOrder as number), 0);
  return maxOrder + 1024;
}

/**
 * Compute the next sortOrder value for a new non-main space in a project.
 * Returns max(existing non-main active sortOrder, 0) + 1024.
 * Uses interval stepping so future insertions can be placed between values
 * without rewriting the whole list.
 */
export function computeNextSortOrder(project: PiWebProjectRecord): number {
  const maxOrder = Object.values(project.spaces)
    .filter((s) => !s.archived && s.id !== "main" && typeof s.sortOrder === "number")
    .reduce((max, s) => Math.max(max, s.sortOrder as number), 0);
  return maxOrder + 1024;
}

function worktreeInfoFromRecord(
  record: WorktreeRecord,
  mainWorktree?: WorktreeRecord,
  existing?: PiWebProjectSpaceWorktreeInfo,
): PiWebProjectSpaceRecord["worktree"] {
  return {
    branch: record.branch,
    repoRoot: record.path,
    mainWorktreePath: mainWorktree?.path,
    mainWorktreeBranch: mainWorktree?.branch,
    baseRef: record.baseRef || existing?.baseRef,
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
      worktree: worktreeInfoFromRecord(record, mainWorktree, existing.worktree),
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
    sortOrder: computeNextSortOrder(project),
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

export async function syncRegisteredProjectWorktreeSpace(mainWorktreePath: string, worktreePath: string, branch?: string, baseRef?: string): Promise<{
  project: PiWebProjectRecord;
  space: PiWebProjectSpaceRecord;
  created: boolean;
} | null> {
  const mainPathInfo = await canonicalizeProjectPath(mainWorktreePath);
  const registry = await readProjectRegistry();
  const projectIndex = registry.projects.findIndex((project) => !project.archived && project.pathKey === mainPathInfo.pathKey);
  if (projectIndex < 0) return null;

  const project = registry.projects[projectIndex];
  const result = await upsertWorktreeSpace(project, { path: worktreePath, branch, baseRef }, { path: mainWorktreePath });
  project.updatedAt = nowIso();
  registry.projects[projectIndex] = project;
  await writeRegistry(registry);
  return { project, space: result.space, created: result.created };
}

function buildPathMatchKeys(pathInfo: ProjectPathInfo): Set<string> {
  const keys = new Set<string>([pathInfo.pathKey, pathInfo.displayPath]);
  if (pathInfo.realPath) keys.add(pathInfo.realPath);
  return keys;
}

function buildSpacePathKeys(space: PiWebProjectSpaceRecord): Set<string> {
  const keys = new Set<string>([space.pathKey, space.path]);
  if (space.realPath) keys.add(space.realPath);
  return keys;
}

/**
 * Archive worktree spaces matching any of the provided paths.
 *
 * For each input path, derives canonical pathKey / displayPath / realPath via
 * {@link canonicalizeProjectPath} and matches against worktree spaces
 * (`space.kind === "worktree"`) using pathKey as the primary key with
 * displayPath and realPath as fallbacks.  Matched spaces are soft-archived
 * (`archived: true, missing: true`) with additive audit metadata — not hard
 * deleted from the registry.
 *
 * @param paths - One or more path aliases (e.g. cwd, status.cwd, repoRoot).
 * @param options.reason - Audit label stored in `metadata.archivedReason`.
 * @param options.missing - Whether to set `missing: true`, defaults `true`.
 * @returns Summary of archived spaces and paths that matched nothing.
 */
export async function archiveWorktreeSpacesByPaths(
  paths: string[],
  options?: ArchiveWorktreeSpacesOptions,
): Promise<ArchiveWorktreeSpacesResult> {
  const registry = await readProjectRegistry();
  const reason = options?.reason || "api_archive";
  const markMissing = options?.missing !== false;
  const timestamp = nowIso();
  const archivedSpaces: PiWebProjectSpaceRecord[] = [];

  // Resolve every input path into canonical forms for matching
  interface Candidate {
    inputPath: string;
    pathInfo: ProjectPathInfo;
    matchKeys: Set<string>;
  }
  const candidates: Candidate[] = [];
  for (const p of paths) {
    const trimmed = p.trim();
    if (!trimmed) continue;
    const pathInfo = await canonicalizeProjectPath(trimmed);
    candidates.push({ inputPath: trimmed, pathInfo, matchKeys: buildPathMatchKeys(pathInfo) });
  }

  if (candidates.length === 0) {
    return { archivedSpaces: [], unmatchedPaths: [] };
  }

  const matchedInputPaths = new Set<string>();
  const modifiedProjectIds = new Set<string>();

  for (const project of registry.projects) {
    let projectChanged = false;
    for (const [spaceId, space] of Object.entries(project.spaces)) {
      if (space.kind !== "worktree") continue;
      if (space.archived && space.missing) continue; // already soft-archived

      const spaceKeys = buildSpacePathKeys(space);

      // Find which input-path candidates match this space
      const matchedCandidates = candidates.filter((c) => {
        for (const mk of c.matchKeys) {
          if (spaceKeys.has(mk)) return true;
        }
        return false;
      });

      if (matchedCandidates.length === 0) continue;

      const archivedSpace: PiWebProjectSpaceRecord = {
        ...space,
        archived: true,
        missing: markMissing || space.missing || undefined,
        updatedAt: timestamp,
        metadata: {
          ...space.metadata,
          archivedReason: reason,
          archivedAt: timestamp,
          lastKnownPath: space.path,
        },
      };
      project.spaces[spaceId as ProjectSpaceId] = archivedSpace;
      archivedSpaces.push(archivedSpace);
      projectChanged = true;

      for (const c of matchedCandidates) {
        matchedInputPaths.add(c.inputPath);
      }
    }
    if (projectChanged) {
      project.updatedAt = timestamp;
      modifiedProjectIds.add(project.id);
    }
  }

  const unmatchedPaths = candidates
    .filter((c) => !matchedInputPaths.has(c.inputPath))
    .map((c) => c.inputPath);

  if (modifiedProjectIds.size > 0) {
    await writeRegistry(registry);
  }

  return { archivedSpaces, unmatchedPaths };
}

/**
 * Passive missing-only sync for worktree spaces whose directories no longer
 * exist on the filesystem.
 *
 * Scans non-archived projects for non-archived worktree spaces, checks each
 * space&apos;s path existence via {@link canonicalizeProjectPath} (which resolves
 * realpath), and soft-archives (`archived: true, missing: true`) any space
 * whose path is no longer present.  No git commands are executed.
 *
 * Designed as a lightweight companion to the heavier
 * {@link syncProjectWorktreeSpaces} full refresh.  Suitable for passive
 * triggers such as project-list loads or Sidebar refreshes.
 *
 * Internally delegates to {@link archiveWorktreeSpacesByPaths} so that
 * the same canonical matching and audit metadata are applied.
 *
 * @param options.projectId - Optional single-project scope.
 * @param options.reason    - Audit label, defaults to `"passive_missing"`.
 */
export async function syncMissingWorktreeSpaces(
  options?: SyncMissingWorktreeSpacesOptions,
): Promise<ArchiveWorktreeSpacesResult> {
  const registry = await readProjectRegistry();
  const reason = options?.reason || "passive_missing";
  const projectIdFilter = options?.projectId;

  // Collect every non-archived worktree space whose filesystem path is gone
  const missingPaths: string[] = [];

  for (const project of registry.projects) {
    if (project.archived) continue;
    if (projectIdFilter && project.id !== projectIdFilter) continue;

    for (const space of Object.values(project.spaces)) {
      if (space.kind !== "worktree") continue;
      if (space.archived) continue;

      const pathInfo = await canonicalizeProjectPath(space.path);
      if (pathInfo.missing) {
        missingPaths.push(space.path);
      }
    }
  }

  if (missingPaths.length === 0) {
    return { archivedSpaces: [], unmatchedPaths: [] };
  }

  return archiveWorktreeSpacesByPaths(missingPaths, { reason });
}

export async function markWorktreeSpaceArchivedByPath(worktreePath: string): Promise<PiWebProjectSpaceRecord[]> {
  const result = await archiveWorktreeSpacesByPaths([worktreePath], { reason: "api_archive" });
  return result.archivedSpaces;
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

/**
 * Batch-reorder non-main spaces for a single project.
 *
 * Rules:
 * - `main` must not appear in orderedSpaceIds.
 * - Only active, non-archived, non-main spaces owned by the project are accepted.
 * - Unknown, archived, duplicate, or cross-project ids are rejected.
 * - Active non-main spaces not in the payload are appended to the end while
 *   preserving their relative effective order.
 * - Each space receives a clean interval-based sortOrder (1024, 2048, …)
 *   to support future local insertions.
 *
 * @param projectId - The project owning the spaces.
 * @param orderedSpaceIds - Desired order of active non-main space ids (first → last).
 * @returns Updated project and its active spaces.
 */
export async function reorderProjects(
  orderedProjectIds: string[],
): Promise<{ projects: PiWebProjectRecord[] }> {
  const registry = await readProjectRegistry();

  if (!Array.isArray(orderedProjectIds)) {
    throw new ProjectRegistryError("orderedProjectIds must be an array");
  }

  const seen = new Set<string>();
  const orderedSet = new Set<string>();
  for (const id of orderedProjectIds) {
    if (typeof id !== "string" || !id.trim()) {
      throw new ProjectRegistryError("orderedProjectIds must contain non-empty strings");
    }
    if (seen.has(id)) {
      throw new ProjectRegistryError(`Duplicate project id in orderedProjectIds: ${id}`);
    }
    seen.add(id);
    orderedSet.add(id);

    const project = registry.projects.find((item) => item.id === id);
    if (!project) {
      throw new ProjectRegistryError(`Unknown project id: ${id}`);
    }
    if (project.archived) {
      throw new ProjectRegistryError(`Project is archived: ${id}`);
    }
  }

  const remaining = registry.projects
    .filter((project) => !project.archived && !orderedSet.has(project.id))
    .sort((a, b) => {
      const aOrder = typeof a.sortOrder === "number" ? a.sortOrder : Infinity;
      const bOrder = typeof b.sortOrder === "number" ? b.sortOrder : Infinity;
      return aOrder - bOrder;
    });

  const finalOrder = [...orderedProjectIds, ...remaining.map((project) => project.id)] as ProjectId[];
  const timestamp = nowIso();
  const STEP = 1024;
  const projectById = new Map<ProjectId, PiWebProjectRecord>(registry.projects.map((project) => [project.id, project]));

  for (let i = 0; i < finalOrder.length; i++) {
    const id = finalOrder[i];
    const project = projectById.get(id);
    if (!project) continue;
    project.sortOrder = (i + 1) * STEP;
    project.updatedAt = timestamp;
  }

  registry.updatedAt = timestamp;
  await writeRegistry(registry);
  return { projects: registry.projects };
}

export async function reorderProjectSpaces(
  projectId: string,
  orderedSpaceIds: string[],
): Promise<{ project: PiWebProjectRecord; spaces: PiWebProjectSpaceRecord[] }> {
  const registry = await readProjectRegistry();
  const projectIndex = registry.projects.findIndex((p) => p.id === projectId);
  if (projectIndex < 0) throw new ProjectRegistryError("Project not found", 404);
  const project = registry.projects[projectIndex];

  // --- validation ---
  if (!Array.isArray(orderedSpaceIds)) {
    throw new ProjectRegistryError("orderedSpaceIds must be an array");
  }

  const seen = new Set<string>();
  const orderedSet = new Set<string>();
  for (const id of orderedSpaceIds) {
    if (typeof id !== "string" || !id.trim()) {
      throw new ProjectRegistryError("orderedSpaceIds must contain non-empty strings");
    }
    if (id === "main") {
      throw new ProjectRegistryError("main space cannot be reordered");
    }
    if (seen.has(id)) {
      throw new ProjectRegistryError(`Duplicate space id in orderedSpaceIds: ${id}`);
    }
    seen.add(id);
    orderedSet.add(id);

    const space = project.spaces[id];
    if (!space) {
      throw new ProjectRegistryError(`Unknown space id: ${id}`);
    }
    if (space.archived) {
      throw new ProjectRegistryError(`Space is archived: ${id}`);
    }
    if (space.kind === "main") {
      throw new ProjectRegistryError("main space cannot be reordered");
    }
    if (space.projectId !== projectId) {
      throw new ProjectRegistryError(`Space ${id} does not belong to project ${projectId}`);
    }
  }

  // Collect active non-main spaces not in the payload, keeping their relative effective order
  const remaining = Object.values(project.spaces)
    .filter((s) => s.id !== "main" && !s.archived && !orderedSet.has(s.id))
    .sort((a, b) => {
      const aOrder = typeof a.sortOrder === "number" ? a.sortOrder : Infinity;
      const bOrder = typeof b.sortOrder === "number" ? b.sortOrder : Infinity;
      return aOrder - bOrder || a.createdAt.localeCompare(b.createdAt);
    });

  const finalOrder = [...orderedSpaceIds, ...remaining.map((s) => s.id)];
  const timestamp = nowIso();
  const STEP = 1024;

  for (let i = 0; i < finalOrder.length; i++) {
    const id = finalOrder[i];
    const space = project.spaces[id];
    project.spaces[id] = {
      ...space,
      sortOrder: (i + 1) * STEP,
      updatedAt: timestamp,
    };
  }

  project.updatedAt = timestamp;
  registry.projects[projectIndex] = project;
  await writeRegistry(registry);

  const spaces = Object.values(project.spaces).filter((s) => !s.archived);
  return { project, spaces };
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
