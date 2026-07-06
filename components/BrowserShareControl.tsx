"use client";

import { useCallback, useEffect, useState } from "react";
import type { BrowserShareSessionState } from "@/lib/browser-share-types";

interface Props {
  sessionId?: string | null;
  disabled?: boolean;
}

export function BrowserShareControl({ sessionId, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [shareCode, setShareCode] = useState("");
  const [state, setState] = useState<BrowserShareSessionState | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/browser-share/sessions/${encodeURIComponent(sessionId)}/state`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setState(await res.json() as BrowserShareSessionState);
    } catch (error) {
      setMessage(String(error));
    }
  }, [sessionId]);

  useEffect(() => {
    void refresh();
    if (!sessionId) return;
    const id = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(id);
  }, [refresh, sessionId]);

  const bindShare = async () => {
    if (!sessionId || !shareCode.trim()) return;
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/browser-share/sessions/${encodeURIComponent(sessionId)}/bind`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shareCode: shareCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setState(data as BrowserShareSessionState);
      setShareCode("");
      setOpen(false);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setLoading(false);
    }
  };

  const unbindShare = async () => {
    if (!sessionId) return;
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/browser-share/sessions/${encodeURIComponent(sessionId)}/bind`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setState(data as BrowserShareSessionState);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setLoading(false);
    }
  };

  const approveCommand = async (commandId: string, approved: boolean) => {
    if (!sessionId) return;
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/browser-share/sessions/${encodeURIComponent(sessionId)}/commands/${encodeURIComponent(commandId)}/approval`, {
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
  const canUse = !!sessionId && !disabled;

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        disabled={!canUse}
        onClick={() => setOpen((value) => !value)}
        title={sessionId ? "将 Chrome 插件分享码绑定到当前 chat/session" : "新会话需先发送第一条消息后才能绑定浏览器分享"}
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
          width: 300,
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
            插件生成分享码后，在这里输入即可绑定到当前 chat/session，避免分享到其他会话。
          </div>
          {bound && (
            <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 8, marginBottom: 10 }}>
              <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{state?.tab?.title ?? "Shared Chrome tab"}</div>
              <div style={{ color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{state?.tab?.url}</div>
              <div style={{ marginTop: 6, color: "var(--text-muted)" }}>权限：{state?.permissionMode === "interactive" ? "允许操作（仍需确认高风险）" : "只读"}</div>
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
          {bound && (state?.pendingCommands?.filter((command) => command.status === "pending_approval").length ?? 0) > 0 && (
            <div style={{ marginBottom: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              {state?.pendingCommands?.filter((command) => command.status === "pending_approval").map((command) => (
                <div key={command.commandId} style={{ border: "1px solid rgba(234,179,8,0.35)", borderRadius: 8, padding: 8, background: "rgba(234,179,8,0.08)" }}>
                  <div style={{ fontWeight: 650 }}>待确认操作：{command.type}</div>
                  <div style={{ color: "var(--text-muted)", marginTop: 2 }}>{command.reason || command.elementId || command.url || "agent 请求操作共享页面"}</div>
                  <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                    <button type="button" disabled={loading} onClick={() => void approveCommand(command.commandId, true)} style={{ padding: "5px 8px", borderRadius: 7, border: "1px solid rgba(34,197,94,0.35)", background: "rgba(34,197,94,0.12)", color: "#16a34a", cursor: loading ? "wait" : "pointer" }}>允许一次</button>
                    <button type="button" disabled={loading} onClick={() => void approveCommand(command.commandId, false)} style={{ padding: "5px 8px", borderRadius: 7, border: "1px solid rgba(239,68,68,0.35)", background: "rgba(239,68,68,0.08)", color: "#ef4444", cursor: loading ? "wait" : "pointer" }}>拒绝</button>
                  </div>
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
