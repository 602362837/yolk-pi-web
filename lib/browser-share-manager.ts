import { randomBytes, randomUUID } from "node:crypto";
import type {
  BrowserShareCommand,
  BrowserShareCommandResult,
  BrowserShareCommandStatus,
  BrowserShareCommandType,
  BrowserShareConnectionStatus,
  BrowserShareCreateRequest,
  BrowserShareCreateResponse,
  BrowserSharePageSnapshot,
  BrowserSharePermissionMode,
  BrowserShareSessionState,
  BrowserShareTabInfo,
} from "./browser-share-types";

const SHARE_TTL_MS = 5 * 60 * 1000;
const SNAPSHOT_TEXT_LIMIT = 12_000;
const SELECTION_LIMIT = 4_000;
const ELEMENT_LIMIT = 80;

type ShareRecord = {
  shareId: string;
  shareCode: string;
  extensionInstanceId: string;
  permissionMode: BrowserSharePermissionMode;
  tab: BrowserShareTabInfo;
  snapshot?: BrowserSharePageSnapshot;
  sessionId?: string;
  createdAt: string;
  expiresAt: string;
  boundAt?: string;
  lastSnapshotAt?: string;
  status: BrowserShareConnectionStatus;
};

declare global {
  var __browserShareManager: BrowserShareManager | undefined;
}

function nowIso(): string {
  return new Date().toISOString();
}

function clampText(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

function sanitizeTab(tab: BrowserShareTabInfo): BrowserShareTabInfo {
  let origin = tab.origin;
  try {
    origin = new URL(tab.url).origin;
  } catch {
    // Keep the extension-provided origin if URL parsing fails.
  }
  return {
    url: clampText(tab.url, 2_000) ?? "",
    title: clampText(tab.title, 300) ?? "Untitled",
    origin,
    favIconUrl: clampText(tab.favIconUrl, 2_000),
  };
}

function sanitizeSnapshot(input: BrowserSharePageSnapshot | Partial<BrowserSharePageSnapshot>, fallbackTab: BrowserShareTabInfo): BrowserSharePageSnapshot {
  const tab = input.tab ? sanitizeTab(input.tab) : fallbackTab;
  return {
    tab,
    capturedAt: typeof input.capturedAt === "string" ? input.capturedAt : nowIso(),
    visibleText: clampText(input.visibleText, SNAPSHOT_TEXT_LIMIT) ?? "",
    selection: clampText(input.selection, SELECTION_LIMIT),
    focusedElementId: clampText(input.focusedElementId, 120),
    warnings: Array.isArray(input.warnings) ? input.warnings.filter((v): v is string => typeof v === "string").slice(0, 10) : undefined,
    elements: Array.isArray(input.elements) ? input.elements.slice(0, ELEMENT_LIMIT).map((el) => ({
      elementId: clampText(el.elementId, 120) ?? "",
      tagName: clampText(el.tagName, 40) ?? "",
      role: clampText(el.role, 80),
      label: clampText(el.label, 300),
      text: clampText(el.text, 300),
      inputType: clampText(el.inputType, 80),
      href: clampText(el.href, 1_000),
      isSensitive: el.isSensitive === true,
    })).filter((el) => el.elementId && el.tagName) : [],
  };
}

function generateShareCode(existing: Set<string>): string {
  for (let i = 0; i < 20; i += 1) {
    const raw = randomBytes(4).toString("base64url").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    const code = `${raw.slice(0, 3)}-${raw.slice(3, 6)}`;
    if (!existing.has(code)) return code;
  }
  throw new Error("Unable to allocate browser share code");
}

function commandNeedsApproval(type: BrowserShareCommandType, permissionMode: BrowserSharePermissionMode): boolean {
  if (permissionMode !== "interactive") return true;
  return type === "navigate" || type === "type";
}

export class BrowserShareManager {
  private shares = new Map<string, ShareRecord>();
  private shareCodes = new Map<string, string>();
  private sessionBindings = new Map<string, string>();
  private commands = new Map<string, BrowserShareCommand>();

  createShare(request: BrowserShareCreateRequest): BrowserShareCreateResponse {
    this.cleanupExpired();
    const tab = sanitizeTab(request.tab);
    const shareId = randomUUID();
    const shareCode = generateShareCode(new Set(this.shareCodes.keys()));
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + SHARE_TTL_MS).toISOString();
    const snapshot = request.pagePreview ? sanitizeSnapshot(request.pagePreview, tab) : undefined;
    this.shares.set(shareId, {
      shareId,
      shareCode,
      extensionInstanceId: request.extensionInstanceId,
      permissionMode: request.permissionMode === "interactive" ? "interactive" : "readonly",
      tab: snapshot?.tab ?? tab,
      snapshot,
      createdAt,
      expiresAt,
      status: "pending",
      lastSnapshotAt: snapshot?.capturedAt,
    });
    this.shareCodes.set(shareCode, shareId);
    return { shareId, shareCode, expiresAt };
  }

  bindSession(sessionId: string, shareCode: string): BrowserShareSessionState {
    this.cleanupExpired();
    const normalizedCode = shareCode.trim().toUpperCase();
    const shareId = this.shareCodes.get(normalizedCode);
    if (!shareId) throw new Error("Invalid or expired browser share code");
    const share = this.shares.get(shareId);
    if (!share) throw new Error("Browser share not found");
    if (share.sessionId) throw new Error("Browser share code has already been used");
    this.shareCodes.delete(normalizedCode);
    const previousShareId = this.sessionBindings.get(sessionId);
    if (previousShareId) this.shares.delete(previousShareId);
    share.sessionId = sessionId;
    share.boundAt = nowIso();
    share.status = "bound";
    this.sessionBindings.set(sessionId, shareId);
    return this.getSessionState(sessionId);
  }

  unbindSession(sessionId: string): BrowserShareSessionState {
    const shareId = this.sessionBindings.get(sessionId);
    if (shareId) {
      this.sessionBindings.delete(sessionId);
      this.shares.delete(shareId);
      for (const [commandId, command] of this.commands.entries()) {
        if (command.shareId === shareId) this.commands.delete(commandId);
      }
    }
    return this.getSessionState(sessionId);
  }

  getSessionState(sessionId: string): BrowserShareSessionState {
    this.cleanupExpired();
    const shareId = this.sessionBindings.get(sessionId);
    const share = shareId ? this.shares.get(shareId) : undefined;
    if (!share) return { sessionId, bound: false, status: "disconnected", pendingCommands: [] };
    return {
      sessionId,
      bound: true,
      shareId: share.shareId,
      status: share.status,
      permissionMode: share.permissionMode,
      tab: share.snapshot?.tab ?? share.tab,
      snapshot: share.snapshot,
      createdAt: share.createdAt,
      boundAt: share.boundAt,
      expiresAt: share.expiresAt,
      lastSnapshotAt: share.lastSnapshotAt,
      pendingCommands: this.listPendingCommandsForSession(sessionId),
    };
  }

  updateSnapshot(shareId: string, snapshot: BrowserSharePageSnapshot | Partial<BrowserSharePageSnapshot>): BrowserShareSessionState | { shareId: string; bound: false } {
    this.cleanupExpired();
    const share = this.shares.get(shareId);
    if (!share) throw new Error("Browser share not found");
    const sanitized = sanitizeSnapshot(snapshot, share.tab);
    share.snapshot = sanitized;
    share.tab = sanitized.tab;
    share.lastSnapshotAt = sanitized.capturedAt;
    share.status = share.sessionId ? "bound" : "pending";
    return share.sessionId ? this.getSessionState(share.sessionId) : { shareId, bound: false };
  }

  enqueueCommand(sessionId: string, type: BrowserShareCommandType, payload: Partial<BrowserShareCommand>): BrowserShareCommand {
    this.cleanupExpired();
    const shareId = this.sessionBindings.get(sessionId);
    const share = shareId ? this.shares.get(shareId) : undefined;
    if (!share) throw new Error("No browser share is bound to this session");
    const status: BrowserShareCommandStatus = commandNeedsApproval(type, share.permissionMode) ? "pending_approval" : "queued";
    const command: BrowserShareCommand = {
      commandId: randomUUID(),
      sessionId,
      shareId: share.shareId,
      type,
      status,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      elementId: payload.elementId,
      text: clampText(payload.text, 2_000),
      url: clampText(payload.url, 2_000),
      deltaX: typeof payload.deltaX === "number" ? payload.deltaX : undefined,
      deltaY: typeof payload.deltaY === "number" ? payload.deltaY : undefined,
      reason: clampText(payload.reason, 500),
    };
    this.commands.set(command.commandId, command);
    return command;
  }

  approveCommand(sessionId: string, commandId: string, approved: boolean): BrowserShareCommand {
    const command = this.getSessionCommand(sessionId, commandId);
    command.status = approved ? "queued" : "rejected";
    command.updatedAt = nowIso();
    return command;
  }

  listCommandsForShare(shareId: string, includePendingApproval = false): BrowserShareCommand[] {
    this.cleanupExpired();
    const commands = [...this.commands.values()]
      .filter((command) => command.shareId === shareId && (command.status === "queued" || (includePendingApproval && command.status === "pending_approval")))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const command of commands) {
      if (command.status === "queued") {
        command.status = "running";
        command.updatedAt = nowIso();
      }
    }
    return commands;
  }

  markCommandRunning(commandId: string): BrowserShareCommand {
    const command = this.commands.get(commandId);
    if (!command) throw new Error("Browser share command not found");
    command.status = "running";
    command.updatedAt = nowIso();
    return command;
  }

  recordCommandResult(commandId: string, result: BrowserShareCommandResult): BrowserShareCommand {
    const command = this.commands.get(commandId);
    if (!command) throw new Error("Browser share command not found");
    command.result = result;
    command.status = result.ok ? "succeeded" : "failed";
    command.updatedAt = nowIso();
    if (result.snapshot) this.updateSnapshot(command.shareId, result.snapshot);
    return command;
  }

  private getSessionCommand(sessionId: string, commandId: string): BrowserShareCommand {
    const command = this.commands.get(commandId);
    if (!command || command.sessionId !== sessionId) throw new Error("Browser share command not found for this session");
    return command;
  }

  private listPendingCommandsForSession(sessionId: string): BrowserShareCommand[] {
    return [...this.commands.values()]
      .filter((command) => command.sessionId === sessionId && (command.status === "pending_approval" || command.status === "queued" || command.status === "running"))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [shareId, share] of this.shares.entries()) {
      if (!share.sessionId && Date.parse(share.expiresAt) <= now) {
        this.shareCodes.delete(share.shareCode);
        this.shares.delete(shareId);
      }
    }
  }
}

export function getBrowserShareManager(): BrowserShareManager {
  globalThis.__browserShareManager ??= new BrowserShareManager();
  return globalThis.__browserShareManager;
}
