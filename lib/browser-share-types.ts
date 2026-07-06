export type BrowserSharePermissionMode = "readonly" | "interactive";
export type BrowserShareConnectionStatus = "pending" | "bound" | "disconnected" | "expired";
export type BrowserShareCommandType = "click" | "type" | "scroll" | "navigate";
export type BrowserShareCommandStatus = "pending_approval" | "queued" | "running" | "succeeded" | "failed" | "rejected";

export interface BrowserShareTabInfo {
  url: string;
  title: string;
  origin?: string;
  favIconUrl?: string;
}

export interface BrowserShareInteractiveElement {
  elementId: string;
  tagName: string;
  role?: string;
  label?: string;
  text?: string;
  inputType?: string;
  href?: string;
  isSensitive?: boolean;
}

export interface BrowserSharePageSnapshot {
  tab: BrowserShareTabInfo;
  capturedAt: string;
  visibleText: string;
  selection?: string;
  focusedElementId?: string;
  elements: BrowserShareInteractiveElement[];
  warnings?: string[];
}

export interface BrowserShareCreateRequest {
  extensionInstanceId: string;
  tab: BrowserShareTabInfo;
  permissionMode?: BrowserSharePermissionMode;
  pagePreview?: Partial<BrowserSharePageSnapshot>;
}

export interface BrowserShareCreateResponse {
  shareId: string;
  shareCode: string;
  expiresAt: string;
}

export interface BrowserShareSessionState {
  sessionId: string;
  bound: boolean;
  shareId?: string;
  status: BrowserShareConnectionStatus;
  permissionMode?: BrowserSharePermissionMode;
  tab?: BrowserShareTabInfo;
  snapshot?: BrowserSharePageSnapshot;
  createdAt?: string;
  boundAt?: string;
  expiresAt?: string;
  lastSnapshotAt?: string;
  pendingCommands?: BrowserShareCommand[];
}

export interface BrowserShareCommand {
  commandId: string;
  sessionId: string;
  shareId: string;
  type: BrowserShareCommandType;
  status: BrowserShareCommandStatus;
  createdAt: string;
  updatedAt: string;
  elementId?: string;
  text?: string;
  url?: string;
  deltaX?: number;
  deltaY?: number;
  reason?: string;
  result?: BrowserShareCommandResult;
}

export interface BrowserShareCommandResult {
  ok: boolean;
  message?: string;
  snapshot?: BrowserSharePageSnapshot;
}
