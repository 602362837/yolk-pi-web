"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TrellisWorkflowVisualizer } from "./TrellisWorkflowVisualizer";
import type {
  PiWebChatGptConfig,
  PiWebConfig,
  PiWebSubagentAgentConfig,
  PiWebSubagentDifficultyTier,
  PiWebSubagentModelRef,
  PiWebSubagentModality,
  PiWebSubagentRunPolicy,
  PiWebTrellisConfig,
  PiWebUsageConfig,
  PiWebWorktreeConfig,
} from "@/lib/pi-web-config";
import type { TrellisCommandResponse, TrellisSetupStatus } from "@/lib/trellis-setup-types";

interface WebConfigResponse {
  config: PiWebConfig;
  defaults: PiWebConfig;
  path: string;
  exists: boolean;
  parseError?: string;
  error?: string;
}

interface TrellisStatusResponse {
  status?: TrellisSetupStatus;
  error?: string;
}

interface TrellisActionResponse extends TrellisCommandResponse {
  config?: PiWebConfig;
}

interface ModelListItem {
  id: string;
  name: string;
  provider: string;
}

interface ModelsResponse {
  modelList?: ModelListItem[];
  defaultModel?: { provider: string; modelId: string } | null;
  error?: string;
}

const inputStyle: React.CSSProperties = {
  padding: "7px 9px",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text)",
  fontSize: 12,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

const TEMPLATE_VARIABLES = [
  { token: "{repoRoot}", description: "当前 Git 仓库根目录的绝对路径" },
  { token: "{repoParent}", description: "仓库根目录的父目录" },
  { token: "{repoName}", description: "仓库目录名" },
  { token: "{baseDir}", description: "由“基础目录模板”计算出的目录" },
  { token: "{branchName}", description: "最终创建的分支名" },
  { token: "{branchSlug}", description: "适合文件路径使用的分支名，会替换特殊字符" },
  { token: "{yyyyMMdd-HHmmss}", description: "创建时刻，格式如 20260625-153012" },
];

type SettingsSection = "worktree" | "usage" | "chatgpt" | "trellis";
type SubagentThinkingOption = PiWebSubagentRunPolicy["thinking"];

const SUBAGENT_AGENT_NAMES = ["trellis-implement", "trellis-check", "trellis-research"];
const SUBAGENT_THINKING_OPTIONS: SubagentThinkingOption[] = ["inherit", "off", "minimal", "low", "medium", "high", "xhigh"];
const SUBAGENT_MODALITIES: PiWebSubagentModality[] = ["text", "multimodal"];
const SUBAGENT_TIERS: PiWebSubagentDifficultyTier[] = ["simple", "standard", "complex", "critical"];
const SUBAGENT_MODALITY_LABELS: Record<PiWebSubagentModality, string> = {
  text: "文本任务",
  multimodal: "多模态任务（图片/截图/视觉）",
};
const SUBAGENT_TIER_LABELS: Record<PiWebSubagentDifficultyTier, string> = {
  simple: "简单：短问答、轻量查询",
  standard: "标准：常规检查、普通修复",
  complex: "复杂：实现、重构、跨文件改动",
  critical: "关键：架构、安全、迁移、高风险改动",
};

function formatModelValue(model: PiWebSubagentModelRef): string {
  if (model.mode !== "specific") return model.mode;
  return `specific:${model.provider ?? ""}/${model.modelId ?? ""}`;
}

function parseModelValue(value: string): PiWebSubagentModelRef {
  if (value === "followMain" || value === "piDefault" || value === "unset") return { mode: value };
  if (value.startsWith("specific:")) {
    const [provider, modelId] = value.slice("specific:".length).split("/");
    if (provider && modelId) return { mode: "specific", provider, modelId };
  }
  return { mode: "unset" };
}

function Field({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 12, color: "var(--text)", fontWeight: 600 }}>{label}</span>
      {children}
      {description && <span style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.45 }}>{description}</span>}
    </label>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      spellCheck={false}
      style={{ ...inputStyle, fontFamily: "var(--font-mono)", opacity: disabled ? 0.6 : 1, cursor: disabled ? "not-allowed" : "text" }}
    />
  );
}

function ModelPolicySelect({
  value,
  onChange,
  models,
  disabled = false,
}: {
  value: PiWebSubagentModelRef;
  onChange: (value: PiWebSubagentModelRef) => void;
  models: ModelListItem[];
  disabled?: boolean;
}) {
  return (
    <select
      value={formatModelValue(value)}
      onChange={(e) => onChange(parseModelValue(e.target.value))}
      disabled={disabled}
      style={{ ...inputStyle, opacity: disabled ? 0.6 : 1, cursor: disabled ? "not-allowed" : "pointer" }}
    >
      <option value="followMain">跟随主会话模型</option>
      <option value="piDefault">使用 Pi 默认模型</option>
      <option value="unset">本层不指定</option>
      {models.length > 0 && <option disabled>──────────</option>}
      {models.map((model) => (
        <option key={`${model.provider}/${model.id}`} value={`specific:${model.provider}/${model.id}`}>
          {model.name} · {model.provider}/{model.id}
        </option>
      ))}
    </select>
  );
}

function ThinkingSelect({
  value,
  onChange,
  disabled = false,
}: {
  value: SubagentThinkingOption;
  onChange: (value: SubagentThinkingOption) => void;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as SubagentThinkingOption)}
      disabled={disabled}
      style={{ ...inputStyle, opacity: disabled ? 0.6 : 1, cursor: disabled ? "not-allowed" : "pointer" }}
    >
      {SUBAGENT_THINKING_OPTIONS.map((option) => (
        <option key={option} value={option}>{option === "inherit" ? "跟随主会话思考强度" : option === "off" ? "关闭思考" : option}</option>
      ))}
    </select>
  );
}

function ToggleField({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: 12,
        borderRadius: 10,
        border: "1px solid var(--border)",
        background: "var(--bg-subtle)",
        color: "var(--text)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.65 : 1,
        textAlign: "left",
      }}
    >
      <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>{label}</span>
        <span style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.45 }}>{description}</span>
      </span>
      <span
        aria-hidden
        style={{
          width: 40,
          height: 22,
          borderRadius: 999,
          background: checked ? "var(--accent)" : "var(--border)",
          position: "relative",
          flexShrink: 0,
          transition: "background 0.12s",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 3,
            left: checked ? 21 : 3,
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: "white",
            transition: "left 0.12s",
            boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
          }}
        />
      </span>
    </button>
  );
}

function StatusBadge({ ok, label }: { ok: boolean; label?: string }) {
  return (
    <span style={{ padding: "2px 7px", borderRadius: 999, background: ok ? "rgba(34,197,94,0.14)" : "rgba(239,68,68,0.14)", color: ok ? "#22c55e" : "#f87171", fontSize: 11, fontWeight: 700 }}>
      {label ?? (ok ? "通过" : "需处理")}
    </span>
  );
}

function StatusRow({ label, value, ok, detail }: { label: string; value: string; ok: boolean; detail?: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "120px 1fr max-content", gap: 10, alignItems: "center", padding: "7px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ color: "var(--text-dim)", fontSize: 11 }}>{label}</span>
      <span title={detail} style={{ color: "var(--text)", fontSize: 12, overflowWrap: "anywhere" }}>{value}</span>
      <StatusBadge ok={ok} />
    </div>
  );
}

function formatRecommendedAction(status: TrellisSetupStatus): string {
  if (status.recommendedAction === "fix-prerequisites") return "请先完成系统前置要求，然后再安装或更新 Trellis。";
  if (status.recommendedAction === "initialize") return "当前工作区还没有 Trellis，可安装并初始化 Pi Agent 支持。";
  if (status.recommendedAction === "update") return "当前工作区已有 Trellis，请使用更新操作同步 CLI 和项目模板。";
  if (status.recommendedAction === "ready") return "当前工作区已启用 Trellis，可直接使用面板，也可以执行更新。";
  return "请选择工作区。";
}

function worktreeConfigsEqual(a: PiWebWorktreeConfig | null, b: PiWebWorktreeConfig | null): boolean {
  if (!a || !b) return a === b;
  return a.baseRef === b.baseRef
    && a.branchNameTemplate === b.branchNameTemplate
    && a.baseDirTemplate === b.baseDirTemplate
    && a.pathTemplate === b.pathTemplate
    && a.sessionDisplay === b.sessionDisplay;
}

function trellisConfigsEqual(a: PiWebTrellisConfig | null, b: PiWebTrellisConfig | null): boolean {
  if (!a || !b) return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}

function usageConfigsEqual(a: PiWebUsageConfig | null, b: PiWebUsageConfig | null): boolean {
  if (!a || !b) return a === b;
  return a.includeArchived === b.includeArchived;
}

function chatGptConfigsEqual(a: PiWebChatGptConfig | null, b: PiWebChatGptConfig | null): boolean {
  if (!a || !b) return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}

export function SettingsConfig({ cwd, onClose, onConfigChange }: { cwd: string | null; onClose: () => void; onConfigChange?: () => void }) {
  const [section, setSection] = useState<SettingsSection>("worktree");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [configPath, setConfigPath] = useState("");
  const [exists, setExists] = useState(false);
  const [defaults, setDefaults] = useState<PiWebConfig | null>(null);
  const [worktree, setWorktree] = useState<PiWebWorktreeConfig | null>(null);
  const [savedWorktree, setSavedWorktree] = useState<PiWebWorktreeConfig | null>(null);
  const [trellis, setTrellis] = useState<PiWebTrellisConfig | null>(null);
  const [savedTrellis, setSavedTrellis] = useState<PiWebTrellisConfig | null>(null);
  const [usage, setUsage] = useState<PiWebUsageConfig | null>(null);
  const [savedUsage, setSavedUsage] = useState<PiWebUsageConfig | null>(null);
  const [chatgpt, setChatgpt] = useState<PiWebChatGptConfig | null>(null);
  const [savedChatgpt, setSavedChatgpt] = useState<PiWebChatGptConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [trellisStatus, setTrellisStatus] = useState<TrellisSetupStatus | null>(null);
  const [trellisStatusLoading, setTrellisStatusLoading] = useState(false);
  const [trellisStatusError, setTrellisStatusError] = useState<string | null>(null);
  const [trellisAction, setTrellisAction] = useState<"init" | "update" | null>(null);
  const [trellisOutput, setTrellisOutput] = useState<string | null>(null);
  const [trellisWorkflowOpen, setTrellisWorkflowOpen] = useState(false);
  const [modelList, setModelList] = useState<ModelListItem[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [developerName, setDeveloperName] = useState("");
  const [developerNameTouched, setDeveloperNameTouched] = useState(false);

  const dirty = useMemo(
    () => !worktreeConfigsEqual(worktree, savedWorktree) || !trellisConfigsEqual(trellis, savedTrellis) || !usageConfigsEqual(usage, savedUsage) || !chatGptConfigsEqual(chatgpt, savedChatgpt),
    [worktree, savedWorktree, trellis, savedTrellis, usage, savedUsage, chatgpt, savedChatgpt],
  );

  const loadConfig = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/web-config", { signal });
      const data = await res.json() as WebConfigResponse;
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setDefaults(data.defaults);
      setWorktree(data.config.worktree);
      setSavedWorktree(data.config.worktree);
      setTrellis(data.config.trellis);
      setSavedTrellis(data.config.trellis);
      setUsage(data.config.usage);
      setSavedUsage(data.config.usage);
      setChatgpt(data.config.chatgpt);
      setSavedChatgpt(data.config.chatgpt);
      setConfigPath(data.path);
      setExists(data.exists);
      if (data.parseError) {
        setNotice(`配置文件无法解析，当前显示默认值；保存后会用合法 JSON 覆盖它。${data.parseError}`);
      }
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadModels = useCallback(async (signal?: AbortSignal) => {
    setModelsError(null);
    try {
      const res = await fetch("/api/models", { signal });
      const data = await res.json() as ModelsResponse;
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setModelList(data.modelList ?? []);
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") return;
      setModelsError(err instanceof Error ? err.message : String(err));
      setModelList([]);
    }
  }, []);

  const loadTrellisStatus = useCallback(async (signal?: AbortSignal) => {
    if (!cwd) {
      setTrellisStatus(null);
      setTrellisStatusError(null);
      setTrellisStatusLoading(false);
      return;
    }
    setTrellisStatusLoading(true);
    setTrellisStatusError(null);
    try {
      const res = await fetch(`/api/trellis/setup/status?cwd=${encodeURIComponent(cwd)}`, { signal });
      const data = await res.json() as TrellisStatusResponse;
      if (!res.ok || data.error || !data.status) throw new Error(data.error ?? `HTTP ${res.status}`);
      const status = data.status;
      setTrellisStatus(status);
      setDeveloperName((prev) => (!developerNameTouched || !prev.trim()) ? status.suggestedDeveloperName : prev);
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") return;
      setTrellisStatus(null);
      setTrellisStatusError(err instanceof Error ? err.message : String(err));
    } finally {
      setTrellisStatusLoading(false);
    }
  }, [cwd, developerNameTouched]);

  useEffect(() => {
    const controller = new AbortController();
    void loadConfig(controller.signal);
    return () => controller.abort();
  }, [loadConfig]);

  useEffect(() => {
    setDeveloperName("");
    setDeveloperNameTouched(false);
    setTrellisOutput(null);
  }, [cwd]);

  useEffect(() => {
    if (section !== "trellis") return;
    const controller = new AbortController();
    void loadTrellisStatus(controller.signal);
    void loadModels(controller.signal);
    return () => controller.abort();
  }, [section, loadModels, loadTrellisStatus]);

  const updateWorktree = useCallback((patch: Partial<PiWebWorktreeConfig>) => {
    setWorktree((prev) => prev ? { ...prev, ...patch } : prev);
    setNotice(null);
  }, []);

  const updateTrellis = useCallback((patch: Partial<PiWebTrellisConfig>) => {
    setTrellis((prev) => prev ? { ...prev, ...patch } : prev);
    setNotice(null);
  }, []);

  const updateUsage = useCallback((patch: Partial<PiWebUsageConfig>) => {
    setUsage((prev) => prev ? { ...prev, ...patch } : prev);
    setNotice(null);
  }, []);

  const updateChatgpt = useCallback((patch: Partial<PiWebChatGptConfig>) => {
    setChatgpt((prev) => prev ? { ...prev, ...patch } : prev);
    setNotice(null);
  }, []);

  const updateDefaultSubagentPolicy = useCallback((patch: Partial<PiWebSubagentRunPolicy>) => {
    setTrellis((prev) => prev ? {
      ...prev,
      subagents: {
        ...prev.subagents,
        defaultPolicy: { ...prev.subagents.defaultPolicy, ...patch },
      },
    } : prev);
    setNotice(null);
  }, []);

  const updateWorkflowAssistantPolicy = useCallback((patch: Partial<PiWebSubagentRunPolicy>) => {
    setTrellis((prev) => prev ? {
      ...prev,
      workflowAssistant: { ...prev.workflowAssistant, ...patch },
    } : prev);
    setNotice(null);
  }, []);

  const updateWorkflowAssistantFallbackPolicy = useCallback((patch: Partial<PiWebSubagentRunPolicy>) => {
    setTrellis((prev) => prev ? {
      ...prev,
      workflowAssistantFallback: { ...prev.workflowAssistantFallback, ...patch },
    } : prev);
    setNotice(null);
  }, []);

  const updateSubagentConfig = useCallback((patch: Partial<PiWebTrellisConfig["subagents"]>) => {
    setTrellis((prev) => prev ? {
      ...prev,
      subagents: { ...prev.subagents, ...patch },
    } : prev);
    setNotice(null);
  }, []);

  const updateSubagentAgent = useCallback((agent: string, patch: Partial<PiWebSubagentAgentConfig>) => {
    setTrellis((prev) => {
      if (!prev) return prev;
      const current = prev.subagents.agents[agent] ?? { strategy: "default" as const };
      return {
        ...prev,
        subagents: {
          ...prev.subagents,
          agents: {
            ...prev.subagents.agents,
            [agent]: { ...current, ...patch },
          },
        },
      };
    });
    setNotice(null);
  }, []);

  const updateRouter = useCallback((patch: Partial<PiWebTrellisConfig["subagents"]["router"]>) => {
    setTrellis((prev) => prev ? {
      ...prev,
      subagents: {
        ...prev.subagents,
        router: { ...prev.subagents.router, ...patch },
      },
    } : prev);
    setNotice(null);
  }, []);

  const updateRoutePolicy = useCallback((modality: PiWebSubagentModality, tier: PiWebSubagentDifficultyTier, patch: Partial<PiWebSubagentRunPolicy>) => {
    setTrellis((prev) => prev ? {
      ...prev,
      subagents: {
        ...prev.subagents,
        routes: {
          ...prev.subagents.routes,
          [modality]: {
            ...prev.subagents.routes[modality],
            [tier]: { ...prev.subagents.routes[modality][tier], ...patch },
          },
        },
      },
    } : prev);
    setNotice(null);
  }, []);

  const applyLoadedConfig = useCallback((config: PiWebConfig, path: string, configExists: boolean, nextDefaults?: PiWebConfig) => {
    if (nextDefaults) setDefaults(nextDefaults);
    setWorktree(config.worktree);
    setSavedWorktree(config.worktree);
    setTrellis(config.trellis);
    setSavedTrellis(config.trellis);
    setUsage(config.usage);
    setSavedUsage(config.usage);
    setChatgpt(config.chatgpt);
    setSavedChatgpt(config.chatgpt);
    setConfigPath(path);
    setExists(configExists);
    onConfigChange?.();
  }, [onConfigChange]);

  const saveConfig = useCallback(async (successNotice?: string): Promise<boolean> => {
    if (!worktree || !trellis || !usage || !chatgpt) return false;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/web-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worktree, trellis, usage, chatgpt }),
      });
      const data = await res.json() as WebConfigResponse & { success?: boolean };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      applyLoadedConfig(data.config, data.path, data.exists, data.defaults);
      if (successNotice) setNotice(successNotice);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setSaving(false);
    }
  }, [applyLoadedConfig, worktree, trellis, usage, chatgpt]);

  const handleSave = useCallback(async () => {
    await saveConfig("设置已保存。Usage/ChatGPT/Trellis 设置会立即生效，WorkTree 设置会用于下一次创建 New WorkTree。");
  }, [saveConfig]);

  const resetToDefaults = useCallback(() => {
    if (!defaults) return;
    setWorktree(defaults.worktree);
    setTrellis(defaults.trellis);
    setUsage(defaults.usage);
    setChatgpt(defaults.chatgpt);
    setNotice("已在表单中恢复默认值，点击保存后会写入 pi-web.json。");
  }, [defaults]);

  const runTrellisSetupAction = useCallback(async (action: "init" | "update") => {
    if (!cwd || !trellis) return;
    if (dirty) {
      const saved = await saveConfig();
      if (!saved) return;
    }
    setTrellisAction(action);
    setError(null);
    setNotice(null);
    setTrellisOutput(null);
    try {
      const res = await fetch(`/api/trellis/setup/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "init" ? { cwd, developerName: developerName.trim() } : { cwd }),
      });
      const data = await res.json() as TrellisActionResponse;
      if (!res.ok || data.error || !data.status) throw new Error(data.error ?? `HTTP ${res.status}`);
      setTrellisStatus(data.status);
      setTrellisOutput(data.output || "操作完成。");
      if (data.config) {
        setWorktree(data.config.worktree);
        setSavedWorktree(data.config.worktree);
        setTrellis(data.config.trellis);
        setSavedTrellis(data.config.trellis);
        setUsage(data.config.usage);
        setSavedUsage(data.config.usage);
        setChatgpt(data.config.chatgpt);
        setSavedChatgpt(data.config.chatgpt);
        onConfigChange?.();
      }
      setNotice(action === "init" ? "Trellis 已初始化，右侧抽屉已自动启用。" : "Trellis 已更新。");
      void loadTrellisStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTrellisAction(null);
    }
  }, [cwd, developerName, dirty, loadTrellisStatus, onConfigChange, saveConfig, trellis]);

  const renderSectionButton = (id: SettingsSection, label: string, description: string) => {
    const active = section === id;
    return (
      <button
        key={id}
        onClick={() => setSection(id)}
        style={{
          width: "100%",
          textAlign: "left",
          padding: "8px 10px",
          borderRadius: 8,
          border: active ? "1px solid rgba(37,99,235,0.25)" : "1px solid transparent",
          background: active ? "var(--bg-selected)" : "transparent",
          color: active ? "var(--accent)" : "var(--text-muted)",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
        }}
        title={description}
      >
        {label}
      </button>
    );
  };

  const trellisBusy = !!trellisAction || saving;
  const trellisBlockingReason = !cwd
    ? "请先选择工作区。"
    : trellisStatusError
      ? trellisStatusError
      : !developerName.trim()
        ? "请输入 Trellis 开发者名称。"
        : trellisStatus?.blockingReasons[0] ?? null;
  const canInitializeTrellis = !!cwd && !!trellisStatus?.canInitialize && !!developerName.trim() && !trellisBusy && !trellisStatusLoading;
  const canUpdateTrellis = !!cwd && !!trellisStatus?.canUpdate && !trellisBusy && !trellisStatusLoading;

  return (
    <>
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
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
          width: "min(760px, calc(100vw - 40px))",
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
        <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, color: "var(--text)" }}>设置</h2>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted)" }}>配置 pi-web 行为。保存后动态生效，无需重启。</p>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 24, lineHeight: 1, padding: 4 }}
            title="关闭"
          >
            ×
          </button>
        </div>

        <div style={{ display: "flex", minHeight: 0 }}>
          <div style={{ width: 150, borderRight: "1px solid var(--border)", padding: 10, background: "var(--bg-subtle)", flexShrink: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {renderSectionButton("worktree", "WorkTree", "New WorkTree 默认配置")}
            {renderSectionButton("usage", "Usage", "Usage 统计范围")}
            {renderSectionButton("chatgpt", "ChatGPT", "ChatGPT 用量悬浮面板")}
            {renderSectionButton("trellis", "Trellis", "Trellis 面板开关")}
          </div>

          <div style={{ padding: 18, overflow: "auto", flex: 1 }}>
            {loading ? (
              <div style={{ color: "var(--text-muted)", fontSize: 13 }}>正在加载设置…</div>
            ) : worktree && trellis && usage && chatgpt ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {error && <div style={{ padding: "8px 10px", borderRadius: 8, background: "rgba(239,68,68,0.12)", color: "#f87171", fontSize: 12, overflowWrap: "anywhere" }}>{error}</div>}
                {notice && <div style={{ padding: "8px 10px", borderRadius: 8, background: "rgba(37,99,235,0.12)", color: "var(--accent)", fontSize: 12, overflowWrap: "anywhere" }}>{notice}</div>}

                {section === "worktree" ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    <div>
                      <h3 style={{ margin: 0, color: "var(--text)", fontSize: 15 }}>New WorkTree 默认配置</h3>
                      <p style={{ margin: "5px 0 0", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>
                        保存到 <code style={{ fontFamily: "var(--font-mono)", color: "var(--text)", overflowWrap: "anywhere" }}>{configPath}</code>
                        {exists ? "" : "（保存时会自动创建）"}
                      </p>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                      <Field label="基础引用" description="作为 git worktree add 起点的 Git 引用，例如 HEAD、main、origin/main 或某个 commit。">
                        <TextInput value={worktree.baseRef} onChange={(baseRef) => updateWorktree({ baseRef })} placeholder="HEAD" />
                      </Field>
                      <Field label="会话展示方式" description="控制 WorkTree 会话在支持的位置如何分组/展示。当前侧边栏会优先按独立工作目录展示。">
                        <select
                          value={worktree.sessionDisplay}
                          onChange={(e) => updateWorktree({ sessionDisplay: e.target.value as PiWebWorktreeConfig["sessionDisplay"] })}
                          style={inputStyle}
                        >
                          <option value="separate">独立项目条目</option>
                          <option value="tag">在项目内标记</option>
                        </select>
                      </Field>
                    </div>

                    <Field label="分支名模板" description="未手动指定分支名时，用这个模板生成新分支名。默认会生成类似 pi/20260625-153012 的分支。">
                      <TextInput value={worktree.branchNameTemplate} onChange={(branchNameTemplate) => updateWorktree({ branchNameTemplate })} placeholder="pi/{yyyyMMdd-HHmmss}" />
                    </Field>
                    <Field label="基础目录模板" description="先计算 WorkTree 的基础目录。相对路径会基于仓库根目录解析，绝对路径会直接使用。">
                      <TextInput value={worktree.baseDirTemplate} onChange={(baseDirTemplate) => updateWorktree({ baseDirTemplate })} placeholder="{repoParent}/{repoName}.worktrees" />
                    </Field>
                    <Field label="WorkTree 路径模板" description="最终创建 WorkTree 的目标路径。可以引用基础目录、分支名和时间等变量。">
                      <TextInput value={worktree.pathTemplate} onChange={(pathTemplate) => updateWorktree({ pathTemplate })} placeholder="{baseDir}/{branchSlug}" />
                    </Field>

                    <div style={{ padding: 12, borderRadius: 8, background: "var(--bg-subtle)", border: "1px solid var(--border)" }}>
                      <div style={{ fontSize: 12, color: "var(--text)", fontWeight: 600, marginBottom: 8 }}>可用模板变量</div>
                      <div style={{ display: "grid", gridTemplateColumns: "minmax(150px, max-content) 1fr", gap: "7px 12px", alignItems: "baseline" }}>
                        {TEMPLATE_VARIABLES.map((variable) => (
                          <div key={variable.token} style={{ display: "contents" }}>
                            <code style={{ fontFamily: "var(--font-mono)", fontSize: 11, padding: "3px 6px", borderRadius: 5, background: "var(--bg)", color: "var(--text-muted)", border: "1px solid var(--border)" }}>
                              {variable.token}
                            </code>
                            <span style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.45 }}>{variable.description}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : section === "usage" ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    <div>
                      <h3 style={{ margin: 0, color: "var(--text)", fontSize: 15 }}>Usage 统计</h3>
                      <p style={{ margin: "5px 0 0", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>
                        控制左下角 Usage 弹窗扫描哪些 session 文件。保存到 <code style={{ fontFamily: "var(--font-mono)", color: "var(--text)", overflowWrap: "anywhere" }}>{configPath}</code>
                        {exists ? "" : "（保存时会自动创建）"}
                      </p>
                    </div>
                    <ToggleField
                      label="统计时包含已归档 Session"
                      description="开启后 Usage 会同时扫描 sessions 和 sessions-archive；关闭后只统计当前存活的 sessions。已删除的 session 文件不会参与统计。"
                      checked={usage.includeArchived}
                      onChange={(includeArchived) => updateUsage({ includeArchived })}
                    />
                  </div>
                ) : section === "chatgpt" ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    <div>
                      <h3 style={{ margin: 0, color: "var(--text)", fontSize: 15 }}>ChatGPT</h3>
                      <p style={{ margin: "5px 0 0", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>
                        控制 ChatGPT/Codex 账号相关显示。保存到 <code style={{ fontFamily: "var(--font-mono)", color: "var(--text)", overflowWrap: "anywhere" }}>{configPath}</code>
                        {exists ? "" : "（保存时会自动创建）"}
                      </p>
                    </div>
                    <ToggleField
                      label="ChatGPT 用量悬浮面板"
                      description="开启后顶部右侧会显示当前激活 ChatGPT/Codex 账号的半透明用量入口。展开后可手动刷新，并与 Models 中的额度缓存保持一致。"
                      checked={chatgpt.usagePanelEnabled}
                      onChange={(usagePanelEnabled) => updateChatgpt({ usagePanelEnabled })}
                    />
                    <ToggleField
                      label="后台自动刷新所有账号"
                      description="开启后由后端刷新器按下面的节奏刷新所有已保存 ChatGPT/Codex 账号；不会在每个浏览器标签页里各自轮询。"
                      checked={chatgpt.autoRefreshEnabled}
                      onChange={(autoRefreshEnabled) => updateChatgpt({ autoRefreshEnabled })}
                    />
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <Field label="总刷新间隔（秒）" description="每轮自动刷新开始前的基础等待时间。最小 300 秒。">
                        <input type="number" min={300} step={60} value={chatgpt.refreshCycleIntervalSeconds} onChange={(e) => updateChatgpt({ refreshCycleIntervalSeconds: Number.parseInt(e.target.value || "0", 10) })} style={inputStyle} />
                      </Field>
                      <Field label="多账号间隔（秒）" description="一轮刷新中，刷新下一个账号前的基础等待时间。最小 5 秒。">
                        <input type="number" min={5} step={1} value={chatgpt.refreshAccountIntervalSeconds} onChange={(e) => updateChatgpt({ refreshAccountIntervalSeconds: Number.parseInt(e.target.value || "0", 10) })} style={inputStyle} />
                      </Field>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <Field label="总周期随机盐最小（秒）" description="每轮开始前额外随机等待的下限。">
                        <input type="number" min={0} step={1} value={chatgpt.refreshCycleSaltMinSeconds} onChange={(e) => updateChatgpt({ refreshCycleSaltMinSeconds: Number.parseInt(e.target.value || "0", 10) })} style={inputStyle} />
                      </Field>
                      <Field label="总周期随机盐最大（秒）" description="每轮开始前额外随机等待的上限，需大于等于最小值。">
                        <input type="number" min={0} step={1} value={chatgpt.refreshCycleSaltMaxSeconds} onChange={(e) => updateChatgpt({ refreshCycleSaltMaxSeconds: Number.parseInt(e.target.value || "0", 10) })} style={inputStyle} />
                      </Field>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <Field label="账号间随机盐最小（秒）" description="刷新下一个账号前额外随机等待的下限。">
                        <input type="number" min={0} step={1} value={chatgpt.refreshAccountSaltMinSeconds} onChange={(e) => updateChatgpt({ refreshAccountSaltMinSeconds: Number.parseInt(e.target.value || "0", 10) })} style={inputStyle} />
                      </Field>
                      <Field label="账号间随机盐最大（秒）" description="刷新下一个账号前额外随机等待的上限，需大于等于最小值。">
                        <input type="number" min={0} step={1} value={chatgpt.refreshAccountSaltMaxSeconds} onChange={(e) => updateChatgpt({ refreshAccountSaltMaxSeconds: Number.parseInt(e.target.value || "0", 10) })} style={inputStyle} />
                      </Field>
                    </div>
                    <div style={{ padding: 10, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-subtle)", color: "var(--text-dim)", fontSize: 11, lineHeight: 1.5 }}>
                      文件锁过期判断跟随配置：锁超过约 2 × 总刷新间隔未更新时，启动器会把它视为 stale 并尝试接管。
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    <div style={{ padding: 12, borderRadius: 10, background: "var(--bg-subtle)", border: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 8 }}>
                      <div>
                        <h3 style={{ margin: 0, color: "var(--text)", fontSize: 15 }}>Trellis 面板</h3>
                        <p style={{ margin: "5px 0 0", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>
                          面板从当前工作区的 <code style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>.trellis/tasks</code> 读取任务；使用前需要在项目中安装并初始化 Trellis。
                        </p>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                        <a href="https://docs.trytrellis.app/" target="_blank" rel="noreferrer" style={{ color: "var(--accent)", fontSize: 12, fontWeight: 700, textDecoration: "none" }}>
                          打开 Trellis 官方文档 ↗
                        </a>
                        <button
                          type="button"
                          onClick={() => setTrellisWorkflowOpen(true)}
                          disabled={!cwd}
                          title={cwd ? "查看当前工作区的 Trellis 流程" : "请先选择工作区"}
                          style={{ background: "none", border: "none", padding: 0, color: cwd ? "var(--accent)" : "var(--text-dim)", fontSize: 12, fontWeight: 700, cursor: cwd ? "pointer" : "not-allowed" }}
                        >
                          流程设计
                        </button>
                      </div>
                      <div style={{ color: "var(--text-dim)", fontSize: 11, overflowWrap: "anywhere" }}>
                        当前工作区：{cwd ? <code style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>{cwd}</code> : "未选择"}
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <ToggleField
                        label="启用 Trellis 右侧抽屉"
                        description="开启后，主界面右上角会显示 Trellis 按钮；关闭时 UI 入口和 Trellis 任务 API 都不可用。"
                        checked={trellis.enabled}
                        onChange={(enabled) => updateTrellis({ enabled })}
                      />
                      <ToggleField
                        label="默认包含已归档任务"
                        description="开启后，Trellis 面板初次打开会同时读取 .trellis/tasks/archive 下的任务；面板内仍可临时切换。"
                        checked={trellis.includeArchived}
                        onChange={(includeArchived) => updateTrellis({ includeArchived })}
                      />
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 12, borderRadius: 10, background: "var(--bg-subtle)", border: "1px solid var(--border)" }}>
                      <ToggleField
                        label="安装/更新 Trellis 时使用代理"
                        description="只会应用到安装、初始化、更新 Trellis 的子进程，不会修改 pi-web 服务本身的环境变量。建议使用 HTTP(S) 代理地址。"
                        checked={trellis.proxyEnabled}
                        onChange={(proxyEnabled) => updateTrellis({ proxyEnabled })}
                      />
                      <Field label="代理地址" description="示例：https://127.0.0.1:7890。启用代理时会写入 HTTP_PROXY / HTTPS_PROXY / npm_config_proxy 等子进程环境变量。">
                        <TextInput value={trellis.proxyUrl} onChange={(proxyUrl) => updateTrellis({ proxyUrl })} placeholder="http://127.0.0.1:7890" disabled={!trellis.proxyEnabled} />
                      </Field>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 12, borderRadius: 10, background: "var(--bg-subtle)", border: "1px solid var(--border)" }}>
                      <div>
                        <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 800 }}>流程辅助阅读模型</div>
                        <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 3, lineHeight: 1.45 }}>
                          用于解释 workflow.md 节点引导内容：翻译成中文并总结关键动作。只读辅助，不会修改流程文件。
                        </div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 12 }}>
                        <Field label="辅助模型" description="选择“跟随主会话模型”时，后台无法获知当前聊天模型会安全回退到 Pi 默认模型。">
                          <ModelPolicySelect
                            value={trellis.workflowAssistant.model}
                            onChange={(model) => updateWorkflowAssistantPolicy({ model })}
                            models={modelList}
                          />
                        </Field>
                        <Field label="思考强度" description="建议 minimal/low，辅助阅读不需要高推理预算。">
                          <ThinkingSelect
                            value={trellis.workflowAssistant.thinking}
                            onChange={(thinking) => updateWorkflowAssistantPolicy({ thinking })}
                          />
                        </Field>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 12 }}>
                        <Field label="回退模型" description="主辅助模型返回空内容、超时或失败时使用。建议选择不同 provider 或更稳定的模型。">
                          <ModelPolicySelect
                            value={trellis.workflowAssistantFallback.model}
                            onChange={(model) => updateWorkflowAssistantFallbackPolicy({ model })}
                            models={modelList}
                          />
                        </Field>
                        <Field label="回退思考强度" description="通常保持 minimal/low 即可。">
                          <ThinkingSelect
                            value={trellis.workflowAssistantFallback.thinking}
                            onChange={(thinking) => updateWorkflowAssistantFallbackPolicy({ thinking })}
                          />
                        </Field>
                      </div>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 12, borderRadius: 10, background: "var(--bg-subtle)", border: "1px solid var(--border)" }}>
                      <div>
                        <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 800 }}>子代理模型</div>
                        <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 3, lineHeight: 1.45 }}>
                          给 Trellis 派出去的子代理单独选模型。默认跟随当前聊天使用的主模型；如果某次工具调用里手动指定了模型，会优先使用手动指定。
                        </div>
                      </div>
                      {modelsError && <div style={{ padding: "7px 9px", borderRadius: 7, background: "rgba(239,68,68,0.12)", color: "#f87171", fontSize: 11 }}>{modelsError}</div>}
                      <ToggleField
                        label="启用子代理模型设置"
                        description="开启后按下面的规则给子代理选模型；关闭后回到旧行为：只看工具调用参数、agent 文件头配置或 Pi 默认模型。自动分流需要单独打开。"
                        checked={trellis.subagents.enabled}
                        onChange={(enabled) => updateSubagentConfig({ enabled })}
                      />
                      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 12 }}>
                        <Field label="默认子代理模型" description="没有命中特殊规则时，所有子代理都按这个配置走。推荐保持“跟随主会话模型”。">
                          <ModelPolicySelect
                            value={trellis.subagents.defaultPolicy.model}
                            onChange={(model) => updateDefaultSubagentPolicy({ model })}
                            models={modelList}
                            disabled={!trellis.subagents.enabled}
                          />
                        </Field>
                        <Field label="默认思考强度" description="“跟随主会话思考强度”表示使用当前聊天的 thinking 设置。">
                          <ThinkingSelect
                            value={trellis.subagents.defaultPolicy.thinking}
                            onChange={(thinking) => updateDefaultSubagentPolicy({ thinking })}
                            disabled={!trellis.subagents.enabled}
                          />
                        </Field>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 4, borderTop: "1px solid var(--border)" }}>
                        <ToggleField
                          label="启用自动分流选模型"
                          description="开启后先判断任务属于“文本/多模态”和“简单/标准/复杂/关键”哪一类，再按下面的分流表选择子代理模型。默认关闭，避免额外消耗。"
                          checked={trellis.subagents.router.enabled}
                          onChange={(enabled) => updateRouter({ enabled })}
                          disabled={!trellis.subagents.enabled}
                        />
                        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 12 }}>
                          <Field label="分流判断模型" description="这个模型只负责判断任务类别，不执行真正的子任务。可用较便宜/较快的模型。">
                            <ModelPolicySelect
                              value={trellis.subagents.router.model}
                              onChange={(model) => updateRouter({ model })}
                              models={modelList}
                              disabled={!trellis.subagents.enabled || !trellis.subagents.router.enabled}
                            />
                          </Field>
                          <Field label="分流判断思考强度" description="建议 minimal/low，避免“判断该用哪个模型”这一步本身太贵。">
                            <ThinkingSelect
                              value={trellis.subagents.router.thinking}
                              onChange={(thinking) => updateRouter({ thinking })}
                              disabled={!trellis.subagents.enabled || !trellis.subagents.router.enabled}
                            />
                          </Field>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                          <Field label="分流失败时的任务类型" description="分流判断模型失败、超时或输出格式错误时使用。">
                            <select
                              value={trellis.subagents.router.fallbackOnError.modality}
                              onChange={(e) => updateRouter({ fallbackOnError: { ...trellis.subagents.router.fallbackOnError, modality: e.target.value as PiWebSubagentModality } })}
                              disabled={!trellis.subagents.enabled || !trellis.subagents.router.enabled}
                              style={inputStyle}
                            >
                              <option value="text">文本任务</option>
                              <option value="multimodal">多模态任务（图片/截图/视觉）</option>
                            </select>
                          </Field>
                          <Field label="分流失败时的任务等级" description="分流判断不可用时默认按哪个复杂度处理。建议 standard 或 complex。">
                            <select
                              value={trellis.subagents.router.fallbackOnError.tier}
                              onChange={(e) => updateRouter({ fallbackOnError: { ...trellis.subagents.router.fallbackOnError, tier: e.target.value as PiWebSubagentDifficultyTier } })}
                              disabled={!trellis.subagents.enabled || !trellis.subagents.router.enabled}
                              style={inputStyle}
                            >
                              {SUBAGENT_TIERS.map((tier) => <option key={tier} value={tier}>{SUBAGENT_TIER_LABELS[tier]}</option>)}
                            </select>
                          </Field>
                        </div>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4, borderTop: "1px solid var(--border)" }}>
                        <div style={{ fontSize: 12, color: "var(--text)", fontWeight: 700 }}>分流模型表</div>
                        <div style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.45 }}>按“任务类型 × 任务等级”给子代理指定模型。比如：简单文本任务用便宜模型，复杂实现任务用更强模型，多模态任务用支持图片的模型。</div>
                        {SUBAGENT_MODALITIES.map((modality) => (
                          <div key={modality} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 700 }}>{SUBAGENT_MODALITY_LABELS[modality]}</div>
                            {SUBAGENT_TIERS.map((tier) => {
                              const policy = trellis.subagents.routes[modality][tier];
                              return (
                                <div key={`${modality}-${tier}`} style={{ display: "grid", gridTemplateColumns: "90px minmax(180px, 1fr) 120px", gap: 8, alignItems: "center" }}>
                                  <span title={tier} style={{ fontSize: 11, color: "var(--text-dim)" }}>{SUBAGENT_TIER_LABELS[tier]}</span>
                                  <ModelPolicySelect
                                    value={policy.model}
                                    onChange={(model) => updateRoutePolicy(modality, tier, { model })}
                                    models={modelList}
                                    disabled={!trellis.subagents.enabled || !trellis.subagents.router.enabled}
                                  />
                                  <ThinkingSelect
                                    value={policy.thinking}
                                    onChange={(thinking) => updateRoutePolicy(modality, tier, { thinking })}
                                    disabled={!trellis.subagents.enabled || !trellis.subagents.router.enabled}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <div style={{ fontSize: 12, color: "var(--text)", fontWeight: 700 }}>按 Agent 单独覆盖</div>
                        {SUBAGENT_AGENT_NAMES.map((agent) => {
                          const agentConfig = trellis.subagents.agents[agent] ?? { strategy: "default" as const };
                          const fixed = agentConfig.fixed ?? trellis.subagents.defaultPolicy;
                          const fixedDisabled = !trellis.subagents.enabled || agentConfig.strategy !== "fixed";
                          return (
                            <div key={agent} style={{ display: "grid", gridTemplateColumns: "150px 120px minmax(180px, 1fr) 120px", gap: 8, alignItems: "center" }}>
                              <code style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis" }}>{agent}</code>
                              <select
                                value={agentConfig.strategy}
                                onChange={(e) => updateSubagentAgent(agent, { strategy: e.target.value as PiWebSubagentAgentConfig["strategy"] })}
                                disabled={!trellis.subagents.enabled}
                                style={{ ...inputStyle, opacity: trellis.subagents.enabled ? 1 : 0.6 }}
                              >
                                <option value="default">使用默认规则</option>
                                <option value="route">总是自动分流</option>
                                <option value="fixed">固定指定模型</option>
                                <option value="disabled">不使用这里的设置</option>
                              </select>
                              <ModelPolicySelect
                                value={fixed.model}
                                onChange={(model) => updateSubagentAgent(agent, { fixed: { ...fixed, model } })}
                                models={modelList}
                                disabled={fixedDisabled}
                              />
                              <ThinkingSelect
                                value={fixed.thinking}
                                onChange={(thinking) => updateSubagentAgent(agent, { fixed: { ...fixed, thinking } })}
                                disabled={fixedDisabled}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div style={{ padding: 12, borderRadius: 10, background: "var(--bg-subtle)", border: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                        <div>
                          <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 800 }}>Trellis 巡检</div>
                          <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 3 }}>{trellisStatus ? formatRecommendedAction(trellisStatus) : (cwd ? "正在检查当前工作区…" : "选择工作区后可检查和初始化 Trellis。")}</div>
                        </div>
                        <button
                          onClick={() => void loadTrellisStatus()}
                          disabled={!cwd || trellisStatusLoading || trellisBusy}
                          style={{ padding: "6px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text-muted)", cursor: !cwd || trellisStatusLoading || trellisBusy ? "not-allowed" : "pointer", fontSize: 12 }}
                        >
                          {trellisStatusLoading ? "巡检中…" : "重新巡检"}
                        </button>
                      </div>

                      {trellisStatusError && <div style={{ padding: "8px 10px", borderRadius: 8, background: "rgba(239,68,68,0.12)", color: "#f87171", fontSize: 12, overflowWrap: "anywhere" }}>{trellisStatusError}</div>}
                      {trellisStatus && (
                        <div>
                          <StatusRow label="操作系统" value={`${trellisStatus.platform}${trellisStatus.supportedOs ? "" : "（不支持）"}`} ok={trellisStatus.supportedOs} />
                          <StatusRow label="Node.js" value={trellisStatus.node.version ?? "未检测到"} ok={trellisStatus.node.ok} detail={trellisStatus.node.required} />
                          <StatusRow label="Python" value={trellisStatus.python.version ? `${trellisStatus.python.version} (${trellisStatus.python.command ?? "python"})` : (trellisStatus.python.error ?? "未检测到")} ok={trellisStatus.python.ok} detail={trellisStatus.python.required} />
                          <StatusRow label="Trellis CLI" value={trellisStatus.cli.installed ? (trellisStatus.cli.version ?? "已安装") : "未安装，初始化/更新时会自动安装"} ok={trellisStatus.cli.installed} detail={trellisStatus.cli.error} />
                          <StatusRow label="项目 .trellis" value={trellisStatus.project.hasTrellisDir ? `已存在${trellisStatus.project.version ? ` · ${trellisStatus.project.version}` : ""}` : "未初始化"} ok={trellisStatus.project.hasTrellisDir} />
                          <StatusRow label="任务目录" value={trellisStatus.project.hasTasksDir ? ".trellis/tasks 已存在" : "尚未创建"} ok={trellisStatus.project.hasTasksDir} />
                          <StatusRow label="开发者身份" value={trellisStatus.project.developerName ?? "未写入 .trellis/.developer"} ok={trellisStatus.project.hasDeveloperIdentity} />
                        </div>
                      )}
                    </div>

                    <Field label="Trellis 开发者名称" description="用于 trellis init -u；默认来自已检测到的 Trellis 身份，否则使用系统用户名。可编辑，不能为空。">
                      <TextInput
                        value={developerName}
                        onChange={(value) => {
                          setDeveloperNameTouched(true);
                          setDeveloperName(value);
                        }}
                        placeholder="your-name"
                      />
                    </Field>

                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <button
                        onClick={() => void runTrellisSetupAction("init")}
                        disabled={!canInitializeTrellis}
                        title={canInitializeTrellis ? "安装并初始化 Trellis" : trellisBlockingReason ?? "当前工作区已安装 Trellis，请使用更新"}
                        style={{ padding: "8px 12px", borderRadius: 8, border: "none", background: canInitializeTrellis ? "var(--accent)" : "var(--border)", color: "white", cursor: canInitializeTrellis ? "pointer" : "not-allowed", fontSize: 12, fontWeight: 700 }}
                      >
                        {trellisAction === "init" ? "正在初始化…" : "安装并初始化 Trellis"}
                      </button>
                      <button
                        onClick={() => void runTrellisSetupAction("update")}
                        disabled={!canUpdateTrellis}
                        title={canUpdateTrellis ? "更新 Trellis" : trellisBlockingReason ?? "当前工作区还没有 Trellis，请先初始化"}
                        style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: canUpdateTrellis ? "var(--text)" : "var(--text-dim)", cursor: canUpdateTrellis ? "pointer" : "not-allowed", fontSize: 12, fontWeight: 700 }}
                      >
                        {trellisAction === "update" ? "正在更新…" : "更新 Trellis"}
                      </button>
                      {!canInitializeTrellis && !canUpdateTrellis && trellisBlockingReason && <span style={{ color: "var(--text-dim)", fontSize: 11 }}>{trellisBlockingReason}</span>}
                    </div>

                    {trellisOutput && (
                      <pre style={{ margin: 0, maxHeight: 180, overflow: "auto", padding: 10, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text-muted)", fontSize: 11, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                        {trellisOutput}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ color: "#f87171", fontSize: 13 }}>{error ?? "无法加载设置"}</div>
            )}
          </div>
        </div>

        <div style={{ padding: "12px 18px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 10 }}>
          <button
            onClick={resetToDefaults}
            disabled={!defaults || loading || saving}
            style={{ padding: "7px 12px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text-muted)", cursor: !defaults || loading || saving ? "not-allowed" : "pointer", fontSize: 12 }}
          >
            恢复默认值
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {dirty && <span style={{ fontSize: 12, color: "var(--text-dim)" }}>有未保存更改</span>}
            <button
              onClick={onClose}
              style={{ padding: "7px 12px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}
            >
              取消
            </button>
            <button
              onClick={() => void handleSave()}
              disabled={!worktree || !trellis || !usage || !chatgpt || loading || saving || !dirty}
              style={{ padding: "7px 14px", borderRadius: 7, border: "none", background: !worktree || !trellis || !usage || !chatgpt || loading || saving || !dirty ? "var(--border)" : "var(--accent)", color: "white", cursor: !worktree || !trellis || !usage || !chatgpt || loading || saving || !dirty ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 600 }}
            >
              {saving ? "正在保存…" : "保存"}
            </button>
          </div>
        </div>
      </div>
    </div>
    {trellisWorkflowOpen && <TrellisWorkflowVisualizer cwd={cwd} onClose={() => setTrellisWorkflowOpen(false)} />}
    </>
  );
}
