"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface SelectDropdownOption {
  value: string;
  label: string;
  meta?: string;
  description?: string;
  group?: string;
  disabled?: boolean;
}

interface Props {
  value: string;
  options: SelectDropdownOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  triggerLabel?: string;
  placeholder?: string;
  ariaLabel?: string;
  title?: string;
  icon?: ReactNode;
  /** compact = chat toolbar pill; field = settings form; toolbar = dense bordered control (e.g. Usage filters). */
  size?: "compact" | "field" | "toolbar";
  placement?: "above" | "below" | "auto";
  minWidth?: number;
}

interface PanelPosition {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
}

const PANEL_MARGIN = 8;
const PANEL_GAP = 6;
const MAX_PANEL_HEIGHT = 320;
const MIN_PANEL_HEIGHT = 120;

function groupLabel(option: SelectDropdownOption): string {
  return option.group ?? "Options";
}

export function SelectDropdown({
  value,
  options,
  onChange,
  disabled = false,
  triggerLabel,
  placeholder = "Select",
  ariaLabel = "Select option",
  title,
  icon,
  size = "field",
  placement = "auto",
  minWidth,
}: Props) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [panelPosition, setPanelPosition] = useState<PanelPosition | null>(null);

  const enabledOptions = useMemo(() => options.filter((option) => !option.disabled), [options]);
  const selectedOption = options.find((option) => option.value === value);
  const displayedLabel = triggerLabel ?? selectedOption?.label ?? placeholder;

  const groupedOptions = useMemo(() => {
    const groups: { label: string; options: SelectDropdownOption[] }[] = [];
    for (const option of options) {
      const label = groupLabel(option);
      const group = groups.find((item) => item.label === label);
      if (group) group.options.push(option);
      else groups.push({ label, options: [option] });
    }
    return groups;
  }, [options]);

  const optionIndex = useCallback((target: SelectDropdownOption) => options.findIndex((option) => option.value === target.value), [options]);

  const updatePanelPosition = useCallback(() => {
    if (typeof window === "undefined") return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
    const availableAbove = Math.max(0, rect.top - PANEL_MARGIN - PANEL_GAP);
    const availableBelow = Math.max(0, viewportHeight - rect.bottom - PANEL_MARGIN - PANEL_GAP);
    const shouldOpenAbove = placement === "above" || (placement === "auto" && availableAbove > availableBelow && availableBelow < MIN_PANEL_HEIGHT);
    const available = shouldOpenAbove ? availableAbove : availableBelow;
    const width = Math.max(
      rect.width,
      minWidth ?? (size === "compact" ? 180 : size === "toolbar" ? 160 : 220),
    );
    const left = Math.min(Math.max(PANEL_MARGIN, rect.right - width), Math.max(PANEL_MARGIN, viewportWidth - width - PANEL_MARGIN));
    const maxHeight = Math.max(100, Math.min(MAX_PANEL_HEIGHT, Math.max(MIN_PANEL_HEIGHT, available)));

    setPanelPosition({
      left,
      width,
      maxHeight,
      ...(shouldOpenAbove
        ? { bottom: viewportHeight - rect.top + PANEL_GAP }
        : { top: rect.bottom + PANEL_GAP }),
    });
  }, [minWidth, placement, size]);

  const close = useCallback(() => {
    setOpen(false);
    setHighlightedIndex(0);
  }, []);

  const openPanel = useCallback(() => {
    if (disabled) return;
    const activeIndex = Math.max(0, options.findIndex((option) => option.value === value && !option.disabled));
    setHighlightedIndex(activeIndex);
    setOpen(true);
    updatePanelPosition();
  }, [disabled, options, updatePanelPosition, value]);

  const selectOption = useCallback((option: SelectDropdownOption) => {
    if (option.disabled) return;
    if (option.value !== value) onChange(option.value);
    close();
    triggerRef.current?.focus();
  }, [close, onChange, value]);

  useEffect(() => {
    if (!open) return;
    updatePanelPosition();
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      close();
    };
    const handleReposition = () => updatePanelPosition();
    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [close, open, updatePanelPosition]);

  const highlightedOption = options[highlightedIndex] && !options[highlightedIndex].disabled
    ? options[highlightedIndex]
    : enabledOptions[0];

  const triggerIsActive = open || hovered;
  const triggerStyle: React.CSSProperties =
    size === "compact"
      ? {
          display: "flex",
          alignItems: "center",
          gap: 5,
          padding: "8px 12px",
          height: 32,
          background: triggerIsActive ? "var(--bg-hover)" : "none",
          border: "none",
          borderRadius: 9,
          color: triggerIsActive ? "var(--text)" : "var(--text-muted)",
          cursor: disabled ? "not-allowed" : "pointer",
          fontSize: 12,
          opacity: disabled ? 0.5 : 1,
          transition: "background 0.12s, color 0.12s",
        }
      : size === "toolbar"
        ? {
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 26,
            minWidth: minWidth ?? 128,
            padding: "0 9px",
            background: triggerIsActive ? "var(--bg-hover)" : "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 7,
            color: "var(--text)",
            cursor: disabled ? "not-allowed" : "pointer",
            fontSize: 11,
            opacity: disabled ? 0.6 : 1,
            boxSizing: "border-box",
            textAlign: "left",
            transition: "background 0.12s, border-color 0.12s",
          }
        : {
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            minHeight: 34,
            padding: "7px 9px",
            background: triggerIsActive ? "var(--bg-hover)" : "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 7,
            color: "var(--text)",
            cursor: disabled ? "not-allowed" : "pointer",
            fontSize: 12,
            opacity: disabled ? 0.6 : 1,
            boxSizing: "border-box",
            textAlign: "left",
            transition: "background 0.12s, border-color 0.12s",
          };

  const panel = open && panelPosition ? (
    <div
      ref={panelRef}
      role="listbox"
      aria-label={ariaLabel}
      style={{
        position: "fixed",
        zIndex: 2000,
        left: panelPosition.left,
        top: panelPosition.top,
        bottom: panelPosition.bottom,
        width: panelPosition.width,
        maxHeight: panelPosition.maxHeight,
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        boxShadow: "0 16px 40px rgba(15,23,42,0.18), 0 4px 14px rgba(15,23,42,0.10)",
        overflowY: "auto",
        padding: 6,
      }}
    >
      {groupedOptions.map((group) => (
        <div key={group.label}>
          {groupedOptions.length > 1 && (
            <div style={{ padding: "7px 8px 4px", fontSize: 10, fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
              {group.label}
            </div>
          )}
          {group.options.map((option) => {
            const selected = option.value === value;
            const index = optionIndex(option);
            const highlighted = highlightedOption?.value === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                disabled={option.disabled}
                onMouseEnter={() => setHighlightedIndex(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  selectOption(option);
                }}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "7px 9px",
                  border: "none",
                  borderRadius: 8,
                  background: selected ? "var(--accent)" : highlighted ? "var(--bg-hover)" : "transparent",
                  color: selected ? "#fff" : option.disabled ? "var(--text-dim)" : "var(--text-muted)",
                  cursor: option.disabled ? "not-allowed" : "pointer",
                  fontSize: 12,
                  fontWeight: selected ? 700 : 500,
                  textAlign: "left",
                  whiteSpace: "nowrap",
                  opacity: option.disabled ? 0.6 : 1,
                }}
              >
                {selected ? (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <polyline points="1.5 5 4 7.5 8.5 2.5" />
                  </svg>
                ) : (
                  <span style={{ width: 10, flexShrink: 0 }} />
                )}
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {option.label}
                  {option.meta && <span style={{ fontSize: 10, color: selected ? "rgba(255,255,255,0.78)" : "var(--text-dim)", fontFamily: "var(--font-mono)", marginLeft: 5 }}>{option.meta}</span>}
                </span>
                {option.description && <span style={{ fontSize: 11, color: selected ? "rgba(255,255,255,0.78)" : "var(--text-dim)", marginLeft: 8 }}>{option.description}</span>}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={title}
        disabled={disabled}
        onClick={() => {
          if (open) close();
          else openPanel();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            close();
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (!open) {
              openPanel();
              return;
            }
            if (highlightedOption) selectOption(highlightedOption);
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            if (!open) {
              openPanel();
              return;
            }
            const currentEnabledIndex = Math.max(0, enabledOptions.findIndex((option) => option.value === highlightedOption?.value));
            const next = enabledOptions[Math.min(enabledOptions.length - 1, currentEnabledIndex + 1)];
            if (next) setHighlightedIndex(optionIndex(next));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) {
              openPanel();
              return;
            }
            const currentEnabledIndex = Math.max(0, enabledOptions.findIndex((option) => option.value === highlightedOption?.value));
            const next = enabledOptions[Math.max(0, currentEnabledIndex - 1)];
            if (next) setHighlightedIndex(optionIndex(next));
          } else if (event.key === "Tab") {
            close();
          }
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={triggerStyle}
      >
        {icon}
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayedLabel}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.7 }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {typeof document !== "undefined" && panel ? createPortal(panel, document.body) : panel}
    </>
  );
}
