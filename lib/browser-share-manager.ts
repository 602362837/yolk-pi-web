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
const COMPLETED_COMMAND_TTL_MS = 10 * 60 * 1000;
const COMPLETED_COMMAND_LIMIT = 100;

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
  lastSeenAt?: string;
  lastCommandPollAt?: string;
  lastResultAt?: string;
  status: BrowserShareConnectionStatus;
};

type CommandWaiter = {
  resolve: (command: BrowserShareCommand) => void;
  reject: (error: Error) => void;
  onChange?: (command: BrowserShareCommand) => void;
  cleanup: () => void;
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

function isTerminalStatus(status: BrowserShareCommandStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "rejected" || status === "timeout";
}

export class BrowserShareManager {
  private shares = new Map<string, ShareRecord>();
  private shareCodes = new Map<string, string>();
  private sessionBindings = new Map<string, string>();
  private commands = new Map<string, BrowserShareCommand>();
  private commandWaiters = new Map<string, Set<CommandWaiter>>();

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
      lastSeenAt: createdAt,
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
    if (previousShareId) this.removeShare(previousShareId, "Browser share was replaced");
    const boundAt = nowIso();
    share.sessionId = sessionId;
    share.boundAt = boundAt;
    share.status = "bound";
    share.lastSeenAt = boundAt;
    this.sessionBindings.set(sessionId, shareId);
    return this.getSessionState(sessionId);
  }

  unbindSession(sessionId: string): BrowserShareSessionState {
    const shareId = this.sessionBindings.get(sessionId);
    if (shareId) this.removeShare(shareId, "Browser share was unbound");
    return this.getSessionState(sessionId);
  }

  getSessionState(sessionId: string): BrowserShareSessionState {
    this.cleanupExpired();
    const shareId = this.sessionBindings.get(sessionId);
    const share = shareId ? this.shares.get(shareId) : undefined;
    if (!share) return { sessionId, bound: false, status: "disconnected", pendingCommands: [], activeCommands: [], recentCommands: [] };
    const activeCommands = this.listActiveCommandsForSession(sessionId);
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
      lastSeenAt: share.lastSeenAt,
      lastCommandPollAt: share.lastCommandPollAt,
      lastResultAt: share.lastResultAt,
      pendingCommands: activeCommands,
      activeCommands,
      recentCommands: this.listRecentCommandsForSession(sessionId),
    };
  }

  updateSnapshot(shareId: string, snapshot: BrowserSharePageSnapshot | Partial<BrowserSharePageSnapshot>): BrowserShareSessionState | { shareId: string; bound: false } {
    this.cleanupExpired();
    const share = this.shares.get(shareId);
    if (!share) throw new Error("Browser share not found");
    const sanitized = sanitizeSnapshot(snapshot, share.tab);
    const updatedAt = nowIso();
    share.snapshot = sanitized;
    share.tab = sanitized.tab;
    share.lastSnapshotAt = sanitized.capturedAt;
    share.lastSeenAt = updatedAt;
    share.status = share.sessionId ? "bound" : "pending";
    return share.sessionId ? this.getSessionState(share.sessionId) : { shareId, bound: false };
  }

  enqueueCommand(sessionId: string, type: BrowserShareCommandType, payload: Partial<BrowserShareCommand>): BrowserShareCommand {
    this.cleanupExpired();
    const shareId = this.sessionBindings.get(sessionId);
    const share = shareId ? this.shares.get(shareId) : undefined;
    if (!share) throw new Error("No browser share is bound to this session");
    const status: BrowserShareCommandStatus = commandNeedsApproval(type, share.permissionMode) ? "pending_approval" : "queued";
    const createdAt = nowIso();
    const command: BrowserShareCommand = {
      commandId: randomUUID(),
      sessionId,
      shareId: share.shareId,
      type,
      status,
      createdAt,
      updatedAt: createdAt,
      elementId: payload.elementId,
      text: clampText(payload.text, 2_000),
      url: clampText(payload.url, 2_000),
      deltaX: typeof payload.deltaX === "number" ? payload.deltaX : undefined,
      deltaY: typeof payload.deltaY === "number" ? payload.deltaY : undefined,
      reason: clampText(payload.reason, 500),
    };
    this.commands.set(command.commandId, command);
    this.notifyCommandChanged(command.commandId);
    this.trimCompletedCommands();
    return command;
  }

  approveCommand(sessionId: string, commandId: string, approved: boolean): BrowserShareCommand {
    const command = this.getSessionCommand(sessionId, commandId);
    if (isTerminalStatus(command.status)) return command;
    if (approved) {
      if (command.status === "pending_approval") {
        command.status = "queued";
        command.updatedAt = nowIso();
      }
    } else {
      this.setCommandTerminal(command, "rejected", { ok: false, message: "Browser share command was rejected by the user" });
    }
    this.notifyCommandChanged(command.commandId);
    return command;
  }

  listCommandsForShare(shareId: string, includePendingApproval = false): BrowserShareCommand[] {
    this.cleanupExpired();
    this.touchCommandPoll(shareId);
    const commands = [...this.commands.values()]
      .filter((command) => command.shareId === shareId && (command.status === "queued" || (includePendingApproval && command.status === "pending_approval")))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const command of commands) {
      if (command.status === "queued") this.markCommandRunning(command.commandId);
    }
    return commands;
  }

  markCommandRunning(commandId: string): BrowserShareCommand {
    const command = this.commands.get(commandId);
    if (!command) throw new Error("Browser share command not found");
    if (!isTerminalStatus(command.status) && command.status !== "running") {
      command.status = "running";
      command.updatedAt = nowIso();
      this.notifyCommandChanged(command.commandId);
    }
    return command;
  }

  recordCommandResult(commandId: string, result: BrowserShareCommandResult): BrowserShareCommand {
    const command = this.commands.get(commandId);
    if (!command) throw new Error("Browser share command not found");
    if (isTerminalStatus(command.status)) return command;
    command.result = result;
    this.setCommandTerminal(command, result.ok ? "succeeded" : "failed", result);
    const share = this.shares.get(command.shareId);
    if (share) {
      const resultAt = command.updatedAt;
      share.lastResultAt = resultAt;
      share.lastSeenAt = resultAt;
    }
    if (result.snapshot) this.updateSnapshot(command.shareId, result.snapshot);
    this.notifyCommandChanged(command.commandId);
    this.trimCompletedCommands();
    return command;
  }

  waitForCommand(commandId: string, options: { timeoutMs: number; signal?: AbortSignal; onChange?: (command: BrowserShareCommand) => void }): Promise<BrowserShareCommand> {
    this.cleanupExpired();
    const command = this.commands.get(commandId);
    if (!command) return Promise.reject(new Error("Browser share command not found"));
    if (isTerminalStatus(command.status)) return Promise.resolve(command);

    return new Promise<BrowserShareCommand>((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(new Error("Browser share command wait aborted"));
        return;
      }

      const waiters = this.commandWaiters.get(commandId) ?? new Set<CommandWaiter>();
      this.commandWaiters.set(commandId, waiters);

      const waiter: CommandWaiter = {
        resolve: (terminalCommand) => {
          waiter.cleanup();
          resolve(terminalCommand);
        },
        reject: (error) => {
          waiter.cleanup();
          reject(error);
        },
        onChange: options.onChange,
        cleanup: () => {
          if (timeout) clearTimeout(timeout);
          options.signal?.removeEventListener("abort", abort);
          waiters.delete(waiter);
          if (waiters.size === 0) this.commandWaiters.delete(commandId);
        },
      };

      const abort = () => {
        waiter.cleanup();
        reject(new Error("Browser share command wait aborted"));
      };

      waiters.add(waiter);
      options.signal?.addEventListener("abort", abort, { once: true });
      const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
        const latest = this.commands.get(commandId);
        if (!latest) {
          waiter.reject(new Error("Browser share command not found"));
          return;
        }
        if (!isTerminalStatus(latest.status)) {
          this.setCommandTerminal(latest, "timeout", { ok: false, message: "Browser share command timed out" });
        }
        this.notifyCommandChanged(commandId);
      }, Math.max(0, options.timeoutMs));
    });
  }

  notifyCommandChanged(commandId: string): void {
    const command = this.commands.get(commandId);
    if (!command) return;
    const waiters = this.commandWaiters.get(commandId);
    if (!waiters) return;
    for (const waiter of [...waiters]) {
      waiter.onChange?.(command);
      if (isTerminalStatus(command.status)) waiter.resolve(command);
    }
  }

  private getSessionCommand(sessionId: string, commandId: string): BrowserShareCommand {
    const command = this.commands.get(commandId);
    if (!command || command.sessionId !== sessionId) throw new Error("Browser share command not found for this session");
    return command;
  }

  private listActiveCommandsForSession(sessionId: string): BrowserShareCommand[] {
    return [...this.commands.values()]
      .filter((command) => command.sessionId === sessionId && !isTerminalStatus(command.status))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  private listRecentCommandsForSession(sessionId: string): BrowserShareCommand[] {
    this.trimCompletedCommands();
    return [...this.commands.values()]
      .filter((command) => command.sessionId === sessionId && isTerminalStatus(command.status))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 10);
  }

  private removeShare(shareId: string, message: string): void {
    const share = this.shares.get(shareId);
    if (share?.sessionId) this.sessionBindings.delete(share.sessionId);
    if (share) this.shareCodes.delete(share.shareCode);
    this.failActiveCommandsForShare(shareId, message);
    this.shares.delete(shareId);
    this.trimCompletedCommands();
  }

  private failActiveCommandsForShare(shareId: string, message: string): void {
    for (const command of this.commands.values()) {
      if (command.shareId !== shareId || isTerminalStatus(command.status)) continue;
      this.setCommandTerminal(command, "failed", { ok: false, message });
      this.notifyCommandChanged(command.commandId);
    }
  }

  private setCommandTerminal(command: BrowserShareCommand, status: "succeeded" | "failed" | "rejected" | "timeout", result?: BrowserShareCommandResult): void {
    if (isTerminalStatus(command.status)) return;
    const updatedAt = nowIso();
    command.status = status;
    command.updatedAt = updatedAt;
    command.terminalAt = updatedAt;
    if (result) command.result = result;
  }

  private touchCommandPoll(shareId: string): void {
    const share = this.shares.get(shareId);
    if (!share) return;
    const touchedAt = nowIso();
    share.lastCommandPollAt = touchedAt;
    share.lastSeenAt = touchedAt;
  }

  private trimCompletedCommands(): void {
    const now = Date.now();
    for (const [commandId, command] of this.commands.entries()) {
      if (!isTerminalStatus(command.status)) continue;
      if (Date.parse(command.terminalAt ?? command.updatedAt) + COMPLETED_COMMAND_TTL_MS <= now) {
        this.commands.delete(commandId);
      }
    }

    const completed = [...this.commands.values()]
      .filter((command) => isTerminalStatus(command.status))
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    const overflow = completed.length - COMPLETED_COMMAND_LIMIT;
    for (let i = 0; i < overflow; i += 1) {
      this.commands.delete(completed[i].commandId);
    }
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [shareId, share] of this.shares.entries()) {
      if (!share.sessionId && Date.parse(share.expiresAt) <= now) {
        this.shareCodes.delete(share.shareCode);
        this.shares.delete(shareId);
      }
    }
    this.trimCompletedCommands();
  }
}

export function getBrowserShareManager(): BrowserShareManager {
  globalThis.__browserShareManager ??= new BrowserShareManager();
  return globalThis.__browserShareManager;
}
