import type { SessionHeader, StudioChildSessionInfo } from "./types";

export interface SessionHeaderMetadata {
  projectLink: { legacyUnassigned: boolean; projectId?: string; spaceId?: string };
  studioChild?: StudioChildSessionInfo;
}

function readLinkedProject(header: Partial<SessionHeader>): { projectId?: string; spaceId?: string } {
  const projectId = typeof header.projectId === "string" && header.projectId.trim() ? header.projectId.trim() : undefined;
  const spaceId = typeof header.spaceId === "string" && header.spaceId.trim() ? header.spaceId.trim() : undefined;
  return projectId && spaceId ? { projectId, spaceId } : {};
}

export function parseSessionHeaderMetadata(headerLine: string): SessionHeaderMetadata {
  const header = JSON.parse(headerLine) as Partial<SessionHeader>;
  const projectLink = readLinkedProject(header);
  const studioChild = header.studioChild && typeof header.studioChild === "object" && header.studioChild.kind === "ypi-studio-child-session"
    ? header.studioChild
    : undefined;
  return {
    projectLink: { ...projectLink, legacyUnassigned: !projectLink.projectId || !projectLink.spaceId },
    studioChild,
  };
}
