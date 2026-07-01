"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { DiffView, type DiffMode } from "./DiffView";

interface Props {
  ariaLabel: string;
  header: ReactNode;
  loading: boolean;
  error: string | null;
  diff?: string;
  fallback: ReactNode;
  onClose: () => void;
  loadingLabel?: string;
  overlayStyle?: CSSProperties;
  panelStyle?: CSSProperties;
}

const modeLabels: Record<DiffMode, string> = {
  "side-by-side": "并排模式 / Side-by-side",
  unified: "统一模式 / Unified",
};

function ModeButton({ mode, selected, onSelect, disabled }: { mode: DiffMode; selected: boolean; onSelect: (mode: DiffMode) => void; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(mode)}
      disabled={disabled}
      aria-pressed={selected}
      style={{
        border: "1px solid var(--border)",
        background: selected ? "var(--accent)" : "var(--bg)",
        color: selected ? "white" : "var(--text-muted)",
        borderRadius: 7,
        padding: "5px 9px",
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: 11,
        fontWeight: selected ? 700 : 500,
        opacity: disabled ? 0.55 : 1,
        whiteSpace: "nowrap",
      }}
    >
      {modeLabels[mode]}
    </button>
  );
}

export function DiffModal({
  ariaLabel,
  header,
  loading,
  error,
  diff,
  fallback,
  onClose,
  loadingLabel = "Loading diff...",
  overlayStyle,
  panelStyle,
}: Props) {
  const [mode, setMode] = useState<DiffMode>("side-by-side");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const hasDiff = Boolean(diff);
  const diffBodyOverflow = mode === "side-by-side" && hasDiff ? "hidden" : "auto";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      style={{
        position: "fixed",
        inset: 16,
        zIndex: 1000,
        display: "flex",
        alignItems: "stretch",
        justifyContent: "center",
        background: "rgba(0,0,0,0.42)",
        borderRadius: 14,
        ...overlayStyle,
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "min(1440px, 100%)",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          border: "1px solid var(--border)",
          borderRadius: 14,
          background: "var(--bg-panel)",
          color: "var(--text)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.35)",
          overflow: "hidden",
          ...panelStyle,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 16px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ minWidth: 0, flex: 1 }}>{header}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <ModeButton mode="side-by-side" selected={mode === "side-by-side"} onSelect={setMode} disabled={!hasDiff} />
            <ModeButton mode="unified" selected={mode === "unified"} onSelect={setMode} disabled={!hasDiff} />
            <button
              type="button"
              onClick={onClose}
              aria-label="Close diff"
              style={{
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "var(--text)",
                borderRadius: 8,
                padding: "6px 10px",
                cursor: "pointer",
              }}
            >
              Close
            </button>
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: diffBodyOverflow, background: "var(--bg)" }}>
          {loading ? (
            <div style={{ padding: 18, color: "var(--text-muted)", fontSize: 13 }}>{loadingLabel}</div>
          ) : error ? (
            <div style={{ padding: 18, color: "#dc2626", fontSize: 13 }}>{error}</div>
          ) : diff ? (
            <DiffView diff={diff} mode={mode} />
          ) : (
            <div style={{ padding: 18, color: "var(--text-muted)", fontSize: 13 }}>
              {fallback}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
