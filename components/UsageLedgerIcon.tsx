import type { ReactNode } from "react";
import { ActionFlowIcon } from "./ActionFlowIcon";

/**
 * Shared "line-chart + trend" geometry for the global Usage entry.
 * Keep sidebar and modal header on the same path set to avoid icon drift.
 */
export function UsageLedgerIconGeometry(): ReactNode {
  return (
    <>
      <path d="M3 18l5-6 4 3 7-9" />
      <path d="M18 6h1v1" />
      <path d="M4 21h17" />
    </>
  );
}

/** Sidebar / action-flow host icon. */
export function UsageLedgerFlowIcon({
  width = 14,
  height = 14,
  strokeWidth = 2,
}: {
  width?: number;
  height?: number;
  strokeWidth?: number;
}) {
  return (
    <ActionFlowIcon width={width} height={height} strokeWidth={strokeWidth}>
      <UsageLedgerIconGeometry />
    </ActionFlowIcon>
  );
}

/** Modal header static icon (accent stroke, no flow host required). */
export function UsageLedgerHeaderIcon({
  width = 16,
  height = 16,
  color = "var(--accent)",
}: {
  width?: number;
  height?: number;
  color?: string;
}) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0, display: "block" }}
    >
      <UsageLedgerIconGeometry />
    </svg>
  );
}
