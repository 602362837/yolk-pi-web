"use client";

import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

/** Visual tone for the full-mode status dot. */
export type ProviderUsageTriggerTone = "success" | "warning" | "danger" | "muted";

/** Top-bar density mode shared by GPT / Grok / Kiro. */
export type ProviderUsageDisplayMode = "full" | "compact";

/** Compact quota summary chip (provider-neutral; at most two shown). */
export interface ProviderUsageCompactSummary {
  /** Short label, e.g. "5h", "月", "剩余". */
  label: string;
  /** Short value, e.g. "42%", "125M". */
  value: string;
  /** Tooltip / title text with fuller context. */
  title?: string;
}

/** Ring item for full-mode trigger (provider-owned utilization). */
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
  /** full = status + rings; compact = provider + ≤2 summaries / short fallback. */
  displayMode: ProviderUsageDisplayMode;
  /** Full-mode status tone (dot color). */
  tone?: ProviderUsageTriggerTone;
  /** Full-mode short status text (e.g. "实时", "已缓存 · 2分钟"). */
  statusText?: string;
  /** Show spinner instead of status dot (full) or beside fallback (compact). */
  loading?: boolean;
  /** Full-mode ring items (provider-specific windows / buckets). */
  rings?: ProviderUsageRingItem[];
  /**
   * Compact-mode key quota summaries. At most two are rendered.
   * When empty and no compactFallback, only the provider label is shown.
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

function StatusDot({ tone }: { tone: ProviderUsageTriggerTone }) {
  const color = tone === "success"
    ? "#4ade80"
    : tone === "warning"
      ? "#fbbf24"
      : tone === "danger"
        ? "#fb7185"
        : "var(--text-dim)";
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
        boxShadow: tone === "success" ? "0 0 8px rgba(74,222,128,0.48)" : undefined,
        flexShrink: 0,
      }}
    />
  );
}

function UsageRing({
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
      className="provider-usage-trigger__ring"
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

/**
 * Pure provider-neutral top-bar usage trigger.
 *
 * Owns only presentation for full/compact density. Provider panels keep their
 * own accounts/quota/popover state machines and pass pre-projected props here.
 */
export function ProviderUsageTrigger({
  providerLabel,
  open,
  displayMode,
  tone = "muted",
  statusText,
  loading = false,
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
  const summaries = compactSummaries.slice(0, 2);
  const showCompactFallback = isCompact && summaries.length === 0 && Boolean(compactFallback);

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
      aria-expanded={open}
      style={{
        height: 26,
        display: "flex",
        alignItems: "center",
        gap: isCompact ? 5 : 7,
        padding: isCompact ? "0 8px" : "0 9px",
        borderRadius: 999,
        border: open ? "1px solid rgba(96,165,250,0.58)" : "1px solid rgba(148,163,184,0.28)",
        background: open ? "rgba(96,165,250,0.08)" : "rgba(15,23,42,0.10)",
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
          {rings.map((ring) => (
            <UsageRing key={`${ring.label}:${ring.title}`} {...ring} />
          ))}
        </>
      )}

      {isCompact && (
        <span className="provider-usage-trigger__compact" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          {loading && summaries.length === 0 ? <Spinner /> : null}
          {summaries.length > 0 ? (
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
