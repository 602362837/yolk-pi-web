"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SessionChangedFileSummary, SessionChangesSummaryResponse } from "@/lib/types";
import { FileDiffModal } from "./FileDiffModal";

interface Props {
  sessionId: string;
  agentRunning: boolean;
}

function statusBadge(file: SessionChangedFileSummary): { label: string; color: string } {
  switch (file.status) {
    case "added": return { label: "A", color: "#16a34a" };
    case "deleted": return { label: "D", color: "#dc2626" };
    case "metadata-only": return { label: "?", color: "var(--text-muted)" };
    case "modified":
    default:
      return { label: "M", color: "var(--accent)" };
  }
}

function fileCountLabel(count: number): string {
  return count === 1 ? "1 file changed" : `${count} files changed`;
}

export function SessionChangesFloatingPanel({ sessionId, agentRunning }: Props) {
  const [files, setFiles] = useState<SessionChangedFileSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<SessionChangedFileSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadChanges = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/changes`);
      const body = await res.json() as SessionChangesSummaryResponse | { error?: string };
      if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      setFiles((body as SessionChangesSummaryResponse).files ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void loadChanges();
  }, [loadChanges, agentRunning]);

  useEffect(() => {
    if (!agentRunning) return;
    const interval = setInterval(() => void loadChanges(), 2000);
    return () => clearInterval(interval);
  }, [agentRunning, loadChanges]);

  useEffect(() => {
    setOpen(false);
    setSelectedFile(null);
  }, [sessionId]);

  const totals = useMemo(() => files.reduce((acc, file) => ({
    additions: acc.additions + file.additions,
    deletions: acc.deletions + file.deletions,
  }), { additions: 0, deletions: 0 }), [files]);

  if (files.length === 0 && !open) return null;

  return (
    <>
      <div
        style={{
          position: "absolute",
          right: 18,
          bottom: 92,
          zIndex: 130,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 8,
          pointerEvents: "auto",
        }}
      >
        {open && (
          <div
            style={{
              width: "min(420px, calc(100vw - 48px))",
              maxHeight: 360,
              overflow: "hidden",
              border: "1px solid var(--border)",
              borderRadius: 14,
              background: "color-mix(in srgb, var(--bg-panel) 96%, transparent)",
              color: "var(--text)",
              boxShadow: "0 18px 42px rgba(0,0,0,0.20)",
              backdropFilter: "blur(12px)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800 }}>Changed files</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                  Session edit/write changes · <span style={{ color: "#16a34a" }}>+{totals.additions}</span> <span style={{ color: "#dc2626" }}>-{totals.deletions}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close changed files panel"
                style={{ border: 0, background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 18, lineHeight: 1 }}
              >
                ×
              </button>
            </div>

            <div style={{ maxHeight: 288, overflowY: "auto", padding: 6 }}>
              {error ? (
                <div style={{ padding: 10, color: "#dc2626", fontSize: 12 }}>{error}</div>
              ) : files.length === 0 ? (
                <div style={{ padding: 10, color: "var(--text-muted)", fontSize: 12 }}>No tracked edit/write changes yet.</div>
              ) : files.map((file) => {
                const badge = statusBadge(file);
                return (
                  <button
                    key={file.path}
                    type="button"
                    onClick={() => setSelectedFile(file)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 9,
                      padding: "8px 9px",
                      border: 0,
                      borderRadius: 10,
                      background: "transparent",
                      color: "var(--text)",
                      cursor: file.diffAvailable ? "pointer" : "default",
                      textAlign: "left",
                    }}
                    onMouseEnter={(event) => { event.currentTarget.style.background = "var(--bg-hover)"; }}
                    onMouseLeave={(event) => { event.currentTarget.style.background = "transparent"; }}
                  >
                    <span style={{ width: 20, height: 20, borderRadius: 6, display: "inline-flex", alignItems: "center", justifyContent: "center", color: badge.color, background: "var(--bg-subtle)", fontSize: 11, fontWeight: 900, flexShrink: 0 }}>
                      {badge.label}
                    </span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.path}</span>
                      {!file.diffAvailable && <span style={{ display: "block", marginTop: 2, fontSize: 10, color: "var(--text-dim)" }}>{file.reason ?? "metadata only"}</span>}
                    </span>
                    <span style={{ flexShrink: 0, fontFamily: "var(--font-mono)", fontSize: 11 }}>
                      <span style={{ color: "#16a34a" }}>+{file.additions}</span>{" "}
                      <span style={{ color: "#dc2626" }}>-{file.deletions}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            border: "1px solid var(--border)",
            borderRadius: 999,
            padding: "8px 12px",
            background: "color-mix(in srgb, var(--bg-panel) 92%, transparent)",
            color: "var(--text)",
            boxShadow: "0 10px 28px rgba(0,0,0,0.16)",
            backdropFilter: "blur(10px)",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 800,
          }}
          aria-expanded={open}
        >
          <span>▦</span>
          <span>{loading && agentRunning ? "Changes updating…" : fileCountLabel(files.length)}</span>
        </button>
      </div>

      {selectedFile && (
        <FileDiffModal
          sessionId={sessionId}
          file={selectedFile}
          onClose={() => setSelectedFile(null)}
        />
      )}
    </>
  );
}
