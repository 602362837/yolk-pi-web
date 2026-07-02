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

export interface YpiStudioWorkflowWriteResult {
  id: string;
  fileName: string;
  pathLabel: string;
  status: "created" | "skipped";
}

export interface YpiStudioWorkflowsResponse {
  cwd: string;
  exists: boolean;
  pathLabel: string;
  workflows: YpiStudioWorkflowFile[];
  missingDefaultWorkflows: string[];
  errors: Array<{ fileName?: string; pathLabel?: string; message: string }>;
}

export interface YpiStudioWorkflowsInitResponse {
  cwd: string;
  pathLabel: string;
  created: YpiStudioWorkflowWriteResult[];
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

export type YpiStudioTaskEventType = "created" | "transition" | "artifact" | "subagent" | "note";

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

export type YpiStudioSubagentTranscriptStatus = "running" | "succeeded" | "failed" | "cancelled";

export interface YpiStudioSubagentTranscriptRef {
  schemaVersion: 1;
  format: "ypi-studio-subagent-transcript";
  runId: string;
  taskId: string;
  member: string;
  pathLabel: string;
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

export interface YpiStudioTaskSubagentRun {
  id: string;
  member: string;
  status: YpiStudioSubagentTranscriptStatus;
  startedAt: string;
  finishedAt?: string;
  prompt?: string;
  summary?: string;
  model?: string;
  thinking?: string;
  modelSource?: string;
  thinkingSource?: string;
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
  meta: Record<string, unknown>;
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
  readError?: string;
}

export interface YpiStudioTaskDocument {
  artifact: string;
  fileName: string;
  content: string;
  truncated: boolean;
}

export interface YpiStudioTaskDetail extends YpiStudioTaskSummary {
  artifacts: Record<string, string>;
  documents: Record<string, YpiStudioTaskDocument>;
  subagents: YpiStudioTaskSubagentRun[];
  meta: Record<string, unknown>;
  events: YpiStudioTaskEvent[];
}

export interface YpiStudioTasksResponse {
  cwd: string;
  exists: boolean;
  pathLabel: string;
  tasks: YpiStudioTaskSummary[];
  statusCounts: Record<string, number>;
  errors: Array<{ key?: string; pathLabel?: string; message: string }>;
}

export interface YpiStudioTaskCreateBody {
  cwd: string;
  title: string;
  workflowId?: string;
  contextId?: string;
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
