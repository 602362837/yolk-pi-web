import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { dirname } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

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

async function readProjectSessionIndex(): Promise<ProjectSessionIndexFile> {
  try {
    const parsed = JSON.parse(await readFile(indexPath(), "utf8")) as unknown;
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.sessions)) return defaultIndex();
    return parsed as unknown as ProjectSessionIndexFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaultIndex();
    throw error;
  }
}

async function writeProjectSessionIndex(index: ProjectSessionIndexFile): Promise<void> {
  const filePath = indexPath();
  await mkdir(dirname(filePath), { recursive: true });
  const next = { ...index, updatedAt: new Date().toISOString() };
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await rename(tmp, filePath);
}

export async function upsertProjectSessionIndexEntry(entry: Omit<ProjectSessionIndexEntry, "updatedAt">): Promise<void> {
  if (!entry.projectId || !entry.spaceId || !entry.sessionId) return;
  const index = await readProjectSessionIndex();
  index.sessions[entry.sessionId] = { ...entry, updatedAt: new Date().toISOString() };
  await writeProjectSessionIndex(index);
}

export async function listIndexedSessionsForSpace(projectId: string, spaceId: string): Promise<ProjectSessionIndexEntry[]> {
  const index = await readProjectSessionIndex();
  return Object.values(index.sessions).filter((entry) => entry.projectId === projectId && entry.spaceId === spaceId);
}
