import { readFileSync, writeFileSync } from "fs";
import type { SessionHeader } from "./types";

export interface SessionProjectLink {
  projectId?: string;
  spaceId?: string;
}

export interface SessionProjectLinkState extends SessionProjectLink {
  legacyUnassigned: boolean;
}

function normalizeProjectLink(link: SessionProjectLink): SessionProjectLink {
  const projectId = typeof link.projectId === "string" && link.projectId.trim() ? link.projectId.trim() : undefined;
  const spaceId = typeof link.spaceId === "string" && link.spaceId.trim() ? link.spaceId.trim() : undefined;
  return projectId && spaceId ? { projectId, spaceId } : {};
}

export function getSessionProjectLink(header: Pick<SessionHeader, "projectId" | "spaceId"> | null | undefined): SessionProjectLinkState {
  const link = normalizeProjectLink({ projectId: header?.projectId, spaceId: header?.spaceId });
  return { ...link, legacyUnassigned: !link.projectId || !link.spaceId };
}

export function readSessionHeaderFromFile(filePath: string): SessionHeader | null {
  const firstLine = readFileSync(filePath, "utf8").split("\n")[0];
  const header = JSON.parse(firstLine) as SessionHeader;
  return header?.type === "session" ? header : null;
}

export function writeSessionProjectLink(filePath: string, link: SessionProjectLink): SessionHeader | null {
  const normalized = normalizeProjectLink(link);
  if (!normalized.projectId || !normalized.spaceId) return readSessionHeaderFromFile(filePath);

  const content = readFileSync(filePath, "utf8");
  const newlineIndex = content.indexOf("\n");
  const firstLine = newlineIndex >= 0 ? content.slice(0, newlineIndex) : content;
  const rest = newlineIndex >= 0 ? content.slice(newlineIndex) : "\n";
  const header = JSON.parse(firstLine) as SessionHeader;
  if (header.type !== "session") return null;
  header.projectId = normalized.projectId;
  header.spaceId = normalized.spaceId;
  writeFileSync(filePath, `${JSON.stringify(header)}${rest}`, "utf8");
  return header;
}

export async function sessionCwdMatchesPathKey(cwd: string | undefined, pathKey: string): Promise<boolean> {
  if (!cwd) return false;
  // Dynamic import avoids pulling project-registry into strip-loader test graphs
  // that only need header read/write helpers from this module.
  const { canonicalizeProjectPath } = await import("./project-registry");
  const info = await canonicalizeProjectPath(cwd);
  return info.pathKey === pathKey;
}
