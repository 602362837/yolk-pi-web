import { readFile } from "fs/promises";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/**
 * Legacy global session index under `~/.pi/agent/pi-web-session-index.json`.
 *
 * Project-space lists now use space-local indexes
 * (`lib/project-space-session-index.ts`). This module is a **read-only**
 * migration seed / emergency fallback adapter. Callers must not treat it as
 * the hot path or completeness authority. New writes are stopped (PSI-03);
 * `upsertProjectSessionIndexEntry` is a no-op retained only for import safety.
 */

export interface ProjectSessionIndexEntry {
  sessionId: string;
  sessionFile: string;
  cwd: string;
  projectId: string;
  spaceId: string;
  updatedAt: string;
}

export interface ProjectSessionIndexFile {
  version: 1;
  sessions: Record<string, ProjectSessionIndexEntry>;
  updatedAt?: string;
}

function indexPath(): string {
  return `${getAgentDir()}/pi-web-session-index.json`;
}

function defaultIndex(): ProjectSessionIndexFile {
  return { version: 1, sessions: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Read the legacy global sidecar. Missing/corrupt files return an empty index
 * rather than throwing so migration seed can fail soft.
 */
export async function readProjectSessionIndex(): Promise<ProjectSessionIndexFile> {
  try {
    const parsed = JSON.parse(await readFile(indexPath(), "utf8")) as unknown;
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.sessions)) return defaultIndex();
    return parsed as unknown as ProjectSessionIndexFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaultIndex();
    // Fail soft for migration: treat unreadable/corrupt as empty seed.
    return defaultIndex();
  }
}

/**
 * @deprecated No-op. New code must write space-local indexes via
 * `lib/project-space-session-lifecycle.ts` / `lib/project-space-session-index.ts`.
 * Retained so accidental imports cannot reintroduce dual-write authority.
 */
export async function upsertProjectSessionIndexEntry(..._args: [Omit<ProjectSessionIndexEntry, "updatedAt">?]): Promise<void> {
  void _args;
  // Intentionally empty: legacy global sidecar is migration-seed only.
}

export async function listIndexedSessionsForSpace(projectId: string, spaceId: string): Promise<ProjectSessionIndexEntry[]> {
  const index = await readProjectSessionIndex();
  return Object.values(index.sessions).filter((entry) => entry.projectId === projectId && entry.spaceId === spaceId);
}

/**
 * Migration seed helper: return only legacy entries for one project/space.
 * Callers must still validate each candidate against JSONL headers.
 */
export async function listLegacyIndexedSessionsForSpace(
  projectId: string,
  spaceId: string,
): Promise<ProjectSessionIndexEntry[]> {
  return listIndexedSessionsForSpace(projectId, spaceId);
}
