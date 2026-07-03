"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { YpiStudioLiveRunOverlay, YpiStudioTaskWidgetProjection, YpiStudioTaskWidgetSubagentRun, YpiStudioSubagentTranscriptItem } from "@/lib/ypi-studio-types";

interface Props {
  task: YpiStudioTaskWidgetProjection;
  liveOverlays?: YpiStudioLiveRunOverlay[];
  onClick: () => void;
}

interface WidgetPosition { left: number; top: number }

const STORAGE_KEY = "pi-web:ypi-studio-session-widget-position";
const DEFAULT_MARGIN = 18;
const DRAG_THRESHOLD_PX = 4;
const MOBILE_MEDIA = "(max-width: 640px)";

function clampPosition(position: WidgetPosition, parent: HTMLElement, widget: HTMLElement): WidgetPosition {
  const maxLeft = Math.max(DEFAULT_MARGIN, parent.clientWidth - widget.offsetWidth - DEFAULT_MARGIN);
  const maxTop = Math.max(DEFAULT_MARGIN, parent.clientHeight - widget.offsetHeight - DEFAULT_MARGIN);
  return { left: Math.min(Math.max(DEFAULT_MARGIN, position.left), maxLeft), top: Math.min(Math.max(DEFAULT_MARGIN, position.top), maxTop) };
}

function readStoredPosition(): WidgetPosition | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<WidgetPosition> | null;
    if (typeof parsed?.left === "number" && typeof parsed.top === "number") return { left: parsed.left, top: parsed.top };
  } catch {}
  return null;
}

function writeStoredPosition(position: WidgetPosition): void {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(position)); } catch {}
}

function useMobile(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(MOBILE_MEDIA);
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return mobile;
}

function statusColor(status: string): string {
  if (status === "succeeded" || status === "done") return "#22c55e";
  if (status === "waiting_for_user") return "#f59e0b";
  if (status === "failed") return "#ef4444";
  if (status === "cancelled") return "var(--text-dim)";
  if (status === "running" || status === "active") return "var(--accent)";
  return "var(--text-dim)";
}

function itemText(item: YpiStudioSubagentTranscriptItem): string {
  if (item.kind === "tool_call") return `${item.toolName}: ${item.inputPreview}`;
  if ("text" in item) return item.text;
  return "";
}

function phaseLabel(run: Pick<YpiStudioTaskWidgetSubagentRun, "phase" | "currentTool">): string | undefined {
  if (run.phase === "starting") return "Starting";
  if (run.phase === "waiting_model") return "Waiting model";
  if (run.phase === "streaming") return "Streaming";
  if (run.phase === "running_tool") return `Tool ${run.currentTool?.toolName ?? "running"}`;
  if (run.phase === "waiting_for_user") return "Waiting user";
  if (run.phase === "finished") return "Finished";
  return undefined;
}

function statsLabel(run: Pick<YpiStudioTaskWidgetSubagentRun, "tokens" | "tps">): string | undefined {
  const tokens = typeof run.tokens === "number" ? `${run.tokens} tok` : undefined;
  const tps = typeof run.tps === "number" ? `${run.tps.toFixed(1)} t/s` : undefined;
  return [tokens, tps].filter(Boolean).join(" · ") || undefined;
}

function isDisplayOnlyNote(value: string): boolean {
  const normalized = value.toLowerCase();
  return normalized.startsWith("display note:") || normalized.includes("api projection limits") || normalized.includes("member run status is unchanged");
}

function previewForRun(run: YpiStudioTaskWidgetSubagentRun): string {
  const recovery = run.status === "failed" || run.status === "cancelled" ? "可重试或从当前阶段继续" : undefined;
  const latestWarning = run.warnings?.slice(-1)[0];
  const displayNote = latestWarning && isDisplayOnlyNote(latestWarning) ? latestWarning.replace(/^Display note:\s*/i, "显示说明：") : undefined;
  const runtimeWarning = latestWarning && !displayNote ? latestWarning : undefined;
  const activity = run.lastItemsPreview.map(itemText).filter(Boolean).slice(-2).join(" · ") || run.summary || run.error || recovery || "等待成员输出…";
  return [runtimeWarning, activity, displayNote].filter(Boolean).join(" · ");
}

function mergeRuns(task: YpiStudioTaskWidgetProjection, overlays: YpiStudioLiveRunOverlay[] = []): YpiStudioTaskWidgetSubagentRun[] {
  const relevant = overlays.filter((overlay) => overlay.running && (overlay.taskKey === task.key || overlay.taskId === task.id));
  const liveRuns = relevant.map((overlay): YpiStudioTaskWidgetSubagentRun => ({
    id: overlay.toolCallId,
    member: overlay.member ?? "studio",
    subtaskId: overlay.subtaskId,
    status: overlay.status ?? "running",
    startedAt: new Date(overlay.updatedAt).toISOString(),
    summary: overlay.lastTextPreview,
    model: overlay.model,
    thinking: overlay.thinking,
    phase: overlay.phase,
    tokens: overlay.tokens,
    tps: overlay.tps,
    currentTool: overlay.currentTool,
    lastItemsPreview: overlay.itemsPreview ?? [],
  }));
  const liveIds = new Set(liveRuns.map((run) => run.id));
  return [...liveRuns, ...task.subagents.filter((run) => !liveIds.has(run.id))]
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .slice(-8);
}

const FLOW_MAX_COLUMNS = 4;
const FLOW_ROW_HEIGHT = 42;
const FLOW_NODE_Y_OFFSET = 10;
const FLOW_SIDE_PADDING = 20;

function stepDescription(status: "done" | "active" | "pending"): string {
  if (status === "active") return "当前阶段";
  if (status === "pending") return "未完成";
  return "";
}

function buildStepFlow(task: YpiStudioTaskWidgetProjection) {
  const columnCount = Math.max(1, Math.min(FLOW_MAX_COLUMNS, task.steps.length));
  const rowCount = Math.max(1, Math.ceil(task.steps.length / columnCount));
  const columnGap = columnCount > 1 ? (100 - FLOW_SIDE_PADDING * 2) / (columnCount - 1) : 0;
  const points = task.steps.map((step, index) => {
    const row = Math.floor(index / columnCount);
    const offset = index % columnCount;
    const column = row % 2 === 0 ? offset : columnCount - 1 - offset;
    return {
      step,
      index,
      row,
      x: columnCount === 1 ? 50 : FLOW_SIDE_PADDING + column * columnGap,
      y: row * FLOW_ROW_HEIGHT + FLOW_NODE_Y_OFFSET,
      labelAlign: row % 2 === 0 ? "left" as const : "right" as const,
    };
  });
  if (points.length === 0) return { points, path: "", height: FLOW_ROW_HEIGHT, rowCount, columnCount };
  const pathParts = [`M ${points[0].x} ${points[0].y}`];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (previous.row === current.row) {
      pathParts.push(`L ${current.x} ${current.y}`);
    } else {
      const edgeX = previous.row % 2 === 0 ? 100 - FLOW_SIDE_PADDING : FLOW_SIDE_PADDING;
      const midY = previous.y + (current.y - previous.y) / 2;
      pathParts.push(`L ${edgeX} ${previous.y}`);
      pathParts.push(`Q ${edgeX} ${midY} ${edgeX} ${current.y}`);
      pathParts.push(`L ${current.x} ${current.y}`);
    }
  }
  return { points, path: pathParts.join(" "), height: rowCount * FLOW_ROW_HEIGHT, rowCount, columnCount };
}

function Content({ task, runs }: { task: YpiStudioTaskWidgetProjection; runs: YpiStudioTaskWidgetSubagentRun[] }) {
  const completedCount = task.artifacts.completed.filter((artifact) => task.artifacts.required.includes(artifact)).length;
  const implementation = task.implementation;
  const stepFlow = buildStepFlow(task);
  return (
    <>
      <div style={{ padding: "10px 38px 8px 12px", display: "flex", gap: 10, alignItems: "flex-start" }}>
        <span style={{ width: 26, height: 26, borderRadius: 9, display: "grid", placeItems: "center", background: "rgba(37,99,235,0.13)", color: "var(--accent)", fontWeight: 900 }}>工</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-muted)", fontWeight: 800 }}>
            <span>Studio · {task.workflowName ?? task.workflowId}</span>
            <span style={{ marginLeft: "auto", color: "var(--text)" }}>{task.progress}%</span>
          </div>
          <div style={{ marginTop: 4, color: "var(--text)", fontSize: 13, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.title}</div>
          <div style={{ marginTop: 4, display: "flex", gap: 6, flexWrap: "wrap", color: "var(--text-dim)", fontSize: 10 }}>
            <span>{task.statusLabel}</span><span>·</span><span>负责人 {task.currentMember ?? "—"}</span><span>·</span><span>产物 {completedCount}/{task.artifacts.required.length}</span>{implementation && <><span>·</span><span>子任务 {implementation.done + implementation.skipped}/{implementation.total}</span></>}
          </div>
        </div>
      </div>
      <div style={{ padding: "0 12px 10px", display: "flex", flexDirection: "column", gap: 9 }}>
        <div className="ypi-studio-widget-flow" style={{ position: "relative", height: stepFlow.height, minHeight: FLOW_ROW_HEIGHT }}>
          {stepFlow.path && (
            <svg aria-hidden="true" viewBox={`0 0 100 ${stepFlow.height}`} preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}>
              <path d={stepFlow.path} fill="none" stroke="var(--border)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              <path className="ypi-studio-widget-flow-path" d={stepFlow.path} fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </svg>
          )}
          {stepFlow.points.map(({ step, x, y, labelAlign }) => (
            <div key={step.id} title={`${step.label} · ${step.owner}`} style={{ position: "absolute", left: `${x}%`, top: y - 7, width: 68, transform: labelAlign === "left" ? "translateX(-7px)" : "translateX(calc(-100% + 7px))", pointerEvents: "none" }}>
              <span className={step.status === "active" ? "ypi-studio-widget-pulse" : undefined} style={{ display: "block", width: 14, height: 14, marginLeft: labelAlign === "left" ? 0 : "auto", borderRadius: "50%", background: step.status === "done" ? "#22c55e" : step.status === "active" ? "var(--accent)" : "var(--bg-subtle)", border: `2px solid ${step.status === "pending" ? "var(--border)" : "color-mix(in srgb, var(--bg-panel) 75%, white)"}`, boxShadow: "0 0 0 2px color-mix(in srgb, var(--bg-panel) 90%, transparent)" }} />
              <div style={{ marginTop: 5, color: step.status === "active" ? "var(--accent)" : "var(--text-dim)", fontSize: 9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: labelAlign }}>{step.label}</div>
              {stepDescription(step.status) && <div style={{ marginTop: 2, color: step.status === "pending" ? "var(--text-dim)" : "var(--text-muted)", fontSize: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: labelAlign }}>{stepDescription(step.status)}</div>}
            </div>
          ))}
        </div>
        {implementation && (implementation.activeTitle || implementation.nextTitle || implementation.blocked > 0) && <div style={{ color: implementation.blocked > 0 ? "#f59e0b" : "var(--text-dim)", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{implementation.activeTitle ? `当前子任务：${implementation.activeTitle}` : implementation.nextTitle ? `下一个子任务：${implementation.nextTitle}` : `阻塞子任务：${implementation.blocked}`}</div>}
        {task.artifacts.missing.length > 0 && <div style={{ color: "var(--text-dim)", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>缺失：{task.artifacts.missing.join("、")}</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 150, overflowY: "auto", paddingRight: 2 }}>
          {runs.length === 0 ? <div style={{ color: "var(--text-dim)", fontSize: 11 }}>暂无 Studio 成员执行记录</div> : runs.map((run) => (
            <div key={run.id} style={{ display: "grid", gridTemplateColumns: "54px 1fr auto", alignItems: "center", gap: 7, borderBottom: "1px solid color-mix(in srgb, var(--border) 55%, transparent)", padding: "4px 0" }}>
              <span style={{ color: "var(--text-dim)", fontSize: 9 }}>{new Date(run.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              <span style={{ color: "var(--text-muted)", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><span style={{ color: "var(--text)", fontWeight: 800 }}>{run.member}</span> · {[phaseLabel(run), statsLabel(run), previewForRun(run).slice(0, 70)].filter(Boolean).join(" · ")}</span>
              <span style={{ color: statusColor(run.status), fontSize: 9, fontWeight: 800 }}>{run.phase ?? run.status}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export function YpiStudioSessionWidget({ task, liveOverlays = [], onClick }: Props) {
  const ref = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number; startX: number; startY: number; dragged: boolean } | null>(null);
  const positionRef = useRef<WidgetPosition | null>(null);
  const [position, setPosition] = useState<WidgetPosition | null>(null);
  const [dragging, setDragging] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const isMobile = useMobile();
  const runs = useMemo(() => mergeRuns(task, liveOverlays), [task, liveOverlays]);

  useEffect(() => { positionRef.current = position; }, [position]);
  useEffect(() => { setDismissedKey(null); setMobileOpen(false); }, [task.key]);

  useEffect(() => {
    if (isMobile) return;
    const widget = ref.current;
    const parent = widget?.parentElement;
    if (!widget || !parent) return;
    const apply = () => {
      const stored = readStoredPosition();
      const next = stored ?? { left: Math.max(DEFAULT_MARGIN, parent.clientWidth - widget.offsetWidth - DEFAULT_MARGIN), top: DEFAULT_MARGIN };
      setPosition(clampPosition(next, parent, widget));
    };
    apply();
    const observer = new ResizeObserver(() => setPosition((latest) => latest ? clampPosition(latest, parent, widget) : null));
    observer.observe(parent); observer.observe(widget);
    return () => observer.disconnect();
  }, [isMobile]);

  const moveToPointer = useCallback((event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    const widget = ref.current;
    const parent = widget?.parentElement;
    if (!drag || !widget || !parent) return;
    const rect = parent.getBoundingClientRect();
    const next = clampPosition({ left: event.clientX - rect.left - drag.offsetX, top: event.clientY - rect.top - drag.offsetY }, parent, widget);
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > DRAG_THRESHOLD_PX) drag.dragged = true;
    setPosition(next);
  }, []);

  const handlePointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    if (isMobile || event.button !== 0) return;
    const widget = ref.current;
    const parent = widget?.parentElement;
    if (!widget || !parent) return;
    const rect = widget.getBoundingClientRect();
    dragRef.current = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, startX: event.clientX, startY: event.clientY, dragged: false };
    widget.setPointerCapture(event.pointerId);
  }, [isMobile]);

  const handlePointerUp = useCallback((event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (ref.current?.hasPointerCapture(event.pointerId)) ref.current.releasePointerCapture(event.pointerId);
    if (drag.dragged && positionRef.current) writeStoredPosition(positionRef.current);
    setDragging(false);
    const wasDragged = drag.dragged;
    dragRef.current = null;
    if (!wasDragged) onClick();
  }, [onClick]);

  const handlePointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    if (!dragRef.current) return;
    moveToPointer(event);
    setDragging(true);
  }, [moveToPointer]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onClick(); }
  }, [onClick]);

  if (dismissedKey === task.key) return null;

  if (isMobile) {
    return (
      <>
        <button type="button" onClick={() => setMobileOpen(true)} style={{ position: "absolute", left: "50%", bottom: 12, transform: "translateX(-50%)", zIndex: 250, border: "1px solid var(--border)", background: "color-mix(in srgb, var(--bg-panel) 92%, transparent)", color: "var(--text)", borderRadius: 999, padding: "7px 12px", fontSize: 12, fontWeight: 800, boxShadow: "0 10px 30px rgba(0,0,0,0.18)", backdropFilter: "blur(10px)" }}>工 Studio {task.progress}% · {runs[0]?.member ?? task.currentMember ?? task.statusLabel}</button>
        {mobileOpen && <div style={{ position: "fixed", inset: 0, zIndex: 600, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "flex-end" }} onClick={() => setMobileOpen(false)}><div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxHeight: "78vh", overflowY: "auto", borderTopLeftRadius: 16, borderTopRightRadius: 16, border: "1px solid var(--border)", background: "var(--bg)", boxShadow: "0 -16px 40px rgba(0,0,0,0.22)" }}><Content task={task} runs={runs} /><div style={{ padding: 12, display: "flex", gap: 8 }}><button onClick={onClick} style={{ flex: 1, padding: 10, borderRadius: 10, border: "1px solid var(--accent)", background: "var(--accent)", color: "white", fontWeight: 800 }}>打开工作室</button><button onClick={() => setMobileOpen(false)} style={{ padding: 10, borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-panel)", color: "var(--text-muted)", fontWeight: 800 }}>关闭</button></div></div></div>}
      </>
    );
  }

  return (
    <aside
      ref={ref}
      role="button"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{ position: "absolute", zIndex: 250, width: 340, maxWidth: "calc(100% - 36px)", maxHeight: 390, overflow: "hidden", left: position?.left, top: position?.top, right: position ? undefined : DEFAULT_MARGIN, border: `1px solid ${dragging ? "var(--accent)" : "var(--border)"}`, borderRadius: 14, background: "color-mix(in srgb, var(--bg-panel) 88%, transparent)", color: "var(--text)", boxShadow: "0 16px 45px rgba(0,0,0,0.18)", backdropFilter: "blur(10px)", cursor: dragging ? "grabbing" : "grab", opacity: dragging ? 0.72 : 1, userSelect: "none" }}
    >
      <button type="button" aria-label="隐藏 Studio 卡片" onPointerDown={(event) => { event.stopPropagation(); }} onPointerUp={(event) => { event.stopPropagation(); }} onClick={(event) => { event.stopPropagation(); setDismissedKey(task.key); }} style={{ position: "absolute", top: 8, right: 9, width: 18, height: 18, lineHeight: "16px", borderRadius: 999, border: "1px solid color-mix(in srgb, var(--border) 65%, transparent)", background: "color-mix(in srgb, var(--bg-panel) 80%, transparent)", color: "var(--text-dim)", cursor: "pointer", zIndex: 1, fontSize: 12, opacity: 0.72 }}>×</button>
      <Content task={task} runs={runs} />
    </aside>
  );
}
