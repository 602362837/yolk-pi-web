"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BrowserShareCommand, BrowserShareCommandType, BrowserShareDebuggerSummary, BrowserShareLifecycleStatus, BrowserShareOperatorInfo, BrowserShareSessionState } from "@/lib/browser-share-types";
import { ActionFlowIcon } from "./ActionFlowIcon";
import { iconFlowAttrs } from "./iconFlow";

interface Props {
  cwd?: string | null;
  sessionId?: string | null;
  ensureSession?: () => Promise<string | null>;
  disabled?: boolean;
}

type BrowserShareUiCommand = Omit<BrowserShareCommand, "status"> & { status: BrowserShareCommand["status"] | "timeout" | string };
type BrowserShareUiState = Omit<BrowserShareSessionState, "pendingCommands"> & {
  pendingCommands?: BrowserShareUiCommand[];
  activeCommands?: BrowserShareUiCommand[];
  recentCommands?: BrowserShareUiCommand[];
  lastCommandPollAt?: string;
  lastSeenAt?: string;
  lastResultAt?: string;
  connection?: {
    status?: "active" | "stale" | "offline" | "disconnected";
    lastHeartbeatAt?: string;
    lastSeenAt?: string;
    lastCommandPollAt?: string;
    lastSnapshotAt?: string;
    lastResultAt?: string;
    heartbeatAgeMs?: number;
  };
};

const ACTIVE_COMMAND_STATUSES = new Set(["pending_approval", "queued", "running"]);
const TERMINAL_COMMAND_STATUSES = new Set(["succeeded", "failed", "rejected", "timeout"]);
const SHARE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{3,31}$/;

function formatTime(value?: string): string {
  if (!value) return "—";
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return value;
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(time));
}

function commandSummary(command: BrowserShareUiCommand): string {
  return command.reason || command.elementId || command.url || command.result?.message || "agent 请求操作共享页面";
}

function shortSessionId(value?: string): string {
  if (!value) return "—";
  return value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

function lifecycleLabel(value?: BrowserShareLifecycleStatus): string {
  if (value === "pending_code") return "待绑定";
  if (value === "bound") return "已绑定";
  if (value === "stale") return "连接变慢";
  if (value === "offline") return "服务离线";
  if (value === "stopped") return "已停止";
  if (value === "unbound") return "已解绑";
  if (value === "replaced") return "已替换";
  if (value === "expired") return "已过期";
  if (value === "tab_closed") return "Tab 已关闭";
  if (value === "not_found") return "未找到";
  return "未连接";
}

function debuggerLabel(debuggerState?: BrowserShareDebuggerSummary): string {
  if (!debuggerState) return "旧版/未知";
  const state = debuggerState.state;
  if (debuggerState.attached || state === "attached") return debuggerState.persistent ? "常驻已连接" : "已连接";
  if (state === "attaching") return "连接中";
  if (state === "blocked") return "被其他调试器占用";
  if (state === "failed") return "连接失败";
  if (state === "detached") return "已断开";
  if (state === "unsupported") return "不支持";
  return debuggerState.enabled ? "已启用但未确认连接" : "未启用";
}

function debuggerUnavailable(debuggerState?: BrowserShareDebuggerSummary): boolean {
  if (!debuggerState) return false;
  if (debuggerState.state === "blocked" || debuggerState.state === "failed" || debuggerState.state === "detached" || debuggerState.state === "unsupported") return true;
  return debuggerState.desired === true && debuggerState.attached === false;
}

function permissionLabel(operator?: BrowserShareOperatorInfo, fallback?: BrowserShareSessionState["permissionMode"]): string {
  const mode = operator?.permissionMode ?? fallback;
  if (mode === "interactive") return "interactive（click/scroll 可自动执行；type/navigate 仍需允许一次）";
  return "readonly（所有操作都需要你允许一次）";
}

function commandListLabel(commands?: BrowserShareCommandType[]): string {
  return commands?.length ? commands.join(" / ") : "无";
}

export function BrowserShareControl({ cwd, sessionId, ensureSession, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [shareCode, setShareCode] = useState("");
  const [state, setState] = useState<BrowserShareUiState | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const activeSessionId = sessionId ?? state?.sessionId ?? null;
  const commands = useMemo(() => {
    const combined = [...(state?.activeCommands ?? []), ...(state?.pendingCommands ?? [])];
    const byId = new Map<string, BrowserShareUiCommand>();
    for (const command of combined) byId.set(command.commandId, command);
    return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [state?.activeCommands, state?.pendingCommands]);
  const pendingApprovalCommands = commands.filter((command) => command.status === "pending_approval");
  const activeCommands = commands.filter((command) => ACTIVE_COMMAND_STATUSES.has(command.status));
  const queuedOrRunningCommands = activeCommands.filter((command) => command.status === "queued" || command.status === "running");
  const recentCommands = (state?.recentCommands ?? []).filter((command) => TERMINAL_COMMAND_STATUSES.has(command.status)).slice(0, 4);

  const refresh = useCallback(async () => {
    if (!activeSessionId) return;
    try {
      const res = await fetch(`/api/browser-share/sessions/${encodeURIComponent(activeSessionId)}/state`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setState(await res.json() as BrowserShareUiState);
    } catch (error) {
      setMessage(String(error));
    }
  }, [activeSessionId]);

  useEffect(() => {
    void refresh();
    if (!activeSessionId) return;
    const intervalMs = activeCommands.length > 0 ? 1500 : state?.bound ? 7000 : 12000;
    const id = window.setInterval(() => void refresh(), intervalMs);
    return () => window.clearInterval(id);
  }, [activeCommands.length, activeSessionId, refresh, state?.bound]);

  const bindShare = async () => {
    const normalizedCode = shareCode.trim().toUpperCase();
    if (!normalizedCode) {
      setMessage("请输入 Chrome 插件生成的分享码");
      return;
    }
    if (!SHARE_CODE_PATTERN.test(normalizedCode)) {
      setMessage("分享码格式不正确，请检查后再绑定");
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const targetSessionId = sessionId ?? await ensureSession?.();
      if (!targetSessionId) throw new Error("无法创建用于绑定 Browser Share 的会话");
      const res = await fetch(`/api/browser-share/sessions/${encodeURIComponent(targetSessionId)}/bind`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shareCode: normalizedCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setState(data as BrowserShareUiState);
      setShareCode("");
    } catch (error) {
      setMessage(String(error));
    } finally {
      setLoading(false);
    }
  };

  const unbindShare = async () => {
    if (!activeSessionId) return;
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/browser-share/sessions/${encodeURIComponent(activeSessionId)}/bind`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setState(data as BrowserShareUiState);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setLoading(false);
    }
  };

  const approveCommand = async (commandId: string, approved: boolean) => {
    if (!activeSessionId) return;
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/browser-share/sessions/${encodeURIComponent(activeSessionId)}/commands/${encodeURIComponent(commandId)}/approval`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      await refresh();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setLoading(false);
    }
  };

  const bound = state?.bound === true;
  const lifecycleStatus = state?.lifecycleStatus;
  const operator = state?.operator;
  const isDebuggerUnavailable = debuggerUnavailable(state?.debugger);
  const isOffline = lifecycleStatus === "offline" || state?.connection?.status === "offline";
  const isStale = lifecycleStatus === "stale" || state?.connection?.status === "stale";
  const isAttached = state?.debugger?.attached === true || state?.debugger?.state === "attached";
  const label = bound
    ? isDebuggerUnavailable
      ? "Chrome 共享异常"
      : isOffline
        ? "Chrome 共享离线"
        : isAttached
          ? `Chrome 已共享: ${state?.tab?.title ?? "当前 tab"}`
          : `Chrome: ${state?.tab?.title ?? "已共享"}`
    : state?.status === "pending"
      ? "Browser Share：等待插件"
      : "绑定浏览器分享";
  const canCreateSession = !!cwd && !!ensureSession;
  const canUse = (!!sessionId || canCreateSession) && !disabled;
  const connectionLabel = isOffline
    ? "离线"
    : isStale
      ? "连接变慢"
      : state?.connection?.status === "active"
        ? "在线"
        : state?.status === "bound"
          ? "已连接"
          : state?.status === "pending"
            ? "等待插件"
            : state?.status === "expired"
              ? "已过期"
              : "未连接";
  const pillStyle = isDebuggerUnavailable
    ? { background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.34)", color: "#ef4444" }
    : isOffline || isStale
      ? { background: "rgba(234,179,8,0.10)", border: "1px solid rgba(234,179,8,0.34)", color: "#ca8a04" }
      : bound && isAttached
        ? { background: "rgba(34,197,94,0.10)", border: "1px solid rgba(34,197,94,0.28)", color: "#16a34a" }
        : bound
          ? { background: "rgba(59,130,246,0.10)", border: "1px solid rgba(59,130,246,0.28)", color: "#2563eb" }
          : { background: "none", border: "none", color: "var(--text-muted)" };

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        disabled={!canUse}
        onClick={() => setOpen((value) => !value)}
        title={sessionId ? "将 Chrome 插件分享码绑定到当前 chat/session" : "绑定会先创建 chat/session，使首条消息也能使用共享页面"}
        {...iconFlowAttrs(!canUse || loading ? "off" : "interactive")}
        style={{
          display: "flex", alignItems: "center", gap: 5,
          maxWidth: 190,
          padding: "8px 10px",
          height: 32,
          background: pillStyle.background,
          border: pillStyle.border,
          borderRadius: 9,
          color: pillStyle.color,
          cursor: canUse ? "pointer" : "not-allowed",
          fontSize: 12,
          opacity: canUse ? 1 : 0.5,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        <ActionFlowIcon width={12} height={12} strokeWidth={2}>
          <rect x="3" y="4" width="18" height="14" rx="2" />
          <path d="M8 20h8" />
          <path d="M12 18v2" />
        </ActionFlowIcon>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      </button>

      {open && (
        <div style={{
          position: "absolute",
          bottom: "calc(100% + 8px)",
          left: 0,
          zIndex: 220,
          width: 340,
          maxWidth: "calc(100vw - 28px)",
          padding: 12,
          borderRadius: 12,
          border: "1px solid var(--border)",
          background: "var(--bg-panel)",
          boxShadow: "0 -6px 24px rgba(0,0,0,0.16)",
          color: "var(--text)",
          fontSize: 12,
        }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Browser Share</div>
          <div style={{ color: "var(--text-muted)", lineHeight: 1.45, marginBottom: 10 }}>
            插件生成分享码后，在这里输入即可绑定到当前 chat/session，避免分享到其他会话。新 Chat 绑定会先创建会话，使首条消息也能使用共享页面。
          </div>

          {bound && (
            <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 8, marginBottom: 10 }}>
              <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{state?.tab?.title ?? "Shared Chrome tab"}</div>
              <div style={{ color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{state?.tab?.url}</div>
              {state?.tab?.origin && <div style={{ color: "var(--text-dim)", marginTop: 3 }}>Origin：{state.tab.origin}</div>}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8, color: "var(--text-muted)" }}>
                <span>生命周期：{lifecycleLabel(lifecycleStatus)}</span>
                <span>连接：{connectionLabel}</span>
                <span>权限：{operator?.permissionMode === "interactive" || state?.permissionMode === "interactive" ? "interactive" : "readonly"}</span>
                <span>Debugger：{debuggerLabel(state?.debugger)}</span>
                <span>采集：{state?.captureMode === "debugger" ? "Debugger/CDP" : state?.captureMode === "debugger_fallback" ? "CDP fallback" : state?.captureMode ?? "DOM"}</span>
                <span>截图：{state?.screenshot?.available || state?.screenshot?.data ? "可用" : state?.screenshot?.byteLength ? "已截取" : state?.screenshot?.error ? "失败" : "—"}</span>
                <span>快照：{formatTime(state?.connection?.lastSnapshotAt ?? state?.lastSnapshotAt ?? state?.snapshot?.capturedAt)}</span>
                <span>心跳：{formatTime(state?.connection?.lastHeartbeatAt ?? state?.connection?.lastCommandPollAt ?? state?.lastCommandPollAt ?? state?.lastSeenAt)}</span>
              </div>
              <div style={{ marginTop: 8, padding: 8, borderRadius: 8, background: "var(--bg-subtle)", color: "var(--text-muted)", lineHeight: 1.45 }}>
                <div style={{ fontWeight: 650, color: "var(--text)" }}>可操作对象</div>
                <div>当前 ypi chat/session：{shortSessionId(operator?.boundSessionId ?? state?.sessionId)}</div>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>服务：{operator?.serviceBaseUrl ?? state?.source?.baseUrl ?? "—"}</div>
                <div>权限：{permissionLabel(operator, state?.permissionMode)}</div>
                <div>可自动执行：{commandListLabel(operator?.autoAllowedCommands)}</div>
                <div>需允许一次：{commandListLabel(operator?.approvalRequiredCommands)}</div>
              </div>
              <div style={{ marginTop: 8, color: isDebuggerUnavailable ? "#ef4444" : "var(--text-dim)", lineHeight: 1.4 }}>
                Debugger：{debuggerLabel(state?.debugger)}{state?.debugger?.persistent ? "，Chrome 顶部会持续显示调试提示" : state?.debugger ? "（旧版或非持久模式，请更新插件以获得常驻提示）" : "（旧版插件未上报状态，请更新插件）"}
                {state?.debugger?.lastError ? `；${state.debugger.lastError.slice(0, 120)}` : ""}
                {state?.debugger?.detachReason ? `；${state.debugger.detachReason.slice(0, 120)}` : ""}
              </div>
              {isDebuggerUnavailable && (
                <div style={{ marginTop: 6, padding: 8, border: "1px solid rgba(239,68,68,0.35)", borderRadius: 8, background: "rgba(239,68,68,0.08)", color: "#ef4444", lineHeight: 1.45 }}>
                  Debugger 未连接。为避免不可感知操作，agent action tools 暂不会执行；请在 Chrome 插件中重试或重新分享，并关闭 DevTools/其他 debugger 冲突。
                </div>
              )}
              {state?.snapshot?.visibleText && (
                <div style={{ marginTop: 8, color: "var(--text-dim)", lineHeight: 1.4, maxHeight: 48, overflow: "hidden" }}>
                  {state.snapshot.visibleText.slice(0, 180)}{state.snapshot.visibleText.length > 180 ? "…" : ""}
                </div>
              )}
            </div>
          )}

          {!bound && (
            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              <input
                value={shareCode}
                onChange={(event) => setShareCode(event.target.value.toUpperCase())}
                placeholder="ABC-123"
                style={{
                  flex: 1,
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  background: "var(--bg)",
                  color: "var(--text)",
                  padding: "7px 9px",
                  fontSize: 12,
                  fontFamily: "var(--font-mono)",
                }}
              />
              <button type="button" disabled={loading || !shareCode.trim()} onClick={bindShare} style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--accent)", color: "white", cursor: loading ? "wait" : "pointer" }}>绑定</button>
            </div>
          )}

          {bound && pendingApprovalCommands.length > 0 && (
            <div style={{ marginBottom: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              {pendingApprovalCommands.map((command) => (
                <div key={command.commandId} style={{ border: "1px solid rgba(234,179,8,0.35)", borderRadius: 8, padding: 8, background: "rgba(234,179,8,0.08)" }}>
                  <div style={{ fontWeight: 650 }}>待确认操作：{command.type}</div>
                  <div style={{ color: "var(--text-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis" }}>{commandSummary(command)}</div>
                  <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                    <button type="button" disabled={loading} onClick={() => void approveCommand(command.commandId, true)} style={{ padding: "5px 8px", borderRadius: 7, border: "1px solid rgba(34,197,94,0.35)", background: "rgba(34,197,94,0.12)", color: "#16a34a", cursor: loading ? "wait" : "pointer" }}>允许一次</button>
                    <button type="button" disabled={loading} onClick={() => void approveCommand(command.commandId, false)} style={{ padding: "5px 8px", borderRadius: 7, border: "1px solid rgba(239,68,68,0.35)", background: "rgba(239,68,68,0.08)", color: "#ef4444", cursor: loading ? "wait" : "pointer" }}>拒绝</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {bound && queuedOrRunningCommands.length > 0 && (
            <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 8, marginBottom: 10 }}>
              <div style={{ fontWeight: 650, marginBottom: 4 }}>执行中</div>
              {queuedOrRunningCommands.slice(0, 4).map((command) => (
                <div key={command.commandId} style={{ display: "flex", justifyContent: "space-between", gap: 8, color: "var(--text-muted)", lineHeight: 1.5 }}>
                  <span>{command.type}</span>
                  <span>{command.status}</span>
                </div>
              ))}
            </div>
          )}

          {bound && recentCommands.length > 0 && (
            <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 8, marginBottom: 10 }}>
              <div style={{ fontWeight: 650, marginBottom: 4 }}>最近操作</div>
              {recentCommands.map((command) => (
                <div key={command.commandId} style={{ display: "flex", justifyContent: "space-between", gap: 8, color: "var(--text-muted)", lineHeight: 1.5 }}>
                  <span>{command.type}</span>
                  <span>{command.status}</span>
                </div>
              ))}
            </div>
          )}

          {bound && (
            <button type="button" disabled={loading} onClick={unbindShare} style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid rgba(239,68,68,0.35)", background: "rgba(239,68,68,0.08)", color: "#ef4444", cursor: loading ? "wait" : "pointer" }}>解绑当前浏览器分享</button>
          )}
          {message && <div style={{ marginTop: 8, color: "#ef4444" }}>{message}</div>}
        </div>
      )}
    </div>
  );
}
