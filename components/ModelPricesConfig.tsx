"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ModelPriceListResponse,
  ModelPriceRecord,
  ModelPriceSuggestResponse,
  PriceRates,
} from "@/lib/model-price-types";
import { MODEL_PRICE_SUGGEST_TARGETS_MAX } from "@/lib/model-price-types";
import { usePrompt } from "./AppPromptProvider";

// ── Types ──────────────────────────────────────────────────────────────────────

type FilterStatus = "all" | "missing" | "configured" | "free";

interface PendingChange {
  key: string;
  provider: string;
  model: string;
  prices: Partial<PriceRates>;
  explicitFree: boolean;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const FILTER_TABS: { value: FilterStatus; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "missing", label: "缺少价格" },
  { value: "configured", label: "已配置" },
  { value: "free", label: "免费" },
];

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  missing:    { label: "缺价",   color: "#f87171", bg: "rgba(239,68,68,0.12)" },
  configured: { label: "已配置", color: "#22c55e", bg: "rgba(34,197,94,0.12)" },
  builtin:    { label: "内置",   color: "#60a5fa", bg: "rgba(96,165,250,0.12)" },
  free:       { label: "免费",   color: "#a78bfa", bg: "rgba(167,139,250,0.12)" },
};

const CONFIDENCE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  high:   { label: "高", color: "#22c55e", bg: "rgba(34,197,94,0.1)" },
  medium: { label: "中", color: "#f59e0b", bg: "rgba(245,158,11,0.1)" },
  low:    { label: "低", color: "#f87171", bg: "rgba(239,68,68,0.1)" },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatPrice(value: number): string {
  if (value <= 0) return "—";
  if (value < 0.001) return `$${value.toExponential(1)}`;
  if (value < 0.01) return `$${value.toFixed(6)}`;
  return `$${value.toFixed(2)}`;
}

function parsePriceInput(raw: string, fieldName: string): { value: number | undefined; error?: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { value: undefined };
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return { value: undefined, error: `${fieldName} 必须为有效数字` };
  if (n < 0) return { value: undefined, error: `${fieldName} 不能为负数` };
  if (n > 1_000_000) return { value: undefined, error: `${fieldName} 不能超过 1,000,000` };
  return { value: n };
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  padding: "6px 9px",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text)",
  fontSize: 12,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

const btnPrimaryStyle: React.CSSProperties = {
  padding: "7px 14px",
  borderRadius: 7,
  border: "none",
  background: "var(--accent)",
  color: "white",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
};

const btnSecondaryStyle: React.CSSProperties = {
  padding: "7px 14px",
  borderRadius: 7,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text-muted)",
  cursor: "pointer",
  fontSize: 12,
};

const btnDisabledStyle: React.CSSProperties = {
  ...btnPrimaryStyle,
  background: "var(--border)",
  cursor: "not-allowed",
  opacity: 0.6,
};

// ── Component ──────────────────────────────────────────────────────────────────

export function ModelPricesConfig({ cwd }: { cwd: string | null }) {
  const prompt = usePrompt();

  // ── Core state ────────────────────────────────────────────────────────────

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<ModelPriceRecord[]>([]);
  const [revision, setRevision] = useState("");

  // ── Filter state ──────────────────────────────────────────────────────────

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("missing");

  // ── Edit state ────────────────────────────────────────────────────────────

  const [editingModel, setEditingModel] = useState<ModelPriceRecord | null>(null);
  const [editInput, setEditInput] = useState("");
  const [editOutput, setEditOutput] = useState("");
  const [editCacheRead, setEditCacheRead] = useState("");
  const [editExplicitFree, setEditExplicitFree] = useState(false);
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});

  // ── Suggest state ─────────────────────────────────────────────────────────

  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [suggestResults, setSuggestResults] = useState<ModelPriceSuggestResponse | null>(null);
  const [suggestSelected, setSuggestSelected] = useState<Set<string>>(new Set());
  const [showSuggestModal, setShowSuggestModal] = useState(false);
  const [suggestingAllMissing, setSuggestingAllMissing] = useState(false);

  // ── Save state ────────────────────────────────────────────────────────────

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflictRevision, setConflictRevision] = useState<string | null>(null);

  // ── Data loading ──────────────────────────────────────────────────────────

  const loadPrices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (cwd) params.set("cwd", cwd);
      const res = await fetch(`/api/model-prices?${params.toString()}`);
      const data = await res.json() as ModelPriceListResponse & { error?: string };
      if (!res.ok || (data as { error?: string }).error) {
        throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      setModels(data.models);
      setRevision(data.revision);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    void loadPrices();
  }, [loadPrices]);

  // ── Filtered models ───────────────────────────────────────────────────────

  const filteredModels = useMemo(() => {
    let result = models;
    if (statusFilter !== "all") {
      result = result.filter((m) => m.status === statusFilter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (m) =>
          m.provider.toLowerCase().includes(q) ||
          m.model.toLowerCase().includes(q) ||
          (m.displayName ?? "").toLowerCase().includes(q) ||
          (m.providerDisplayName ?? "").toLowerCase().includes(q),
      );
    }
    return result;
  }, [models, statusFilter, search]);

  const missingModels = useMemo(() => models.filter((m) => m.status === "missing"), [models]);

  // ── Edit handlers ─────────────────────────────────────────────────────────

  const openEdit = useCallback((model: ModelPriceRecord) => {
    setEditingModel(model);
    setEditInput(model.override ? String(model.override.input ?? "") : String(model.resolved.input || ""));
    setEditOutput(model.override ? String(model.override.output ?? "") : String(model.resolved.output || ""));
    setEditCacheRead(model.override ? String(model.override.cacheRead ?? "") : String(model.resolved.cacheRead || ""));
    setEditExplicitFree(model.status === "free");
    setEditErrors({});
    setSaveError(null);
  }, []);

  const closeEdit = useCallback(() => {
    setEditingModel(null);
    setEditErrors({});
    setSaveError(null);
  }, []);

  const toggleEditFree = useCallback(() => {
    setEditExplicitFree((prev) => {
      if (!prev) {
        // Enable free: set prices to 0 and disable inputs
        setEditInput("0");
        setEditOutput("0");
        setEditCacheRead("0");
      } else {
        // Disable free: restore from model
        if (editingModel) {
          setEditInput(editingModel.override ? String(editingModel.override.input ?? "") : String(editingModel.resolved.input || ""));
          setEditOutput(editingModel.override ? String(editingModel.override.output ?? "") : String(editingModel.resolved.output || ""));
          setEditCacheRead(editingModel.override ? String(editingModel.override.cacheRead ?? "") : String(editingModel.resolved.cacheRead || ""));
        }
      }
      return !prev;
    });
    setEditErrors({});
  }, [editingModel]);

  const validateEdit = useCallback((): PendingChange | null => {
    if (!editingModel) return null;
    const errors: Record<string, string> = {};
    const prices: Partial<PriceRates> = {};

    if (!editExplicitFree) {
      const inputResult = parsePriceInput(editInput, "Input");
      const outputResult = parsePriceInput(editOutput, "Output");
      const cacheReadResult = parsePriceInput(editCacheRead, "Cache Read");

      if (inputResult.error) errors.input = inputResult.error;
      if (outputResult.error) errors.output = outputResult.error;
      if (cacheReadResult.error) errors.cacheRead = cacheReadResult.error;

      if (Object.keys(errors).length > 0) {
        setEditErrors(errors);
        return null;
      }

      prices.input = inputResult.value ?? 0;
      prices.output = outputResult.value ?? 0;
      prices.cacheRead = cacheReadResult.value ?? 0;
    } else {
      prices.input = 0;
      prices.output = 0;
      prices.cacheRead = 0;
    }

    setEditErrors({});
    return {
      key: `${editingModel.provider}:${editingModel.model}`,
      provider: editingModel.provider,
      model: editingModel.model,
      prices,
      explicitFree: editExplicitFree,
    };
  }, [editingModel, editInput, editOutput, editCacheRead, editExplicitFree]);

  // ── Save handlers ─────────────────────────────────────────────────────────

  const handleSingleSave = useCallback(async () => {
    const change = validateEdit();
    if (!change) return;

    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/model-prices", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          revision,
          changes: [change],
        }),
      });
      const data = await res.json() as Record<string, unknown>;

      if (res.status === 409) {
        setSaveError("配置已被其他请求修改。请重新加载后再试。");
        setConflictRevision((data.currentRevision as string) ?? null);
        setSaving(false);
        return;
      }

      if (!res.ok) {
        throw new Error((data.error as string) ?? `HTTP ${res.status}`);
      }

      // Success
      setEditingModel(null);
      prompt.toast({ message: "模型价格已保存，后续调用将使用新价格。历史费用不追溯重算。", tone: "success" });
      await loadPrices(); // Reload to get fresh revision
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [validateEdit, revision, prompt, loadPrices]);

  const handleReloadAfterConflict = useCallback(async () => {
    setConflictRevision(null);
    setSaveError(null);
    await loadPrices();
  }, [loadPrices]);

  // ── Smart suggestion handlers ──────────────────────────────────────────────

  const handleOpenSuggest = useCallback(() => {
    if (missingModels.length === 0) {
      prompt.toast({ message: "没有缺少价格的模型需要智能填写。", tone: "info" });
      return;
    }
    setSuggestResults(null);
    setSuggestError(null);
    setSuggestSelected(new Set());
    setShowSuggestModal(true);
    setSuggestingAllMissing(true);
  }, [missingModels, prompt]);

  const handleRunSuggest = useCallback(async (targets: Array<{ provider: string; model: string }>) => {
    if (targets.length === 0) return;
    setSuggesting(true);
    setSuggestError(null);
    setSuggestResults(null);
    try {
      const res = await fetch("/api/model-prices/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets: targets.slice(0, MODEL_PRICE_SUGGEST_TARGETS_MAX), cwd }),
      });
      const data = await res.json() as ModelPriceSuggestResponse & { error?: string };
      if (!res.ok || (data as { error?: string }).error) {
        throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      setSuggestResults(data);
      // Auto-select high-confidence suggestions
      const selected = new Set<string>();
      for (const s of data.suggestions) {
        if (s.confidence === "high") {
          selected.add(`${s.provider}:${s.model}`);
        }
      }
      setSuggestSelected(selected);
    } catch (err) {
      setSuggestError(err instanceof Error ? err.message : String(err));
    } finally {
      setSuggesting(false);
    }
  }, [cwd]);

  // Auto-run suggest when modal opens
  useEffect(() => {
    if (showSuggestModal && suggestingAllMissing && missingModels.length > 0) {
      const targets = missingModels.slice(0, MODEL_PRICE_SUGGEST_TARGETS_MAX).map((m) => ({
        provider: m.provider,
        model: m.model,
      }));
      setSuggestingAllMissing(false);
      void handleRunSuggest(targets);
    }
  }, [showSuggestModal, suggestingAllMissing, missingModels, handleRunSuggest]);

  const toggleSuggestionSelection = useCallback((key: string) => {
    setSuggestSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleApplySuggestions = useCallback(async () => {
    if (!suggestResults) return;
    const selectedSuggestions = suggestResults.suggestions.filter((s) =>
      suggestSelected.has(`${s.provider}:${s.model}`),
    );
    if (selectedSuggestions.length === 0) {
      prompt.toast({ message: "未选择任何建议，不会保存。", tone: "info" });
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/model-prices", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          revision,
          changes: selectedSuggestions.map((s) => ({
            provider: s.provider,
            model: s.model,
            prices: s.prices,
            explicitFree: false,
          })),
        }),
      });
      const data = await res.json() as Record<string, unknown>;

      if (res.status === 409) {
        setSaveError("配置已被其他请求修改。请关闭后重新加载再试。");
        setConflictRevision((data.currentRevision as string) ?? null);
        setSaving(false);
        return;
      }

      if (!res.ok) {
        throw new Error((data.error as string) ?? `HTTP ${res.status}`);
      }

      setShowSuggestModal(false);
      prompt.toast({
        message: `已应用 ${selectedSuggestions.length} 条价格建议。历史费用不追溯重算。`,
        tone: "success",
      });
      await loadPrices();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [suggestResults, suggestSelected, revision, prompt, loadPrices]);

  // ── Count metrics ──────────────────────────────────────────────────────────

  const counts = useMemo(() => ({
    all: models.length,
    missing: models.filter((m) => m.status === "missing").length,
    configured: models.filter((m) => m.status === "configured").length,
    free: models.filter((m) => m.status === "free").length,
  }), [models]);

  // ── Render helpers ─────────────────────────────────────────────────────────

  const renderStatusBadge = (status: string) => {
    const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.missing;
    return (
      <span
        style={{
          padding: "2px 7px",
          borderRadius: 999,
          background: cfg.bg,
          color: cfg.color,
          fontSize: 11,
          fontWeight: 600,
          whiteSpace: "nowrap",
        }}
      >
        {cfg.label}
      </span>
    );
  };

  // ── Main render ────────────────────────────────────────────────────────────

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Explanation */}
      <div style={{ padding: "12px 14px", borderRadius: 10, background: "var(--bg-subtle)", border: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 800 }}>模型价格配置</div>
        <div style={{ color: "var(--text-muted)", fontSize: 11, lineHeight: 1.5 }}>
          价格单位为 USD / 1M tokens。保存后直接写入 Pi <code style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>models.json</code>，
          仅影响未来调用计费；历史费用不追溯重算。内置价格来源为 Pi Model Registry，手动配置会覆盖内置值。
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 11, color: "var(--text-dim)", flexWrap: "wrap" }}>
          <span>总模型 <strong style={{ color: "var(--text)" }}>{counts.all}</strong></span>
          <span>缺价 <strong style={{ color: "#f87171" }}>{counts.missing}</strong></span>
          <span>已配置 <strong style={{ color: "#22c55e" }}>{counts.configured}</strong></span>
          <span>内置 <strong style={{ color: "#60a5fa" }}>{counts.all - counts.missing - counts.configured - counts.free}</strong></span>
          <span>免费 <strong style={{ color: "#a78bfa" }}>{counts.free}</strong></span>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171", fontSize: 12 }}>
          {error}
          <button onClick={() => void loadPrices()} style={{ marginLeft: 10, padding: "4px 10px", borderRadius: 5, border: "1px solid #f87171", background: "transparent", color: "#f87171", cursor: "pointer", fontSize: 11 }}>重试</button>
        </div>
      )}

      {/* 409 conflict banner */}
      {conflictRevision && (
        <div style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ color: "#f87171", fontSize: 12, fontWeight: 600 }}>并发冲突</div>
          <div style={{ color: "#f87171", fontSize: 11, lineHeight: 1.5 }}>配置文件已被其他请求修改。请重新加载以获取最新数据，您的编辑草稿已保留。</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => void handleReloadAfterConflict()} style={btnSecondaryStyle}>重新加载</button>
            <button onClick={() => { setConflictRevision(null); setSaveError(null); }} style={btnSecondaryStyle}>忽略</button>
          </div>
        </div>
      )}

      {/* Search + filter bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 140 }}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索 provider 或模型名…"
            style={{ ...inputStyle, fontFamily: "var(--font-mono)" }}
          />
        </div>
        <div style={{ display: "flex", borderRadius: 7, border: "1px solid var(--border)", overflow: "hidden" }}>
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              style={{
                padding: "6px 11px",
                border: "none",
                borderLeft: tab.value !== "all" ? "1px solid var(--border)" : "none",
                background: statusFilter === tab.value ? "var(--bg-selected)" : "transparent",
                color: statusFilter === tab.value ? "var(--text)" : "var(--text-muted)",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: statusFilter === tab.value ? 600 : 400,
                whiteSpace: "nowrap",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button
          onClick={handleOpenSuggest}
          disabled={missingModels.length === 0}
          title={missingModels.length === 0 ? "没有缺少价格的模型" : `为 ${Math.min(missingModels.length, MODEL_PRICE_SUGGEST_TARGETS_MAX)} 个缺价模型查询建议`}
          style={missingModels.length === 0 ? btnDisabledStyle : { ...btnPrimaryStyle, padding: "6px 12px", fontSize: 11 }}
        >
          智能填写
        </button>
        <button
          onClick={() => void loadPrices()}
          disabled={loading}
          style={{ ...btnSecondaryStyle, padding: "6px 10px", fontSize: 11 }}
          title="重新加载"
        >
          ↻
        </button>
      </div>

      {/* Save error (from edit or suggest) */}
      {saveError && !conflictRevision && (
        <div style={{ padding: "8px 10px", borderRadius: 7, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171", fontSize: 11 }}>{saveError}</div>
      )}

      {/* Main content */}
      {loading ? (
        <div style={{ padding: 30, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>正在加载模型价格…</div>
      ) : filteredModels.length === 0 ? (
        <div style={{ padding: 30, textAlign: "center" }}>
          <div style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 6 }}>
            {search.trim() ? "没有匹配的模型" : statusFilter === "missing" ? "太好了，所有模型都有价格！" : "没有符合当前筛选条件的模型"}
          </div>
          {search.trim() && (
            <button onClick={() => { setSearch(""); setStatusFilter("all"); }} style={btnSecondaryStyle}>清除筛选</button>
          )}
        </div>
      ) : (
        /* Model list table */
        <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
          {/* Table header */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(100px, 1.2fr) minmax(100px, 1fr) 72px 80px 80px 80px 80px 60px",
              gap: 6,
              padding: "9px 10px",
              background: "var(--bg-subtle)",
              borderBottom: "1px solid var(--border)",
              fontSize: 11,
              color: "var(--text-dim)",
              fontWeight: 600,
              alignItems: "center",
            }}
          >
            <span>Provider</span>
            <span>Model</span>
            <span style={{ textAlign: "center" }}>状态</span>
            <span style={{ textAlign: "right" }}>Input</span>
            <span style={{ textAlign: "right" }}>Output</span>
            <span style={{ textAlign: "right" }}>Cache R</span>
            <span style={{ textAlign: "right" }}>来源</span>
            <span />
          </div>

          {/* Table rows */}
          <div style={{ maxHeight: "min(480px, 65vh)", overflow: "auto" }}>
            {filteredModels.map((model) => {
              const key = `${model.provider}:${model.model}`;
              const isEditing = editingModel?.provider === model.provider && editingModel?.model === model.model;
              const sourceLabel =
                model.source === "builtin" ? "内置" :
                model.source === "models_json_override" ? "覆盖" :
                model.source === "custom_model" ? "自定义" :
                model.source === "explicit_free" ? "标记" : model.source;

              return (
                <div key={key}>
                  {/* Row */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(100px, 1.2fr) minmax(100px, 1fr) 72px 80px 80px 80px 80px 60px",
                      gap: 6,
                      padding: "8px 10px",
                      borderBottom: "1px solid var(--border)",
                      background: isEditing ? "var(--bg-selected)" : "transparent",
                      alignItems: "center",
                      fontSize: 12,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: "var(--text-muted)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {model.providerDisplayName ?? model.provider}
                      </div>
                      <div style={{ color: "var(--text-dim)", fontSize: 10, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {model.provider}
                      </div>
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={model.model}>
                        {model.displayName ?? model.model}
                      </div>
                      {model.displayName && (
                        <div style={{ color: "var(--text-dim)", fontSize: 10, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {model.model}
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: "center" }}>{renderStatusBadge(model.status)}</div>
                    <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
                      {formatPrice(model.override?.input ?? model.resolved.input)}
                    </div>
                    <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
                      {formatPrice(model.override?.output ?? model.resolved.output)}
                    </div>
                    <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
                      {formatPrice(model.override?.cacheRead ?? model.resolved.cacheRead)}
                    </div>
                    <div style={{ textAlign: "right", fontSize: 10, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>{sourceLabel}</div>
                    <div style={{ textAlign: "center" }}>
                      {isEditing ? (
                        <button
                          onClick={closeEdit}
                          style={{
                            padding: "4px 8px",
                            borderRadius: 5,
                            border: "1px solid var(--border)",
                            background: "var(--bg)",
                            color: "var(--text-muted)",
                            cursor: "pointer",
                            fontSize: 11,
                          }}
                        >
                          取消
                        </button>
                      ) : (
                        <button
                          onClick={() => openEdit(model)}
                          style={{
                            padding: "4px 8px",
                            borderRadius: 5,
                            border: "1px solid var(--border)",
                            background: "var(--bg)",
                            color: "var(--accent)",
                            cursor: "pointer",
                            fontSize: 11,
                            fontWeight: 600,
                          }}
                        >
                          编辑
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Inline edit panel */}
                  {isEditing && editingModel && (
                    <div
                      style={{
                        padding: "12px 14px",
                        borderBottom: "1px solid var(--border)",
                        background: "var(--bg-subtle)",
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                      }}
                    >
                      <div style={{ fontSize: 12, color: "var(--text)", fontWeight: 700 }}>
                        编辑 {editingModel.providerDisplayName ?? editingModel.provider} / {editingModel.displayName ?? editingModel.model}
                      </div>

                      {/* Explicit free toggle */}
                      <label
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          cursor: "pointer",
                          fontSize: 12,
                          color: "var(--text-muted)",
                          userSelect: "none",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={editExplicitFree}
                          onChange={toggleEditFree}
                          style={{ width: 14, height: 14, accentColor: "var(--accent)", cursor: "pointer" }}
                        />
                        显式免费模型（将价格固定为 0，不再告警）
                      </label>

                      {/* Price inputs */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                        {([
                          { label: "Input ($/1M)", value: editInput, setter: setEditInput, key: "input", modelVal: editingModel.resolved.input },
                          { label: "Output ($/1M)", value: editOutput, setter: setEditOutput, key: "output", modelVal: editingModel.resolved.output },
                          { label: "Cache Read ($/1M)", value: editCacheRead, setter: setEditCacheRead, key: "cacheRead", modelVal: editingModel.resolved.cacheRead },
                        ] as const).map((field) => {
                          const hasError = editErrors[field.key];
                          const disabled = editExplicitFree;
                          return (
                            <div key={field.key} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                              <span style={{ fontSize: 11, color: disabled ? "var(--text-dim)" : "var(--text-muted)", fontWeight: 500 }}>
                                {field.label}
                                <span style={{ fontSize: 10, color: "var(--text-dim)", marginLeft: 4 }}>
                                  当前: {formatPrice(field.modelVal)}
                                </span>
                              </span>
                              <input
                                type="number"
                                min="0"
                                step="any"
                                value={field.value}
                                onChange={(e) => field.setter(e.target.value)}
                                disabled={disabled}
                                placeholder="0.00"
                                style={{
                                  ...inputStyle,
                                  fontFamily: "var(--font-mono)",
                                  opacity: disabled ? 0.5 : 1,
                                  cursor: disabled ? "not-allowed" : "text",
                                  ...(hasError ? { borderColor: "#f87171", background: "rgba(239,68,68,0.06)" } : {}),
                                }}
                              />
                              {hasError && <span style={{ fontSize: 10, color: "#f87171" }}>{hasError}</span>}
                            </div>
                          );
                        })}
                      </div>

                      {/* Save / Cancel */}
                      <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end" }}>
                        <button onClick={closeEdit} style={btnSecondaryStyle}>取消</button>
                        <button onClick={() => void handleSingleSave()} disabled={saving} style={saving ? btnDisabledStyle : btnPrimaryStyle}>
                          {saving ? "保存中…" : "保存价格"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Smart suggestion modal */}
      {showSuggestModal && (
        <SuggestModal
          suggesting={suggesting}
          suggestError={suggestError}
          suggestResults={suggestResults}
          suggestSelected={suggestSelected}
          saving={saving}
          saveError={saveError}
          conflictRevision={conflictRevision}
          missingModels={missingModels}
          onToggleSelection={toggleSuggestionSelection}
          onApply={handleApplySuggestions}
          onRetrySuggest={() => {
            const targets = missingModels.slice(0, MODEL_PRICE_SUGGEST_TARGETS_MAX).map((m) => ({
              provider: m.provider,
              model: m.model,
            }));
            void handleRunSuggest(targets);
          }}
          onClose={() => setShowSuggestModal(false)}
          onReloadAfterConflict={handleReloadAfterConflict}
        />
      )}
    </div>
  );
}

// ── Smart Suggestion Modal ─────────────────────────────────────────────────────

function SuggestModal({
  suggesting,
  suggestError,
  suggestResults,
  suggestSelected,
  saving,
  saveError,
  conflictRevision,
  missingModels,
  onToggleSelection,
  onApply,
  onRetrySuggest,
  onClose,
  onReloadAfterConflict,
}: {
  suggesting: boolean;
  suggestError: string | null;
  suggestResults: ModelPriceSuggestResponse | null;
  suggestSelected: Set<string>;
  saving: boolean;
  saveError: string | null;
  conflictRevision: string | null;
  missingModels: ModelPriceRecord[];
  onToggleSelection: (key: string) => void;
  onApply: () => void;
  onRetrySuggest: () => void;
  onClose: () => void;
  onReloadAfterConflict: () => void;
}) {
  const hasResults = suggestResults && suggestResults.suggestions.length > 0;
  const hasUnresolved = suggestResults && suggestResults.unresolved.length > 0;
  const hasWarnings = suggestResults && suggestResults.warnings.length > 0;
  const selectedCount = suggestSelected.size;
  const limitedMissing = Math.min(missingModels.length, MODEL_PRICE_SUGGEST_TARGETS_MAX);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 1100,
          background: "rgba(0,0,0,0.45)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            width: "min(580px, calc(100vw - 40px))",
            maxHeight: "calc(100vh - 40px)",
            overflow: "hidden",
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Header */}
          <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 14, color: "var(--text)", fontWeight: 700 }}>智能填写价格建议</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                为 {limitedMissing} 个缺价模型查询公开定价数据，确认后写入 models.json
              </div>
            </div>
            <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 20, padding: 4 }}>×</button>
          </div>

          {/* Body */}
          <div style={{ overflow: "auto", padding: 14, flex: 1 }}>
            {/* Loading */}
            {suggesting && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: 30 }}>
                <div style={{ width: 32, height: 32, border: "3px solid var(--border)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>正在查询公开价格数据…</span>
              </div>
            )}

            {/* Error */}
            {!suggesting && suggestError && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 20 }}>
                <div style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171", fontSize: 12 }}>
                  智能填写失败：{suggestError}
                </div>
                <button onClick={onRetrySuggest} style={{ alignSelf: "center", ...btnPrimaryStyle }}>重试</button>
              </div>
            )}

            {/* Results */}
            {!suggesting && suggestResults && (
              <>
                {/* Warnings */}
                {hasWarnings && (
                  <div style={{ marginBottom: 10, padding: "8px 10px", borderRadius: 7, background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", fontSize: 11, color: "#f59e0b", lineHeight: 1.5 }}>
                    {suggestResults.warnings.map((w, i) => (
                      <div key={i}>⚠ {w}</div>
                    ))}
                  </div>
                )}

                {/* No results at all */}
                {!hasResults && !hasUnresolved && (
                  <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                    未找到任何匹配结果。您可以手动填写价格。
                  </div>
                )}

                {/* Suggestions list */}
                {hasResults && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 2 }}>
                      {suggestResults.suggestions.length} 条建议 · 已选 {selectedCount} 条
                    </div>
                    {suggestResults.suggestions.map((suggestion) => {
                      const key = `${suggestion.provider}:${suggestion.model}`;
                      const selected = suggestSelected.has(key);
                      const confidence = CONFIDENCE_CONFIG[suggestion.confidence] ?? CONFIDENCE_CONFIG.low;
                      const isLow = suggestion.confidence === "low";

                      return (
                        <label
                          key={key}
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 10,
                            padding: "10px 12px",
                            borderRadius: 8,
                            border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
                            background: selected ? "var(--bg-selected)" : "var(--bg)",
                            cursor: "pointer",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => onToggleSelection(key)}
                            style={{ marginTop: 2, width: 14, height: 14, accentColor: "var(--accent)", flexShrink: 0, cursor: "pointer" }}
                          />
                          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 12, color: "var(--text)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {suggestion.provider} / {suggestion.model}
                              </span>
                              <span style={{ padding: "1px 5px", borderRadius: 999, background: confidence.bg, color: confidence.color, fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
                                {confidence.label}
                              </span>
                              <span style={{ fontSize: 10, color: "var(--text-dim)", flexShrink: 0 }}>{suggestion.matchMethod === "exact" ? "精确匹配" : suggestion.matchMethod === "alias" ? "别名匹配" : "AI 辅助"}</span>
                            </div>
                            {(suggestion.matchedId || suggestion.normalizedLabel) && (
                              <div style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
                                {suggestion.normalizedLabel ? `识别为 ${suggestion.normalizedLabel}` : null}
                                {suggestion.normalizedLabel && suggestion.matchedId ? " · " : null}
                                {suggestion.matchedId ? `匹配目录 ${suggestion.matchedId}` : null}
                              </div>
                            )}
                            <div style={{ display: "flex", gap: 12, fontSize: 11, fontFamily: "var(--font-mono)" }}>
                              {suggestion.prices.input !== undefined && (
                                <span style={{ color: "var(--text)" }}>Input: {formatPrice(suggestion.prices.input)}</span>
                              )}
                              {suggestion.prices.output !== undefined && (
                                <span style={{ color: "var(--text)" }}>Output: {formatPrice(suggestion.prices.output)}</span>
                              )}
                              {suggestion.prices.cacheRead !== undefined && (
                                <span style={{ color: "var(--text)" }}>Cache Read: {formatPrice(suggestion.prices.cacheRead)}</span>
                              )}
                            </div>
                            {suggestion.evidence.length > 0 && (
                              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                {suggestion.evidence.map((ev, ei) => (
                                  <a
                                    key={ei}
                                    href={ev.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    style={{ fontSize: 10, color: "var(--accent)", textDecoration: "none", cursor: "pointer" }}
                                    title={`${ev.title} · ${ev.fetchedAt}`}
                                  >
                                    {ev.title} ↗
                                  </a>
                                ))}
                              </div>
                            )}
                            {isLow && suggestion.warnings.length > 0 && (
                              <div style={{ fontSize: 10, color: "#f59e0b", lineHeight: 1.4 }}>
                                {suggestion.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
                              </div>
                            )}
                            {isLow && (
                              <div style={{ fontSize: 10, color: "var(--text-dim)" }}>低置信度，默认不选中。请仔细核验来源后再手动勾选。</div>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}

                {/* Unresolved models */}
                {hasUnresolved && (
                  <div style={{ marginTop: 12, padding: "8px 10px", borderRadius: 7, background: "rgba(239,68,68,0.06)", border: "1px solid var(--border)", fontSize: 11, color: "var(--text-dim)" }}>
                    <div style={{ fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>
                      {suggestResults.unresolved.length} 个模型未找到匹配
                    </div>
                    {suggestResults.unresolved.slice(0, 10).map((u) => (
                      <div key={`${u.provider}:${u.model}`} style={{ fontFamily: "var(--font-mono)", padding: "1px 0" }}>
                        {u.provider} / {u.model}
                      </div>
                    ))}
                    {suggestResults.unresolved.length > 10 && (
                      <div style={{ color: "var(--text-dim)" }}>…及其他 {suggestResults.unresolved.length - 10} 个</div>
                    )}
                  </div>
                )}

                {/* Conflict warning */}
                {conflictRevision && (
                  <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 7, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ color: "#f87171", fontSize: 11, fontWeight: 600 }}>并发冲突：配置文件已被其他请求修改</div>
                    <button onClick={onReloadAfterConflict} style={{ alignSelf: "flex-start", ...btnSecondaryStyle }}>重新加载</button>
                  </div>
                )}

                {/* Save error */}
                {saveError && !conflictRevision && (
                  <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 7, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171", fontSize: 11 }}>{saveError}</div>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          {!suggesting && suggestResults && (
            <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 10 }}>
              <div style={{ fontSize: 11, color: "var(--text-dim)", alignSelf: "center" }}>
                已选 {selectedCount} 条建议，保存后只影响未来调用
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={onClose} style={btnSecondaryStyle}>取消</button>
                <button
                  onClick={() => void onApply()}
                  disabled={selectedCount === 0 || saving || !!conflictRevision}
                  style={selectedCount === 0 || saving || !!conflictRevision ? { ...btnDisabledStyle, padding: "7px 14px", fontSize: 12, fontWeight: 600 } : { ...btnPrimaryStyle }}
                >
                  {saving ? "保存中…" : `确认并保存 (${selectedCount})`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Spinner keyframes */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
