"use client";

import { useId, useMemo } from "react";
import type { ButtonHTMLAttributes, CSSProperties, ReactNode, Ref } from "react";
import {
  assertRingUnitCenterInvariant,
  clampUsagePercent,
  formatRingCenterValue,
  layerIdentityForIndex,
  resolveRingUnitCenterLayer,
  toneForUsagePercent,
  type ProviderUsageRingLayer,
  type ProviderUsageRingTone,
  type ProviderUsageRingUnit,
} from "./ProviderUsagePanelContract";

/** Visual tone for the full-mode status dot. */
export type ProviderUsageTriggerTone = "success" | "warning" | "danger" | "muted";

/** Top-bar density mode shared by GPT / Grok / Kiro. */
export type ProviderUsageDisplayMode = "full" | "compact";

/**
 * @deprecated Prefer ProviderUsageRingUnit.layers. Kept for transitional
 * standalone panels until USAGE-AGG-03/04/05 migrate adapters.
 */
export interface ProviderUsageCompactSummary {
  /** Short label, e.g. "5h", "月", "剩余". */
  label: string;
  /** Short value, e.g. "42%", "125M". */
  value: string;
  /** Tooltip / title text with fuller context. */
  title?: string;
}

/**
 * @deprecated Prefer ProviderUsageRingUnit. Kept for transitional standalone
 * panels that still project parallel single rings.
 */
export interface ProviderUsageRingItem {
  percent: number | null;
  label: string;
  title: string;
  color?: string;
  size?: number;
}

export interface ProviderUsageTriggerProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "color"> {
  /** Stable provider short label shown in both modes (e.g. "GPT", "Grok", "Kiro"). */
  providerLabel: string;
  /** Whether the detailed popover is open. */
  open: boolean;
  /** full = status + N-ring; compact = provider + N-ring / short fallback. */
  displayMode: ProviderUsageDisplayMode;
  /** Full-mode status tone (dot color). */
  tone?: ProviderUsageTriggerTone;
  /** Full-mode short status text (e.g. "实时", "已缓存 · 2分钟"). */
  statusText?: string;
  /** Show spinner instead of status dot (full) or beside fallback (compact). */
  loading?: boolean;
  /**
   * Preferred shared N-ring unit (outer → inner period layers). When present and
   * ringUnits is empty, Full and Compact render this single primitive.
   */
  ringUnit?: ProviderUsageRingUnit | null;
  /**
   * Independent side-by-side ring units (model groups). When length > 1, each
   * unit is rendered as its own single (or period N-ring) instance — never
   * merged into one concentric Flash/Opus unit. Takes precedence over ringUnit.
   */
  ringUnits?: readonly ProviderUsageRingUnit[] | null;
  /**
   * @deprecated Transitional parallel rings when ringUnit is absent.
   * USAGE-AGG-03/04/05 should migrate to ringUnit.
   */
  rings?: ProviderUsageRingItem[];
  /**
   * @deprecated Transitional compact text chips when ringUnit is absent.
   * Normal quota compact must use ringUnit once adapters migrate.
   */
  compactSummaries?: ProviderUsageCompactSummary[];
  /**
   * Compact short fallback when quota is unknown / login / reauth / loading.
   * Never invent 0%.
   */
  compactFallback?: string | null;
  /** Optional className on the outer button. */
  className?: string;
  /** Optional button ref for focus restore. */
  buttonRef?: Ref<HTMLButtonElement>;
  /** Extra children after the standard content (rarely needed). */
  children?: ReactNode;
}

type RingGeometrySize = "small" | "large";

interface LayerGeometry {
  radius: number;
  strokeWidth: number;
  dashArray: string | null;
}

function StatusDot({ tone }: { tone: ProviderUsageTriggerTone }) {
  const color = tone === "success"
    ? "var(--usage-dot-success, #4ade80)"
    : tone === "warning"
      ? "var(--usage-dot-warning, #fbbf24)"
      : tone === "danger"
        ? "var(--usage-dot-danger, #fb7185)"
        : "var(--usage-dot-muted, var(--text-dim))";
  return (
    <span
      aria-hidden="true"
      className="provider-usage-trigger__dot"
      data-tone={tone}
      style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: color,
        boxShadow: tone === "success" ? "0 0 8px color-mix(in srgb, var(--usage-dot-success, #4ade80) 48%, transparent)" : undefined,
        flexShrink: 0,
      }}
    />
  );
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="provider-usage-trigger__spinner"
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

function layerGeometry(layerCount: number, index: number, size: RingGeometrySize): LayerGeometry {
  // Adaptive geometry for 1 / 2 / 3+ layers (UI v6). All safe layers still render.
  if (size === "small") {
    if (layerCount <= 1) {
      return { radius: 12.5, strokeWidth: 4, dashArray: null };
    }
    if (layerCount === 2) {
      // layers[0]=outer (Solid), layers[1]=inner (Dashed)
      return index === 0
        ? { radius: 13.5, strokeWidth: 2.4, dashArray: null }
        : { radius: 10.7, strokeWidth: 2.4, dashArray: "3 1.5" };
    }
    // 3+ : outer solid, middle dashed, innermost+ dotted
    if (index === 0) return { radius: 13.8, strokeWidth: 1.8, dashArray: null };
    if (index === 1) return { radius: 11.6, strokeWidth: 1.8, dashArray: "5 2" };
    const step = Math.max(0, index - 2);
    return {
      radius: Math.max(6.5, 9.4 - step * 1.8),
      strokeWidth: 1.8,
      dashArray: "2 1.5",
    };
  }

  if (layerCount <= 1) {
    return { radius: 16.5, strokeWidth: 5, dashArray: null };
  }
  if (layerCount === 2) {
    // layers[0]=outer (Solid), layers[1]=inner (Dashed)
    return index === 0
      ? { radius: 17.5, strokeWidth: 3, dashArray: null }
      : { radius: 14.0, strokeWidth: 3, dashArray: "4 2" };
  }
  // 3+ : outer solid, middle dashed, innermost+ dotted
  if (index === 0) return { radius: 18.0, strokeWidth: 2.4, dashArray: null };
  if (index === 1) return { radius: 15.2, strokeWidth: 2.4, dashArray: "6 2.5" };
  const step = Math.max(0, index - 2);
  return {
    radius: Math.max(8, 12.4 - step * 2.1),
    strokeWidth: 2.2,
    dashArray: "3 2",
  };
}

/** small = aggregate/compact trigger 30px; large = panel header / full mode target 40px (geometry ≥38). */
function ringBoxSize(size: RingGeometrySize): number {
  return size === "small" ? 30 : 40;
}

function centerMaskSize(layerCount: number, size: RingGeometrySize): number {
  // Original UI v6 geometry: center disc sized for readable label + percent
  // while leaving a clear used-arc rim (matches pre-regression aggregate look).
  if (size === "small") {
    if (layerCount <= 1) return 21;
    if (layerCount === 2) return 18.5;
    return 15.5;
  }
  if (layerCount <= 1) return 27;
  if (layerCount === 2) return 23.5;
  return 21.5;
}

function usedStrokeForLayer(tone: ProviderUsageRingTone, index: number): string {
  if (tone === "danger") return "var(--provider-usage-ring-danger, #ef4444)";
  if (tone === "warning") return "var(--provider-usage-ring-warning, #eab308)";
  if (tone === "muted") return "rgba(148, 163, 184, 0.35)";
  // Layer identity hues (second channel is warning/danger above).
  if (index <= 0) return "var(--provider-usage-ring-layer-0, #06b6d4)";
  if (index === 1) return "var(--provider-usage-ring-layer-1, #8b5cf6)";
  return "var(--provider-usage-ring-layer-2, #ec4899)";
}

function LegacyUsageRing({
  percent,
  label,
  title,
  color,
  size = 17,
}: ProviderUsageRingItem) {
  const utilization = percent === null ? 0 : Math.min(Math.max(percent, 0), 100);
  const ringColor = percent === null
    ? "var(--text-dim)"
    : (color ?? (utilization >= 95 ? "#ef4444" : utilization >= 80 ? "#eab308" : "var(--accent)"));
  const background = percent === null
    ? "conic-gradient(rgba(148,163,184,0.25) 0deg, rgba(148,163,184,0.25) 360deg)"
    : `conic-gradient(${ringColor} ${utilization * 3.6}deg, rgba(148,163,184,0.18) 0deg)`;

  return (
    <span
      title={title}
      className="provider-usage-trigger__ring provider-usage-trigger__ring--legacy"
      style={{ display: "inline-flex", alignItems: "center", gap: 3 }}
    >
      <span
        aria-hidden="true"
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background,
          border: "1px solid rgba(148,163,184,0.35)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          boxSizing: "border-box",
        }}
      >
        <span
          style={{
            width: Math.max(6, Math.floor(size * 0.48)),
            height: Math.max(6, Math.floor(size * 0.48)),
            borderRadius: "50%",
            background: "var(--bg-panel)",
            opacity: 0.92,
          }}
        />
      </span>
      <span style={{ fontSize: 9, color: "var(--text-dim)", fontWeight: 700 }}>
        {percent === null ? `${label} —` : `${label} ${Math.round(utilization)}%`}
      </span>
    </span>
  );
}

export interface ProviderUsageRingUnitViewProps {
  unit: ProviderUsageRingUnit;
  /** small = compact / aggregate trigger; large = full standalone. */
  size?: RingGeometrySize;
  className?: string;
  style?: CSSProperties;
  /** Optional decorative short value rendered after the unit (e.g. remaining). */
  showShortValue?: boolean;
}

/**
 * Shared N-ring primitive used by Full, Compact, and aggregate trigger segments.
 * Renders all safe layers (no +N truncation). Center is always the outermost
 * priority-short layer (layers[0] / centerLayerId) — never silent-fallback.
 */
export function ProviderUsageRingUnitView({
  unit,
  size = "small",
  className,
  style,
  showShortValue = true,
}: ProviderUsageRingUnitViewProps) {
  const reactId = useId().replace(/:/g, "");
  const layers = unit.layers;
  const layerCount = layers.length;

  // Resolve by centerLayerId and fail loud on drift — never silent-fallback to last layer.
  if (process.env.NODE_ENV !== "production") {
    assertRingUnitCenterInvariant(unit);
  }
  const centerLayer = resolveRingUnitCenterLayer(unit);
  const centerLabel = centerLayer.shortLabel;
  const centerValue = formatRingCenterValue(centerLayer.percent, unit.unknownCenterValue);
  const box = ringBoxSize(size);
  const cx = box / 2;
  const cy = box / 2;
  const mask = centerMaskSize(layerCount, size);
  const fontLabel = size === "small" ? 8 : 10;
  const fontVal = size === "small" ? 7 : 9;

  const layerMeta = useMemo(
    () =>
      layers.map((layer, index) => {
        const percent = clampUsagePercent(layer.percent);
        const tone = toneForUsagePercent(percent);
        const geometry = layerGeometry(layerCount, index, size);
        const identity = layerIdentityForIndex(index);
        return { layer, index, percent, tone, geometry, identity };
      }),
    [layerCount, layers, size],
  );

  return (
    <span
      className={["provider-usage-ring-unit", `provider-usage-ring-unit--${size}`, className]
        .filter(Boolean)
        .join(" ")}
      data-layer-count={layerCount}
      data-center-layer-id={unit.centerLayerId}
      title={unit.ariaLabel}
      role="img"
      aria-label={unit.ariaLabel}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        verticalAlign: "middle",
        ...style,
      }}
    >
      <span
        className="provider-usage-ring-unit__canvas"
        style={{
          position: "relative",
          width: box,
          height: box,
          flexShrink: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg
          width={box}
          height={box}
          viewBox={`0 0 ${box} ${box}`}
          className="provider-usage-ring-unit__svg"
          aria-hidden="true"
          focusable="false"
        >
          <defs>
            {layerMeta.map(({ layer, index, percent, geometry }) => {
              if (percent === null || percent <= 0) return null;
              const circ = 2 * Math.PI * geometry.radius;
              const usedLen = (percent / 100) * circ;
              const maskId = `pu-mask-${reactId}-${index}-${layer.id}`;
              return (
                <mask
                  key={maskId}
                  id={maskId}
                  maskUnits="userSpaceOnUse"
                  x={0}
                  y={0}
                  width={box}
                  height={box}
                >
                  <rect x={0} y={0} width={box} height={box} fill="black" />
                  <circle
                    cx={cx}
                    cy={cy}
                    r={geometry.radius}
                    fill="none"
                    stroke="white"
                    strokeWidth={geometry.strokeWidth + 0.2}
                    strokeDasharray={`${usedLen} ${circ}`}
                    transform={`rotate(-90 ${cx} ${cy})`}
                  />
                </mask>
              );
            })}
          </defs>

          {layerMeta.map(({ layer, index, percent, tone, geometry, identity }) => {
            const trackStroke =
              percent === null
                ? "rgba(148, 163, 184, 0.25)"
                : "rgba(148, 163, 184, 0.12)";
            const dashProps = geometry.dashArray
              ? { strokeDasharray: geometry.dashArray }
              : {};
            const usedStroke = usedStrokeForLayer(tone, index);
            const maskId = `pu-mask-${reactId}-${index}-${layer.id}`;
            const showUsed = percent !== null && percent > 0;

            return (
              <g
                key={`${layer.id}:${index}`}
                className="provider-usage-ring-unit__layer"
                data-layer-id={layer.id}
                data-layer-index={index}
                data-layer-identity={identity}
                data-tone={tone}
                data-percent={percent === null ? "unknown" : String(Math.round(percent))}
              >
                {/* Track — layer identity via stroke style, muted when unknown. */}
                <circle
                  className="provider-usage-ring-unit__track"
                  cx={cx}
                  cy={cy}
                  r={geometry.radius}
                  fill="none"
                  stroke={trackStroke}
                  strokeWidth={geometry.strokeWidth}
                  {...dashProps}
                  transform={`rotate(-90 ${cx} ${cy})`}
                />
                {showUsed ? (
                  <g mask={`url(#${maskId})`}>
                    <circle
                      className="provider-usage-ring-unit__used"
                      cx={cx}
                      cy={cy}
                      r={geometry.radius}
                      fill="none"
                      stroke={usedStroke}
                      strokeWidth={geometry.strokeWidth}
                      {...dashProps}
                      transform={`rotate(-90 ${cx} ${cy})`}
                    />
                    {/* CSS-only sheen; mask limits flow to used arc. */}
                    <circle
                      className="provider-usage-ring-unit__sheen sheen-flow"
                      cx={cx}
                      cy={cy}
                      r={geometry.radius}
                      fill="none"
                      stroke="rgba(255, 255, 255, 0.45)"
                      strokeWidth={geometry.strokeWidth + 0.1}
                      strokeDasharray="15 30"
                      transform={`rotate(-90 ${cx} ${cy})`}
                    />
                  </g>
                ) : null}
              </g>
            );
          })}
        </svg>

        <span
          className="provider-usage-ring-unit__center"
          aria-hidden="true"
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: mask,
            height: mask,
            borderRadius: "50%",
            // Theme-aware center fill — never a fixed night surface.
            background: "var(--usage-center-bg, var(--bg-panel))",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            lineHeight: 1.05,
            pointerEvents: "none",
            zIndex: 2,
            overflow: "visible",
          }}
        >
          <span
            className="provider-usage-ring-unit__center-label"
            style={{
              fontWeight: 800,
              fontSize: fontLabel,
              color: "var(--usage-center-label, var(--text))",
              textTransform: "uppercase",
            }}
          >
            {centerLabel}
          </span>
          <span
            className="provider-usage-ring-unit__center-value"
            data-unknown={centerLayer.percent === null ? "true" : "false"}
            style={{
              fontWeight: 700,
              fontSize: fontVal,
              color: "var(--usage-center-value, var(--text-muted))",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {centerValue}
          </span>
        </span>
      </span>

      {showShortValue && unit.shortValue ? (
        <span
          className="provider-usage-ring-unit__short-value"
          style={{ fontSize: 9, fontWeight: 700, color: "var(--text-dim)" }}
        >
          {unit.shortValue}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Pure provider-neutral top-bar usage trigger.
 *
 * Owns only presentation for full/compact density. Provider panels keep their
 * own accounts/quota/popover state machines and pass pre-projected props here.
 * Prefer ringUnit for Full/Compact/aggregate; legacy rings/summaries remain for
 * transitional adapters until USAGE-AGG-03/04/05 complete.
 */
export function ProviderUsageTrigger({
  providerLabel,
  open,
  displayMode,
  tone = "muted",
  statusText,
  loading = false,
  ringUnit = null,
  ringUnits = null,
  rings = [],
  compactSummaries = [],
  compactFallback = null,
  className,
  buttonRef,
  children,
  type = "button",
  style,
  ...buttonProps
}: ProviderUsageTriggerProps) {
  const isCompact = displayMode === "compact";
  // Prefer independent multi-unit slots (model groups) over single ringUnit.
  const resolvedRingUnits: ProviderUsageRingUnit[] =
    ringUnits && ringUnits.length > 0
      ? [...ringUnits]
      : ringUnit && ringUnit.layers.length > 0
        ? [ringUnit]
        : [];
  const hasRingUnit = resolvedRingUnits.length > 0;
  const multiIndependent = resolvedRingUnits.length > 1;
  const summaries = compactSummaries.slice(0, 2);
  const showCompactFallback =
    isCompact && !hasRingUnit && summaries.length === 0 && Boolean(compactFallback);
  const ringSize: RingGeometrySize = isCompact ? "small" : "large";

  const ringRow = hasRingUnit ? (
    <span
      className="provider-usage-trigger__ring-units"
      data-ring-count={resolvedRingUnits.length}
      data-multi-independent={multiIndependent ? "true" : "false"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: multiIndependent ? 4 : 0,
        flexShrink: 0,
      }}
    >
      {resolvedRingUnits.map((unit, index) => {
        const short = unit.layers[0]?.shortLabel?.trim() || "";
        const showMiniLabel = multiIndependent && short.length > 0;
        return (
          <span
            key={`${unit.centerLayerId}:${index}`}
            className="provider-usage-trigger__ring-slot"
            data-ring-slot={index}
            data-center-layer={unit.centerLayerId}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              flexShrink: 0,
            }}
          >
            {showMiniLabel ? (
              <span
                className="provider-usage-trigger__ring-slot-label"
                style={{
                  fontSize: isCompact ? 9 : 10,
                  fontWeight: 700,
                  color: "var(--text-dim)",
                  lineHeight: 1,
                }}
              >
                {short}
              </span>
            ) : null}
            <ProviderUsageRingUnitView unit={unit} size={ringSize} />
          </span>
        );
      })}
    </span>
  ) : null;

  return (
    <button
      {...buttonProps}
      ref={buttonRef}
      type={type}
      className={["provider-usage-trigger", isCompact ? "provider-usage-trigger--compact" : "provider-usage-trigger--full", className]
        .filter(Boolean)
        .join(" ")}
      data-display-mode={displayMode}
      data-open={open ? "true" : "false"}
      data-has-ring-unit={hasRingUnit ? "true" : "false"}
      data-ring-count={resolvedRingUnits.length}
      data-multi-independent={multiIndependent ? "true" : "false"}
      aria-expanded={open}
      style={{
        height: hasRingUnit ? 32 : 26,
        display: "flex",
        alignItems: "center",
        gap: isCompact ? 5 : 7,
        padding: isCompact ? "0 8px" : "0 9px",
        borderRadius: 999,
        border: open
          ? "1px solid color-mix(in srgb, var(--accent) 58%, transparent)"
          : "1px solid var(--usage-panel-border, var(--border))",
        background: open
          ? "color-mix(in srgb, var(--accent) 10%, transparent)"
          : "var(--usage-segment-bg, var(--bg-subtle))",
        backdropFilter: "blur(10px)",
        color: "var(--text-muted)",
        cursor: "pointer",
        fontSize: 11,
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
        flexShrink: 0,
        ...style,
      }}
    >
      <span className="provider-usage-trigger__label" style={{ fontWeight: 800, color: "var(--text)" }}>
        {providerLabel}
      </span>

      {!isCompact && (
        <>
          {(statusText || loading) && (
            <span className="provider-usage-trigger__status" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              {loading ? <Spinner /> : <StatusDot tone={tone} />}
              {statusText ? <span>{statusText}</span> : null}
            </span>
          )}
          {hasRingUnit ? (
            ringRow
          ) : (
            rings.map((ring) => (
              <LegacyUsageRing key={`${ring.label}:${ring.title}`} {...ring} />
            ))
          )}
        </>
      )}

      {isCompact && (
        <span className="provider-usage-trigger__compact" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          {loading && !hasRingUnit && summaries.length === 0 ? <Spinner /> : null}
          {hasRingUnit ? (
            <>
              {loading ? <Spinner /> : null}
              {ringRow}
            </>
          ) : summaries.length > 0 ? (
            <span className="provider-usage-trigger__summaries" style={{ display: "inline-flex", alignItems: "center", gap: 0, fontSize: 10, color: "var(--text-dim)", fontWeight: 700 }}>
              {summaries.map((item, index) => (
                <span key={`${item.label}:${item.value}:${index}`} style={{ display: "inline-flex", alignItems: "center" }}>
                  {index > 0 ? (
                    <span aria-hidden="true" style={{ margin: "0 4px", opacity: 0.55 }}>·</span>
                  ) : null}
                  <span title={item.title ?? `${item.label} ${item.value}`} className="provider-usage-trigger__summary">
                    {item.label ? `${item.label} ${item.value}` : item.value}
                  </span>
                </span>
              ))}
            </span>
          ) : showCompactFallback ? (
            <span className="provider-usage-trigger__fallback" style={{ fontSize: 10, color: "var(--text-dim)", fontWeight: 700 }}>
              {compactFallback}
            </span>
          ) : null}
        </span>
      )}

      {children}
    </button>
  );
}

// Re-export contract helpers used by adapters and tests.
export type {
  ProviderUsageRingLayer,
  ProviderUsageRingTone,
  ProviderUsageRingUnit,
};
