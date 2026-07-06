export type BrowserSharePermissionMode = "readonly" | "interactive";
export type BrowserShareConnectionStatus = "pending" | "bound" | "disconnected" | "expired";
export type BrowserShareLifecycleStatus = "pending_code" | "bound" | "stale" | "offline" | "stopped" | "unbound" | "replaced" | "expired" | "tab_closed" | "not_found";
export type BrowserShareDebuggerState = "unsupported" | "attaching" | "attached" | "detached" | "blocked" | "failed";
export type BrowserShareCommandType = "click" | "type" | "scroll" | "navigate";
export type BrowserShareActiveCommandStatus = "pending_approval" | "queued" | "running";
export type BrowserShareTerminalCommandStatus = "succeeded" | "failed" | "rejected" | "timeout";
export type BrowserShareCommandStatus = BrowserShareActiveCommandStatus | BrowserShareTerminalCommandStatus;
export type BrowserShareCaptureMode = "dom" | "debugger" | "debugger_fallback";

export interface BrowserShareTabInfo {
  url: string;
  title: string;
  origin?: string;
  favIconUrl?: string;
}

export interface BrowserShareSourceInfo {
  baseUrl?: string;
  origin?: string;
}

export interface BrowserShareViewport {
  width: number;
  height: number;
  deviceScaleFactor?: number;
  scrollX?: number;
  scrollY?: number;
}

export interface BrowserShareElementBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserShareScreenshotSummary {
  enabled?: boolean;
  available?: boolean;
  mimeType?: string;
  width?: number;
  height?: number;
  byteLength?: number;
  capturedAt?: string;
  data?: string;
  truncated?: boolean;
  error?: string;
}

export interface BrowserShareDebuggerSummary {
  enabled: boolean;
  attached?: boolean;
  persistent?: boolean;
  desired?: boolean;
  state?: BrowserShareDebuggerState;
  attachedAt?: string;
  detachedAt?: string;
  detachReason?: string;
  protocolVersion?: string;
  lastError?: string;
  screenshotAvailable?: boolean;
}

export interface BrowserShareCapabilities {
  captureModes?: BrowserShareCaptureMode[];
  debugger?: boolean;
  screenshot?: boolean | "opt-in";
  [key: string]: unknown;
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
  bounds?: BrowserShareElementBounds;
  axRole?: string;
  axName?: string;
  selector?: string;
  frameId?: string;
  debuggerRef?: string;
}

export interface BrowserSharePageSnapshot {
  tab: BrowserShareTabInfo;
  capturedAt: string;
  visibleText: string;
  selection?: string;
  focusedElementId?: string;
  elements: BrowserShareInteractiveElement[];
  warnings?: string[];
  captureMode?: BrowserShareCaptureMode;
  viewport?: BrowserShareViewport;
  debugger?: BrowserShareDebuggerSummary;
  screenshot?: BrowserShareScreenshotSummary;
}

export interface BrowserShareCreateRequest {
  extensionInstanceId: string;
  tab: BrowserShareTabInfo;
  permissionMode?: BrowserSharePermissionMode;
  pagePreview?: Partial<BrowserSharePageSnapshot>;
  extensionVersion?: string;
  baseUrl?: string;
  source?: BrowserShareSourceInfo;
  capabilities?: BrowserShareCapabilities;
  captureMode?: BrowserShareCaptureMode;
  debugger?: BrowserShareDebuggerSummary;
  screenshot?: BrowserShareScreenshotSummary;
}

export interface BrowserShareCreateResponse {
  shareId: string;
  shareCode: string;
  expiresAt: string;
}

export interface BrowserShareOperatorInfo {
  bindingStatus: "none" | "pending_code" | "bound" | "unbound";
  serviceBaseUrl?: string;
  boundSessionId?: string;
  boundSessionLabel?: string;
  permissionMode?: BrowserSharePermissionMode;
  canRead: boolean;
  canOperate: boolean;
  autoAllowedCommands: BrowserShareCommandType[];
  approvalRequiredCommands: BrowserShareCommandType[];
}

export interface BrowserShareControlProjection {
  shareId: string;
  lifecycleStatus: BrowserShareLifecycleStatus;
  detachRequested?: boolean;
  detachReason?: string;
  boundSessionId?: string;
  permissionMode?: BrowserSharePermissionMode;
  expiresAt?: string;
  operator?: BrowserShareOperatorInfo;
  debugger?: BrowserShareDebuggerSummary;
}

export interface BrowserShareRuntimeUpdate {
  tab?: BrowserShareTabInfo;
  lifecycleStatus?: BrowserShareLifecycleStatus;
  debugger?: BrowserShareDebuggerSummary;
  captureMode?: BrowserShareCaptureMode;
  screenshot?: BrowserShareScreenshotSummary;
  source?: BrowserShareSourceInfo;
  capabilities?: BrowserShareCapabilities;
  transport?: {
    serviceOnline?: boolean;
    lastHeartbeatAt?: string;
    lastError?: string;
  };
}

export interface BrowserShareSessionState {
  sessionId: string;
  bound: boolean;
  shareId?: string;
  status: BrowserShareConnectionStatus;
  lifecycleStatus?: BrowserShareLifecycleStatus;
  operator?: BrowserShareOperatorInfo;
  detachRequested?: boolean;
  detachReason?: string;
  permissionMode?: BrowserSharePermissionMode;
  tab?: BrowserShareTabInfo;
  snapshot?: BrowserSharePageSnapshot;
  createdAt?: string;
  boundAt?: string;
  expiresAt?: string;
  lastSnapshotAt?: string;
  lastSeenAt?: string;
  lastCommandPollAt?: string;
  lastResultAt?: string;
  pendingCommands?: BrowserShareCommand[];
  activeCommands?: BrowserShareCommand[];
  recentCommands?: BrowserShareCommand[];
  extensionVersion?: string;
  source?: BrowserShareSourceInfo;
  capabilities?: BrowserShareCapabilities;
  captureMode?: BrowserShareCaptureMode;
  debugger?: BrowserShareDebuggerSummary;
  screenshot?: BrowserShareScreenshotSummary;
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
  terminalAt?: string;
}

export interface BrowserShareCommandResult {
  ok: boolean;
  message?: string;
  snapshot?: BrowserSharePageSnapshot;
  captureMode?: BrowserShareCaptureMode;
  debugger?: BrowserShareDebuggerSummary;
  screenshot?: BrowserShareScreenshotSummary;
}
