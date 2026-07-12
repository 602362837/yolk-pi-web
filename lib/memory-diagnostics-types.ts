/**
 * Shared, dependency-free diagnostic contracts for the memory snapshot feature.
 *
 * This module is intentionally leaf-level: it imports nothing from other project
 * modules so runtime owners can import the limit/budget shapes and projection
 * result types without creating a circular dependency back to the collector
 * (`lib/memory-diagnostics.ts`). All projection result types are pure data
 * (numbers/booleans/strings/bounded samples) and must never carry message
 * content, tool args/results, prompts, secrets, or buffer text.
 */

// ---------------------------------------------------------------------------
// Budget & limits (passed from the collector to runtime owners)
// ---------------------------------------------------------------------------

/** Cooperative time budget. `deadline` is an absolute epoch-ms timestamp. */
export interface DiagnosticBudget {
  now: number;
  deadline: number;
}

/** Per-section bounded scan caps. Owned by the collector; owners only read. */
export interface DiagnosticLimits {
  maxSessions: number;
  maxBranchEntriesPerSession: number;
  maxMessagesPerSession: number;
  maxContentBlocksPerMessage: number;
  maxChildRunSamples: number;
  maxPendingContinuationSamples: number;
  maxPathCacheSamples: number;
  maxTerminalSamples: number;
  maxSessionFileChangeSessions: number;
  sessionFileChangeMaxStatBytes: number;
}

/** True when the cooperative deadline has expired. Pure helper, no side effects. */
export function isBudgetExpired(budget: DiagnosticBudget): boolean {
  return Date.now() >= budget.deadline;
}

// ---------------------------------------------------------------------------
// OpenAI Codex WebSocket debug stats (known-session projection only)
// ---------------------------------------------------------------------------

/**
 * Numeric/boolean-only projection of the public Codex WebSocket debug stats.
 * `lastPreviousResponseId` and `lastWebSocketError` are deliberately omitted
 * because they may carry response ids / error strings that are not safe to
 * persist in a diagnostic file.
 */
export interface OpenAICodexStatsDiagnostic {
  requests: number;
  connectionsCreated: number;
  connectionsReused: number;
  cachedContextRequests: number;
  storeTrueRequests: number;
  fullContextRequests: number;
  deltaRequests: number;
  lastInputItems: number;
  lastDeltaInputItems?: number;
  websocketFailures: number;
  sseFallbacks: number;
  websocketFallbackActive?: boolean;
}

// ---------------------------------------------------------------------------
// AgentSession / RPC runtime projection
// ---------------------------------------------------------------------------

export interface AgentSessionDiagnosticSample {
  sessionId: string;
  cwd: string;
  sessionFile: string;
  provider?: string;
  model?: string;
  alive: boolean;
  isStreaming: boolean;
  isCompacting: boolean;
  listenerCount: number;
  hasIdleTimer: boolean;
  studioChildCount: number;
  branchEntryCount: number;
  agentMessageCount: number;
  roleCounts: Record<string, number>;
  contentTypeCounts: Record<string, number>;
  totalContentChars: number;
  totalContentBytes: number;
  maxSingleContentLength: number;
  systemPromptLength: number;
  activeToolCount: number;
  truncated: boolean;
  openaiCodexStats?: OpenAICodexStatsDiagnostic;
}

export interface RpcRuntimeDiagnostic {
  registryTotal: number;
  aliveCount: number;
  streamingCount: number;
  compactingCount: number;
  startLockCount: number;
  studioChildPinnedSessionCount: number;
  sessions: {
    total: number;
    sampled: number;
    truncated: number;
    samples: AgentSessionDiagnosticSample[];
  };
  error?: string;
}

// ---------------------------------------------------------------------------
// YPI Studio runtime projection
// ---------------------------------------------------------------------------

export interface StudioChildRunSample {
  runId: string;
  taskId: string;
  subtaskId?: string;
  member: string;
  status: string;
  runner?: string;
  startedAt: string;
  parentSessionId?: string;
  ageMs?: number;
}

export interface StudioPendingContinuationSample {
  continuationKey: string;
  parentSessionId: string;
  taskId: string;
  runId: string;
  attempts: number;
}

export interface StudioRuntimeDiagnostic {
  childRunTotal: number;
  childRunByStatus: Record<string, number>;
  childRunByRunner: Record<string, number>;
  childRunByMember: Record<string, number>;
  childRuns: {
    total: number;
    sampled: number;
    truncated: number;
    samples: StudioChildRunSample[];
  };
  continuationCallbackCount: number;
  terminalContinuationKeyCount: number;
  pendingContinuationTotal: number;
  pendingContinuations: {
    total: number;
    sampled: number;
    truncated: number;
    samples: StudioPendingContinuationSample[];
  };
  error?: string;
}

// ---------------------------------------------------------------------------
// Session path cache projection
// ---------------------------------------------------------------------------

export interface CacheDiagnostic {
  total: number;
  sampled: number;
  truncated: number;
  samples: Array<{ sessionId: string; path: string }>;
  error?: string;
}

// ---------------------------------------------------------------------------
// Browser Share projection (counts/aggregates only; no snapshot/payload text)
// ---------------------------------------------------------------------------

export interface BrowserShareDiagnostic {
  shareCount: number;
  shareCodeCount: number;
  sessionBindingCount: number;
  tombstoneCount: number;
  commandCount: number;
  commandWaiterCount: number;
  sharesByStatus: Record<string, number>;
  sharesByLifecycleStatus: Record<string, number>;
  commandsByStatus: Record<string, number>;
  tombstonesByLifecycleStatus: Record<string, number>;
  error?: string;
}

// ---------------------------------------------------------------------------
// Terminal projection (buffer bytes estimated, never joined)
// ---------------------------------------------------------------------------

export interface TerminalSessionSample {
  id: string;
  kind: string;
  backend: string;
  cwd: string;
  shell: string;
  subscriberCount: number;
  bufferChunks: number;
  estimatedBufferBytes: number;
  closed: boolean;
}

export interface TerminalDiagnostic {
  sessionCount: number;
  byKind: Record<string, number>;
  byBackend: Record<string, number>;
  totalSubscribers: number;
  totalBufferChunks: number;
  estimatedBufferBytes: number;
  sessions: {
    total: number;
    sampled: number;
    truncated: number;
    samples: TerminalSessionSample[];
  };
  error?: string;
}

// ---------------------------------------------------------------------------
// Session file change projection (active-session sidecar top-level counts only)
// ---------------------------------------------------------------------------

export interface SessionFileChangeSessionSample {
  sessionId: string;
  fileCount: number;
  pendingToolCount: number;
  sidecarBytes?: number;
  sidecarUpdatedAt?: string;
  sidecarError?: string;
}

export interface SessionFileChangesDiagnostic {
  sessionCount: number;
  sampled: number;
  truncated: number;
  sessions: SessionFileChangeSessionSample[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Section error placeholder used by the collector when an owner throws.
// Owners return their own `error?: string` field; the collector wraps these.
// ---------------------------------------------------------------------------

export interface DiagnosticSectionError {
  section: string;
  message: string;
}