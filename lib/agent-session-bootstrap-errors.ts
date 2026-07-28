/**
 * Typed Session bootstrap failure contract (GHR-02).
 *
 * Kept free of rpc-manager / project-registry imports so callers and tests can
 * classify failures without loading the full agent runtime graph.
 */

export type AgentSessionBootstrapCode =
  | "session_binding_invalid"
  | "session_worktree_missing"
  | "session_project_space_missing_or_archived"
  | "session_project_space_mismatch"
  | "session_runtime_module_missing"
  | "session_runtime_start_failed"
  | "session_index_update_failed"
  | "session_unknown";

export type AgentSessionBootstrapStage =
  | "binding"
  | "runtime_load"
  | "runtime_start"
  | "index";

export type AgentSessionBootstrapRetryability = "automatic" | "operator";

export const SAFE_AGENT_SESSION_BOOTSTRAP_MESSAGES: Record<
  AgentSessionBootstrapCode,
  string
> = {
  session_binding_invalid: "Session binding is invalid",
  session_worktree_missing: "WorkTree directory is missing",
  session_project_space_missing_or_archived: "Project space is archived or missing",
  session_project_space_mismatch: "cwd does not match the selected project space",
  session_runtime_module_missing: "Session runtime module is missing",
  session_runtime_start_failed: "Session runtime failed to start",
  session_index_update_failed: "Session candidate index update failed",
  session_unknown: "Session bootstrap failed",
};

export class AgentSessionBootstrapError extends Error {
  public readonly bootstrapCode: AgentSessionBootstrapCode;
  public readonly stage: AgentSessionBootstrapStage;
  public readonly retryability: AgentSessionBootstrapRetryability;
  public readonly safeMessage: string;

  constructor(
    message: string,
    public readonly status = 400,
    options?: {
      bootstrapCode?: AgentSessionBootstrapCode;
      stage?: AgentSessionBootstrapStage;
      retryability?: AgentSessionBootstrapRetryability;
      cause?: unknown;
    },
  ) {
    const bootstrapCode = options?.bootstrapCode ?? "session_unknown";
    const safeMessage =
      SAFE_AGENT_SESSION_BOOTSTRAP_MESSAGES[bootstrapCode] ??
      SAFE_AGENT_SESSION_BOOTSTRAP_MESSAGES.session_unknown;
    super(
      message || safeMessage,
      options?.cause !== undefined ? { cause: options.cause } : undefined,
    );
    this.name = "AgentSessionBootstrapError";
    this.bootstrapCode = bootstrapCode;
    this.stage = options?.stage ?? "binding";
    this.retryability = options?.retryability ?? "operator";
    this.safeMessage = safeMessage;
  }
}

export function isAgentSessionBootstrapError(
  value: unknown,
): value is AgentSessionBootstrapError {
  return value instanceof AgentSessionBootstrapError;
}

/**
 * Walk Node/Error cause chain for `code` only (never free-text message).
 */
export function extractNodeErrorCode(err: unknown): string | null {
  const seen = new Set<unknown>();
  let current: unknown = err;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);
    if (typeof current === "object" && current !== null) {
      const code = (current as { code?: unknown }).code;
      if (typeof code === "string" && code.trim()) {
        return code.trim();
      }
      current = (current as { cause?: unknown }).cause;
      continue;
    }
    break;
  }
  return null;
}

/**
 * Classify a raw bootstrap failure before any generic sanitizer runs.
 * Never parses sanitized free-form text; uses typed errors + Node codes only.
 */
export function classifyAgentSessionBootstrapFailure(
  err: unknown,
  fallbackStage: AgentSessionBootstrapStage = "runtime_start",
): {
  bootstrapCode: AgentSessionBootstrapCode;
  stage: AgentSessionBootstrapStage;
  retryability: AgentSessionBootstrapRetryability;
  safeMessage: string;
  reasonCode: "session_bootstrap_failed" | "session_bootstrap_transient";
} {
  if (isAgentSessionBootstrapError(err)) {
    const reasonCode =
      err.retryability === "automatic"
        ? "session_bootstrap_transient"
        : "session_bootstrap_failed";
    return {
      bootstrapCode: err.bootstrapCode,
      stage: err.stage,
      retryability: err.retryability,
      safeMessage: err.safeMessage,
      reasonCode,
    };
  }

  const nodeCode = extractNodeErrorCode(err);
  if (
    nodeCode === "MODULE_NOT_FOUND" ||
    nodeCode === "ERR_MODULE_NOT_FOUND" ||
    nodeCode === "ERR_PACKAGE_PATH_NOT_EXPORTED"
  ) {
    return {
      bootstrapCode: "session_runtime_module_missing",
      stage: "runtime_load",
      retryability: "operator",
      safeMessage: SAFE_AGENT_SESSION_BOOTSTRAP_MESSAGES.session_runtime_module_missing,
      reasonCode: "session_bootstrap_failed",
    };
  }

  // Stage-aware transient filesystem / resource pressure (runtime start only).
  if (
    fallbackStage === "runtime_start" &&
    (nodeCode === "EBUSY" ||
      nodeCode === "EAGAIN" ||
      nodeCode === "EMFILE" ||
      nodeCode === "ENFILE" ||
      nodeCode === "ETIMEDOUT" ||
      nodeCode === "ECONNRESET")
  ) {
    return {
      bootstrapCode: "session_runtime_start_failed",
      stage: "runtime_start",
      retryability: "automatic",
      safeMessage: SAFE_AGENT_SESSION_BOOTSTRAP_MESSAGES.session_runtime_start_failed,
      reasonCode: "session_bootstrap_transient",
    };
  }

  // Deterministic missing path at binding stage is operator (WorkTree gone).
  if (nodeCode === "ENOENT" && fallbackStage === "binding") {
    return {
      bootstrapCode: "session_worktree_missing",
      stage: "binding",
      retryability: "operator",
      safeMessage: SAFE_AGENT_SESSION_BOOTSTRAP_MESSAGES.session_worktree_missing,
      reasonCode: "session_bootstrap_failed",
    };
  }

  // EACCES/EPERM/ENOENT elsewhere stay operator (not automatic spin).
  if (nodeCode === "EACCES" || nodeCode === "EPERM" || nodeCode === "ENOENT") {
    return {
      bootstrapCode:
        fallbackStage === "binding"
          ? "session_worktree_missing"
          : "session_runtime_start_failed",
      stage: fallbackStage,
      retryability: "operator",
      safeMessage:
        fallbackStage === "binding"
          ? SAFE_AGENT_SESSION_BOOTSTRAP_MESSAGES.session_worktree_missing
          : SAFE_AGENT_SESSION_BOOTSTRAP_MESSAGES.session_runtime_start_failed,
      reasonCode: "session_bootstrap_failed",
    };
  }

  return {
    bootstrapCode: "session_unknown",
    stage: fallbackStage,
    retryability: "operator",
    safeMessage: SAFE_AGENT_SESSION_BOOTSTRAP_MESSAGES.session_unknown,
    reasonCode: "session_bootstrap_failed",
  };
}
