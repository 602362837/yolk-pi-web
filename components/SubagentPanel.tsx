"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  StudioChildPanelStatus,
  StudioChildSessionListItem,
  StudioChildSessionListResponse,
} from "@/lib/types";

const ACTIVE_STATUSES = new Set<StudioChildPanelStatus>([
  "queued",
  "running",
  "waiting_for_user",
]);

const TERMINAL_STATUSES = new Set<StudioChildPanelStatus>([
  "succeeded",
  "failed",
  "cancelled",
  "runtime_lost",
]);

function isActivePanelStatus(status: StudioChildPanelStatus): boolean {
  return ACTIVE_STATUSES.has(status);
}

function isTerminalPanelStatus(status: StudioChildPanelStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export type StudioChildPanelLoadState = "idle" | "loading" | "ready" | "error";

interface Props {
  /** Parent session id currently driving the inventory (null for New Chat). */
  parentSessionId?: string | null;
  /** High-confidence YPI Studio child projections for the current parent Chat. */
  items: StudioChildSessionListItem[];
  counts: StudioChildSessionListResponse["counts"] | null;
  limits: StudioChildSessionListResponse["limits"] | null;
  loadState: StudioChildPanelLoadState;
  stale: boolean;
  errorMessage: string | null;
  hasParentSession: boolean;
  onRefresh: () => void;
  onOpenChild: (child: StudioChildSessionListItem) => void;
}

function formatRelativeTime(dateStr: string | undefined): string {
  if (!dateStr) return "—";
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "—";
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

function statusLabel(status: StudioChildPanelStatus): string {
  switch (status) {
    case "waiting_for_user":
      return "等待反馈";
    case "running":
      return "运行中";
    case "queued":
      return "排队中";
    case "succeeded":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    case "runtime_lost":
      return "运行丢失";
    default:
      return "状态待同步";
  }
}

function statusTone(status: StudioChildPanelStatus): "waiting" | "running" | "success" | "danger" | "muted" {
  if (status === "waiting_for_user") return "waiting";
  if (status === "running" || status === "queued") return "running";
  if (status === "succeeded") return "success";
  if (status === "failed" || status === "runtime_lost") return "danger";
  if (status === "cancelled") return "muted";
  return "muted";
}

function isTerminalLike(item: StudioChildSessionListItem): boolean {
  return isTerminalPanelStatus(item.status)
    || (item.status === "unknown" && Boolean(item.finishedAt));
}

function isWaiting(item: StudioChildSessionListItem): boolean {
  return item.status === "waiting_for_user";
}

function groupChildren(items: StudioChildSessionListItem[]): {
  waiting: StudioChildSessionListItem[];
  running: StudioChildSessionListItem[];
  terminal: StudioChildSessionListItem[];
} {
  const waiting: StudioChildSessionListItem[] = [];
  const running: StudioChildSessionListItem[] = [];
  const terminal: StudioChildSessionListItem[] = [];
  // Server already sorts; preserve order while splitting for display groups.
  for (const item of items) {
    if (isWaiting(item)) waiting.push(item);
    else if (isTerminalLike(item)) terminal.push(item);
    else running.push(item);
  }
  return { waiting, running, terminal };
}

export function SubagentPanel({
  parentSessionId = null,
  items,
  counts,
  limits,
  loadState,
  stale,
  errorMessage,
  hasParentSession,
  onRefresh,
  onOpenChild,
}: Props) {
  const previousStatusRef = useRef<Map<string, StudioChildPanelStatus>>(new Map());
  const [flashById, setFlashById] = useState<Record<string, "success" | "danger" | undefined>>({});
  const initialStatusesSeededRef = useRef(false);
  const trackedParentIdRef = useRef<string | null>(parentSessionId ?? null);

  // Parent switch must not treat the new list as status transitions of the old parent.
  useEffect(() => {
    const nextParent = parentSessionId ?? null;
    if (trackedParentIdRef.current === nextParent) return;
    trackedParentIdRef.current = nextParent;
    previousStatusRef.current = new Map();
    initialStatusesSeededRef.current = false;
    setFlashById({});
  }, [parentSessionId]);

  // Track status transitions for one-shot terminal feedback; skip initial paint & same-status polls.
  useEffect(() => {
    const nextMap = new Map<string, StudioChildPanelStatus>();
    const flashes: Record<string, "success" | "danger"> = {};
    let hasFlash = false;

    for (const child of items) {
      nextMap.set(child.sessionId, child.status);
      if (!initialStatusesSeededRef.current) continue;
      const prev = previousStatusRef.current.get(child.sessionId);
      if (!prev || prev === child.status) continue;
      if (child.status === "succeeded") {
        flashes[child.sessionId] = "success";
        hasFlash = true;
      } else if (child.status === "failed" || child.status === "runtime_lost") {
        flashes[child.sessionId] = "danger";
        hasFlash = true;
      }
    }

    previousStatusRef.current = nextMap;
    if (!initialStatusesSeededRef.current) {
      initialStatusesSeededRef.current = items.length > 0 || loadState === "ready" || loadState === "error";
      return;
    }

    if (!hasFlash) return;
    setFlashById((prev) => ({ ...prev, ...flashes }));
    const timer = window.setTimeout(() => {
      setFlashById((prev) => {
        const next = { ...prev };
        for (const id of Object.keys(flashes)) delete next[id];
        return next;
      });
    }, 900);
    return () => window.clearTimeout(timer);
  }, [items, loadState]);

  // Reset flash bookkeeping when parent context empties.
  useEffect(() => {
    if (hasParentSession) return;
    previousStatusRef.current = new Map();
    initialStatusesSeededRef.current = false;
    setFlashById({});
  }, [hasParentSession]);

  const groups = useMemo(() => groupChildren(items), [items]);
  const activeCount = counts?.active ?? items.filter((c) => !isTerminalLike(c)).length;
  const terminalReturned = counts?.terminalReturned ?? groups.terminal.length;
  const totalVisible = items.length;
  const showInitialLoading = loadState === "loading" && items.length === 0;
  const showError = loadState === "error" && items.length === 0;
  const showEmpty = hasParentSession
    && loadState === "ready"
    && items.length === 0
    && !stale;
  const showNoParent = !hasParentSession;

  const countsLabel = (() => {
    if (showInitialLoading) return "(正在同步...)";
    if (showError) return "(连接失败)";
    if (showNoParent) return "";
    return `(${activeCount} 活动 / ${totalVisible} 显示)`;
  })();

  return (
    <div className="studio-child-panel" role="region" aria-label="Studio child sessions">
      <div className="studio-child-panel__header">
        <div className="studio-child-panel__title">
          <span>Studio 子会话列表</span>
          {countsLabel ? (
            <span className="studio-child-panel__counts">{countsLabel}</span>
          ) : null}
        </div>
        <div className="studio-child-panel__actions">
          <button
            type="button"
            className="studio-child-panel__refresh"
            onClick={onRefresh}
            disabled={!hasParentSession || showInitialLoading}
            title="手动刷新"
            aria-label="刷新 Studio 子会话列表"
          >
            ↻
          </button>
        </div>
      </div>

      <div className="studio-child-panel__body">
        {stale && errorMessage ? (
          <div className="studio-child-panel__stale" role="status">
            <span>数据可能已过期 · {errorMessage}</span>
            <button type="button" className="studio-child-panel__retry-inline" onClick={onRefresh}>
              重试
            </button>
          </div>
        ) : null}

        {showNoParent ? (
          <div className="studio-child-panel__empty">
            <strong>需要先选择已保存的父会话</strong>
            <p>新建 Chat 尚未持久化时不会产生 YPI Studio child session。</p>
          </div>
        ) : null}

        {showInitialLoading ? (
          <div className="studio-child-panel__loading" role="status" aria-live="polite">
            <div className="studio-child-panel__spinner" aria-hidden="true" />
            <div>同步 Studio Task 运行状态中...</div>
          </div>
        ) : null}

        {showError ? (
          <div className="studio-child-panel__error" role="alert">
            <strong>同步子会话列表失败</strong>
            <p>{errorMessage || "网络超时或后端服务不可达，无法加载 inventory。"}</p>
            <button type="button" className="studio-child-panel__retry" onClick={onRefresh}>
              重试连接
            </button>
          </div>
        ) : null}

        {showEmpty ? (
          <div className="studio-child-panel__empty">
            <strong>当前父 Chat 尚无 YPI Studio child sessions</strong>
            <p>当 YPI Studio 派出成员执行子任务时，会在此列出持久化的子 session 审计记录。</p>
          </div>
        ) : null}

        {!showInitialLoading && !showError && !showEmpty && !showNoParent && items.length > 0 ? (
          <>
            {groups.waiting.length > 0 ? (
              <section className="studio-child-panel__group" aria-label="需要关注">
                <div className="studio-child-panel__group-title">
                  需要关注 · 等待用户 ({groups.waiting.length})
                </div>
                <div className="studio-child-panel__list">
                  {groups.waiting.map((child) => (
                    <ChildRow
                      key={child.sessionId}
                      child={child}
                      flash={flashById[child.sessionId]}
                      onOpen={onOpenChild}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {groups.running.length > 0 ? (
              <section className="studio-child-panel__group" aria-label="运行中">
                <div className="studio-child-panel__group-title">
                  运行中 / 排队 ({groups.running.length})
                </div>
                <div className="studio-child-panel__list">
                  {groups.running.map((child) => (
                    <ChildRow
                      key={child.sessionId}
                      child={child}
                      flash={flashById[child.sessionId]}
                      onOpen={onOpenChild}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {groups.terminal.length > 0 ? (
              <section className="studio-child-panel__group" aria-label="最近完成">
                <div className="studio-child-panel__group-title">
                  最近完成 ({terminalReturned})
                </div>
                <div className="studio-child-panel__list">
                  {groups.terminal.map((child) => (
                    <ChildRow
                      key={child.sessionId}
                      child={child}
                      flash={flashById[child.sessionId]}
                      onOpen={onOpenChild}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {limits?.terminalTruncated || limits?.activeTruncated ? (
              <div className="studio-child-panel__truncated" role="note">
                {limits.terminalTruncated
                  ? `仅显示最近 ${limits.terminal} 条终态子会话（共 ${counts?.terminalAvailable ?? "?"} 条）`
                  : null}
                {limits.activeTruncated
                  ? `${limits.terminalTruncated ? " · " : ""}活动项已达防御上限 ${limits.defensiveActiveCap}`
                  : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

function ChildRow({
  child,
  flash,
  onOpen,
}: {
  child: StudioChildSessionListItem;
  flash?: "success" | "danger";
  onOpen: (child: StudioChildSessionListItem) => void;
}) {
  const tone = statusTone(child.status);
  const timeSource = child.finishedAt ?? child.startedAt ?? child.modifiedAt ?? child.createdAt;
  const activePulse = isActivePanelStatus(child.status);

  return (
    <button
      type="button"
      className={[
        "studio-child-row",
        flash === "success" ? "is-flash-success" : "",
        flash === "danger" ? "is-flash-danger" : "",
      ].filter(Boolean).join(" ")}
      onClick={() => onOpen(child)}
      title="进入只读审计会话"
      aria-label={`进入只读审计会话：${child.title}`}
    >
      <div className="studio-child-row__main">
        <div className="studio-child-row__title" title={child.title}>
          {child.title}
        </div>
        <div className="studio-child-row__meta">
          <span className="studio-child-row__member">{child.member}</span>
          <span>{child.messageCount} 轮</span>
          <span aria-hidden="true">·</span>
          <span title={timeSource}>{formatRelativeTime(timeSource)}</span>
          {child.statusMayBeStale ? (
            <span className="studio-child-row__stale-tag" title="状态来自 child header，可能已过期">
              状态可能过期
            </span>
          ) : null}
          <span aria-hidden="true">·</span>
          <span className={`studio-child-row__status is-${tone}`}>
            {activePulse ? (
              <span
                className={`studio-child-row__pulse is-${child.status === "waiting_for_user" ? "waiting" : "running"}`}
                aria-hidden="true"
              />
            ) : (
              <span className="studio-child-row__status-icon" aria-hidden="true">
                {child.status === "succeeded" ? "✓"
                  : child.status === "failed" || child.status === "runtime_lost" ? "✗"
                    : child.status === "cancelled" ? "—"
                      : "○"}
              </span>
            )}
            <span>{statusLabel(child.status)}</span>
          </span>
        </div>
      </div>
      <div className="studio-child-row__enter" aria-hidden="true">
        <span className="studio-child-row__readonly">只读</span>
        <span>进入只读审计</span>
        <span>→</span>
      </div>
    </button>
  );
}
