"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BrowserShareCommand, BrowserShareSessionState } from "@/lib/browser-share-types";

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
  const label = bound ? `Chrome: ${state?.tab?.title ?? "已共享"}` : "绑定浏览器分享";
  const canCreateSession = !!cwd && !!ensureSession;
  const canUse = (!!sessionId || canCreateSession) && !disabled;
  const connectionLabel = state?.connection?.status === "active"
    ? "在线"
    : state?.connection?.status === "stale"
      ? "连接变慢"
      : state?.connection?.status === "offline"
        ? "离线"
        : state?.status === "bound"
          ? "已连接"
          : state?.status === "pending"
            ? "等待插件"
            : state?.status === "expired"
              ? "已过期"
              : "未连接";

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        disabled={!canUse}
        onClick={() => setOpen((value) => !value)}
        title={sessionId ? "将 Chrome 插件分享码绑定到当前 chat/session" : "绑定会先创建 chat/session，使首条消息也能使用共享页面"}
        style={{
          display: "flex", alignItems: "center", gap: 5,
          maxWidth: 190,
          padding: "8px 10px",
          height: 32,
          background: bound ? "rgba(34,197,94,0.10)" : "none",
          border: bound ? "1px solid rgba(34,197,94,0.28)" : "none",
          borderRadius: 9,
          color: bound ? "#16a34a" : "var(--text-muted)",
          cursor: canUse ? "pointer" : "not-allowed",
          fontSize: 12,
          opacity: canUse ? 1 : 0.5,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <rect x="3" y="4" width="18" height="14" rx="2" />
          <path d="M8 20h8" />
          <path d="M12 18v2" />
        </svg>
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
                <span>权限：{state?.permissionMode === "interactive" ? "可操作" : "只读"}</span>
                <span>连接：{connectionLabel}</span>
                <span>采集：{state?.captureMode === "debugger" ? "Debugger/CDP" : state?.captureMode === "debugger_fallback" ? "CDP fallback" : state?.captureMode ?? "DOM"}</span>
                <span>截图：{state?.screenshot?.available || state?.screenshot?.data ? "可用" : state?.screenshot?.byteLength ? "已截取" : state?.screenshot?.error ? "失败" : "—"}</span>
                <span>快照：{formatTime(state?.connection?.lastSnapshotAt ?? state?.lastSnapshotAt ?? state?.snapshot?.capturedAt)}</span>
                <span>轮询：{formatTime(state?.connection?.lastCommandPollAt ?? state?.connection?.lastHeartbeatAt ?? state?.lastCommandPollAt ?? state?.lastSeenAt)}</span>
              </div>
              {(state?.source?.baseUrl || state?.debugger) && (
                <div style={{ marginTop: 6, color: "var(--text-dim)", lineHeight: 1.4 }}>
                  {state.source?.baseUrl && <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>服务：{state.source.baseUrl}</div>}
                  {state.debugger && <div>Debugger：{state.debugger.attached ? "已连接" : state.debugger.enabled ? "已启用" : "未启用"}{state.debugger.lastError ? `（${state.debugger.lastError.slice(0, 90)}）` : ""}</div>}
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
