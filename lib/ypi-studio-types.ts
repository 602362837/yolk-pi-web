export interface YpiStudioAgentFrontmatter {
  id?: string;
  name?: string;
  description?: string;
  version?: string;
}

export interface YpiStudioAgent {
  key: string;
  id: string;
  fileName: string;
  name: string;
  description: string;
  version?: number;
  pathLabel: string;
  content: string;
  truncated: boolean;
  isDefault: boolean;
  modifiedAt?: string;
  frontmatter: YpiStudioAgentFrontmatter;
  readError?: string;
}

export interface YpiStudioAgentWriteResult {
  id: string;
  fileName: string;
  pathLabel: string;
  status: "created" | "updated" | "skipped";
}

export interface YpiStudioAgentWarning {
  fileName: string;
  pathLabel: string;
  message: string;
}

export interface YpiStudioAgentsResponse {
  cwd: string;
  exists: boolean;
  pathLabel: string;
  agents: YpiStudioAgent[];
  missingDefaultAgents: string[];
  outdatedDefaultAgents: string[];
  errors: Array<{ fileName?: string; pathLabel?: string; message: string }>;
}

export interface YpiStudioAgentsInitResponse {
  cwd: string;
  pathLabel: string;
  created: YpiStudioAgentWriteResult[];
  updated: YpiStudioAgentWriteResult[];
  skipped: YpiStudioAgentWriteResult[];
  warnings: YpiStudioAgentWarning[];
  agents: YpiStudioAgentsResponse;
}

export type YpiStudioWorkflowOwner = "main" | "architect" | "ui-designer" | "implementer" | "checker" | string;

export interface YpiStudioWorkflowTriggers {
  slash?: string[];
  natural?: string[];
}

export interface YpiStudioWorkflowState {
  id: string;
  label: string;
  owner: YpiStudioWorkflowOwner;
  progress: number;
  instruction?: string;
  requiredArtifacts: string[];
  optionalArtifacts?: string[];
  requiresSubagent?: boolean;
  requiresUserApproval?: boolean;
}

export interface YpiStudioWorkflowTransition {
  from: string;
  to: string;
  label?: string;
  requiresUserApproval?: boolean;
  overrideAllowed?: boolean;
}

export interface YpiStudioWorkflow {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  triggers: YpiStudioWorkflowTriggers;
  initialStatus: string;
  terminalStatuses: string[];
  states: Record<string, YpiStudioWorkflowState>;
  transitions: YpiStudioWorkflowTransition[];
}

export interface YpiStudioWorkflowFile extends YpiStudioWorkflow {
  key: string;
  fileName: string;
  pathLabel: string;
  modifiedAt?: string;
  readError?: string;
}

export interface YpiStudioWorkflowFlowStep {
  state: YpiStudioWorkflowState;
  index: number;
  isCurrent: boolean;
}

export interface YpiStudioWorkflowFlowTransition {
  transition: YpiStudioWorkflowTransition;
  fromState?: YpiStudioWorkflowState;
  toState?: YpiStudioWorkflowState;
}

export interface YpiStudioWorkflowFlow {
  steps: YpiStudioWorkflowFlowStep[];
  mainTransitions: YpiStudioWorkflowFlowTransition[];
  branchTransitions: YpiStudioWorkflowFlowTransition[];
  warnings: string[];
}

export interface YpiStudioWorkflowWriteResult {
  id: string;
  fileName: string;
  pathLabel: string;
  status: "created" | "updated" | "skipped";
}

export interface YpiStudioWorkflowsResponse {
  cwd: string;
  exists: boolean;
  pathLabel: string;
  workflows: YpiStudioWorkflowFile[];
  missingDefaultWorkflows: string[];
  outdatedDefaultWorkflows?: string[];
  errors: Array<{ fileName?: string; pathLabel?: string; message: string }>;
}

export interface YpiStudioWorkflowsInitResponse {
  cwd: string;
  pathLabel: string;
  created: YpiStudioWorkflowWriteResult[];
  updated: YpiStudioWorkflowWriteResult[];
  skipped: YpiStudioWorkflowWriteResult[];
  workflows: YpiStudioWorkflowsResponse;
}

export type YpiStudioTaskStatus =
  | "intake"
  | "planning"
  | "awaiting_approval"
  | "implementing"
  | "checking"
  | "changes_requested"
  | "ready"
  | "completed"
  | "blocked"
  | "cancelled"
  | "archived"
  | string;

export type YpiStudioTaskScope = "active" | "archived" | "all";

export type YpiStudioTaskEventType = "created" | "transition" | "artifact" | "subagent" | "note" | "archive";

export interface YpiStudioTaskEvent {
  type: YpiStudioTaskEventType;
  at: string;
  taskId: string;
  message?: string;
  from?: string;
  to?: string;
  member?: string;
  artifact?: string;
  data?: Record<string, unknown>;
}

export type YpiStudioSubagentTranscriptStatus = "running" | "succeeded" | "failed" | "cancelled" | "waiting_for_user";

export type YpiStudioSubagentRunStatus = "queued" | YpiStudioSubagentTranscriptStatus;

export type YpiStudioSubagentRunner = "sdk" | "cli";

export interface YpiStudioSubagentRequestAffinity {
  schemaVersion: 1;
  providerSessionIdSource: "childSessionId";
  parentSessionId?: string;
  childSessionId?: string;
  model?: string;
  modelSource?: YpiStudioPolicySource;
  thinking?: string;
  thinkingSource?: YpiStudioPolicySource;
  note?: string;
}

export type YpiStudioPolicySource = "toolInput" | "memberConfig" | "defaultPolicy" | "followMain" | "piDefault" | "unset";

export type YpiStudioPolicyWarningCode =
  | "config_parse_error"
  | "member_id_normalized"
  | "tool_model_invalid"
  | "tool_thinking_invalid"
  | "tool_model_overrides_settings"
  | "tool_thinking_overrides_settings"
  | "member_policy_unset"
  | "default_policy_unset"
  | "follow_main_model_unavailable"
  | "follow_main_thinking_unavailable";

export interface YpiStudioPolicyWarning {
  code: YpiStudioPolicyWarningCode;
  message: string;
}

export interface YpiStudioPolicyResolution {
  label: string;
  arg?: string;
  effectiveSource: YpiStudioPolicySource;
  configuredSource?: "toolInput" | "memberConfig" | "defaultPolicy";
  configuredMode?: string;
  requested?: string;
  fallbackChain: YpiStudioPolicySource[];
  warnings?: YpiStudioPolicyWarning[];
}

export interface YpiStudioSubagentPolicyDiagnostics {
  schemaVersion: 1;
  memberInput: string;
  member: string;
  memberPolicyFound: boolean;
  config: { exists: boolean; parseError?: string; pathLabel: "~/.pi/agent/pi-web.json" };
  model: YpiStudioPolicyResolution;
  thinking: YpiStudioPolicyResolution;
  warnings?: YpiStudioPolicyWarning[];
}

export type YpiStudioSubagentRunPhase = "starting" | "waiting_model" | "streaming" | "running_tool" | "waiting_for_user" | "finished";

export interface YpiStudioSubagentCurrentTool {
  toolCallId: string;
  toolName: string;
  startedAt?: string;
}

export interface YpiStudioSubagentRunDisplayLimits {
  recentLimit: number;
  previewTruncated?: boolean;
  finalOutputTruncated?: boolean;
  transcriptItemTruncated?: boolean;
  transcriptCaptureLimited?: boolean;
  apiProjectionLimited?: boolean;
}

export interface YpiStudioSubagentRunProgress {
  schemaVersion: 1;
  phase: YpiStudioSubagentRunPhase;
  startedAt: string;
  updatedAt: string;
  eventCount: number;
  lastTextPreview: string;
  itemsPreview: YpiStudioSubagentTranscriptItem[];
  warnings?: string[];
  outputChars?: number;
  tokens?: number;
  tokenSource?: "estimated_chars" | "usage";
  tps?: number;
  firstTokenAt?: string;
  lastTokenAt?: string;
  currentTool?: YpiStudioSubagentCurrentTool;
  display?: YpiStudioSubagentRunDisplayLimits;
  terminationReason?: string;
}

export interface YpiStudioSubagentTranscriptTruncation {
  itemTruncated?: boolean;
  captureLimited?: boolean;
  bytesLimit?: number;
  itemBytesLimit?: number;
}

export interface YpiStudioSubagentTranscriptRef {
  schemaVersion: 1;
  format: "ypi-studio-subagent-transcript";
  runId: string;
  taskId: string;
  member: string;
  pathLabel: string;
  runner?: YpiStudioSubagentRunner;
  childSessionId?: string;
  childSessionFile?: string;
  status: YpiStudioSubagentTranscriptStatus;
  startedAt: string;
  finishedAt?: string;
  updatedAt: string;
  itemCount: number;
  messageCount: number;
  toolCallCount: number;
  stderrBytes: number;
  bytes: number;
  truncated: boolean;
  truncation?: YpiStudioSubagentTranscriptTruncation;
}

export type YpiStudioSubagentTranscriptItem =
  | { kind: "status"; at: string; text: string; truncated?: boolean }
  | { kind: "prompt"; at: string; text: string; truncated?: boolean }
  | { kind: "assistant"; at: string; text: string; model?: string; truncated?: boolean }
  | { kind: "tool_call"; at: string; toolCallId: string; toolName: string; inputPreview: string; truncated?: boolean }
  | { kind: "tool_result"; at: string; toolCallId: string; toolName?: string; text: string; isError?: boolean; truncated?: boolean }
  | { kind: "stderr"; at: string; text: string; truncated?: boolean }
  | { kind: "error"; at: string; text: string };

export interface YpiStudioSubagentTranscriptResponse {
  transcript: YpiStudioSubagentTranscriptRef;
  items: YpiStudioSubagentTranscriptItem[];
  nextCursor?: number;
  warnings?: string[];
}


export type YpiStudioImplementationSubtaskStatus =
  | "pending" // Legacy alias. UI and scheduler projections should present it as waiting.
  | "waiting"
  | "ready"
  | "queued"
  | "running"
  | "blocked"
  | "failed"
  | "done"
  | "skipped";

export type YpiStudioImplementationSchedulerMode = "dag";
export type YpiStudioImplementationSchedulerStrategy = "ready_fifo" | "priority";
export type YpiStudioImplementationFailurePolicy = "block_dependents" | "manual" | "allow_dependents_when_skipped";

export interface YpiStudioImplementationScheduler {
  mode: YpiStudioImplementationSchedulerMode;
  strategy?: YpiStudioImplementationSchedulerStrategy;
  failFast?: boolean;
  defaultFailurePolicy?: Exclude<YpiStudioImplementationFailurePolicy, "allow_dependents_when_skipped">;
}

export interface YpiStudioImplementationDependencyStatus {
  id: string;
  title?: string;
  status: YpiStudioImplementationSubtaskStatus;
}

export type YpiStudioImplementationLocalReviewStatus =
  | "not_requested"
  | "requested"
  | "running"
  | "passed"
  | "failed"
  | "skipped";

export type YpiStudioImplementationSubtaskRelation = "serial" | "parallel" | "barrier";

export interface YpiStudioImplementationExecutionGroup {
  id: string;
  title: string;
  relation: YpiStudioImplementationSubtaskRelation;
  dependencies?: string[];
  subtaskIds: string[];
}

export interface YpiStudioImplementationExecution {
  mode: "mixed" | "serial" | "parallel";
  maxParallel?: number;
  groups?: YpiStudioImplementationExecutionGroup[];
}

export interface YpiStudioImplementationSubtaskPlan {
  id: string;
  title: string;
  phase?: string;
  description?: string;
  order: number;
  /** DAG scheduling source of truth. `dependencies` is kept as a legacy alias. */
  dependsOn: string[];
  dependencies?: string[];
  relation: YpiStudioImplementationSubtaskRelation;
  files?: string[];
  instructions?: string[];
  acceptance?: string[];
  validation?: string[];
  risks?: string[];
  parallelGroup?: string;
  parallelizable?: boolean;
  member?: "implementer" | "checker" | string;
  priority?: number;
  failurePolicy?: YpiStudioImplementationFailurePolicy;
  retry?: { maxAttempts?: number };
  localReview?: {
    required?: boolean;
    reviewer?: "checker" | string;
  };
}

export interface YpiStudioImplementationPlan {
  schemaVersion: 1 | 2;
  updatedAt: string;
  sourceArtifact?: "implement.md" | string;
  summary?: string;
  strategy?: string;
  maxConcurrency?: number;
  scheduler?: YpiStudioImplementationScheduler;
  /** UI/readability projection only; scheduler readiness is derived from subtasks[].dependsOn. */
  execution?: YpiStudioImplementationExecution;
  subtasks: YpiStudioImplementationSubtaskPlan[];
}

export interface YpiStudioImplementationSubtaskProgress {
  id: string;
  status: YpiStudioImplementationSubtaskStatus;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  attempts: number;
  runIds: string[];
  lastRunId?: string;
  currentRunId?: string;
  queuedAt?: string;
  claimedAt?: string;
  claimedByContextId?: string;
  member?: string;
  waitingOn?: YpiStudioImplementationDependencyStatus[];
  blockedBy?: string[];
  blockedReason?: string;
  skippedReason?: string;
  terminationReason?: string;
  summary?: string;
  validation?: string[];
  localReview?: {
    status?: YpiStudioImplementationLocalReviewStatus;
    runIds?: string[];
    summary?: string;
    updatedAt?: string;
  };
}

export interface YpiStudioImplementationHistoryEntry {
  at: string;
  subtaskId: string;
  from?: YpiStudioImplementationSubtaskStatus;
  to: YpiStudioImplementationSubtaskStatus;
  runId?: string;
  message?: string;
}

export interface YpiStudioImplementationProgress {
  schemaVersion: 1 | 2;
  updatedAt: string;
  /** Legacy primary active subtask; v2 readers should prefer activeSubtaskIds. */
  activeSubtaskId?: string;
  activeSubtaskIds?: string[];
  queuedSubtaskIds?: string[];
  /** Legacy first ready subtask; v2 readers should prefer nextSubtaskIds. */
  nextSubtaskId?: string;
  nextSubtaskIds?: string[];
  counts: Record<YpiStudioImplementationSubtaskStatus, number>;
  subtasks: Record<string, YpiStudioImplementationSubtaskProgress>;
  history?: YpiStudioImplementationHistoryEntry[];
}

export interface YpiStudioImplementationSummary {
  total: number;
  done: number;
  skipped: number;
  blocked: number;
  failed: number;
  running: number;
  queued: number;
  ready: number;
  waiting: number;
  /** Legacy count retained for existing UI; pending should be displayed as waiting. */
  pending: number;
  activeSubtaskId?: string;
  activeSubtaskIds?: string[];
  activeTitle?: string;
  nextSubtaskId?: string;
  nextSubtaskIds?: string[];
  nextTitle?: string;
  blockedTitles: string[];
}

export interface YpiStudioTaskSubagentRun {
  id: string;
  subtaskId?: string;
  member: string;
  status: YpiStudioSubagentRunStatus;
  startedAt: string;
  finishedAt?: string;
  runner?: YpiStudioSubagentRunner;
  childSessionId?: string;
  childSessionFile?: string;
  requestAffinity?: YpiStudioSubagentRequestAffinity;
  prompt?: string;
  summary?: string;
  model?: string;
  thinking?: string;
  modelSource?: string;
  thinkingSource?: string;
  policy?: YpiStudioSubagentPolicyDiagnostics;
  progress?: YpiStudioSubagentRunProgress;
  terminationReason?: string;
  error?: string;
  transcript?: YpiStudioSubagentTranscriptRef;
}

export interface YpiStudioTaskProgress {
  status: string;
  label: string;
  percent: number;
  owner: YpiStudioWorkflowOwner;
  requiredArtifacts: string[];
  optionalArtifacts: string[];
  completedArtifacts: string[];
  missingArtifacts: string[];
}

export interface YpiStudioApprovalGate {
  enteredAt: string;
  contextId?: string;
  from: string;
  to: "awaiting_approval";
}

export interface YpiStudioApprovalGrant {
  approvedAt: string;
  /** Must match the bound Studio context key (normally pi_<sessionId>) used by input hooks and task binding. */
  contextId: string;
  inputHash: string;
  source: "user-input";
}

export interface YpiStudioTaskMeta extends Record<string, unknown> {
  approvalGate?: YpiStudioApprovalGate;
  approvalGrant?: YpiStudioApprovalGrant;
}

export interface YpiStudioTaskRecord {
  schemaVersion: 1;
  id: string;
  title: string;
  workflowId: string;
  status: YpiStudioTaskStatus;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  contextIds: string[];
  currentMember?: string;
  artifacts: Record<string, string>;
  subagents: YpiStudioTaskSubagentRun[];
  meta: YpiStudioTaskMeta;
  implementationPlan?: YpiStudioImplementationPlan;
  implementationProgress?: YpiStudioImplementationProgress;
}

export interface YpiStudioTaskSummary {
  key: string;
  id: string;
  title: string;
  workflowId: string;
  workflowName?: string;
  status: string;
  cwd: string;
  pathLabel: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  currentMember?: string;
  contextIds: string[];
  progress: YpiStudioTaskProgress;
  archived?: boolean;
  archiveMonth?: string;
  archivedAt?: string;
  archiveReason?: string;
  knowledgePath?: string;
  readError?: string;
  implementation?: YpiStudioImplementationSummary;
}

export interface YpiStudioTaskDocument {
  artifact: string;
  fileName: string;
  content: string;
  truncated: boolean;
}

export interface YpiStudioImplementationRunProjection {
  id: string;
  member: string;
  subtaskId?: string;
  status: YpiStudioSubagentRunStatus;
  registryStatus?: YpiStudioSubagentRunStatus | "runtime_lost";
  registryActive: boolean;
  startedAt: string;
  finishedAt?: string;
  summary?: string;
  error?: string;
  terminationReason?: string;
  phase?: YpiStudioSubagentRunPhase;
  tokens?: number;
  tps?: number;
  currentTool?: YpiStudioSubagentCurrentTool;
  transcriptMeta?: YpiStudioSubagentTranscriptRef;
}

export interface YpiStudioImplementationSubtaskProjection extends YpiStudioImplementationSubtaskPlan {
  status: YpiStudioImplementationSubtaskStatus;
  displayStatus: "waiting" | Exclude<YpiStudioImplementationSubtaskStatus, "pending">;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  attempts: number;
  runIds: string[];
  lastRunId?: string;
  currentRunId?: string;
  queuedAt?: string;
  claimedAt?: string;
  claimedByContextId?: string;
  member?: string;
  waitingOn?: YpiStudioImplementationDependencyStatus[];
  blockedBy?: string[];
  blockedReason?: string;
  skippedReason?: string;
  terminationReason?: string;
  summary?: string;
  validation?: string[];
  runs: YpiStudioImplementationRunProjection[];
}

export interface YpiStudioImplementationCompactTimelineItem {
  id: string;
  title: string;
  status: YpiStudioImplementationSubtaskStatus;
  displayStatus: "waiting" | Exclude<YpiStudioImplementationSubtaskStatus, "pending">;
  member?: string;
  runId?: string;
  runStatus?: YpiStudioSubagentRunStatus | "runtime_lost";
  reason?: string;
  summary?: string;
  updatedAt: string;
}

export type YpiStudioSessionRuntimeStatus =
  | "idle"
  | "running_model"
  | "running_tool"
  | "waiting_for_studio_children"
  | "needs_user"
  | "completed";

export interface YpiStudioSessionRuntimeProjection {
  status: YpiStudioSessionRuntimeStatus;
  message: string;
  activeRunCount: number;
  queuedRunCount: number;
  readySubtaskCount: number;
  blockedSubtaskCount: number;
  failedSubtaskCount: number;
  timeline: YpiStudioImplementationCompactTimelineItem[];
  updatedAt: string;
}

export interface YpiStudioImplementationProjection {
  schemaVersion: 1 | 2;
  maxConcurrency: number;
  statusCounts: Record<YpiStudioImplementationSubtaskStatus, number>;
  activeSubtaskIds: string[];
  queuedSubtaskIds: string[];
  nextSubtaskIds: string[];
  subtasksWithStatus: YpiStudioImplementationSubtaskProjection[];
  runsBySubtask: Record<string, YpiStudioImplementationRunProjection[]>;
  nonTerminalSubtasks: YpiStudioImplementationSubtaskProjection[];
  compactTimeline: YpiStudioImplementationCompactTimelineItem[];
  sessionRuntime?: YpiStudioSessionRuntimeProjection;
}

export interface YpiStudioTaskDetail extends YpiStudioTaskSummary {
  artifacts: Record<string, string>;
  documents: Record<string, YpiStudioTaskDocument>;
  subagents: YpiStudioTaskSubagentRun[];
  meta: YpiStudioTaskMeta;
  events: YpiStudioTaskEvent[];
  implementationPlan?: YpiStudioImplementationPlan;
  implementationProgress?: YpiStudioImplementationProgress;
  implementationProjection?: YpiStudioImplementationProjection;
}

export interface YpiStudioTasksResponse {
  cwd: string;
  exists: boolean;
  pathLabel: string;
  scope?: YpiStudioTaskScope;
  tasks: YpiStudioTaskSummary[];
  statusCounts: Record<string, number>;
  errors: Array<{ key?: string; pathLabel?: string; message: string }>;
}

export type YpiStudioSessionTaskLinkSource = "session-runtime" | "task-context" | "session-transcript";

export type YpiStudioSessionTaskLinkReason = "no-workspace" | "no-evidence" | "task-not-found" | "ambiguous";

export type YpiStudioWidgetStepStatus = "done" | "active" | "pending";

export interface YpiStudioTaskWidgetStep {
  id: string;
  label: string;
  owner: string;
  progress: number;
  requiresSubagent?: boolean;
  requiresUserApproval?: boolean;
  requiredArtifacts: string[];
  optionalArtifacts: string[];
  status: YpiStudioWidgetStepStatus;
}

export interface YpiStudioTaskWidgetSubagentRun {
  id: string;
  member: string;
  subtaskId?: string;
  status: YpiStudioSubagentRunStatus;
  startedAt: string;
  finishedAt?: string;
  summary?: string;
  error?: string;
  model?: string;
  thinking?: string;
  modelSource?: string;
  thinkingSource?: string;
  phase?: YpiStudioSubagentRunPhase;
  tokens?: number;
  tps?: number;
  currentTool?: YpiStudioSubagentCurrentTool;
  policy?: YpiStudioSubagentPolicyDiagnostics;
  transcriptMeta?: YpiStudioSubagentTranscriptRef;
  lastItemsPreview: YpiStudioSubagentTranscriptItem[];
  warnings?: string[];
}

export interface YpiStudioTaskWidgetEvent {
  type: YpiStudioTaskEventType;
  at: string;
  message?: string;
  from?: string;
  to?: string;
  member?: string;
  artifact?: string;
}

export interface YpiStudioTaskWidgetProjection {
  key: string;
  id: string;
  title: string;
  workflowId: string;
  workflowName?: string;
  status: string;
  statusLabel: string;
  progress: number;
  currentMember?: string;
  updatedAt: string;
  archived?: boolean;
  archiveMonth?: string;
  archivedAt?: string;
  pathLabel: string;
  artifacts: {
    required: string[];
    optional: string[];
    completed: string[];
    missing: string[];
  };
  steps: YpiStudioTaskWidgetStep[];
  subagents: YpiStudioTaskWidgetSubagentRun[];
  events?: YpiStudioTaskWidgetEvent[];
  implementation?: YpiStudioImplementationSummary;
  implementationProjection?: Pick<YpiStudioImplementationProjection, "maxConcurrency" | "statusCounts" | "activeSubtaskIds" | "queuedSubtaskIds" | "nextSubtaskIds" | "nonTerminalSubtasks" | "compactTimeline" | "sessionRuntime">;
}

export type YpiStudioSessionTaskLinkResult =
  | { task: YpiStudioTaskWidgetProjection; source: YpiStudioSessionTaskLinkSource; confidence: "high"; warnings?: string[] }
  | { task: null; reason: YpiStudioSessionTaskLinkReason; warnings?: string[] };

export interface YpiStudioLiveRunOverlay {
  toolCallId: string;
  toolName: "ypi_studio_task" | "ypi_studio_subagent" | "ypi_studio_wait";
  taskId?: string;
  taskKey?: string;
  taskTitle?: string;
  runId?: string;
  member?: string;
  subtaskId?: string;
  subtaskTitle?: string;
  status?: YpiStudioSubagentRunStatus;
  model?: string;
  thinking?: string;
  phase?: YpiStudioSubagentRunPhase;
  tokens?: number;
  tps?: number;
  currentTool?: YpiStudioSubagentCurrentTool;
  policyWarnings?: string[];
  lastTextPreview?: string;
  itemsPreview?: YpiStudioSubagentTranscriptItem[];
  updatedAt: number;
  running: boolean;
}

export interface YpiStudioKnowledgeEntry {
  id: string;
  title: string;
  taskId: string;
  taskKey: string;
  workflowId: string;
  summary: string;
  tags: string[];
  sourceTaskPath: string;
  knowledgePath: string;
  createdAt: string;
  archivedAt: string;
  sourceArtifacts: string[];
}

export interface YpiStudioKnowledgeIndex {
  schemaVersion: 1;
  updatedAt: string;
  entries: YpiStudioKnowledgeEntry[];
}

export interface YpiStudioTaskArchiveBody {
  cwd: string;
  reason?: string;
  contextId?: string;
  knowledgeSummary?: string;
  knowledgeMarkdown?: string;
  tags?: string[];
  allowFallbackKnowledge?: boolean;
}

export interface YpiStudioTaskArchiveResult {
  task: YpiStudioTaskDetail;
  knowledge: YpiStudioKnowledgeEntry;
  warnings?: string[];
}

export interface YpiStudioTaskCreateBody {
  cwd: string;
  title: string;
  workflowId?: string;
  contextId?: string;
}

export interface YpiStudioTaskImplementationPlanUpdateBody {
  cwd: string;
  action: "update_implementation_plan";
  implementationPlan: YpiStudioImplementationPlan | Record<string, unknown>;
  contextId?: string;
}

export interface YpiStudioTaskImplementationSubtaskClaimBody {
  cwd: string;
  action: "claim_implementation_subtask";
  subtaskId?: string;
  subtaskIds?: string[];
  limit?: number;
  runId?: string;
  runIds?: string[];
  status?: "queued" | "running";
  message?: string;
  contextId?: string;
}

export interface YpiStudioTaskImplementationSubtaskUpdateBody {
  cwd: string;
  action: "update_implementation_subtask";
  subtaskId: string;
  status: YpiStudioImplementationSubtaskStatus;
  runId?: string;
  message?: string;
  validation?: string[];
  blockedBy?: string[];
  blockedReason?: string;
  skippedReason?: string;
  terminationReason?: string;
  localReview?: {
    status?: YpiStudioImplementationLocalReviewStatus;
    runId?: string;
    summary?: string;
  };
  contextId?: string;
}

export type YpiStudioSubagentToolAction = "start" | "poll" | "collect" | "cancel";
export type YpiStudioSubagentToolMode = "sync" | "async";

export interface YpiStudioSubagentToolInput {
  /** Omitted action/mode preserves the existing synchronous delegation behavior. */
  action?: YpiStudioSubagentToolAction;
  mode?: YpiStudioSubagentToolMode;
  member?: string;
  prompt?: string;
  taskId?: string;
  model?: string;
  thinking?: string;
  subtaskId?: string;
  runId?: string;
  runIds?: string[];
  cancelReason?: string;
}

export interface YpiStudioSubagentToolRunProjection {
  runId: string;
  taskId?: string;
  subtaskId?: string;
  member?: string;
  status: YpiStudioSubagentRunStatus;
  progress?: YpiStudioSubagentRunProgress;
  transcript?: YpiStudioSubagentTranscriptRef;
  summary?: string;
  error?: string;
  terminationReason?: string;
}

export interface YpiStudioSubagentToolResult {
  action: YpiStudioSubagentToolAction;
  mode: YpiStudioSubagentToolMode;
  run?: YpiStudioSubagentToolRunProjection;
  runs?: YpiStudioSubagentToolRunProjection[];
  message?: string;
  warnings?: string[];
}

export interface YpiStudioTaskTransitionBody {
  cwd: string;
  to: string;
  reason?: string;
  contextId?: string;
  override?: boolean;
}

export interface YpiStudioTaskArtifactUpdateBody {
  cwd: string;
  artifact: string;
  content: string;
  contextId?: string;
}
