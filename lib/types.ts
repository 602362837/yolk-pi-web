// Types mirrored from pi-mono coding-agent session-manager

export interface SessionHeader {
  type: "session";
  version?: number;
  id: string;
  timestamp: string;
  cwd: string;
  parentSession?: string;
}

export interface SessionEntryBase {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
}

export interface TextContent {
  type: "text";
  text: string;
}

export interface ImageContent {
  type: "image";
  source: {
    type: "base64" | "url";
    media_type?: string;
    data?: string;
    url?: string;
  };
}

/** A file attached to a chat message (stored server-side, referenced by path). */
export interface AttachedFile {
  name: string;
  size: number;
  path: string;
}

export interface FileReference {
  relativePath: string;
  startLine?: number;
  endLine?: number;
}

export interface ThinkingContent {
  type: "thinking";
  thinking: string;
}

export interface ToolCallContent {
  type: "toolCall";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export type AssistantContentBlock = TextContent | ImageContent | ThinkingContent | ToolCallContent;

export interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
  timestamp?: number;
}

export interface AssistantMessage {
  role: "assistant";
  content: AssistantContentBlock[];
  model: string;
  provider: string;
  stopReason?: string;
  errorMessage?: string;
  timestamp?: number;
  usage?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      total: number;
    };
  };
}

export interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName?: string;
  content: (TextContent | ImageContent)[];
  isError?: boolean;
  timestamp?: number;
}

export interface CustomMessage {
  role: "custom";
  customType: string;
  content: string | (TextContent | ImageContent)[];
  display: boolean;
  details?: unknown;
  timestamp?: number;
}

export type AgentMessage = UserMessage | AssistantMessage | ToolResultMessage | CustomMessage;

export type ExtensionUiRequest =
  | {
      type: "extension_ui_request";
      id: string;
      method: "select";
      title: string;
      options: string[];
      timeout?: number;
      expiresAt?: number;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "confirm";
      title: string;
      message: string;
      timeout?: number;
      expiresAt?: number;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "input";
      title: string;
      placeholder?: string;
      timeout?: number;
      expiresAt?: number;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "editor";
      title: string;
      prefill?: string;
      timeout?: number;
      expiresAt?: number;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "notify";
      message: string;
      notifyType?: "info" | "warning" | "error";
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "setStatus";
      statusKey: string;
      statusText?: string;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "setWidget";
      widgetKey: string;
      widgetLines?: string[];
      widgetPlacement?: "aboveEditor" | "belowEditor";
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "setTitle";
      title: string;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "set_editor_text";
      text: string;
    };

export type ExtensionUiResponse =
  | { type: "extension_ui_response"; id: string; value: string }
  | { type: "extension_ui_response"; id: string; confirmed: boolean }
  | { type: "extension_ui_response"; id: string; cancelled: true };

export interface ExtensionStatusItem {
  key: string;
  text: string;
}

export interface ExtensionWidgetItem {
  key: string;
  lines: string[];
  placement: "aboveEditor" | "belowEditor";
}

export interface SessionMessageEntry extends SessionEntryBase {
  type: "message";
  message: AgentMessage;
}

export interface ThinkingLevelChangeEntry extends SessionEntryBase {
  type: "thinking_level_change";
  thinkingLevel: string;
}

export interface ModelChangeEntry extends SessionEntryBase {
  type: "model_change";
  provider: string;
  modelId: string;
}

export interface CompactionEntry extends SessionEntryBase {
  type: "compaction";
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details?: unknown;
  fromHook?: boolean;
}

export interface BranchSummaryEntry extends SessionEntryBase {
  type: "branch_summary";
  fromId: string;
  summary: string;
  details?: unknown;
  fromHook?: boolean;
}

export interface CustomEntry extends SessionEntryBase {
  type: "custom";
  customType: string;
  data?: unknown;
}

export interface CustomMessageEntry extends SessionEntryBase {
  type: "custom_message";
  customType: string;
  content: string | (TextContent | ImageContent)[];
  details?: unknown;
  display: boolean;
}

export interface LabelEntry extends SessionEntryBase {
  type: "label";
  targetId: string;
  label: string | undefined;
}

export interface SessionInfoEntry extends SessionEntryBase {
  type: "session_info";
  name?: string;
}

export type SessionEntry =
  | SessionMessageEntry
  | ThinkingLevelChangeEntry
  | ModelChangeEntry
  | CompactionEntry
  | BranchSummaryEntry
  | CustomEntry
  | CustomMessageEntry
  | LabelEntry
  | SessionInfoEntry;

export type FileEntry = SessionHeader | SessionEntry;

export interface SessionTreeNode {
  entry: SessionEntry;
  children: SessionTreeNode[];
  label?: string;
  compressedEntryIds?: string[];
}

export interface GitInfo {
  branch?: string;
  repoRoot?: string;
  mainWorktreePath?: string;
  mainWorktreeBranch?: string;
  isWorktree?: boolean;
}

export interface WorktreeInfo {
  isWorktree: true;
  branch?: string;
  repoRoot?: string;
  mainWorktreePath?: string;
  mainWorktreeBranch?: string;
}

export interface SessionInfo {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
  parentSessionId?: string; // set if this session was forked from another
  archived?: boolean;       // true for archived sessions
  worktree?: WorktreeInfo;
  git?: GitInfo;
}

export interface SessionContext {
  messages: AgentMessage[];
  entryIds: string[]; // parallel to messages — the session entry id for each message
  thinkingLevel: string;
  model: { provider: string; modelId: string } | null;
}

export type SessionFileChangeStatus = "added" | "modified" | "deleted" | "metadata-only";
export type SessionFileChangeSourceKind = "edit" | "write";
export type SessionFileChangeReason = "binary" | "too-large" | "outside-workspace" | "unreadable" | "unchanged";

export interface SessionChangedFileSummary {
  path: string;
  status: SessionFileChangeStatus;
  additions: number;
  deletions: number;
  toolNames: SessionFileChangeSourceKind[];
  sourceKinds: SessionFileChangeSourceKind[];
  diffAvailable: boolean;
  reason?: SessionFileChangeReason;
  firstChangedAt: string;
  lastChangedAt: string;
}

export interface SessionChangesSummaryResponse {
  sessionId: string;
  updatedAt?: string;
  files: SessionChangedFileSummary[];
}

export interface SessionFileDiffResponse extends SessionChangedFileSummary {
  diff?: string;
}

// RPC types
export interface RpcSessionState {
  model?: { provider: string; id: string; contextWindow?: number };
  thinkingLevel: string;
  isStreaming: boolean;
  isCompacting: boolean;
  sessionFile?: string;
  sessionId: string;
  sessionName?: string;
  messageCount: number;
}

// Git status panel types
export type GitCommitFileStatus = "M" | "A" | "D" | "R" | "C" | "T" | "U" | "?";

export interface GitFileChange {
  status: "M" | "A" | "D" | "R" | "C" | "U" | "?";
  file: string;
  oldFile?: string;
}

export interface GitCommitInfo {
  hash: string;
  message: string;
  author: string;
  date: string;
  relativeDate: string;
}

export interface GitCommitRef {
  name: string;
  type: "branch" | "tag" | "head" | "remote";
}

export interface GitGraphCommit {
  hash: string;
  message: string;
  author: string;
  date: string;
  relativeDate: string;
  parents: string[];
  refs: GitCommitRef[];
}

export interface GitCommitChangedFile {
  status: GitCommitFileStatus;
  file: string;
  oldFile?: string;
  additions?: number;
  deletions?: number;
  binary?: boolean;
}

export interface GitCommitDetail {
  hash: string;
  shortHash: string;
  parents: string[];
  author: {
    name: string;
    email: string;
    date: string;
    relativeDate: string;
  };
  committer: {
    name: string;
    email: string;
    date: string;
  };
  subject: string;
  body: string;
  refs: GitCommitRef[];
  files: GitCommitChangedFile[];
}

export type GitCommitDiffReason = "binary" | "too-large" | "unavailable";

export interface GitCommitFileDiffResponse {
  hash: string;
  file: string;
  oldFile?: string;
  diffAvailable: boolean;
  diff?: string;
  reason?: GitCommitDiffReason;
}

export interface GitBranchInfo {
  name: string;
  isCurrent: boolean;
  upstream?: string | null;
  ahead: number;
  behind: number;
  latestCommit: string;
}

export interface GitGraphData {
  commits: GitGraphCommit[];
  branches: GitBranchInfo[];
}

export interface GitStatusInfo {
  branch: string | null;
  upstream: string | null;
  isDetached: boolean;
  isDirty: boolean;
  isWorktree: boolean;
  ahead: number;
  behind: number;
  staged: GitFileChange[];
  unstaged: GitFileChange[];
  untracked: string[];
  recentCommits: GitCommitInfo[];
  stashCount: number;
}
