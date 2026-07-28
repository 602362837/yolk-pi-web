import { existsSync, statSync } from "fs";
import { registerAllowedRoot } from "./allowed-roots";
import { canonicalizeCwd } from "./cwd";
import { startRpcSession, type AgentSessionWrapper } from "./rpc-manager";
import { canonicalizeProjectPath, getProjectSpace } from "./project-registry";
import { writeSessionProjectLink } from "./session-project-link";
import type { SessionHeader } from "./types";
import { upsertProjectSpaceSessionFromFile } from "./project-space-session-lifecycle";
import { invalidateSessionListSnapshots } from "./session-reader";
import {
  AgentSessionBootstrapError,
  classifyAgentSessionBootstrapFailure,
} from "./agent-session-bootstrap-errors";

export {
  AgentSessionBootstrapError,
  classifyAgentSessionBootstrapFailure,
  extractNodeErrorCode,
  isAgentSessionBootstrapError,
  SAFE_AGENT_SESSION_BOOTSTRAP_MESSAGES,
  type AgentSessionBootstrapCode,
  type AgentSessionBootstrapRetryability,
  type AgentSessionBootstrapStage,
} from "./agent-session-bootstrap-errors";

export interface AgentSessionBootstrapOptions {
  cwd?: string;
  provider?: string;
  modelId?: string;
  /**
   * When provided and non-empty, restricts active tools to these names.
   * When omitted, the standard full tool set remains active (file/bash/network).
   * GitHub unattended (GHA-06) deliberately omits this so restricted tools are
   * not a launch hard gate. Pass `[]` only when the caller intentionally wants
   * all tools disabled.
   */
  toolNames?: string[];
  thinkingLevel?: string;
  applyAutoThinkingLevel?: boolean;
  projectId?: string;
  spaceId?: string;
  /**
   * Optional pre-start hook. GitHub unattended no longer uses this to delete
   * shared process.env keys (GHA-CLOSE-03); prefer per-run toolEnv on child runs.
   * Does not provide host sandboxing.
   */
  beforeStart?: () => void | Promise<void>;
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

function disposePartialSession(session: AgentSessionWrapper | null | undefined): void {
  if (!session) return;
  try {
    const disposable = session as {
      dispose?: () => void;
      destroy?: () => void;
    };
    if (typeof disposable.destroy === "function") {
      disposable.destroy();
      return;
    }
    disposable.dispose?.();
  } catch {
    // best-effort cleanup only
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
  beforeStart,
}: AgentSessionBootstrapOptions): Promise<AgentSessionBootstrapResult> {
  if (!cwd || typeof cwd !== "string") {
    throw new AgentSessionBootstrapError("cwd is required", 400, {
      bootstrapCode: "session_binding_invalid",
      stage: "binding",
      retryability: "operator",
    });
  }

  // Optional env/context scrub (e.g. GitHub automation-owned secrets). Not a sandbox.
  if (beforeStart) {
    await beforeStart();
  }

  let canonicalCwd: string;
  try {
    canonicalCwd = canonicalizeCwd(cwd);
  } catch (error) {
    throw new AgentSessionBootstrapError("cwd is invalid", 400, {
      bootstrapCode: "session_binding_invalid",
      stage: "binding",
      retryability: "operator",
      cause: error,
    });
  }

  try {
    if (!statSync(canonicalCwd).isDirectory()) {
      throw new AgentSessionBootstrapError(`Path is not a directory: ${cwd}`, 400, {
        bootstrapCode: "session_worktree_missing",
        stage: "binding",
        retryability: "operator",
      });
    }
  } catch (error) {
    if (error instanceof AgentSessionBootstrapError) throw error;
    throw new AgentSessionBootstrapError(`Directory does not exist: ${cwd}`, 400, {
      bootstrapCode: "session_worktree_missing",
      stage: "binding",
      // Missing WorkTree is deterministic; permission pressure at binding stays operator.
      retryability: "operator",
      cause: error,
    });
  }

  if ((projectId && !spaceId) || (!projectId && spaceId)) {
    throw new AgentSessionBootstrapError("projectId and spaceId must be provided together", 400, {
      bootstrapCode: "session_binding_invalid",
      stage: "binding",
      retryability: "operator",
    });
  }
  if (projectId && spaceId) {
    let space;
    try {
      space = await getProjectSpace(projectId, spaceId);
    } catch (error) {
      throw new AgentSessionBootstrapError(
        error instanceof Error ? error.message : String(error),
        400,
        {
          bootstrapCode: "session_project_space_missing_or_archived",
          stage: "binding",
          retryability: "operator",
          cause: error,
        },
      );
    }
    if (space.archived || space.missing) {
      throw new AgentSessionBootstrapError("Project space is archived or missing", 400, {
        bootstrapCode: "session_project_space_missing_or_archived",
        stage: "binding",
        retryability: "operator",
      });
    }
    const cwdPath = await canonicalizeProjectPath(canonicalCwd);
    if (cwdPath.pathKey !== space.pathKey) {
      throw new AgentSessionBootstrapError("cwd does not match the selected project space", 400, {
        bootstrapCode: "session_project_space_mismatch",
        stage: "binding",
        retryability: "operator",
      });
    }
  }

  const tempKey = `__new__${Date.now()}_${Math.random().toString(36).slice(2)}`;
  let session: AgentSessionWrapper | null = null;
  let realSessionId = "";
  try {
    const started = await startRpcSession(tempKey, "", canonicalCwd, toolNames);
    session = started.session;
    realSessionId = started.realSessionId;
  } catch (error) {
    const classified = classifyAgentSessionBootstrapFailure(error, "runtime_start");
    // MODULE_NOT_FOUND is load-stage; reclassify via cause codes.
    throw new AgentSessionBootstrapError(classified.safeMessage, 500, {
      bootstrapCode: classified.bootstrapCode,
      stage:
        classified.bootstrapCode === "session_runtime_module_missing"
          ? "runtime_load"
          : classified.stage,
      retryability: classified.retryability,
      cause: error,
    });
  }

  try {
    // Keep allowed workspace roots in sync so brand-new cwd file/Trellis
    // requests do not have to wait for a session-list cache refresh.
    registerAllowedRoot(canonicalCwd);

    if (projectId && spaceId && session.sessionFile) {
      try {
        persistSessionHeaderProjectLink(session, projectId, spaceId);
      } catch (error) {
        // Header link is required for WorkTree ownership; treat as hard bootstrap fail.
        disposePartialSession(session);
        session = null;
        throw new AgentSessionBootstrapError("Failed to bind session project header", 500, {
          bootstrapCode: "session_runtime_start_failed",
          stage: "runtime_start",
          retryability: "operator",
          cause: error,
        });
      }

      // Space-local candidate index write-through (best-effort; never rolls back JSONL).
      try {
        await upsertProjectSpaceSessionFromFile({
          projectId,
          spaceId,
          sessionId: realSessionId,
          sessionFileAbsolute: session.sessionFile,
          cwd: canonicalCwd,
        });
      } catch {
        // Index is not JSONL truth. Do not destroy a live Session for candidate-index failure.
        // Callers that care can observe via logs; bootstrap remains successful.
      }
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
  } catch (error) {
    // Always dispose a process-local partial wrapper; JSONL on disk (if any) remains audit truth.
    disposePartialSession(session);
    if (error instanceof AgentSessionBootstrapError) throw error;
    const classified = classifyAgentSessionBootstrapFailure(error, "runtime_start");
    throw new AgentSessionBootstrapError(classified.safeMessage, 500, {
      bootstrapCode: classified.bootstrapCode,
      stage: classified.stage,
      retryability: classified.retryability,
      cause: error,
    });
  }
}
