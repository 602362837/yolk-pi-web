"use client";

import { useId, type ReactNode, type SVGAttributes } from "react";

export type ActionFlowIconProps = {
  /** Pure geometry nodes (path/line/rect/circle/polyline). Rendered twice as base + overlay. */
  children: ReactNode;
  viewBox?: string;
  width?: number | string;
  height?: number | string;
  className?: string;
  strokeWidth?: number | string;
  /** Extra width for the decorative gradient overlay stroke. */
  overlayStrokeWidth?: number | string;
} & Omit<
  SVGAttributes<SVGSVGElement>,
  "children" | "viewBox" | "width" | "height" | "className" | "strokeWidth" | "aria-hidden" | "focusable"
>;

/**
 * Shared inline SVG primitive: currentColor base stroke + per-instance gradient
 * dashed overlay. Motion is CSS-only via `.action-flow-icon__overlay` dash offset.
 *
 * Opt-in contract: the host must set `data-icon-flow` ("interactive" | "ambient" |
 * "off"), typically via `iconFlowAttrs(mode)`. Without a host attr, the overlay
 * stays hidden — this component alone does not animate. Prefer pairing every
 * ActionFlowIcon used for flow with an explicit host attr; use "off" when disabled.
 * Failures hide the overlay; base stroke remains readable.
 */
export function ActionFlowIcon({
  children,
  viewBox = "0 0 24 24",
  width = 14,
  height = 14,
  className,
  strokeWidth = 2,
  overlayStrokeWidth,
  style,
  ...svgProps
}: ActionFlowIconProps) {
  const reactId = useId();
  // useId can include ":" which is invalid/awkward inside url(#...); keep URL-safe.
  const gradientId = `afi-grad-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const baseWidth = strokeWidth;
  const flowWidth =
    overlayStrokeWidth ??
    (typeof strokeWidth === "number" ? strokeWidth + 0.55 : `calc(${strokeWidth} + 0.55px)`);

  return (
    <svg
      {...svgProps}
      className={["action-flow-icon", className].filter(Boolean).join(" ")}
      width={width}
      height={height}
      viewBox={viewBox}
      fill="none"
      aria-hidden="true"
      focusable="false"
      style={{ overflow: "visible", flexShrink: 0, display: "block", ...style }}
    >
      <defs>
        <linearGradient
          id={gradientId}
          x1="0"
          y1="0"
          x2="24"
          y2="24"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="var(--icon-flow-a)" />
          <stop offset="0.5" stopColor="var(--icon-flow-b)" />
          <stop offset="1" stopColor="var(--icon-flow-c)" />
        </linearGradient>
      </defs>
      <g
        className="action-flow-icon__base"
        fill="none"
        stroke="currentColor"
        strokeWidth={baseWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </g>
      <g
        className="action-flow-icon__overlay"
        aria-hidden="true"
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth={flowWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </g>
    </svg>
  );
}
