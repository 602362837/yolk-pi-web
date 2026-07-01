"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
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

interface WidgetPosition {
  left: number;
  top: number;
}

const STORAGE_KEY = "pi-web:session-changes-widget-position";
const DEFAULT_MARGIN = 18;
const DEFAULT_BOTTOM = 92;
const DRAG_THRESHOLD_PX = 4;

function clampPosition(position: WidgetPosition, parent: HTMLElement, widget: HTMLElement): WidgetPosition {
  const maxLeft = Math.max(DEFAULT_MARGIN, parent.clientWidth - widget.offsetWidth - DEFAULT_MARGIN);
  const maxTop = Math.max(DEFAULT_MARGIN, parent.clientHeight - widget.offsetHeight - DEFAULT_MARGIN);
  return {
    left: Math.min(Math.max(DEFAULT_MARGIN, position.left), maxLeft),
    top: Math.min(Math.max(DEFAULT_MARGIN, position.top), maxTop),
  };
}

function readStoredPosition(): WidgetPosition | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<WidgetPosition> | null;
    if (typeof parsed?.left === "number" && typeof parsed.top === "number") return { left: parsed.left, top: parsed.top };
  } catch {
    // Ignore malformed persisted UI state.
  }
  return null;
}

function writeStoredPosition(position: WidgetPosition): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(position));
  } catch {
    // Best-effort UI preference only.
  }
}

export function SessionChangesFloatingPanel({ sessionId, agentRunning }: Props) {
  const [files, setFiles] = useState<SessionChangedFileSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<SessionChangedFileSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState<WidgetPosition | null>(null);
  const [dragging, setDragging] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const positionRef = useRef<WidgetPosition | null>(null);
  const suppressClickRef = useRef(false);
  const dragRef = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
    startX: number;
    startY: number;
    dragged: boolean;
  } | null>(null);

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

  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  useEffect(() => {
    const widget = wrapperRef.current;
    const parent = widget?.parentElement;
    if (!widget || !parent) return;

    const applyDefault = () => {
      const stored = readStoredPosition();
      const next = stored ?? {
        left: Math.max(DEFAULT_MARGIN, parent.clientWidth - widget.offsetWidth - DEFAULT_MARGIN),
        top: Math.max(DEFAULT_MARGIN, parent.clientHeight - widget.offsetHeight - DEFAULT_BOTTOM),
      };
      setPosition(clampPosition(next, parent, widget));
    };

    applyDefault();
    const resizeObserver = new ResizeObserver(() => {
      const latest = positionRef.current;
      if (!latest) applyDefault();
      else setPosition(clampPosition(latest, parent, widget));
    });
    resizeObserver.observe(parent);
    resizeObserver.observe(widget);
    return () => resizeObserver.disconnect();
  }, []);

  const moveToPointer = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    const widget = wrapperRef.current;
    const parent = widget?.parentElement;
    if (!drag || !widget || !parent) return;

    const parentRect = parent.getBoundingClientRect();
    const next = clampPosition({
      left: event.clientX - parentRect.left - drag.offsetX,
      top: event.clientY - parentRect.top - drag.offsetY,
    }, parent, widget);
    const moved = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (moved > DRAG_THRESHOLD_PX) drag.dragged = true;
    setPosition(next);
  }, []);

  const handlePointerDown = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const widget = wrapperRef.current;
    const parent = widget?.parentElement;
    if (!widget || !parent) return;

    const widgetRect = widget.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    const current = position ?? {
      left: widgetRect.left - parentRect.left,
      top: widgetRect.top - parentRect.top,
    };
    const clamped = clampPosition(current, parent, widget);
    setPosition(clamped);
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - widgetRect.left,
      offsetY: event.clientY - widgetRect.top,
      startX: event.clientX,
      startY: event.clientY,
      dragged: false,
    };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [position]);

  const handlePointerMove = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
    event.preventDefault();
    moveToPointer(event);
  }, [moveToPointer]);

  const handlePointerUp = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const wasDragged = drag.dragged;
    dragRef.current = null;
    setDragging(false);
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* already released */ }

    const widget = wrapperRef.current;
    const parent = widget?.parentElement;
    const latestPosition = positionRef.current;
    if (widget && parent && latestPosition) writeStoredPosition(clampPosition(latestPosition, parent, widget));
    if (wasDragged) suppressClickRef.current = true;
  }, []);

  const handleButtonClick = useCallback(() => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    setOpen((value) => !value);
  }, []);

  const totals = useMemo(() => files.reduce((acc, file) => ({
    additions: acc.additions + file.additions,
    deletions: acc.deletions + file.deletions,
  }), { additions: 0, deletions: 0 }), [files]);

  if (files.length === 0 && !open) return null;

  return (
    <>
      <div
        ref={wrapperRef}
        style={{
          position: "absolute",
          ...(position ? { left: position.left, top: position.top } : { right: DEFAULT_MARGIN, bottom: DEFAULT_BOTTOM }),
          zIndex: 130,
          display: "inline-flex",
          pointerEvents: "auto",
        }}
      >
        {open && (
          <div
            style={{
              position: "absolute",
              right: 0,
              bottom: "calc(100% + 8px)",
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
          onClick={handleButtonClick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
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
            cursor: dragging ? "grabbing" : "grab",
            fontSize: 12,
            fontWeight: 800,
            touchAction: "none",
            userSelect: "none",
          }}
          aria-expanded={open}
          title="Drag to move; click to show changed files"
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
