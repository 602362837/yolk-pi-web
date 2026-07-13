import { SessionManager, buildSessionContext as piBuildSessionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import type { SessionEntry, SessionInfo, SessionContext, SessionTreeNode, AssistantMessage, StudioChildSessionInfo, StudioChildSessionDisplay } from "./types";
import type { SessionEntry as PiSessionEntry } from "@earendil-works/pi-coding-agent";
import { normalizeToolCalls } from "./normalize";
import { getGitMetadataForCwd } from "./git-worktree";
import { canonicalizeCwd, expandCwd } from "./cwd";
import { parseSessionHeaderMetadata } from "./session-header-metadata";
import {
  scanSessionInventory,
  type LightweightSessionMetadata,
} from "./session-metadata-scanner";
import { getYpiStudioTaskDetail, listYpiStudioTasks } from "./ypi-studio-tasks";
import {
  isBudgetExpired,
  type CacheDiagnostic,
  type DiagnosticBudget,
  type DiagnosticLimits,
} from "./memory-diagnostics-types";
import { SessionListTimingCollector } from "./session-list-timing";

export { getAgentDir };

export function getSessionsDir(): string {
  return `${getAgentDir()}/sessions`;
}

export interface DeletedSessionFile {
  id: string;
  path: string;
  cwd: string;
}

function cwdKeys(cwd: string | undefined): Set<string> {
  const keys = new Set<string>();
  if (!cwd) return keys;
  for (const candidate of [cwd, expandCwd(cwd), canonicalizeCwd(cwd)]) {
    if (candidate) keys.add(candidate.replace(/[\\/]+$/, ""));
  }
  return keys;
}

function cwdMatchesAny(cwd: string | undefined, targets: Set<string>): boolean {
  for (const key of cwdKeys(cwd)) {
    if (targets.has(key)) return true;
  }
  return false;
}

function readFirstLineSync(filePath: string): string {
  const fd = openSync(filePath, "r");
  try {
    const chunks: Buffer[] = [];
    const buffer = Buffer.allocUnsafe(4096);
    while (true) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead <= 0) break;
      const newlineIndex = buffer.subarray(0, bytesRead).indexOf(10);
      if (newlineIndex !== -1) {
        chunks.push(Buffer.from(buffer.subarray(0, newlineIndex)));
        break;
      }
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

function isDeletedWorktreeCwd(cwd: string | undefined): boolean {
  const keys = cwdKeys(cwd);
  if (keys.size === 0) return false;
  if ([...keys].some((key) => existsSync(key))) return false;

  return [...keys].some((key) => {
    const parts = key.split(/[\\/]+/).filter(Boolean);
    return parts.length >= 2 && parts[parts.length - 2].endsWith(".worktrees");
  });
}

function deleteSessionFile(session: Pick<LightweightSessionMetadata, "id" | "path" | "cwd">): DeletedSessionFile | null {
  try {
    unlinkSync(session.path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return null;
  }

  invalidateSessionPathCache(session.id);
  invalidateSessionListSnapshots();
  try { rmdirSync(dirname(session.path)); } catch { /* keep non-empty session directories */ }
  return { id: session.id, path: session.path, cwd: session.cwd ?? "" };
}

function pruneDeletedWorktreeSessions(sessions: LightweightSessionMetadata[]): Set<string> {
  const prunedSessionIds = new Set<string>();
  for (const session of sessions) {
    if (!isDeletedWorktreeCwd(session.cwd)) continue;
    prunedSessionIds.add(session.id);
    deleteSessionFile(session);
  }
  return prunedSessionIds;
}

export async function deleteSessionsForCwd(cwd: string, aliases: string[] = []): Promise<DeletedSessionFile[]> {
  const targets = new Set<string>();
  for (const candidate of [cwd, ...aliases]) {
    for (const key of cwdKeys(candidate)) targets.add(key);
  }

  const deleted: DeletedSessionFile[] = [];
  // Lightweight inventory only — never SessionManager.listAll() (retains allMessagesText).
  const sessions = await scanSessionInventory();
  for (const session of sessions) {
    if (!cwdMatchesAny(session.cwd, targets)) continue;
    const deletedSession = deleteSessionFile(session);
    if (deletedSession) deleted.push(deletedSession);
  }
  return deleted;
}

export async function listSessionCwdsForAllowedRoots(): Promise<string[]> {
  let sessions = await scanSessionInventory();
  const prunedSessionIds = pruneDeletedWorktreeSessions(sessions);
  if (prunedSessionIds.size > 0) {
    sessions = sessions.filter((session) => !prunedSessionIds.has(session.id));
  }
  return [...new Set(sessions.map((session) => session.cwd).filter((cwd): cwd is string => Boolean(cwd)))];
}

export interface ListAllSessionsOptions {
  includeGit?: boolean;
  /** Include YPI Studio child audit sessions as list roots. Defaults to false so project history stays focused on user chats. */
  includeStudioChildren?: boolean;
  /** Populate UI-only Studio child title projection. Defaults to false to avoid extra task.json I/O in global scans. */
  includeStudioChildDisplay?: boolean;
  /**
   * Optional content-safe stage timing collector (PERF-001 measure phase).
   * When provided, the reader records `inventory`, `header`, and
   * `studioProjection` stage durations plus scalar counts. When omitted
   * (the default for all production callers), overhead is essentially zero.
   * The collector never receives session titles, messages, or tool content.
   */
  timing?: SessionListTimingCollector;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.map((value) => value?.trim()).find((value): value is string => Boolean(value));
}

const STUDIO_DISPLAY_CACHE_TTL_MS = 1000;
const studioDisplayCache = new Map<string, { expiresAt: number; value?: StudioChildSessionDisplay }>();

export function projectStudioChildDisplay(cwd: string, studioChild?: StudioChildSessionInfo): StudioChildSessionDisplay | undefined {
  if (!studioChild?.taskId) return undefined;
  // Isolate by subtask/run: title/summary depend on both, not only the parent task.
  const cacheKey = `${canonicalizeCwd(cwd)}:${studioChild.taskId}:${studioChild.subtaskId ?? ""}:${studioChild.runId ?? ""}`;
  const cached = studioDisplayCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const headerSubtaskId = firstNonEmpty(studioChild.subtaskId);
  try {
    let detail = getYpiStudioTaskDetail(cwd, studioChild.taskId);
    if (!detail) {
      const match = listYpiStudioTasks(cwd, { scope: "all" }).tasks.find((task) => task.id === studioChild.taskId);
      if (match) detail = getYpiStudioTaskDetail(cwd, match.key);
    }
    if (!detail) {
      // Header-only projection still exposes stable step id for legacy children.
      const value = headerSubtaskId ? { subtaskId: headerSubtaskId } : undefined;
      studioDisplayCache.set(cacheKey, { expiresAt: Date.now() + STUDIO_DISPLAY_CACHE_TTL_MS, value });
      return value;
    }
    const run = detail.subagents.find((item) => item.id === studioChild.runId);
    const subtaskTitle = studioChild.subtaskId
      ? detail.implementationProjection?.subtasksWithStatus.find((item) => item.id === studioChild.subtaskId)?.title
        ?? detail.implementationPlan?.subtasks.find((item) => item.id === studioChild.subtaskId)?.title
      : undefined;
    const runSummary = firstNonEmpty(run?.summary, run?.progress?.lastTextPreview);
    const value: StudioChildSessionDisplay = {
      taskTitle: firstNonEmpty(detail.title),
      subtaskId: headerSubtaskId,
      subtaskTitle,
      runSummary,
    };
    studioDisplayCache.set(cacheKey, { expiresAt: Date.now() + STUDIO_DISPLAY_CACHE_TTL_MS, value });
    return value;
  } catch {
    const value = headerSubtaskId ? { subtaskId: headerSubtaskId } : undefined;
    studioDisplayCache.set(cacheKey, { expiresAt: Date.now() + STUDIO_DISPLAY_CACHE_TTL_MS, value });
    return value;
  }
}

export { parseSessionHeaderMetadata } from "./session-header-metadata";

declare global {
  var __piSessionListSnapshots: Map<string, { expiresAt: number; value?: SessionInfo[]; pending?: Promise<SessionInfo[]> }> | undefined;
}

const SESSION_LIST_CACHE_TTL_MS = 1000;
const SESSION_LIST_CACHE_LIMIT = 8;

function getSessionListSnapshots() {
  if (!globalThis.__piSessionListSnapshots) globalThis.__piSessionListSnapshots = new Map();
  return globalThis.__piSessionListSnapshots;
}

function sessionListCacheKey(options: ListAllSessionsOptions): string {
  return [Boolean(options.includeGit), Boolean(options.includeStudioChildren), Boolean(options.includeStudioChildDisplay)].join(":");
}

export function invalidateSessionListSnapshots(): void {
  getSessionListSnapshots().clear();
  archivedCwdsCache = undefined;
  studioDisplayCache.clear();
}

export async function listAllSessions(options: ListAllSessionsOptions = {}): Promise<SessionInfo[]> {
  const cache = getSessionListSnapshots();
  const key = sessionListCacheKey(options);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached?.value && cached.expiresAt > now) return cached.value.slice();
  if (cached?.pending) return (await cached.pending).slice();

  const pending = listAllSessionsUncached(options);
  cache.set(key, { expiresAt: now + SESSION_LIST_CACHE_TTL_MS, pending });
  while (cache.size > SESSION_LIST_CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  try {
    const value = await pending;
    cache.set(key, { expiresAt: Date.now() + SESSION_LIST_CACHE_TTL_MS, value });
    return value.slice();
  } catch (error) {
    cache.delete(key);
    throw error;
  }
}

async function listAllSessionsUncached(options: ListAllSessionsOptions = {}): Promise<SessionInfo[]> {
  const timing = options.timing;
  // Bounded metadata inventory (no allMessagesText). Do not call SessionManager.listAll().
  let inventory: LightweightSessionMetadata[] = timing
    ? await timing.measureAsync("inventory", () => scanSessionInventory())
    : await scanSessionInventory();
  if (timing) timing.addCount("activeSessions", inventory.length);
  const prunedSessionIds = pruneDeletedWorktreeSessions(inventory);
  if (prunedSessionIds.size > 0) {
    inventory = inventory.filter((session) => !prunedSessionIds.has(session.id));
  }
  const pathToId = new Map<string, string>();
  for (const s of inventory) pathToId.set(s.path, s.id);

  const canonicalCwdBySessionId = new Map<string, string>();
  for (const s of inventory) {
    if (s.cwd) canonicalCwdBySessionId.set(s.id, canonicalizeCwd(s.cwd));
  }

  const gitByCwd = new Map<string, SessionInfo["git"]>();
  const worktreeByCwd = new Map<string, SessionInfo["worktree"]>();
  if (options.includeGit) {
    await Promise.all([...new Set(canonicalCwdBySessionId.values())].map(async (cwd) => {
      try {
        const metadata = await getGitMetadataForCwd(cwd);
        if (metadata) {
          gitByCwd.set(cwd, metadata);
          if (metadata.isWorktree) {
            worktreeByCwd.set(cwd, {
              isWorktree: true,
              branch: metadata.branch,
              repoRoot: metadata.repoRoot,
              mainWorktreePath: metadata.mainWorktreePath,
              mainWorktreeBranch: metadata.mainWorktreeBranch,
            });
          }
        }
      } catch {
        // Git metadata is best-effort; normal session listing must still work.
      }
    }));
  }

  const cache = getPathCache();
  const result = inventory.map((s) => {
    const cwd = canonicalCwdBySessionId.get(s.id) ?? s.cwd;
    // Populate path cache so resolveSessionPath works without a full scan
    cache.set(s.id, s.path);
    let projectLink: { legacyUnassigned: boolean; projectId?: string; spaceId?: string } = { legacyUnassigned: true };
    let studioChild: StudioChildSessionInfo | undefined;
    try {
      const line = timing
        ? timing.measureSync("header", () => readFirstLineSync(s.path))
        : readFirstLineSync(s.path);
      const metadata = parseSessionHeaderMetadata(line);
      projectLink = metadata.projectLink;
      studioChild = metadata.studioChild;
    } catch {
      // Keep session listing tolerant of malformed/missing headers; orphan handling lives in detail routes.
    }
    if (timing && studioChild) timing.addCount("studioChildren");
    const studioChildDisplay = options.includeStudioChildDisplay && studioChild
      ? timing
        ? timing.measureSync("studioProjection", () => projectStudioChildDisplay(cwd ?? "", studioChild))
        : projectStudioChildDisplay(cwd ?? "", studioChild)
      : undefined;
    if (timing && options.includeStudioChildDisplay && studioChild) timing.addCount("studioProjectionCalls");
    return {
      path: s.path,
      id: s.id,
      cwd,
      name: s.name,
      projectId: projectLink.projectId,
      spaceId: projectLink.spaceId,
      legacyUnassigned: studioChild ? false : projectLink.legacyUnassigned,
      studioChild,
      studioChildDisplay,
      created: s.created instanceof Date ? s.created.toISOString() : String(s.created),
      modified: s.modified instanceof Date ? s.modified.toISOString() : String(s.modified),
      messageCount: s.messageCount,
      firstMessage: s.firstMessage || "(no messages)",
      parentSessionId: s.parentSessionPath ? pathToId.get(s.parentSessionPath) : undefined,
      worktree: options.includeGit && cwd ? worktreeByCwd.get(cwd) : undefined,
      git: options.includeGit && cwd ? gitByCwd.get(cwd) : undefined,
    };
  }).filter((session) => options.includeStudioChildren || !session.studioChild);
  return result;
}

// ============================================================================
// Session path cache: sessionId → absolute file path
// Stored in globalThis for hot-reload safety
// ============================================================================
declare global {
  var __piSessionPathCache: Map<string, string> | undefined;
}

function getPathCache(): Map<string, string> {
  if (!globalThis.__piSessionPathCache) globalThis.__piSessionPathCache = new Map();
  return globalThis.__piSessionPathCache;
}

export function cacheSessionPath(sessionId: string, filePath: string): void {
  getPathCache().set(sessionId, filePath);
}

export function invalidateSessionPathCache(sessionId: string): void {
  getPathCache().delete(sessionId);
}

/**
 * Bounded read-only projection of the in-process session id → file path cache.
 * Returns total count plus a capped sample of `{ sessionId, path }` pairs.
 * Mutates nothing; never triggers `SessionManager.listAll()` or any scan.
 */
export function projectSessionPathCache(
  budget: DiagnosticBudget,
  limits: DiagnosticLimits,
): CacheDiagnostic {
  const cache = getPathCache();
  const samples: CacheDiagnostic["samples"] = [];
  let truncated = 0;
  try {
    for (const [sessionId, path] of cache.entries()) {
      if (isBudgetExpired(budget)) {
        truncated = cache.size - samples.length;
        break;
      }
      if (samples.length >= limits.maxPathCacheSamples) {
        truncated = cache.size - samples.length;
        break;
      }
      samples.push({ sessionId, path });
    }
  } catch {
    // best-effort projection
  }
  return {
    total: cache.size,
    sampled: samples.length,
    truncated,
    samples,
  };
}

export function getSessionEntries(filePath: string): SessionEntry[] {
  const entries = SessionManager.open(filePath).getEntries();
  return entries as unknown as SessionEntry[];
}

export function buildTree(entries: SessionEntry[]): SessionTreeNode[] {
  const nodeMap = new Map<string, SessionTreeNode>();
  const labelsById = new Map<string, string>();

  for (const entry of entries) {
    if (entry.type === "label") {
      const l = entry as { type: "label"; targetId: string; label?: string };
      if (l.label) labelsById.set(l.targetId, l.label);
      else labelsById.delete(l.targetId);
    }
  }

  const roots: SessionTreeNode[] = [];
  for (const entry of entries) {
    nodeMap.set(entry.id, { entry, children: [], label: labelsById.get(entry.id) });
  }
  for (const entry of entries) {
    const node = nodeMap.get(entry.id)!;
    if (!entry.parentId) {
      roots.push(node);
    } else {
      const parent = nodeMap.get(entry.parentId);
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
  }

  const stack = [...roots];
  while (stack.length > 0) {
    const node = stack.pop()!;
    node.children.sort((a, b) => new Date(a.entry.timestamp).getTime() - new Date(b.entry.timestamp).getTime());
    stack.push(...node.children);
  }
  return roots;
}

export function buildSessionContext(entries: SessionEntry[], leafId?: string | null): SessionContext {
  const byId = new Map<string, SessionEntry>();
  for (const e of entries) byId.set(e.id, e);

  const piEntries = entries as unknown as PiSessionEntry[];
  const piCtx = piBuildSessionContext(piEntries, leafId, byId as unknown as Map<string, PiSessionEntry>);

  // Build entryIds: parallel array to messages[], mapping each message back to its entry id.
  // Needed for fork and navigate_tree calls from the UI.
  let targetLeaf: SessionEntry | undefined;
  if (leafId === null) {
    return { messages: [], entryIds: [], thinkingLevel: piCtx.thinkingLevel, model: piCtx.model };
  }
  if (leafId) targetLeaf = byId.get(leafId);
  if (!targetLeaf) targetLeaf = entries[entries.length - 1];
  if (!targetLeaf) {
    return { messages: [], entryIds: [], thinkingLevel: piCtx.thinkingLevel, model: piCtx.model };
  }

  // Walk path from target leaf to root
  const path: SessionEntry[] = [];
  let cur: SessionEntry | undefined = targetLeaf;
  while (cur) {
    path.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }

  // Find the last compaction on path (mirrors pi's buildSessionContext logic)
  let compactionId: string | undefined;
  let firstKeptEntryId: string | undefined;
  for (const e of path) {
    if (e.type === "compaction") {
      compactionId = e.id;
      firstKeptEntryId = (e as { firstKeptEntryId: string }).firstKeptEntryId;
    }
  }

  const entryIds: string[] = [];
  if (compactionId) {
    // The first message in piCtx.messages is the synthetic compaction summary — map to compaction entry id
    entryIds.push(compactionId);
    const compactionIdx = path.findIndex((e) => e.id === compactionId);
    const firstKeptIdx = firstKeptEntryId
      ? path.findIndex((e, i) => i < compactionIdx && e.id === firstKeptEntryId)
      : -1;
    const startIdx = firstKeptIdx >= 0 ? firstKeptIdx : compactionIdx;
    for (let i = startIdx; i < compactionIdx; i++) {
      if (path[i].type === "message") entryIds.push(path[i].id);
    }
    for (let i = compactionIdx + 1; i < path.length; i++) {
      if (path[i].type === "message") entryIds.push(path[i].id);
    }
  } else {
    for (const e of path) {
      if (e.type === "message") entryIds.push(e.id);
    }
  }

  // pi injects compaction summary as {role:"compactionSummary", summary, tokensBefore}.
  // Convert to {role:"user"} so MessageView can render it the same as before.
  const messages = (piCtx.messages as AssistantMessage[]).map((msg) => {
    const raw = msg as unknown as Record<string, unknown>;
    if (raw.role === "compactionSummary") {
      return {
        role: "user" as const,
        content: `*The conversation history before this point was compacted into the following summary:*\n\n${raw.summary ?? ""}`,
        timestamp: raw.timestamp as number | undefined,
      };
    }
    return normalizeToolCalls(msg);
  });

  return {
    messages,
    entryIds,
    thinkingLevel: piCtx.thinkingLevel,
    model: piCtx.model,
  };
}

export function getLeafId(entries: SessionEntry[]): string | null {
  if (entries.length === 0) return null;
  return entries[entries.length - 1].id;
}

// ============================================================================
// Archive helpers: move sessions between sessions/ and sessions-archive/
// ============================================================================

export function getSessionsArchiveDir(): string {
  return `${getAgentDir()}/sessions-archive`;
}

/**
 * Move a session file from sessions/ to sessions-archive/.
 * Returns the new archive path.
 */
export function archiveSessionFile(sessionPath: string): string {
  const target = sessionPath.replace("/sessions/", "/sessions-archive/");
  mkdirSync(dirname(target), { recursive: true });
  renameSync(sessionPath, target);
  // Update parentSession refs in sibling files
  updateParentSessionRefs(dirname(sessionPath), sessionPath, target);
  invalidateSessionListSnapshots();
  return target;
}

/**
 * Move a session file from sessions-archive/ back to sessions/.
 * Returns the new active path.
 */
export function unarchiveSessionFile(archivePath: string): string {
  const target = archivePath.replace("/sessions-archive/", "/sessions/");
  mkdirSync(dirname(target), { recursive: true });
  renameSync(archivePath, target);
  // Update parentSession refs in sibling files
  updateParentSessionRefs(dirname(archivePath), archivePath, target);
  invalidateSessionListSnapshots();
  return target;
}

/**
 * Scan sibling files in a directory and update their parentSession header
 * if it points to oldPath → point to newPath instead.
 */
function updateParentSessionRefs(dirPath: string, oldPath: string, newPath: string): void {
  if (oldPath === newPath) return;
  try {
    const files = readdirSync(dirPath).filter((f) => f.endsWith(".jsonl"));
    for (const file of files) {
      const filePath = join(dirPath, file);
      if (filePath === oldPath || filePath === newPath) continue;
      try {
        const content = readFileSync(filePath, "utf8");
        const lines = content.split("\n");
        const header = JSON.parse(lines[0]) as { type?: string; parentSession?: string };
        if (header.type === "session" && header.parentSession === oldPath) {
          header.parentSession = newPath;
          lines[0] = JSON.stringify(header);
          writeFileSync(filePath, lines.join("\n"));
        }
      } catch {
        // skip malformed files
      }
    }
  } catch {
    // skip if dir unreadable
  }
}

/**
 * Scan the archive directory and return which cwds have archived sessions.
 * Reads only the first header line of one session file per archive cwd dir.
 */
let archivedCwdsCache: { expiresAt: number; value: { cwds: string[]; counts: Record<string, number> } } | undefined;
const ARCHIVE_SCAN_CACHE_TTL_MS = 1000;

export function scanArchivedCwds(): { cwds: string[]; counts: Record<string, number> } {
  if (archivedCwdsCache && archivedCwdsCache.expiresAt > Date.now()) {
    return { cwds: archivedCwdsCache.value.cwds.slice(), counts: { ...archivedCwdsCache.value.counts } };
  }
  const archiveDir = getSessionsArchiveDir();
  const cwds: string[] = [];
  const counts: Record<string, number> = {};
  if (!existsSync(archiveDir)) {
    const value = { cwds, counts };
    archivedCwdsCache = { expiresAt: Date.now() + ARCHIVE_SCAN_CACHE_TTL_MS, value };
    return value;
  }

  const entries = readdirSync(archiveDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirPath = join(archiveDir, entry.name);
    const jsonlFiles = readdirSync(dirPath).filter((f) => f.endsWith(".jsonl"));
    if (jsonlFiles.length === 0) continue;
    // Bounded header-only read — never load full archive JSONL bodies.
    try {
      const firstLine = readFirstLineSync(join(dirPath, jsonlFiles[0]));
      const header = JSON.parse(firstLine) as { type?: string; cwd?: string };
      if (header.type === "session" && header.cwd) {
        const cwd = canonicalizeCwd(header.cwd);
        if (!cwds.includes(cwd)) cwds.push(cwd);
        counts[cwd] = (counts[cwd] ?? 0) + jsonlFiles.length;
      }
    } catch {
      // skip malformed files
    }
  }
  const value = { cwds, counts };
  archivedCwdsCache = { expiresAt: Date.now() + ARCHIVE_SCAN_CACHE_TTL_MS, value };
  return { cwds: cwds.slice(), counts: { ...counts } };
}

/**
 * List archived sessions for a specific cwd.
 * Uses the bounded JSONL metadata scanner — never SessionManager.getEntries().
 */
export interface ListArchivedSessionsOptions {
  /** Include YPI Studio child audit sessions as archived list roots. Defaults to false so archived history stays focused on user chats. */
  includeStudioChildren?: boolean;
  /** Populate UI-only Studio child title projection. Defaults to false to avoid extra task.json I/O in global scans. */
  includeStudioChildDisplay?: boolean;
}

function mapArchivedLightweightSession(
  meta: LightweightSessionMetadata,
  options: ListArchivedSessionsOptions,
  fallbackCwd?: string,
): SessionInfo | null {
  let projectLink: { legacyUnassigned: boolean; projectId?: string; spaceId?: string } = { legacyUnassigned: true };
  let studioChild: StudioChildSessionInfo | undefined;
  try {
    const metadata = parseSessionHeaderMetadata(readFirstLineSync(meta.path));
    projectLink = metadata.projectLink;
    studioChild = metadata.studioChild;
  } catch {
    // Keep archive listing tolerant of malformed/missing headers.
  }
  if (studioChild && !options.includeStudioChildren) return null;

  const sessionCwd = meta.cwd ? canonicalizeCwd(meta.cwd) : fallbackCwd ?? "";
  getPathCache().set(meta.id, meta.path);

  return {
    path: meta.path,
    id: meta.id,
    cwd: sessionCwd,
    name: meta.name,
    projectId: projectLink.projectId,
    spaceId: projectLink.spaceId,
    legacyUnassigned: studioChild ? false : projectLink.legacyUnassigned,
    studioChild,
    studioChildDisplay: options.includeStudioChildDisplay
      ? projectStudioChildDisplay(sessionCwd, studioChild)
      : undefined,
    created: meta.created instanceof Date ? meta.created.toISOString() : String(meta.created),
    modified: meta.modified instanceof Date ? meta.modified.toISOString() : String(meta.modified),
    messageCount: meta.messageCount,
    firstMessage: meta.firstMessage || "(no messages)",
    archived: true,
  };
}

async function listArchivedSessionMetadata(cwd?: string, options: ListArchivedSessionsOptions = {}): Promise<SessionInfo[]> {
  // Header-only inventory for callers that only need id/path/cwd/studioChild
  // (e.g. usage session rollup). Does not stream full message bodies.
  const archiveDir = getSessionsArchiveDir();
  if (!existsSync(archiveDir)) return [];

  const targets = cwd ? cwdKeys(cwd) : null;
  const cache = getPathCache();
  const sessions: SessionInfo[] = [];

  const dirs = readdirSync(archiveDir, { withFileTypes: true });
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const dirPath = join(archiveDir, dir.name);
    const jsonlFiles = readdirSync(dirPath).filter((f) => f.endsWith(".jsonl"));

    for (const file of jsonlFiles) {
      const filePath = join(dirPath, file);
      try {
        const firstLine = readFirstLineSync(filePath);
        const header = JSON.parse(firstLine) as { type?: string; id?: string; cwd?: string; timestamp?: string; parentSession?: string };
        if (header.type !== "session" || !header.id) continue;
        if (targets && !cwdMatchesAny(header.cwd, targets)) continue;

        const metadata = parseSessionHeaderMetadata(firstLine);
        if (metadata.studioChild && !options.includeStudioChildren) continue;

        const sessionCwd = header.cwd ? canonicalizeCwd(header.cwd) : cwd ?? "";
        cache.set(header.id, filePath);

        let modified = header.timestamp ?? new Date().toISOString();
        try {
          modified = statSync(filePath).mtime.toISOString();
        } catch {
          // use header timestamp
        }

        sessions.push({
          path: filePath,
          id: header.id,
          cwd: sessionCwd,
          projectId: metadata.projectLink.projectId,
          spaceId: metadata.projectLink.spaceId,
          legacyUnassigned: metadata.studioChild ? false : metadata.projectLink.legacyUnassigned,
          studioChild: metadata.studioChild,
          studioChildDisplay: options.includeStudioChildDisplay ? projectStudioChildDisplay(sessionCwd, metadata.studioChild) : undefined,
          created: header.timestamp ?? modified,
          modified,
          messageCount: 0,
          firstMessage: "(metadata only)",
          archived: true,
        });
      } catch {
        // skip malformed files
      }
    }
  }

  return sessions.sort((a, b) => b.modified.localeCompare(a.modified));
}

async function listArchivedSessions(cwd?: string, options: ListArchivedSessionsOptions = {}): Promise<SessionInfo[]> {
  const archiveDir = getSessionsArchiveDir();
  if (!existsSync(archiveDir)) return [];

  const targets = cwd ? cwdKeys(cwd) : null;
  // Bounded concurrent stream scan — never open SessionManager / getEntries for list metadata.
  const scanned = await scanSessionInventory({ rootDir: archiveDir });
  const sessions: SessionInfo[] = [];

  for (const meta of scanned) {
    if (targets && !cwdMatchesAny(meta.cwd, targets)) continue;
    const session = mapArchivedLightweightSession(meta, options, cwd);
    if (session) sessions.push(session);
  }

  return sessions.sort((a, b) => b.modified.localeCompare(a.modified));
}

export async function listAllArchivedSessions(options: ListArchivedSessionsOptions = {}): Promise<SessionInfo[]> {
  return listArchivedSessions(undefined, options);
}

export async function listAllArchivedSessionMetadata(options: ListArchivedSessionsOptions = {}): Promise<SessionInfo[]> {
  return listArchivedSessionMetadata(undefined, options);
}

export async function listArchivedSessionsForCwd(cwd: string, options: ListArchivedSessionsOptions = {}): Promise<SessionInfo[]> {
  return listArchivedSessions(cwd, options);
}

/**
 * Find an archived session by scanning the sessions-archive/ directory tree.
 */
export function resolveArchivedSessionPath(sessionId: string): string | null {
  const archiveDir = getSessionsArchiveDir();
  if (!existsSync(archiveDir)) return null;

  const cache = getPathCache();
  // Check cache first
  const cached = cache.get(sessionId);
  if (cached && cached.includes("sessions-archive")) return cached;

  // Scan archive dirs for the session file
  const entries = readdirSync(archiveDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirPath = join(archiveDir, entry.name);
    const files = readdirSync(dirPath).filter((f) => f.endsWith(".jsonl"));
    for (const file of files) {
      if (file.includes(sessionId)) {
        const fullPath = join(dirPath, file);
        cache.set(sessionId, fullPath);
        return fullPath;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Extend resolveSessionPath to also check the archive directory
// ---------------------------------------------------------------------------
export async function resolveSessionPath(sessionId: string): Promise<string | null> {
  const cached = getPathCache().get(sessionId);
  if (cached) return cached;

  // Cache miss: scan all active sessions to populate cache, then retry
  await listAllSessions();
  const cachedAfter = getPathCache().get(sessionId);
  if (cachedAfter) return cachedAfter;

  // Not found in active sessions — check archive
  return resolveArchivedSessionPath(sessionId);
}



