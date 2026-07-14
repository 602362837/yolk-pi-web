"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type {
  SessionUsageChildTopbarSummary,
  SessionUsageTopbarStats,
} from "@/hooks/useAgentSession";
import type { SessionContextUsageSnapshot } from "@/lib/usage-stats";

export type SessionContextUsage = {
  percent: number | null;
  contextWindow: number;
  tokens: number | null;
} | null;

type ContextPressure = "normal" | "watch" | "danger" | "unknown";

type OpenPopover = "billing" | "context" | null;

interface SessionStatsChipsProps {
  sessionStats: SessionUsageTopbarStats | null;
  contextUsage: SessionContextUsage;
  /** Right padding so chips clear the right-panel toggle / usage panel spacing. */
  paddingRight: number | string;
}

interface PopoverPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  transformOrigin: string;
}

const CLOSE_DELAY_MS = 150;
const POPOVER_GAP = 7;
const POPOVER_MARGIN = 12;
const BILLING_WIDTH = 245;
const CONTEXT_WIDTH = 330;
const CHILDREN_LIST_MAX = 242;

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return String(n);
}

function formatCompactCost(cost: number): string | null {
  if (!(cost > 0)) return null;
  return cost >= 0.01 ? `$${cost.toFixed(2)}` : "<$0.01";
}

function formatExactCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}

/** Thresholds from approved design: <70 normal, 70–89 watch, ≥90 danger. */
function pressureFromPercent(percent: number | null | undefined): ContextPressure {
  if (percent == null || !Number.isFinite(percent)) return "unknown";
  if (percent >= 90) return "danger";
  if (percent >= 70) return "watch";
  return "normal";
}

function pressureLabel(pressure: ContextPressure): string {
  switch (pressure) {
    case "normal":
      return "正常";
    case "watch":
      return "关注";
    case "danger":
      return "告警";
    default:
      return "未知";
  }
}

function pressureRank(pressure: ContextPressure): number {
  switch (pressure) {
    case "danger":
      return 0;
    case "watch":
      return 1;
    case "normal":
      return 2;
    default:
      return 3;
  }
}

function childDisplayName(child: SessionUsageChildTopbarSummary): string {
  const member = child.member?.trim();
  const step = child.subtaskId?.trim();
  if (member && step) return `${member} · ${step}`;
  if (member) return member;
  if (step) return step;
  return child.sessionId;
}

function childLifetimeTokens(child: SessionUsageChildTopbarSummary): number {
  const t = child.totals.tokens;
  return (t.input ?? 0) + (t.output ?? 0) + (t.cacheRead ?? 0);
}

function snapshotPressure(snapshot: SessionContextUsageSnapshot | undefined): ContextPressure {
  if (!snapshot || snapshot.availability === "unavailable" || snapshot.availability === "unknown") {
    return "unknown";
  }
  return pressureFromPercent(snapshot.percent);
}

function clampPopoverPosition(
  triggerRect: DOMRect,
  preferredWidth: number,
  preferredMaxHeight: number,
): PopoverPosition {
  const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  const width = Math.min(preferredWidth, Math.max(200, viewportWidth - POPOVER_MARGIN * 2));
  const top = Math.min(
    triggerRect.bottom + POPOVER_GAP,
    Math.max(POPOVER_MARGIN, viewportHeight - POPOVER_MARGIN - 120),
  );
  const idealLeft = triggerRect.right - width;
  const left = Math.min(
    Math.max(POPOVER_MARGIN, idealLeft),
    Math.max(POPOVER_MARGIN, viewportWidth - width - POPOVER_MARGIN),
  );
  const availableBelow = Math.max(120, viewportHeight - top - POPOVER_MARGIN);
  const maxHeight = Math.min(preferredMaxHeight, availableBelow);
  return {
    top,
    left,
    width,
    maxHeight,
    transformOrigin: idealLeft < POPOVER_MARGIN ? "top left" : "top right",
  };
}

function TopbarMetricPopover({
  open,
  onOpenChange,
  trigger,
  triggerClassName,
  triggerAriaLabel,
  panelId,
  panelClassName,
  preferredWidth,
  preferredMaxHeight = 420,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  triggerClassName: string;
  triggerAriaLabel: string;
  panelId: string;
  panelClassName?: string;
  preferredWidth: number;
  preferredMaxHeight?: number;
  children: ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const [mounted, setMounted] = useState(false);
  const keyboardNavRef = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const onPointerDown = () => {
      keyboardNavRef.current = false;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Tab") keyboardNavRef.current = true;
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => onOpenChange(false), CLOSE_DELAY_MS);
  }, [clearCloseTimer, onOpenChange]);

  const openNow = useCallback(() => {
    clearCloseTimer();
    onOpenChange(true);
  }, [clearCloseTimer, onOpenChange]);

  const updatePosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition(clampPopoverPosition(rect, preferredWidth, preferredMaxHeight));
  }, [preferredMaxHeight, preferredWidth]);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const onReposition = () => updatePosition();
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    window.visualViewport?.addEventListener("resize", onReposition);
    window.visualViewport?.addEventListener("scroll", onReposition);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
      window.visualViewport?.removeEventListener("resize", onReposition);
      window.visualViewport?.removeEventListener("scroll", onReposition);
    };
  }, [open, updatePosition]);

  useEffect(() => () => clearCloseTimer(), [clearCloseTimer]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (wrapRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      onOpenChange(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onOpenChange(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onOpenChange]);

  const panelStyle: CSSProperties | undefined = position
    ? {
        top: position.top,
        left: position.left,
        width: position.width,
        maxHeight: position.maxHeight,
        transformOrigin: position.transformOrigin,
      }
    : undefined;

  const panel =
    mounted && open && position
      ? createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-modal="false"
            aria-label={triggerAriaLabel}
            className={`session-stats-popover open${panelClassName ? ` ${panelClassName}` : ""}`}
            style={panelStyle}
            onMouseEnter={openNow}
            onMouseLeave={scheduleClose}
            onClick={(event) => event.stopPropagation()}
          >
            {children}
          </div>,
          document.body,
        )
      : null;

  return (
    <div
      ref={wrapRef}
      className="session-stats-chip-wrap"
      onMouseEnter={openNow}
      onMouseLeave={scheduleClose}
    >
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
        aria-label={triggerAriaLabel}
        onClick={(event) => {
          event.stopPropagation();
          onOpenChange(!open);
        }}
        onFocus={() => {
          if (keyboardNavRef.current) openNow();
        }}
        onBlur={(event) => {
          const next = event.relatedTarget as Node | null;
          if (next && (wrapRef.current?.contains(next) || panelRef.current?.contains(next))) return;
          scheduleClose();
        }}
      >
        {trigger}
      </button>
      {panel}
    </div>
  );
}

function ContextMeter({ percent, pressure }: { percent: number | null; pressure: ContextPressure }) {
  if (percent == null || pressure === "unknown") return null;
  return (
    <div className="session-stats-meter" aria-hidden="true">
      <i style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
    </div>
  );
}

function ContextRow({
  name,
  badge,
  detail,
  percent,
  pressure,
  valueLabel,
  isCurrent = false,
}: {
  name: string;
  badge: string;
  detail: string;
  percent: number | null;
  pressure: ContextPressure;
  /** Explicit value label; defaults to percent or unavailable copy. */
  valueLabel?: string;
  isCurrent?: boolean;
}) {
  const displayValue =
    valueLabel ??
    (percent == null || pressure === "unknown" ? "暂无上下文数据" : `${Math.round(percent)}%`);
  return (
    <div className={`session-stats-context-row state-${pressure}`}>
      <div className="session-stats-context-main">
        <div className="session-stats-context-name-line">
          <span className="session-stats-context-name" title={name}>
            {name}
          </span>
          <span className={isCurrent ? "session-stats-role-badge" : "session-stats-status-badge"}>
            {badge}
          </span>
        </div>
        <div className="session-stats-context-detail" title={detail}>
          {detail}
        </div>
        <ContextMeter percent={percent} pressure={pressure} />
      </div>
      <div className="session-stats-context-value">
        <strong>{displayValue}</strong>
        <small>{pressureLabel(pressure)}</small>
      </div>
    </div>
  );
}

/**
 * Top-bar session metric chips + mutually exclusive billing/context popovers.
 *
 * Billing compact semantics are intentionally unchanged from the previous AppShell inline block:
 * parent rollup + optional `incl. Studio`, standalone own, studio_child selected own.
 * Context occupancy never uses lifetime usage totals.
 */
export function SessionStatsChips({
  sessionStats,
  contextUsage,
  paddingRight,
}: SessionStatsChipsProps) {
  const reactId = useId();
  const billingPanelId = `${reactId}-billing`;
  const contextPanelId = `${reactId}-context`;
  const [openPopover, setOpenPopover] = useState<OpenPopover>(null);

  const kind = sessionStats?.selectedSessionKind ?? "standalone";
  const selectedTotals = sessionStats?.selectedSessionTotals;
  const tokens = kind === "studio_child" && selectedTotals ? selectedTotals.tokens : sessionStats?.tokens;
  const costValue =
    kind === "studio_child" && selectedTotals
      ? (selectedTotals.cost ?? 0)
      : (sessionStats?.cost ?? 0);
  const costStr = formatCompactCost(costValue);

  const childCount = sessionStats?.studioChildSessionCount ?? 0;
  const ownCost = sessionStats?.own?.cost ?? 0;
  const studioChild = sessionStats?.studioChild;
  const childCost = studioChild?.cost ?? 0;
  const childTokenTotal = studioChild
    ? studioChild.tokens.input +
      studioChild.tokens.output +
      studioChild.tokens.cacheRead
    : 0;
  const hasChildUsage = kind === "parent" && (childTokenTotal > 0 || childCost > 0);
  const parentRollupCost = sessionStats?.parentRollupTotals?.cost ?? 0;
  const compactMark =
    kind === "studio_child" ? "Studio child" : hasChildUsage ? "incl. Studio" : null;

  const currentPressure = useMemo(() => {
    if (!contextUsage?.contextWindow) return "unknown" as ContextPressure;
    return pressureFromPercent(contextUsage.percent);
  }, [contextUsage]);

  const currentDetail = useMemo(() => {
    if (!contextUsage?.contextWindow) return "暂无上下文数据";
    const used =
      contextUsage.tokens != null ? formatTokenCount(contextUsage.tokens) : contextUsage.percent != null ? "…" : "?";
    return `${used} / ${formatTokenCount(contextUsage.contextWindow)}`;
  }, [contextUsage]);

  const currentRole =
    kind === "parent" ? "本体 · Parent" : kind === "studio_child" ? "Studio child" : "Standalone";

  const sortedChildren = useMemo(() => {
    const children = sessionStats?.childSessions ?? [];
    return [...children].sort((a, b) => {
      const rank = pressureRank(snapshotPressure(a.contextUsage)) - pressureRank(snapshotPressure(b.contextUsage));
      if (rank !== 0) return rank;
      return childDisplayName(a).localeCompare(childDisplayName(b), "zh");
    });
  }, [sessionStats?.childSessions]);

  const showTokens = Boolean(tokens && (tokens.input > 0 || tokens.output > 0 || tokens.cacheRead > 0));
  const showCost = Boolean(costStr);
  const showContext = Boolean(contextUsage?.contextWindow);
  if (!showTokens && !showCost && !showContext) return null;

  const contextChipClass = [
    "session-stats-chip",
    "session-stats-chip-context",
    `context-${currentPressure}`,
  ].join(" ");

  const contextChipValue =
    contextUsage?.percent != null
      ? `${Math.round(contextUsage.percent)}%`
      : contextUsage?.contextWindow
        ? "?"
        : "—";

  const billingSubtitle =
    kind === "studio_child"
      ? "Studio child · compact 仅本 child"
      : kind === "parent"
        ? hasChildUsage
          ? "Parent rollup · own + Studio children"
          : "Parent · 仅本会话"
        : "Standalone · 仅本会话";

  return (
    <div
      className="app-top-stats session-stats-chips"
      style={{
        marginLeft: "auto",
        paddingRight,
      }}
      aria-label="Session 指标"
    >
      {tokens && tokens.input > 0 && (
        <span className="session-stats-chip session-stats-token-chip" title="Input tokens">
          <span aria-hidden="true">↑</span>
          <span className="session-stats-chip-label">input</span>
          <span>{formatTokenCount(tokens.input)}</span>
        </span>
      )}
      {tokens && tokens.output > 0 && (
        <span className="session-stats-chip session-stats-token-chip" title="Output tokens">
          <span aria-hidden="true">↓</span>
          <span className="session-stats-chip-label">output</span>
          <span>{formatTokenCount(tokens.output)}</span>
        </span>
      )}
      {tokens && tokens.cacheRead > 0 && (
        <span className="session-stats-chip session-stats-token-chip" title="Cache read tokens">
          <span aria-hidden="true">↻</span>
          <span className="session-stats-chip-label">cache</span>
          <span>{formatTokenCount(tokens.cacheRead)}</span>
        </span>
      )}

      {showCost && costStr && (
        <TopbarMetricPopover
          open={openPopover === "billing"}
          onOpenChange={(open) =>
            setOpenPopover((current) => (open ? "billing" : current === "billing" ? null : current))
          }
          preferredWidth={BILLING_WIDTH}
          preferredMaxHeight={280}
          panelId={billingPanelId}
          panelClassName="session-stats-popover-billing"
          triggerClassName="session-stats-chip session-stats-chip-cost"
          triggerAriaLabel={`费用 ${costStr}${compactMark ? ` ${compactMark}` : ""}`}
          trigger={
            <>
              <span aria-hidden="true">$</span>
              <span className="session-stats-chip-label">费用</span>
              <span>{costStr}</span>
              {compactMark && (
                <span className="session-stats-compact-mark">{compactMark}</span>
              )}
            </>
          }
        >
          <div className="session-stats-popover-header">
            <div>
              <div className="session-stats-popover-title" id={`${billingPanelId}-title`}>
                计费组成
              </div>
              <div className="session-stats-popover-subtitle">{billingSubtitle}</div>
            </div>
          </div>
          <div className="session-stats-billing-body">
            {kind === "studio_child" ? (
              <>
                <div className="session-stats-billing-row">
                  <span>本会话</span>
                  <strong>{formatExactCost(costValue || 0)}</strong>
                </div>
                {parentRollupCost > 0 && (
                  <div className="session-stats-billing-row muted">
                    <span>父会话汇总</span>
                    <span>{formatExactCost(parentRollupCost)}</span>
                  </div>
                )}
                {sessionStats?.parentSessionId && (
                  <div className="session-stats-billing-note">
                    Parent: {sessionStats.parentSessionId}
                  </div>
                )}
              </>
            ) : hasChildUsage ? (
              <>
                <div className="session-stats-billing-row">
                  <span>本会话</span>
                  <strong>{ownCost > 0 ? formatExactCost(ownCost) : costStr}</strong>
                </div>
                <div className="session-stats-billing-row muted">
                  <span>Studio 子会话{childCount > 1 ? ` (${childCount})` : ""}</span>
                  <span>{formatExactCost(childCost)}</span>
                </div>
                <div className="session-stats-billing-row total">
                  <span>汇总</span>
                  <strong>{formatExactCost(costValue || ownCost + childCost)}</strong>
                </div>
              </>
            ) : (
              <div className="session-stats-billing-row">
                <span>本会话</span>
                <strong>{costStr}</strong>
              </div>
            )}
            <div className="session-stats-billing-note">
              费用展示口径沿用 parent / standalone / studio_child 规则，不在 UI 内重新计算。
            </div>
          </div>
        </TopbarMetricPopover>
      )}

      {showContext && (
        <TopbarMetricPopover
          open={openPopover === "context"}
          onOpenChange={(open) =>
            setOpenPopover((current) => (open ? "context" : current === "context" ? null : current))
          }
          preferredWidth={CONTEXT_WIDTH}
          preferredMaxHeight={480}
          panelId={contextPanelId}
          panelClassName="session-stats-popover-context"
          triggerClassName={contextChipClass}
          triggerAriaLabel={`上下文占用 ${contextChipValue}，状态 ${pressureLabel(currentPressure)}`}
          trigger={
            <>
              <span
                className="session-stats-ring"
                style={
                  {
                    ["--pct" as string]:
                      contextUsage?.percent != null
                        ? Math.max(0, Math.min(100, contextUsage.percent))
                        : 0,
                  } as CSSProperties
                }
                aria-hidden="true"
              />
              <span className="session-stats-chip-label">上下文</span>
              <span>{contextChipValue}</span>
            </>
          }
        >
          <div className="session-stats-popover-header">
            <div>
              <div className="session-stats-popover-title">上下文占用</div>
              <div className="session-stats-popover-subtitle">
                当前 Session 优先；未知值不会显示为 0%
              </div>
            </div>
          </div>
          <div className="session-stats-current-card">
            <ContextRow
              name="当前 Session"
              badge={currentRole}
              detail={currentDetail}
              percent={contextUsage?.percent ?? null}
              pressure={currentPressure}
              valueLabel={
                contextUsage?.percent != null
                  ? `${Math.round(contextUsage.percent)}%`
                  : contextUsage?.contextWindow
                    ? "?"
                    : "暂无上下文数据"
              }
              isCurrent
            />
          </div>
          {kind === "parent" && sortedChildren.length > 0 ? (
            <>
              <div className="session-stats-children-heading">
                <span>Studio children</span>
                <span>
                  {sortedChildren.length} 个 · 风险优先
                </span>
              </div>
              <div
                className="session-stats-children-list"
                style={{ maxHeight: CHILDREN_LIST_MAX }}
              >
                {sortedChildren.map((child) => {
                  const snap = child.contextUsage;
                  const pressure = snapshotPressure(snap);
                  const hasWindow =
                    snap?.availability === "available" && snap.contextWindow != null;
                  const percent = hasWindow ? snap.percent : null;
                  const lifetime = childLifetimeTokens(child);
                  const detail = hasWindow
                    ? `${snap.tokens != null ? formatTokenCount(snap.tokens) : "?"} / ${formatTokenCount(snap.contextWindow!)}`
                    : lifetime > 0
                      ? `暂无上下文数据 · lifetime ${formatTokenCount(lifetime)} tokens`
                      : "暂无上下文数据";
                  const valueLabel = hasWindow
                    ? percent != null
                      ? `${Math.round(percent)}%`
                      : "?"
                    : "暂无上下文数据";
                  return (
                    <div key={child.sessionId} className="session-stats-child-row">
                      <ContextRow
                        name={childDisplayName(child)}
                        badge={child.status?.trim() || "—"}
                        detail={detail}
                        percent={percent}
                        pressure={pressure}
                        valueLabel={valueLabel}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="session-stats-popover-footer">
                快照不可用时明确显示 unknown；lifetime usage 仅作标注，不用于计算上下文百分比。
              </div>
            </>
          ) : (
            <div className="session-stats-popover-footer">
              {kind === "parent" ? "此场景没有 Studio children。" : "仅显示当前 Session 的上下文占用。"}
            </div>
          )}
        </TopbarMetricPopover>
      )}
    </div>
  );
}
