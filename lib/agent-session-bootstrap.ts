import { existsSync, statSync } from "fs";
import { registerAllowedRoot } from "./allowed-roots";
import { canonicalizeCwd } from "./cwd";
import { startRpcSession, type AgentSessionWrapper } from "./rpc-manager";
import { canonicalizeProjectPath, getProjectSpace } from "./project-registry";
import { writeSessionProjectLink } from "./session-project-link";
import type { SessionHeader } from "./types";
import { upsertProjectSpaceSessionFromFile } from "./project-space-session-lifecycle";
import { invalidateSessionListSnapshots } from "./session-reader";

export class AgentSessionBootstrapError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "AgentSessionBootstrapError";
  }
}

export interface AgentSessionBootstrapOptions {
  cwd?: string;
  provider?: string;
  modelId?: string;
  toolNames?: string[];
  thinkingLevel?: string;
  applyAutoThinkingLevel?: boolean;
  projectId?: string;
  spaceId?: string;
}

export interface AgentSessionBootstrapResult {
  session: AgentSessionWrapper;
  sessionId: string;
  cwd: string;
}

function persistSessionHeaderProjectLink(session: AgentSessionWrapper, projectId: string, spaceId: string): void {
  const manager = session.inner.sessionManager;
  const header = manager.getHeader() as SessionHeader | null;
  if (!header || header.type !== "session") return;
  header.projectId = projectId;
  header.spaceId = spaceId;

  const rewrite = (manager as unknown as { _rewriteFile?: () => void })._rewriteFile;
  if (typeof rewrite === "function") {
    rewrite.call(manager);
    (manager as unknown as { flushed?: boolean }).flushed = true;
  } else if (session.sessionFile && existsSync(session.sessionFile)) {
    writeSessionProjectLink(session.sessionFile, { projectId, spaceId });
  }
}

export async function createConfiguredEmptyAgentSession({
  cwd,
  provider,
  modelId,
  toolNames,
  thinkingLevel,
  applyAutoThinkingLevel = true,
  projectId,
  spaceId,
}: AgentSessionBootstrapOptions): Promise<AgentSessionBootstrapResult> {
  if (!cwd || typeof cwd !== "string") {
    throw new AgentSessionBootstrapError("cwd is required");
  }

  const canonicalCwd = canonicalizeCwd(cwd);
  try {
    if (!statSync(canonicalCwd).isDirectory()) {
      throw new AgentSessionBootstrapError(`Path is not a directory: ${cwd}`);
    }
  } catch (error) {
    if (error instanceof AgentSessionBootstrapError) throw error;
    throw new AgentSessionBootstrapError(`Directory does not exist: ${cwd}`);
  }

  if ((projectId && !spaceId) || (!projectId && spaceId)) {
    throw new AgentSessionBootstrapError("projectId and spaceId must be provided together");
  }
  if (projectId && spaceId) {
    const space = await getProjectSpace(projectId, spaceId).catch((error) => {
      throw new AgentSessionBootstrapError(error instanceof Error ? error.message : String(error), 400);
    });
    if (space.archived || space.missing) {
      throw new AgentSessionBootstrapError("Project space is archived or missing");
    }
    const cwdPath = await canonicalizeProjectPath(canonicalCwd);
    if (cwdPath.pathKey !== space.pathKey) {
      throw new AgentSessionBootstrapError("cwd does not match the selected project space");
    }
  }

  const tempKey = `__new__${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const { session, realSessionId } = await startRpcSession(tempKey, "", canonicalCwd, toolNames);

  // Keep allowed workspace roots in sync so brand-new cwd file/Trellis
  // requests do not have to wait for a session-list cache refresh.
  registerAllowedRoot(canonicalCwd);

  if (projectId && spaceId && session.sessionFile) {
    persistSessionHeaderProjectLink(session, projectId, spaceId);
    // Space-local candidate index write-through (best-effort; never rolls back JSONL).
    await upsertProjectSpaceSessionFromFile({
      projectId,
      spaceId,
      sessionId: realSessionId,
      sessionFileAbsolute: session.sessionFile,
      cwd: canonicalCwd,
    });
  }

  // Drop the short-lived listAllSessions snapshot so the sidebar does not miss
  // a brand-new draft/prompt session created within the cache TTL window.
  invalidateSessionListSnapshots();

  if (provider && modelId) {
    await session.send({ type: "set_model", provider, modelId });
  }

  if (thinkingLevel && (applyAutoThinkingLevel || thinkingLevel !== "auto")) {
    await session.send({ type: "set_thinking_level", level: thinkingLevel });
  }

  return { session, sessionId: realSessionId, cwd: canonicalCwd };
}
