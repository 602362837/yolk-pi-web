/**
 * Write-through maintenance for project-space local session indexes.
 *
 * JSONL under getAgentDir()/sessions/ remains the content and project/space
 * link truth. Local index mutations are best-effort: failures never roll back
 * or rewrite session files. PSI-03 covers create/fork/Studio child/rename/
 * archive/unarchive/delete/relink; the list query path is PSI-02/05.
 */

import { existsSync, statSync } from "node:fs";
import { isAbsolute, normalize, resolve } from "node:path";
import { homedir } from "node:os";
import { realpath } from "node:fs/promises";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

import {
  type ProjectSpaceSessionIndexEntry,
  type ProjectSpaceSessionIndexSpaceLike,
  type ProjectSpaceSessionIndexStudioChildPointer,
  normalizeProjectSpaceSessionIndexEntry,
  removeProjectSpaceSessionIndexEntry,
  toAgentDirRelativeSessionFile,
  upsertProjectSpaceSessionIndexEntry,
} from "./project-space-session-index";
import {
  getSessionProjectLink,
  readSessionHeaderFromFile,
  writeSessionProjectLink,
  type SessionProjectLink,
} from "./session-project-link";
import { scanSessionMetadata } from "./session-metadata-scanner";
import { invalidateSessionListSnapshots } from "./session-reader";
import type { SessionHeader, StudioChildSessionInfo } from "./types";

/**
 * Local pathKey helper mirroring project-registry canonicalizeProjectPath.
 * Avoids a static import of project-registry (parameter properties break the
 * strip-only test loader used by focused lifecycle tests).
 */
async function canonicalizePathKey(inputPath: string): Promise<string> {
  const trimmed = inputPath.trim();
  const expanded =
    trimmed === "~"
      ? homedir()
      : trimmed.startsWith("~/")
        ? resolve(homedir(), trimmed.slice(2))
        : trimmed;
  const displayPath = normalize(isAbsolute(expanded) ? expanded : resolve(expanded)).replace(
    /[\\/]+$/,
    "",
  ) || expanded;
  try {
    return normalize(await realpath(displayPath)).replace(/[\\/]+$/, "") || displayPath;
  } catch {
    return displayPath;
  }
}

const FIRST_MESSAGE_MAX = 100;

export interface ProjectSpaceSessionLifecycleTarget {
  projectId: string;
  spaceId: string;
  sessionId: string;
  /** Absolute path to the active JSONL file. */
  sessionFileAbsolute: string;
  cwd?: string;
  /** Optional pre-resolved space; skips registry lookup when provided. */
  space?: ProjectSpaceSessionIndexSpaceLike;
  /** Optional display name override (e.g. after rename). */
  name?: string;
  /** Optional parent session id when already known (fork). */
  parentSessionId?: string;
  /** Absolute parent session file when known. */
  parentSessionFileAbsolute?: string;
}

export interface ProjectSpaceSessionRelinkInput {
  sessionFileAbsolute: string;
  link: SessionProjectLink;
  sessionId?: string;
  cwd?: string;
  /** Previous link when known; otherwise read from header before rewrite. */
  previousLink?: SessionProjectLink;
}

function nowIso(): string {
  return new Date().toISOString();
}

function clipFirstMessage(value: string | undefined): string {
  if (!value) return "";
  return value.length <= FIRST_MESSAGE_MAX ? value : value.slice(0, FIRST_MESSAGE_MAX);
}

function studioChildPointer(
  studioChild: StudioChildSessionInfo | undefined,
): ProjectSpaceSessionIndexStudioChildPointer | undefined {
  if (!studioChild || studioChild.kind !== "ypi-studio-child-session") return undefined;
  if (!studioChild.taskId || !studioChild.runId || !studioChild.member) return undefined;
  const pointer: ProjectSpaceSessionIndexStudioChildPointer = {
    kind: "ypi-studio-child-session",
    taskId: studioChild.taskId,
    runId: studioChild.runId,
    member: studioChild.member,
  };
  if (studioChild.subtaskId) pointer.subtaskId = studioChild.subtaskId;
  if (studioChild.parentSessionId) pointer.parentSessionId = studioChild.parentSessionId;
  if (studioChild.status) pointer.status = studioChild.status;
  return pointer;
}

/**
 * Clear process-local session list caches after a known mutation.
 * Clears legacy listAllSessions snapshots and the project-space 5s response
 * snapshot map (shared globalThis slot used by listSessionsForProjectSpace).
 * Keeps this sync and free of static imports of the list module so focused
 * lifecycle strip-loader tests stay isolated.
 */
export function invalidateProjectSpaceSessionListCaches(): void {
  invalidateSessionListSnapshots();
  const g = globalThis as typeof globalThis & {
    __piProjectSpaceSessionListSnapshots?: Map<unknown, unknown>;
  };
  g.__piProjectSpaceSessionListSnapshots?.clear();
}

async function resolveSpaceLike(
  projectId: string,
  spaceId: string,
  space?: ProjectSpaceSessionIndexSpaceLike,
): Promise<ProjectSpaceSessionIndexSpaceLike | null> {
  if (space && space.projectId === projectId && space.id === spaceId) return space;
  try {
    // Dynamic import keeps production registry resolution without forcing the
    // strip-loader test graph to parse project-registry parameter properties.
    const { getProjectSpace } = await import("./project-registry");
    const resolved = await getProjectSpace(projectId, spaceId);
    return {
      id: resolved.id,
      projectId: resolved.projectId,
      path: resolved.path,
      realPath: resolved.realPath,
      pathKey: resolved.pathKey,
    };
  } catch {
    return null;
  }
}

function readHeaderSafe(sessionFileAbsolute: string): SessionHeader | null {
  try {
    if (!existsSync(sessionFileAbsolute)) return null;
    return readSessionHeaderFromFile(sessionFileAbsolute);
  } catch {
    return null;
  }
}

/**
 * Build a normalized index entry from an active session JSONL file.
 * Returns null when the file is missing, not under active sessions/, or
 * cannot produce a valid entry.
 */
export async function buildProjectSpaceSessionIndexEntryFromFile(
  input: ProjectSpaceSessionLifecycleTarget,
): Promise<ProjectSpaceSessionIndexEntry | null> {
  const sessionId = String(input.sessionId ?? "").trim();
  const projectId = String(input.projectId ?? "").trim();
  const spaceId = String(input.spaceId ?? "").trim();
  if (!sessionId || !projectId || !spaceId) return null;

  const relative = toAgentDirRelativeSessionFile(input.sessionFileAbsolute);
  if (!relative) return null;

  let fileMtimeMs = 0;
  let fileSize = 0;
  try {
    const st = statSync(input.sessionFileAbsolute);
    if (!st.isFile()) return null;
    fileMtimeMs = Math.trunc(st.mtimeMs);
    fileSize = st.size;
  } catch {
    return null;
  }

  const header = readHeaderSafe(input.sessionFileAbsolute);
  const headerId = header?.id?.trim();
  if (headerId && headerId !== sessionId) return null;

  const link = getSessionProjectLink(header);
  // Prefer explicit target link (caller just wrote header); fall back to file.
  const effectiveProjectId = projectId || link.projectId || "";
  const effectiveSpaceId = spaceId || link.spaceId || "";
  if (!effectiveProjectId || !effectiveSpaceId) return null;

  const cwd =
    (typeof input.cwd === "string" && input.cwd.trim() ? input.cwd.trim() : undefined) ||
    (typeof header?.cwd === "string" && header.cwd.trim() ? header.cwd.trim() : undefined) ||
    "";
  if (!cwd) return null;

  let cwdPathKey = cwd;
  try {
    cwdPathKey = await canonicalizePathKey(cwd);
  } catch {
    cwdPathKey = cwd;
  }

  let created = header?.timestamp || nowIso();
  let modified = new Date(fileMtimeMs || Date.now()).toISOString();
  let messageCount = 0;
  let firstMessage = "";
  let name = typeof input.name === "string" && input.name.trim() ? input.name.trim() : undefined;
  let parentSessionFile =
    input.parentSessionFileAbsolute
      ? toAgentDirRelativeSessionFile(input.parentSessionFileAbsolute) ?? undefined
      : undefined;
  let parentSessionId = input.parentSessionId?.trim() || undefined;

  const metadata = await scanSessionMetadata(input.sessionFileAbsolute).catch(() => null);
  if (metadata) {
    created = metadata.created?.toISOString?.() || created;
    modified = metadata.modified?.toISOString?.() || modified;
    messageCount = metadata.messageCount ?? 0;
    firstMessage = clipFirstMessage(metadata.firstMessage);
    if (!name && metadata.name) name = metadata.name;
    if (!parentSessionFile && metadata.parentSessionPath) {
      parentSessionFile = toAgentDirRelativeSessionFile(metadata.parentSessionPath) ?? undefined;
    }
  } else {
    firstMessage = "";
  }

  if (!parentSessionId && parentSessionFile) {
    // Best-effort: parent id may be recoverable from absolute parent path header.
    const absoluteParent =
      input.parentSessionFileAbsolute ||
      (parentSessionFile ? `${getAgentDir()}/${parentSessionFile}` : undefined);
    if (absoluteParent) {
      const parentHeader = readHeaderSafe(absoluteParent);
      if (parentHeader?.id) parentSessionId = parentHeader.id;
    }
  }

  if (!parentSessionId && header && typeof (header as { parentSession?: string }).parentSession === "string") {
    const parentAbs = (header as { parentSession?: string }).parentSession!;
    const parentHeader = readHeaderSafe(parentAbs);
    if (parentHeader?.id) parentSessionId = parentHeader.id;
    if (!parentSessionFile) {
      parentSessionFile = toAgentDirRelativeSessionFile(parentAbs) ?? undefined;
    }
  }

  const studioChild = studioChildPointer(
    (header as { studioChild?: StudioChildSessionInfo } | null)?.studioChild,
  );

  return normalizeProjectSpaceSessionIndexEntry({
    sessionId,
    sessionFile: relative,
    projectId: effectiveProjectId,
    spaceId: effectiveSpaceId,
    cwd,
    cwdPathKey,
    fileMtimeMs,
    fileSize,
    created,
    modified,
    messageCount,
    firstMessage,
    name,
    parentSessionId,
    parentSessionFile,
    studioChild,
    updatedAt: nowIso(),
  });
}

/**
 * Upsert one active session into its project-space local index.
 * Never throws to callers that must not fail session creation.
 */
export async function upsertProjectSpaceSessionFromFile(
  input: ProjectSpaceSessionLifecycleTarget,
): Promise<boolean> {
  try {
    const space = await resolveSpaceLike(input.projectId, input.spaceId, input.space);
    if (!space) return false;
    const entry = await buildProjectSpaceSessionIndexEntryFromFile({ ...input, space });
    if (!entry) return false;
    const result = await upsertProjectSpaceSessionIndexEntry(space, entry);
    invalidateProjectSpaceSessionListCaches();
    return result.ok;
  } catch {
    return false;
  }
}

/**
 * Remove a session id from a space-local active index.
 */
export async function removeProjectSpaceSessionFromIndex(input: {
  projectId: string;
  spaceId: string;
  sessionId: string;
  space?: ProjectSpaceSessionIndexSpaceLike;
}): Promise<boolean> {
  try {
    const sessionId = String(input.sessionId ?? "").trim();
    const projectId = String(input.projectId ?? "").trim();
    const spaceId = String(input.spaceId ?? "").trim();
    if (!sessionId || !projectId || !spaceId) return false;
    const space = await resolveSpaceLike(projectId, spaceId, input.space);
    if (!space) return false;
    const result = await removeProjectSpaceSessionIndexEntry(space, sessionId);
    invalidateProjectSpaceSessionListCaches();
    return result.ok;
  } catch {
    return false;
  }
}

/**
 * Remove using header project/space when available. Safe after archive/delete
 * when the absolute path may already be gone — prefer reading header first.
 */
export async function removeProjectSpaceSessionByHeader(input: {
  sessionId: string;
  sessionFileAbsolute?: string;
  header?: Pick<SessionHeader, "projectId" | "spaceId" | "id"> | null;
  projectId?: string;
  spaceId?: string;
}): Promise<boolean> {
  const sessionId = String(input.sessionId ?? "").trim();
  if (!sessionId) return false;

  let projectId = input.projectId?.trim();
  let spaceId = input.spaceId?.trim();
  if ((!projectId || !spaceId) && input.header) {
    const link = getSessionProjectLink(input.header);
    projectId = projectId || link.projectId;
    spaceId = spaceId || link.spaceId;
  }
  if ((!projectId || !spaceId) && input.sessionFileAbsolute) {
    const header = readHeaderSafe(input.sessionFileAbsolute);
    const link = getSessionProjectLink(header);
    projectId = projectId || link.projectId;
    spaceId = spaceId || link.spaceId;
  }
  if (!projectId || !spaceId) {
    invalidateProjectSpaceSessionListCaches();
    return false;
  }
  return removeProjectSpaceSessionFromIndex({ projectId, spaceId, sessionId });
}

/**
 * Header-first project/space relink: write JSONL truth, then move index entry.
 * Does not roll back a successful header write if index mutation fails.
 */
export async function relinkSessionProjectSpace(
  input: ProjectSpaceSessionRelinkInput,
): Promise<SessionHeader | null> {
  const filePath = input.sessionFileAbsolute;
  if (!filePath) return null;

  let previous = input.previousLink;
  if (!previous) {
    const before = readHeaderSafe(filePath);
    previous = getSessionProjectLink(before);
  }

  let header: SessionHeader | null = null;
  try {
    header = writeSessionProjectLink(filePath, input.link);
  } catch {
    return null;
  }
  if (!header) return null;

  const next = getSessionProjectLink(header);
  const sessionId =
    (input.sessionId?.trim() || header.id?.trim() || "").trim();
  const cwd =
    (typeof input.cwd === "string" && input.cwd.trim() ? input.cwd.trim() : undefined) ||
    (typeof header.cwd === "string" ? header.cwd : undefined);

  const prevProjectId = previous.projectId?.trim();
  const prevSpaceId = previous.spaceId?.trim();
  const nextProjectId = next.projectId?.trim();
  const nextSpaceId = next.spaceId?.trim();

  if (
    sessionId &&
    prevProjectId &&
    prevSpaceId &&
    (prevProjectId !== nextProjectId || prevSpaceId !== nextSpaceId)
  ) {
    await removeProjectSpaceSessionFromIndex({
      projectId: prevProjectId,
      spaceId: prevSpaceId,
      sessionId,
    });
  }

  if (sessionId && nextProjectId && nextSpaceId) {
    await upsertProjectSpaceSessionFromFile({
      projectId: nextProjectId,
      spaceId: nextSpaceId,
      sessionId,
      sessionFileAbsolute: filePath,
      cwd,
    });
  } else {
    invalidateProjectSpaceSessionListCaches();
  }

  return header;
}

/**
 * Refresh a single entry after rename / parent rewrite / studio status change.
 * Missing project/space link → only invalidate list caches.
 */
export async function refreshProjectSpaceSessionIndexEntry(input: {
  sessionId: string;
  sessionFileAbsolute: string;
  cwd?: string;
  name?: string;
  projectId?: string;
  spaceId?: string;
}): Promise<boolean> {
  try {
    const header = readHeaderSafe(input.sessionFileAbsolute);
    const link = getSessionProjectLink(header);
    const projectId = input.projectId?.trim() || link.projectId;
    const spaceId = input.spaceId?.trim() || link.spaceId;
    const sessionId = input.sessionId.trim() || header?.id?.trim() || "";
    if (!sessionId || !projectId || !spaceId) {
      invalidateProjectSpaceSessionListCaches();
      return false;
    }
    // Archived / non-active paths must not re-enter the active index.
    if (
      input.sessionFileAbsolute.includes("/sessions-archive/") ||
      !toAgentDirRelativeSessionFile(input.sessionFileAbsolute)
    ) {
      await removeProjectSpaceSessionFromIndex({ projectId, spaceId, sessionId });
      return true;
    }
    return upsertProjectSpaceSessionFromFile({
      projectId,
      spaceId,
      sessionId,
      sessionFileAbsolute: input.sessionFileAbsolute,
      cwd: input.cwd,
      name: input.name,
    });
  } catch {
    invalidateProjectSpaceSessionListCaches();
    return false;
  }
}

/**
 * After unarchive: re-insert into the space index from the restored active path.
 */
export async function upsertProjectSpaceSessionAfterUnarchive(input: {
  sessionId: string;
  sessionFileAbsolute: string;
}): Promise<boolean> {
  const header = readHeaderSafe(input.sessionFileAbsolute);
  const link = getSessionProjectLink(header);
  if (!link.projectId || !link.spaceId || !header?.id) {
    invalidateProjectSpaceSessionListCaches();
    return false;
  }
  return upsertProjectSpaceSessionFromFile({
    projectId: link.projectId,
    spaceId: link.spaceId,
    sessionId: input.sessionId || header.id,
    sessionFileAbsolute: input.sessionFileAbsolute,
    cwd: header.cwd,
  });
}

/**
 * Best-effort batch remove after cwd cleanup (WorkTree delete etc.).
 * Reads headers when files still exist; otherwise only invalidates caches.
 */
export async function removeProjectSpaceSessionsBatch(
  sessions: Array<{ id: string; path: string; cwd?: string }>,
): Promise<void> {
  for (const session of sessions) {
    try {
      // File may already be deleted; try header only if still present.
      await removeProjectSpaceSessionByHeader({
        sessionId: session.id,
        sessionFileAbsolute: existsSync(session.path) ? session.path : undefined,
      });
    } catch {
      // continue
    }
  }
  invalidateProjectSpaceSessionListCaches();
}
