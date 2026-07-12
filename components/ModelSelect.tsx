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

interface ScoredOption { option: ModelSelectOption; index: number; score: number }

function normalizeSearchText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[\s_./:-]+/g, " ").trim();
}

function compactSearchText(value: string) { return normalizeSearchText(value).replace(/\s+/g, ""); }

function subsequenceScore(query: string, target: string): number | null {
  if (!query) return 0;
  const q = compactSearchText(query);
  const t = compactSearchText(target);
  if (!q) return 0;
  const exact = t.indexOf(q);
  if (exact >= 0) return 4000 - exact * 8 - Math.max(0, t.length - q.length);
  let qi = 0; let first = -1; let last = -1; let gaps = 0;
  for (let i = 0; i < t.length && qi < q.length; i += 1) {
    if (t[i] !== q[qi]) continue;
    if (first < 0) first = i;
    if (last >= 0) gaps += Math.max(0, i - last - 1);
    last = i; qi += 1;
  }
  return qi === q.length ? 2500 - first * 10 - gaps * 4 - Math.max(0, t.length - q.length) : null;
}

function scoreOption(option: ModelSelectOption, query: string): number | null {
  if (!query.trim()) return 0;
  const candidates = [option.label, option.detail, option.provider, option.modelId, option.group, option.value, ...(option.keywords ?? [])]
    .filter((candidate): candidate is string => Boolean(candidate));
  return candidates.reduce<number | null>((best, candidate) => {
    const score = subsequenceScore(query, candidate);
    return score === null ? best : best === null ? score : Math.max(best, score);
  }, null);
}

function selectedLabel(option: ModelSelectOption | undefined, fallback: string | null | undefined, placeholder: string) {
  return option ? option.provider && option.label ? `${option.provider}/${option.label}` : option.label : fallback ?? placeholder;
}

function groupLabel(option: ModelSelectOption) { return option.group ?? option.provider ?? "Models"; }

export function ModelSelect({ value, options, onChange, disabled = false, placeholder = "Select model", fallbackLabel = null, ariaLabel = "Select model", size = "field", placement = "auto" }: Props) {
  // Kept for caller compatibility; the selector is now viewport-centered.
  void placement;
  const searchId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [hovered, setHovered] = useState(false);

  const selected = useMemo(() => options.find((option) => option.value === value), [options, value]);
  const filtered = useMemo(() => options.map((option, index) => ({ option, index, score: scoreOption(option, query) }))
    .filter((entry): entry is ScoredOption => entry.score !== null)
    .sort((a, b) => query.trim() ? b.score - a.score || a.index - b.index : a.index - b.index), [options, query]);
  const groups = useMemo(() => {
    const result: { label: string; entries: ScoredOption[] }[] = [];
    filtered.forEach((entry) => {
      const label = groupLabel(entry.option);
      const existing = result.find((group) => group.label === label);
      if (existing) existing.entries.push(entry); else result.push({ label, entries: [entry] });
    });
    return result;
  }, [filtered]);

  const close = useCallback(() => { setOpen(false); setQuery(""); setHighlightedIndex(0); }, []);
  const openModal = useCallback(() => { if (!disabled) { setOpen(true); setQuery(""); setHighlightedIndex(0); } }, [disabled]);
  const choose = useCallback((next: string) => { if (next !== value) onChange(next); close(); window.setTimeout(() => triggerRef.current?.focus(), 0); }, [close, onChange, value]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => searchRef.current?.focus(), 0);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(); triggerRef.current?.focus(); return; }
      if (event.key === "ArrowDown") { event.preventDefault(); setHighlightedIndex((index) => Math.min(Math.max(0, filtered.length - 1), index + 1)); return; }
      if (event.key === "ArrowUp") { event.preventDefault(); setHighlightedIndex((index) => Math.max(0, index - 1)); return; }
      if (event.key === "Enter") { event.preventDefault(); const entry = filtered[highlightedIndex]; if (entry) choose(entry.option.value); return; }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>("button, input, [tabindex]:not([tabindex=\"-1\"])");
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { window.clearTimeout(timer); document.removeEventListener("keydown", onKeyDown); document.body.style.overflow = previousOverflow; };
  }, [choose, close, filtered, highlightedIndex, open]);

  useEffect(() => setHighlightedIndex(0), [query]);

  const triggerStyle: React.CSSProperties = size === "compact" ? {
    display: "flex", alignItems: "center", gap: 6, height: 32, maxWidth: 220, padding: "8px 12px", border: 0, borderRadius: 9,
    background: open || hovered ? "var(--bg-hover)" : "none", color: open || hovered ? "var(--text)" : "var(--text-muted)",
    cursor: disabled ? "not-allowed" : "pointer", fontSize: 12, opacity: disabled ? 0.5 : 1,
  } : {
    display: "flex", alignItems: "center", gap: 8, width: "100%", minHeight: 34, padding: "7px 9px", boxSizing: "border-box",
    border: "1px solid var(--border)", borderRadius: 7, background: open || hovered ? "var(--bg-hover)" : "var(--bg)", color: "var(--text)",
    cursor: disabled ? "not-allowed" : "pointer", fontSize: 12, opacity: disabled ? 0.6 : 1, textAlign: "left",
  };

  const dialog = open ? <div style={{ position: "fixed", inset: 0, zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 12, background: "rgba(15,23,42,0.42)" }} onMouseDown={(event) => { if (event.target === event.currentTarget) { close(); triggerRef.current?.focus(); } }}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={ariaLabel} style={{ width: "min(960px, 100%)", maxHeight: "min(760px, calc(100vh - 24px))", display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "0 24px 70px rgba(15,23,42,.28)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)" }}>
        <strong style={{ flex: 1, minWidth: 0, fontSize: 14 }}>{ariaLabel}</strong>
        <label htmlFor={searchId} style={{ flex: "0 1 360px", display: "flex", alignItems: "center", gap: 7, padding: "7px 9px", border: "1px solid var(--border)", borderRadius: 7, background: "var(--bg)" }}>
          <span aria-hidden="true">⌕</span><input id={searchId} ref={searchRef} value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Search models or providers" spellCheck={false} style={{ width: "100%", minWidth: 0, border: 0, outline: 0, background: "transparent", color: "inherit", fontSize: 12 }} />
        </label>
        <button type="button" aria-label="Close model selector" onClick={() => { close(); triggerRef.current?.focus(); }} style={{ width: 30, height: 30, border: 0, borderRadius: 6, background: "transparent", color: "inherit", cursor: "pointer", fontSize: 18 }}>×</button>
      </div>
      <div style={{ overflowY: "auto", padding: 12 }}>
        {filtered.length === 0 ? <div style={{ padding: 42, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>No matching models</div> : <div className="model-select-provider-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10, alignItems: "start" }}>{groups.map((group) => <section key={group.label} aria-label={group.label} style={{ minWidth: 0, border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", background: "var(--bg-panel)" }}><h3 style={{ margin: 0, padding: "9px 10px", borderBottom: "1px solid var(--border)", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".06em" }}>{group.label}</h3>{group.entries.map((entry) => { const index = filtered.indexOf(entry); const isSelected = entry.option.value === value; const isHighlighted = index === highlightedIndex; return <button key={entry.option.value} type="button" role="option" aria-selected={isSelected} onMouseEnter={() => setHighlightedIndex(index)} onClick={() => choose(entry.option.value)} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", minHeight: 50, padding: "8px 10px", border: 0, borderBottom: "1px solid var(--border)", background: isSelected ? "var(--accent)" : isHighlighted ? "var(--bg-hover)" : "transparent", color: isSelected ? "#fff" : "var(--text)", cursor: "pointer", textAlign: "left" }}><span aria-hidden="true" style={{ width: 14, flexShrink: 0, color: isSelected ? "#fff" : "var(--accent)" }}>{isSelected ? "✓" : ""}</span><span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: isSelected ? 700 : 500 }}>{entry.option.label}</span>{entry.option.detail && <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: isSelected ? "rgba(255,255,255,.78)" : "var(--text-dim)", fontSize: 10, fontFamily: "var(--font-mono)" }}>{entry.option.detail}</span>}</span></button>; })}</section>)}</div>}
      </div>
    </div>
  </div> : null;

  return <>
    <button ref={triggerRef} type="button" aria-label={ariaLabel} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={openModal} onKeyDown={(event) => { if (["Enter", " ", "ArrowDown"].includes(event.key)) { event.preventDefault(); openModal(); } }} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} style={triggerStyle}>
      <span aria-hidden="true">▣</span><span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedLabel(selected, fallbackLabel, placeholder)}</span><span aria-hidden="true">⌄</span>
    </button>
    {typeof document !== "undefined" && dialog ? createPortal(dialog, document.body) : dialog}
  </>;
}
