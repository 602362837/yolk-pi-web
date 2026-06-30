"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { TrellisTaskProgressStage, TrellisTaskSummary } from "@/lib/trellis-types";

interface TrellisSessionWidgetProps {
  task: TrellisTaskSummary;
  onClick: () => void;
}

interface WidgetPosition {
  left: number;
  top: number;
}

const STORAGE_KEY = "pi-web:trellis-session-widget-position";
const DEFAULT_MARGIN = 18;
const DRAG_THRESHOLD_PX = 4;

function phaseColor(phase: TrellisTaskSummary["progress"]["phase"]): string {
  switch (phase) {
    case "finish":
      return "#22c55e";
    case "check":
      return "#a78bfa";
    case "execute":
      return "#60a5fa";
    case "plan":
    default:
      return "#f59e0b";
  }
}

function stageColor(stage: TrellisTaskProgressStage): string {
  if (stage.status === "done") return "#22c55e";
  if (stage.status === "active") return phaseColor(stage.id);
  return "var(--text-dim)";
}

function stageIcon(stage: TrellisTaskProgressStage): string {
  if (stage.status === "done") return "✓";
  if (stage.status === "active") return "●";
  return "○";
}

function childStatusSegments(task: TrellisTaskSummary): Array<{ label: string; value: number; color: string }> {
  return [
    { label: "完成", value: task.childProgress.completed, color: "#22c55e" },
    { label: "检查", value: task.childProgress.review, color: "#a78bfa" },
    { label: "执行", value: task.childProgress.inProgress, color: "#60a5fa" },
    { label: "规划", value: task.childProgress.planning, color: "#f59e0b" },
    { label: "未知", value: task.childProgress.unknown, color: "var(--text-dim)" },
  ].filter((item) => item.value > 0);
}

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

export function TrellisSessionWidget({ task, onClick }: TrellisSessionWidgetProps) {
  const widgetRef = useRef<HTMLDivElement | null>(null);
  const positionRef = useRef<WidgetPosition | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
    startX: number;
    startY: number;
    dragged: boolean;
  } | null>(null);
  const [position, setPosition] = useState<WidgetPosition | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    positionRef.current = position;
  }, [position]);
  const color = phaseColor(task.progress.phase);
  const childText = task.childProgress.total > 0
    ? `子任务 ${task.childProgress.completed}/${task.childProgress.total}`
    : null;
  const childSegments = childStatusSegments(task);

  useEffect(() => {
    const widget = widgetRef.current;
    const parent = widget?.parentElement;
    if (!widget || !parent) return;

    const applyDefault = () => {
      const stored = readStoredPosition();
      const next = stored ?? {
        left: Math.max(DEFAULT_MARGIN, parent.clientWidth - widget.offsetWidth - DEFAULT_MARGIN),
        top: DEFAULT_MARGIN,
      };
      setPosition(clampPosition(next, parent, widget));
    };

    applyDefault();
    const resizeObserver = new ResizeObserver(applyDefault);
    resizeObserver.observe(parent);
    resizeObserver.observe(widget);
    return () => resizeObserver.disconnect();
  }, []);

  const moveToPointer = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const widget = widgetRef.current;
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

  const handlePointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const widget = widgetRef.current;
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

  const handlePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
    event.preventDefault();
    moveToPointer(event);
  }, [moveToPointer]);

  const handlePointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const wasDragged = drag.dragged;
    dragRef.current = null;
    setDragging(false);
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    const widget = widgetRef.current;
    const parent = widget?.parentElement;
    const latestPosition = positionRef.current;
    if (widget && parent && latestPosition) writeStoredPosition(clampPosition(latestPosition, parent, widget));
    if (!wasDragged) onClick();
  }, [onClick]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onClick();
  }, [onClick]);

  return (
    <div
      ref={widgetRef}
      role="button"
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
      title="拖动悬浮窗；点击打开关联 Trellis 任务详情"
      style={{
        position: "absolute",
        ...(position ? { left: position.left, top: position.top } : { right: DEFAULT_MARGIN, top: DEFAULT_MARGIN }),
        zIndex: 120,
        width: "min(340px, calc(100% - 36px))",
        maxHeight: "calc(100% - 36px)",
        border: "1px solid color-mix(in srgb, var(--border) 78%, transparent)",
        borderRadius: 16,
        background: "color-mix(in srgb, var(--bg-panel) 82%, transparent)",
        boxShadow: "0 14px 34px rgba(0,0,0,0.14)",
        backdropFilter: "blur(12px)",
        color: "var(--text)",
        cursor: dragging ? "grabbing" : "grab",
        overflow: "hidden",
        userSelect: "none",
        touchAction: "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px 8px" }}>
        <span style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 24,
          height: 24,
          borderRadius: 8,
          background: "rgba(37,99,235,0.12)",
          color: "var(--accent)",
          fontSize: 12,
          fontWeight: 800,
          flexShrink: 0,
        }}>
          T
        </span>
        <span style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 700 }}>Trellis · {task.progress.label}</span>
            <span style={{ marginLeft: "auto", color: "var(--text)", fontSize: 11, fontWeight: 800 }}>{task.progress.percent}%</span>
          </span>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {task.title}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--text-dim)", fontSize: 10, minWidth: 0 }}>
            <span style={{ fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.dirName}</span>
            {childText && <span style={{ flexShrink: 0 }}>· {childText}</span>}
          </span>
        </span>
      </div>

      <div style={{ padding: "0 12px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ height: 3, borderRadius: 999, background: "color-mix(in srgb, var(--border) 80%, transparent)", overflow: "hidden" }}>
          <div style={{ width: `${task.progress.percent}%`, height: "100%", background: color }} />
        </div>

        {task.childProgress.total > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <div title="子任务状态分布" style={{ display: "flex", height: 5, borderRadius: 999, overflow: "hidden", background: "color-mix(in srgb, var(--border) 80%, transparent)" }}>
              {childSegments.map((segment) => (
                <span key={segment.label} style={{ width: `${(segment.value / task.childProgress.total) * 100}%`, background: segment.color }} />
              ))}
            </div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", color: "var(--text-dim)", fontSize: 9 }}>
              {childSegments.map((segment) => (
                <span key={segment.label} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: segment.color }} />
                  {segment.label} {segment.value}
                </span>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 0, maxHeight: 220, overflowY: "auto", paddingRight: 2 }}>
          {task.progress.stages.map((stage, index) => {
            const currentColor = stageColor(stage);
            return (
              <div key={stage.id} style={{ display: "grid", gridTemplateColumns: "18px 1fr", gap: 8, minHeight: 38 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <span style={{ color: currentColor, fontSize: 12, lineHeight: "16px", fontWeight: 800 }}>{stageIcon(stage)}</span>
                  {index < task.progress.stages.length - 1 && (
                    <span style={{ width: 1, flex: 1, minHeight: 16, background: stage.status === "done" ? "#22c55e" : "var(--border)", opacity: 0.8 }} />
                  )}
                </div>
                <div style={{ paddingBottom: 8, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    <span style={{ color: currentColor, fontSize: 11, fontWeight: 800 }}>{stage.label}</span>
                    {stage.status === "active" && (
                      <span style={{ padding: "1px 5px", borderRadius: 999, background: "rgba(37,99,235,0.14)", color: "var(--accent)", fontSize: 9, fontWeight: 800 }}>当前</span>
                    )}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 1, marginTop: 2, color: "var(--text-dim)", fontSize: 10, lineHeight: 1.35 }}>
                    {stage.details.slice(0, 2).map((detail) => <span key={detail}>{detail}</span>)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
