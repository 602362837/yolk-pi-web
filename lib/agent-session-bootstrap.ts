import { statSync } from "fs";
import { registerAllowedRoot } from "./allowed-roots";
import { canonicalizeCwd } from "./cwd";
import { startRpcSession, type AgentSessionWrapper } from "./rpc-manager";

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
}

export interface AgentSessionBootstrapResult {
  session: AgentSessionWrapper;
  sessionId: string;
  cwd: string;
}

export async function createConfiguredEmptyAgentSession({
  cwd,
  provider,
  modelId,
  toolNames,
  thinkingLevel,
  applyAutoThinkingLevel = true,
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

  const tempKey = `__new__${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const { session, realSessionId } = await startRpcSession(tempKey, "", canonicalCwd, toolNames);

  // Keep allowed workspace roots in sync so brand-new cwd file/Trellis
  // requests do not have to wait for a session-list cache refresh.
  registerAllowedRoot(canonicalCwd);

  if (provider && modelId) {
    await session.send({ type: "set_model", provider, modelId });
  }

  if (thinkingLevel && (applyAutoThinkingLevel || thinkingLevel !== "auto")) {
    await session.send({ type: "set_thinking_level", level: thinkingLevel });
  }

  return { session, sessionId: realSessionId, cwd: canonicalCwd };
}
