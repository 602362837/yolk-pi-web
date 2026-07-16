"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  PROVIDER_USAGE_AGGREGATE_CLOSE_GRACE_MS,
  resolveOverallProviderUsageRisk,
  type ProviderUsageAggregateProjection,
  type ProviderUsageKey,
  type ProviderUsageRisk,
} from "./ProviderUsagePanelContract";
import { ProviderUsageRingUnitView } from "./ProviderUsageTrigger";

export interface ProviderUsageAggregateColumn {
  /** Allowlisted projection for the trigger segment + column header. */
  projection: ProviderUsageAggregateProjection;
  /**
   * Provider-owned detail body (accounts, quota bars, actions).
   * Always mounted while the aggregate panel is open so state is not remounted
   * by hover/focus; shell never fetches.
   */
  detail: ReactNode;
}

export interface ProviderUsageAggregatePanelProps {
  /** Enabled provider columns, already ordered GPT → Grok → Kiro. */
  columns: readonly ProviderUsageAggregateColumn[];
  /**
   * Open Models (or similar) for a provider. Shell closes aggregate first.
   * Optional; column detail may call this via its own buttons.
   */
  onOpenModels?: (key: ProviderUsageKey) => void;
  /**
   * Incrementing token from AppShell (e.g. before opening Models) forces close
   * without remounting provider owners / clearing projection state.
   */
  closeGeneration?: number;
  /** Optional className on the outer host wrapper. */
  className?: string;
  /** Optional style on the outer host wrapper. */
  style?: CSSProperties;
}

type TriggerTone = "success" | "warning" | "danger" | "muted";

function riskToTriggerTone(risk: ProviderUsageRisk): TriggerTone {
  if (risk === "danger") return "danger";
  if (risk === "warning") return "warning";
  if (risk === "muted") return "muted";
  return "success";
}

function StatusDot({ tone }: { tone: TriggerTone }) {
  const color =
    tone === "success"
      ? "var(--usage-dot-success, #4ade80)"
      : tone === "warning"
        ? "var(--usage-dot-warning, #fbbf24)"
        : tone === "danger"
          ? "var(--usage-dot-danger, #fb7185)"
          : "var(--usage-dot-muted, var(--text-dim))";
  return (
    <span
      aria-hidden="true"
      className="provider-usage-aggregate__dot"
      data-tone={tone}
      style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: color,
        boxShadow:
          tone === "success"
            ? "0 0 8px color-mix(in srgb, var(--usage-dot-success, #4ade80) 48%, transparent)"
            : undefined,
        flexShrink: 0,
      }}
    />
  );
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="provider-usage-trigger__spinner provider-usage-aggregate__spinner"
      style={{
        width: 10,
        height: 10,
        borderRadius: "50%",
        border: "1.5px solid rgba(148,163,184,0.35)",
        borderTopColor: "var(--accent)",
        animation: "spin 0.8s linear infinite",
        boxSizing: "border-box",
        flexShrink: 0,
      }}
    />
  );
}

function containsNode(container: HTMLElement | null, node: Node | null): boolean {
  if (!container || !node) return false;
  return container === node || container.contains(node);
}

/**
 * Aggregate top-bar shell: one hover/focus trigger + non-accordion provider columns.
 *
 * - Does not fetch accounts/quota or interpret provider schemas.
 * - Open reasons = pointer/focus inside trigger OR panel; 220ms grace close.
 * - Escape closes with focus restoration + suppression against immediate reopen.
 * - Click is not the primary toggle (focus from click may open).
 */
export function ProviderUsageAggregatePanel({
  columns,
  onOpenModels,
  closeGeneration = 0,
  className,
  style,
}: ProviderUsageAggregatePanelProps) {
  const reactId = useId();
  const panelDomId = `provider-usage-aggregate-panel-${reactId.replace(/:/g, "")}`;

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const escapeSuppressedRef = useRef(false);

  const pointerInsideTriggerRef = useRef(false);
  const pointerInsidePanelRef = useRef(false);
  const focusInsideTriggerRef = useRef(false);
  const focusInsidePanelRef = useRef(false);

  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState<{ top: number; right: number; width: number }>({
    top: 40,
    right: 12,
    width: 720,
  });

  const sortedColumns = useMemo(
    () => [...columns].sort((a, b) => a.projection.order - b.projection.order),
    [columns],
  );

  const overallRisk = useMemo(
    () => resolveOverallProviderUsageRisk(sortedColumns.map((column) => column.projection.risk)),
    [sortedColumns],
  );

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const anyOpenReason = useCallback(() => {
    return (
      pointerInsideTriggerRef.current ||
      pointerInsidePanelRef.current ||
      focusInsideTriggerRef.current ||
      focusInsidePanelRef.current
    );
  }, []);

  const closePanel = useCallback(() => {
    clearCloseTimer();
    setOpen(false);
  }, [clearCloseTimer]);

  const openPanel = useCallback(
    (reason: "pointer" | "focus" | "programmatic") => {
      if (escapeSuppressedRef.current && reason === "focus") {
        return;
      }
      clearCloseTimer();
      setOpen(true);
    },
    [clearCloseTimer],
  );

  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      if (!anyOpenReason()) {
        setOpen(false);
      }
    }, PROVIDER_USAGE_AGGREGATE_CLOSE_GRACE_MS);
  }, [anyOpenReason, clearCloseTimer]);

  const updateOpenReasonsFromDom = useCallback(() => {
    const active = document.activeElement;
    focusInsideTriggerRef.current = containsNode(triggerRef.current, active);
    focusInsidePanelRef.current = containsNode(panelRef.current, active);
  }, []);

  const handleTriggerPointerEnter = useCallback(() => {
    pointerInsideTriggerRef.current = true;
    escapeSuppressedRef.current = false;
    openPanel("pointer");
  }, [openPanel]);

  const handleTriggerPointerLeave = useCallback(() => {
    pointerInsideTriggerRef.current = false;
    scheduleClose();
  }, [scheduleClose]);

  const handlePanelPointerEnter = useCallback(() => {
    pointerInsidePanelRef.current = true;
    clearCloseTimer();
    setOpen(true);
  }, [clearCloseTimer]);

  const handlePanelPointerLeave = useCallback(() => {
    pointerInsidePanelRef.current = false;
    scheduleClose();
  }, [scheduleClose]);

  const handleTriggerFocus = useCallback(() => {
    focusInsideTriggerRef.current = true;
    openPanel("focus");
  }, [openPanel]);

  const handleTriggerBlur = useCallback(() => {
    // Clear Escape suppression on trigger blur so a later focus/pointer can open.
    escapeSuppressedRef.current = false;
    // Defer so relatedTarget / activeElement settle (portal-safe).
    window.setTimeout(() => {
      updateOpenReasonsFromDom();
      if (!anyOpenReason()) {
        scheduleClose();
      }
    }, 0);
  }, [anyOpenReason, scheduleClose, updateOpenReasonsFromDom]);

  const handlePanelFocusIn = useCallback(() => {
    focusInsidePanelRef.current = true;
    clearCloseTimer();
    setOpen(true);
  }, [clearCloseTimer]);

  const handlePanelFocusOut = useCallback(() => {
    // relatedTarget may be null with portals; re-check activeElement next frame.
    window.setTimeout(() => {
      updateOpenReasonsFromDom();
      if (!anyOpenReason()) {
        scheduleClose();
      }
    }, 0);
  }, [anyOpenReason, scheduleClose, updateOpenReasonsFromDom]);

  const handleEscape = useCallback(() => {
    if (!open) return;
    escapeSuppressedRef.current = true;
    clearCloseTimer();
    pointerInsidePanelRef.current = false;
    focusInsidePanelRef.current = false;

    const active = document.activeElement;
    const focusWasInPanel = containsNode(panelRef.current, active);
    setOpen(false);

    if (focusWasInPanel && triggerRef.current) {
      // Restore focus to trigger; suppression blocks immediate focus-reopen.
      triggerRef.current.focus();
      focusInsideTriggerRef.current = true;
    }
    // If focus already on trigger, keep it but remain suppressed until blur/pointerenter.
  }, [clearCloseTimer, open]);

  // Viewport-clamped fixed positioning.
  const recomputePanelPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const gutter = 8;
    const maxWidth = Math.min(920, Math.max(280, window.innerWidth - gutter * 2));
    // Prefer aligning to trigger right edge; clamp within viewport.
    const right = Math.max(gutter, window.innerWidth - rect.right);
    const top = Math.min(rect.bottom + 8, window.innerHeight - gutter);
    setPanelPos({ top, right, width: maxWidth });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    recomputePanelPosition();
  }, [open, recomputePanelPosition, sortedColumns.length]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => recomputePanelPosition();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, recomputePanelPosition]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        handleEscape();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [handleEscape, open]);

  // Cleanup timers / flags on unmount or column hot-switch.
  useEffect(() => {
    return () => {
      clearCloseTimer();
      escapeSuppressedRef.current = false;
      pointerInsideTriggerRef.current = false;
      pointerInsidePanelRef.current = false;
      focusInsideTriggerRef.current = false;
      focusInsidePanelRef.current = false;
    };
  }, [clearCloseTimer]);

  // Reset open state when enabled providers go empty.
  useEffect(() => {
    if (sortedColumns.length === 0 && open) {
      closePanel();
    }
  }, [closePanel, open, sortedColumns.length]);

  // External close request (Models open, config hot-switch) without remounting owners.
  const lastCloseGenerationRef = useRef(closeGeneration);
  useEffect(() => {
    if (closeGeneration === lastCloseGenerationRef.current) return;
    lastCloseGenerationRef.current = closeGeneration;
    escapeSuppressedRef.current = false;
    pointerInsideTriggerRef.current = false;
    pointerInsidePanelRef.current = false;
    focusInsideTriggerRef.current = false;
    focusInsidePanelRef.current = false;
    closePanel();
  }, [closeGeneration, closePanel]);

  if (sortedColumns.length === 0) {
    return null;
  }

  const columnCount = sortedColumns.length;

  return (
    <div
      className={["provider-usage-aggregate", className].filter(Boolean).join(" ")}
      data-open={open ? "true" : "false"}
      data-column-count={columnCount}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        height: "100%",
        flexShrink: 0,
        ...style,
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="provider-usage-trigger provider-usage-aggregate__trigger"
        data-open={open ? "true" : "false"}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelDomId}
        aria-label="模型用量"
        onPointerEnter={handleTriggerPointerEnter}
        onPointerLeave={handleTriggerPointerLeave}
        onFocus={handleTriggerFocus}
        onBlur={handleTriggerBlur}
        // Click is not primary toggle; natural focus opens. Second click does not
        // need to close — users leave via pointer/focus out or Escape.
        onClick={(event) => {
          event.stopPropagation();
          escapeSuppressedRef.current = false;
          openPanel("pointer");
        }}
        style={{
          height: 32,
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "0 10px",
          borderRadius: 999,
          // Theme tokens via CSS class; keep minimal layout styles inline.
          backdropFilter: "blur(10px)",
          cursor: "pointer",
          fontSize: 11,
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        <StatusDot tone={riskToTriggerTone(overallRisk)} />
        <span className="provider-usage-aggregate__label" style={{ fontWeight: 800, color: "var(--text)" }}>
          用量
        </span>
        <span aria-hidden="true" style={{ opacity: 0.55 }}>
          ·
        </span>
        <span className="provider-usage-aggregate__segments" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          {sortedColumns.map(({ projection }) => (
            <span
              key={projection.key}
              className="provider-usage-aggregate__segment"
              data-provider={projection.key}
              data-risk={projection.risk}
              title={projection.title}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 6px",
                borderRadius: 6,
              }}
            >
              <span style={{ fontWeight: 800, color: "var(--text-muted)" }}>{projection.label}</span>
              {projection.loading ? (
                <Spinner />
              ) : projection.ringUnit ? (
                // Trigger segments stay 30px small rings.
                <ProviderUsageRingUnitView unit={projection.ringUnit} size="small" />
              ) : (
                <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-dim)" }}>
                  {projection.fallback ?? "—"}
                </span>
              )}
            </span>
          ))}
        </span>
      </button>

      {/*
        Keep the panel DOM (and provider detail owners) mounted even when closed.
        display:none preserves React state / polling single-instance while avoiding
        hover remount races and dual fetch when reopening.
      */}
      <section
          ref={panelRef}
          id={panelDomId}
          role="dialog"
          aria-label="模型用量"
          aria-live="polite"
          aria-hidden={open ? undefined : true}
          // Non-modal: no aria-modal, no focus trap. Tab can enter columns.
          tabIndex={-1}
          className="provider-usage-aggregate__panel"
          data-open={open ? "true" : "false"}
          data-column-count={columnCount}
          hidden={!open}
          onPointerEnter={open ? handlePanelPointerEnter : undefined}
          onPointerLeave={open ? handlePanelPointerLeave : undefined}
          onFocusCapture={open ? handlePanelFocusIn : undefined}
          onBlurCapture={open ? handlePanelFocusOut : undefined}
          onClick={(event) => event.stopPropagation()}
          style={{
            position: "fixed",
            top: panelPos.top,
            right: panelPos.right,
            width: `min(${panelPos.width}px, calc(100vw - 16px))`,
            maxHeight: "calc(100vh - 120px)",
            zIndex: 900,
            display: open ? "flex" : "none",
            flexDirection: "column",
            gap: 12,
            padding: 16,
            borderRadius: 12,
            // Surface/border/shadow come from usage semantic tokens in globals.css.
            backdropFilter: "blur(20px)",
            outline: "none",
          }}
        >
          <header
            className="provider-usage-aggregate__header"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              paddingBottom: 10,
              gap: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 800, color: "var(--text)", minWidth: 0 }}>
              <span aria-hidden="true">📊</span>
              <span>模型用量</span>
              <span
                className="provider-usage-aggregate__badge"
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  borderRadius: 4,
                  padding: "2px 6px",
                  whiteSpace: "nowrap",
                }}
              >
                {columnCount} 个启用服务商
              </span>
            </div>
            <button
              type="button"
              className="provider-usage-aggregate__close"
              aria-label="关闭模型用量面板"
              onClick={() => {
                escapeSuppressedRef.current = false;
                closePanel();
                // Do not steal focus back for pointer close.
              }}
              style={{
                width: 24,
                height: 24,
                borderRadius: 6,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 14,
                flexShrink: 0,
              }}
            >
              ×
            </button>
          </header>

          <div
            className="provider-usage-aggregate__columns"
            data-columns={columnCount}
            style={{
              display: "grid",
              gap: 16,
              width: "100%",
              // Desktop 1–3 columns; media queries in globals.css refine narrow viewports.
              gridTemplateColumns: `repeat(${Math.min(3, columnCount)}, minmax(0, 1fr))`,
            }}
          >
            {sortedColumns.map(({ projection, detail }) => (
              <div
                key={projection.key}
                className="provider-usage-aggregate__column"
                data-provider={projection.key}
                data-risk={projection.risk}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  minWidth: 0,
                }}
              >
                <div
                  className="provider-usage-aggregate__column-header"
                  style={{
                    padding: 12,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, overflow: "hidden" }}>
                    <StatusDot tone={riskToTriggerTone(projection.risk)} />
                    <span
                      style={{
                        fontWeight: 800,
                        color: "var(--text)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {projection.label}
                    </span>
                    {projection.loading ? <Spinner /> : null}
                  </div>
                  {projection.ringUnit ? (
                    // Panel column header uses large 40px rings (≥ trigger 30px).
                    <ProviderUsageRingUnitView unit={projection.ringUnit} size="large" />
                  ) : (
                    <span className="provider-usage-aggregate__column-fallback">
                      {projection.fallback ?? "—"}
                    </span>
                  )}
                </div>
                <div className="provider-usage-aggregate__column-body" style={{ padding: 12, minWidth: 0 }}>
                  {detail}
                </div>
              </div>
            ))}
          </div>

          {/*
            onOpenModels is available for column details that need shell coordination.
            Shell itself does not render a "refresh all" or Models entry.
          */}
          {onOpenModels ? (
            <span className="provider-usage-aggregate__on-open-models" hidden data-has-handler="true" />
          ) : null}
        </section>
    </div>
  );
}

/** Grace delay constant re-export for tests. */
export { PROVIDER_USAGE_AGGREGATE_CLOSE_GRACE_MS };
