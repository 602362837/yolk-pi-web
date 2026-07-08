"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface ModelSelectOption {
  value: string;
  label: string;
  detail?: string;
  provider?: string;
  modelId?: string;
  group?: string;
  keywords?: string[];
}

interface Props {
  value: string;
  options: ModelSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  fallbackLabel?: string | null;
  ariaLabel?: string;
  size?: "compact" | "field";
  placement?: "above" | "below" | "auto";
}

interface PanelPosition {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
}

interface ScoredOption {
  option: ModelSelectOption;
  index: number;
  score: number;
}

const PANEL_MARGIN = 8;
const PANEL_GAP = 6;
const MIN_PANEL_HEIGHT = 180;
const MAX_PANEL_HEIGHT = 380;

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s_./:-]+/g, " ")
    .trim();
}

function compactSearchText(value: string): string {
  return normalizeSearchText(value).replace(/\s+/g, "");
}

function subsequenceScore(query: string, target: string): number | null {
  if (!query) return 0;
  const compactQuery = compactSearchText(query);
  const compactTarget = compactSearchText(target);
  if (!compactQuery) return 0;
  if (!compactTarget) return null;

  const exactIndex = compactTarget.indexOf(compactQuery);
  if (exactIndex >= 0) {
    return 4000 - exactIndex * 8 - Math.max(0, compactTarget.length - compactQuery.length);
  }

  let queryIndex = 0;
  let firstMatch = -1;
  let lastMatch = -1;
  let gapPenalty = 0;

  for (let targetIndex = 0; targetIndex < compactTarget.length && queryIndex < compactQuery.length; targetIndex += 1) {
    if (compactTarget[targetIndex] !== compactQuery[queryIndex]) continue;
    if (firstMatch === -1) firstMatch = targetIndex;
    if (lastMatch >= 0) gapPenalty += Math.max(0, targetIndex - lastMatch - 1);
    lastMatch = targetIndex;
    queryIndex += 1;
  }

  if (queryIndex !== compactQuery.length) return null;
  return 2500 - firstMatch * 10 - gapPenalty * 4 - Math.max(0, compactTarget.length - compactQuery.length);
}

function scoreOption(option: ModelSelectOption, query: string): number | null {
  if (!query.trim()) return 0;
  const candidates = [
    option.label,
    option.detail,
    option.provider,
    option.modelId,
    option.group,
    option.value,
    ...(option.keywords ?? []),
  ].filter((candidate): candidate is string => Boolean(candidate));

  let best: number | null = null;
  for (const candidate of candidates) {
    const score = subsequenceScore(query, candidate);
    if (score === null) continue;
    best = best === null ? score : Math.max(best, score);
  }
  return best;
}

function displaySelectedLabel(option: ModelSelectOption | undefined, fallbackLabel: string | null | undefined, placeholder: string): string {
  if (!option) return fallbackLabel ?? placeholder;
  if (option.provider && option.label) return `${option.provider}/${option.label}`;
  return option.label;
}

function groupLabel(option: ModelSelectOption): string {
  return option.group ?? option.provider ?? "Models";
}

export function ModelSelect({
  value,
  options,
  onChange,
  disabled = false,
  placeholder = "Select model",
  fallbackLabel = null,
  ariaLabel = "Select model",
  size = "field",
  placement = "auto",
}: Props) {
  const searchId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hovered, setHovered] = useState(false);
  const [panelPosition, setPanelPosition] = useState<PanelPosition | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value),
    [options, value],
  );

  const filteredOptions = useMemo(() => {
    const scored: ScoredOption[] = options
      .map((option, index) => ({ option, index, score: scoreOption(option, query) }))
      .filter((entry): entry is ScoredOption => entry.score !== null);

    if (!query.trim()) return scored;
    return [...scored].sort((a, b) => b.score - a.score || a.index - b.index);
  }, [options, query]);

  const groupedOptions = useMemo(() => {
    const groups: { label: string; options: ScoredOption[] }[] = [];
    for (const entry of filteredOptions) {
      const label = groupLabel(entry.option);
      const group = groups.find((item) => item.label === label);
      if (group) group.options.push(entry);
      else groups.push({ label, options: [entry] });
    }
    return groups;
  }, [filteredOptions]);

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
    const maxHeight = Math.max(120, Math.min(MAX_PANEL_HEIGHT, Math.max(MIN_PANEL_HEIGHT, available)));
    const panelWidth = Math.max(rect.width, size === "compact" ? 300 : 320);
    const left = Math.min(Math.max(PANEL_MARGIN, rect.left), Math.max(PANEL_MARGIN, viewportWidth - panelWidth - PANEL_MARGIN));

    setPanelPosition({
      left,
      width: panelWidth,
      maxHeight,
      ...(shouldOpenAbove
        ? { bottom: viewportHeight - rect.top + PANEL_GAP }
        : { top: rect.bottom + PANEL_GAP }),
    });
  }, [placement, size]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setHighlightedIndex(0);
  }, []);

  const openPanel = useCallback(() => {
    if (disabled) return;
    setOpen(true);
    setQuery("");
    setHighlightedIndex(0);
    updatePanelPosition();
  }, [disabled, updatePanelPosition]);

  const selectValue = useCallback((nextValue: string) => {
    if (nextValue !== value) onChange(nextValue);
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

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [query]);

  const selectedLabel = displaySelectedLabel(selectedOption, fallbackLabel, placeholder);
  const triggerIsActive = open || hovered;
  const triggerStyle: React.CSSProperties = size === "compact"
    ? {
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 12px",
        height: 32,
        maxWidth: 220,
        overflow: "hidden",
        background: triggerIsActive ? "var(--bg-hover)" : "none",
        border: "none",
        borderRadius: 9,
        color: triggerIsActive ? "var(--text)" : "var(--text-muted)",
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: 12,
        opacity: disabled ? 0.5 : 1,
        transition: "background 0.12s, color 0.12s",
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
      role="dialog"
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
        borderRadius: 12,
        boxShadow: "0 16px 40px rgba(15,23,42,0.18), 0 4px 14px rgba(15,23,42,0.10)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ padding: 8, borderBottom: "1px solid var(--border)", background: "var(--bg-panel)" }}>
        <label htmlFor={searchId} style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 8px", borderRadius: 8, background: "var(--bg)", border: "1px solid var(--border)" }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            id={searchId}
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                close();
                triggerRef.current?.focus();
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                setHighlightedIndex((current) => Math.min(filteredOptions.length - 1, current + 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setHighlightedIndex((current) => Math.max(0, current - 1));
              } else if (event.key === "Enter") {
                event.preventDefault();
                const highlighted = filteredOptions[highlightedIndex]?.option;
                if (highlighted) selectValue(highlighted.value);
              }
            }}
            placeholder="Search models…"
            spellCheck={false}
            style={{
              width: "100%",
              minWidth: 0,
              border: "none",
              outline: "none",
              background: "transparent",
              color: "var(--text)",
              fontSize: 12,
              fontFamily: "inherit",
            }}
          />
        </label>
        <div style={{ marginTop: 5, padding: "0 2px", color: "var(--text-dim)", fontSize: 10 }}>
          支持模型、provider / 提供商名称搜索，例如 gpt4、sonnet、dsr1
        </div>
      </div>

      <div role="listbox" aria-label={ariaLabel} style={{ overflowY: "auto", padding: 6 }}>
        {filteredOptions.length === 0 ? (
          <div style={{ padding: "18px 10px", color: "var(--text-muted)", fontSize: 12, textAlign: "center" }}>
            No matching models
          </div>
        ) : groupedOptions.map((group) => {
          let groupStartIndex = 0;
          for (const previousGroup of groupedOptions) {
            if (previousGroup === group) break;
            groupStartIndex += previousGroup.options.length;
          }
          const showGroupHeader = groupedOptions.length > 1;
          return (
            <div key={group.label}>
              {showGroupHeader && (
                <div style={{ padding: "7px 8px 4px", fontSize: 10, fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                  {group.label}
                </div>
              )}
              {group.options.map((entry, offset) => {
                const option = entry.option;
                const globalIndex = groupStartIndex + offset;
                const selected = option.value === value;
                const highlighted = globalIndex === highlightedIndex;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onMouseEnter={() => setHighlightedIndex(globalIndex)}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      selectValue(option.value);
                    }}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "8px 9px",
                      border: "none",
                      borderRadius: 8,
                      background: selected ? "var(--accent)" : highlighted ? "var(--bg-hover)" : "transparent",
                      color: selected ? "#fff" : "var(--text-muted)",
                      cursor: "pointer",
                      textAlign: "left",
                      fontSize: 12,
                    }}
                  >
                    {selected ? (
                      <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                        <polyline points="1.5 5 4 7.5 8.5 2.5" />
                      </svg>
                    ) : (
                      <span style={{ width: 12, flexShrink: 0 }} />
                    )}
                    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: selected ? "#fff" : "inherit", fontWeight: selected ? 700 : 500 }}>
                        {option.label}
                      </span>
                      {option.detail && (
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: selected ? "rgba(255,255,255,0.78)" : "var(--text-dim)", fontSize: 10, fontFamily: "var(--font-mono)" }}>
                          {option.detail}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          if (open) close();
          else openPanel();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openPanel();
          }
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={triggerStyle}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <rect x="9" y="9" width="6" height="6" />
          <line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" />
          <line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" />
          <line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" />
          <line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" />
        </svg>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selectedLabel}
        </span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.7 }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {typeof document !== "undefined" && panel ? createPortal(panel, document.body) : panel}
    </>
  );
}
