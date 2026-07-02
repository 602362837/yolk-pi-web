"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ModelSelect, type ModelSelectOption } from "./ModelSelect";
import { SelectDropdown, type SelectDropdownOption } from "./SelectDropdown";
import { TrellisWorkflowVisualizer } from "./TrellisWorkflowVisualizer";
import type {
  PiWebChatGptConfig,
  PiWebConfig,
  PiWebEditorConfig,
  PiWebSubagentAgentConfig,
  PiWebSubagentDifficultyTier,
  PiWebSubagentModelRef,
  PiWebStudioConfig,
  PiWebSubagentModality,
  PiWebSubagentRunPolicy,
  PiWebTerminalConfig,
  PiWebToolPreset,
  PiWebTrellisConfig,
  PiWebUsageConfig,
  PiWebWorktreeConfig,
  PiWebYolkConfig,
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

type SettingsSection = "yolk" | "worktree" | "studio" | "usage" | "terminal" | "chatgpt" | "editor" | "trellis";
type SubagentThinkingOption = PiWebSubagentRunPolicy["thinking"];

const STUDIO_MEMBER_NAMES = ["architect", "ui-designer", "implementer", "checker"] as const;
const STUDIO_MEMBER_LABELS: Record<(typeof STUDIO_MEMBER_NAMES)[number], string> = {
  architect: "架构师",
  "ui-designer": "UI 设计员",
  implementer: "实现员",
  checker: "检查员",
};
const SUBAGENT_AGENT_NAMES = ["trellis-design", "trellis-implement", "trellis-check", "trellis-research"];
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
const TOOL_PRESET_OPTIONS: SelectDropdownOption[] = [
  { value: "none", label: "off", description: "无工具，纯聊天" },
  { value: "default", label: "default", description: "4 项内置工具" },
  { value: "full", label: "full", description: "全部内置工具" },
  { value: "subagent", label: "subagent", description: "全部工具 + subagent 委派" },
];

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
  const options = useMemo<ModelSelectOption[]>(() => [
    { value: "followMain", label: "跟随主会话模型", detail: "策略", group: "模型策略", keywords: ["main", "current", "follow"] },
    { value: "piDefault", label: "使用 Pi 默认模型", detail: "策略", group: "模型策略", keywords: ["pi", "default"] },
    { value: "unset", label: "本层不指定", detail: "策略", group: "模型策略", keywords: ["unset", "none", "inherit"] },
    ...models.map((model) => ({
      value: `specific:${model.provider}/${model.id}`,
      label: model.name,
      detail: `${model.provider}/${model.id}`,
      provider: model.provider,
      modelId: model.id,
      keywords: [model.name, model.provider, model.id, `${model.provider}/${model.name}`],
    })),
  ], [models]);

  const selectedValue = formatModelValue(value);
  const fallbackLabel = value.mode === "specific"
    ? `${value.provider ?? "unknown"}/${value.modelId ?? "unknown"}`
    : null;

  return (
    <ModelSelect
      value={selectedValue}
      options={options}
      onChange={(nextValue) => onChange(parseModelValue(nextValue))}
      disabled={disabled}
      fallbackLabel={fallbackLabel}
      size="field"
      placement="auto"
      ariaLabel="选择模型"
    />
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
  const options = useMemo<SelectDropdownOption[]>(() => (
    SUBAGENT_THINKING_OPTIONS.map((option) => ({
      value: option,
      label: option === "inherit" ? "跟随主会话思考强度" : option === "off" ? "关闭思考" : option,
    }))
  ), []);

  return (
    <SelectDropdown
      value={value}
      options={options}
      onChange={(nextValue) => onChange(nextValue as SubagentThinkingOption)}
      disabled={disabled}
      size="field"
      placement="auto"
      ariaLabel="选择思考强度"
    />
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

function splitShellWords(line: string): string[] {
  const words: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;
  for (const char of line) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaping = true;
      continue;
    }
    if ((char === "'" || char === '"') && !quote) {
      quote = char;
      continue;
    }
    if (quote === char) {
      quote = null;
      continue;
    }
    if (/\s/.test(char) && !quote) {
      if (current) words.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) words.push(current);
  return words;
}

function parseRawEnv(text: string): { env: Record<string, string>; errors: string[] } {
  const env: Record<string, string> = {};
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const words = splitShellWords(trimmed);
    const candidates = words[0] === "export" ? words.slice(1) : words;
    let parsedAny = false;
    for (const word of candidates) {
      const eq = word.indexOf("=");
      if (eq <= 0) continue;
      const key = word.slice(0, eq).trim();
      const value = word.slice(eq + 1);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        errors.push(`第 ${index + 1} 行变量名无效：${key}`);
        continue;
      }
      env[key] = value;
      parsedAny = true;
    }
    if (!parsedAny) errors.push(`第 ${index + 1} 行没有可解析的 KEY=VALUE`);
  });
  return { env, errors };
}

function formatRecommendedAction(status: TrellisSetupStatus): string {
  if (status.recommendedAction === "fix-prerequisites") return "请先完成系统前置要求，然后再安装或更新 Trellis。";
  if (status.recommendedAction === "initialize") {
    return status.cli.installed
      ? "当前工作区还没有 Trellis。启用 Trellis 面板后，可在面板打开初始化命令并手动执行。"
      : "当前工作区还没有 Trellis，且尚未检测到 Trellis CLI。请先安装 CLI。";
  }
  if (status.recommendedAction === "update") return "当前工作区已有 Trellis，请使用更新操作同步 CLI 和项目模板。";
  if (status.recommendedAction === "ready") return "当前工作区已启用 Trellis，可直接使用面板，也可以执行更新。";
  return "请选择工作区。";
}

function yolkConfigsEqual(a: PiWebYolkConfig | null, b: PiWebYolkConfig | null): boolean {
  if (!a || !b) return a === b;
  return a.defaultToolPreset === b.defaultToolPreset;
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

function studioConfigsEqual(a: PiWebStudioConfig | null, b: PiWebStudioConfig | null): boolean {
  if (!a || !b) return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}

function usageConfigsEqual(a: PiWebUsageConfig | null, b: PiWebUsageConfig | null): boolean {
  if (!a || !b) return a === b;
  return a.includeArchived === b.includeArchived;
}

function terminalConfigsEqual(a: PiWebTerminalConfig | null, b: PiWebTerminalConfig | null): boolean {
  if (!a || !b) return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}

function chatGptConfigsEqual(a: PiWebChatGptConfig | null, b: PiWebChatGptConfig | null): boolean {
  if (!a || !b) return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}

function editorConfigsEqual(a: PiWebEditorConfig | null, b: PiWebEditorConfig | null): boolean {
  if (!a || !b) return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}

export function SettingsConfig({
  cwd,
  onClose,
  onConfigChange,
  terminalEnabled = false,
  onOpenTerminalCommand,
}: {
  cwd: string | null;
  onClose: () => void;
  onConfigChange?: () => void;
  terminalEnabled?: boolean;
  onOpenTerminalCommand?: (cwd: string, command: string) => void;
}) {
  const [section, setSection] = useState<SettingsSection>("yolk");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [configPath, setConfigPath] = useState("");
  const [exists, setExists] = useState(false);
  const [defaults, setDefaults] = useState<PiWebConfig | null>(null);
  const [yolk, setYolk] = useState<PiWebYolkConfig | null>(null);
  const [savedYolk, setSavedYolk] = useState<PiWebYolkConfig | null>(null);
  const [worktree, setWorktree] = useState<PiWebWorktreeConfig | null>(null);
  const [savedWorktree, setSavedWorktree] = useState<PiWebWorktreeConfig | null>(null);
  const [trellis, setTrellis] = useState<PiWebTrellisConfig | null>(null);
  const [savedTrellis, setSavedTrellis] = useState<PiWebTrellisConfig | null>(null);
  const [studio, setStudio] = useState<PiWebStudioConfig | null>(null);
  const [savedStudio, setSavedStudio] = useState<PiWebStudioConfig | null>(null);
  const [usage, setUsage] = useState<PiWebUsageConfig | null>(null);
  const [savedUsage, setSavedUsage] = useState<PiWebUsageConfig | null>(null);
  const [terminal, setTerminal] = useState<PiWebTerminalConfig | null>(null);
  const [savedTerminal, setSavedTerminal] = useState<PiWebTerminalConfig | null>(null);
  const [rawEnvImport, setRawEnvImport] = useState("");
  const [terminalEnvAssistLoading, setTerminalEnvAssistLoading] = useState(false);
  const [chatgpt, setChatgpt] = useState<PiWebChatGptConfig | null>(null);
  const [savedChatgpt, setSavedChatgpt] = useState<PiWebChatGptConfig | null>(null);
  const [editor, setEditor] = useState<PiWebEditorConfig | null>(null);
  const [savedEditor, setSavedEditor] = useState<PiWebEditorConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [trellisStatus, setTrellisStatus] = useState<TrellisSetupStatus | null>(null);
  const [trellisStatusLoading, setTrellisStatusLoading] = useState(false);
  const [trellisStatusError, setTrellisStatusError] = useState<string | null>(null);
  const [trellisAction, setTrellisAction] = useState<"install" | "update" | null>(null);
  const [trellisOutput, setTrellisOutput] = useState<string | null>(null);
  const [trellisWorkflowOpen, setTrellisWorkflowOpen] = useState(false);
  const [modelList, setModelList] = useState<ModelListItem[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);


  const dirty = useMemo(
    () => !yolkConfigsEqual(yolk, savedYolk) || !worktreeConfigsEqual(worktree, savedWorktree) || !trellisConfigsEqual(trellis, savedTrellis) || !studioConfigsEqual(studio, savedStudio) || !usageConfigsEqual(usage, savedUsage) || !terminalConfigsEqual(terminal, savedTerminal) || !chatGptConfigsEqual(chatgpt, savedChatgpt) || !editorConfigsEqual(editor, savedEditor),
    [yolk, savedYolk, worktree, savedWorktree, trellis, savedTrellis, studio, savedStudio, usage, savedUsage, terminal, savedTerminal, chatgpt, savedChatgpt, editor, savedEditor],
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
      setYolk(data.config.yolk);
      setSavedYolk(data.config.yolk);
      setWorktree(data.config.worktree);
      setSavedWorktree(data.config.worktree);
      setTrellis(data.config.trellis);
      setSavedTrellis(data.config.trellis);
      setStudio(data.config.studio);
      setSavedStudio(data.config.studio);
      setUsage(data.config.usage);
      setSavedUsage(data.config.usage);
      setTerminal(data.config.terminal);
      setSavedTerminal(data.config.terminal);
      setChatgpt(data.config.chatgpt);
      setSavedChatgpt(data.config.chatgpt);
      setEditor(data.config.editor);
      setSavedEditor(data.config.editor);
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
      setTrellisStatus(data.status);
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") return;
      setTrellisStatus(null);
      setTrellisStatusError(err instanceof Error ? err.message : String(err));
    } finally {
      setTrellisStatusLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    const controller = new AbortController();
    void loadConfig(controller.signal);
    return () => controller.abort();
  }, [loadConfig]);

  useEffect(() => {
    setTrellisOutput(null);
  }, [cwd]);

  useEffect(() => {
    if (section !== "trellis" && section !== "terminal" && section !== "studio") return;
    const controller = new AbortController();
    if (section === "trellis") void loadTrellisStatus(controller.signal);
    void loadModels(controller.signal);
    return () => controller.abort();
  }, [section, loadModels, loadTrellisStatus]);

  const updateYolk = useCallback((patch: Partial<PiWebYolkConfig>) => {
    setYolk((prev) => prev ? { ...prev, ...patch } : prev);
    setNotice(null);
  }, []);

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

  const updateStudioDefaultPolicy = useCallback((patch: Partial<PiWebSubagentRunPolicy>) => {
    setStudio((prev) => prev ? { ...prev, defaultPolicy: { ...prev.defaultPolicy, ...patch } } : prev);
    setNotice(null);
  }, []);

  const updateStudioMemberPolicy = useCallback((member: string, patch: Partial<PiWebSubagentRunPolicy>) => {
    setStudio((prev) => {
      if (!prev) return prev;
      const current = prev.members[member] ?? prev.defaultPolicy;
      return {
        ...prev,
        members: {
          ...prev.members,
          [member]: { ...current, ...patch },
        },
      };
    });
    setNotice(null);
  }, []);

  const updateChatgpt = useCallback((patch: Partial<PiWebChatGptConfig>) => {
    setChatgpt((prev) => prev ? { ...prev, ...patch } : prev);
    setNotice(null);
  }, []);

  const updateEditor = useCallback((patch: Partial<PiWebEditorConfig>) => {
    setEditor((prev) => prev ? { ...prev, ...patch } : prev);
    setNotice(null);
  }, []);

  const updateEditorShortcuts = useCallback((patch: Partial<PiWebEditorConfig["shortcuts"]>) => {
    setEditor((prev) => prev ? { ...prev, shortcuts: { ...prev.shortcuts, ...patch } } : prev);
    setNotice(null);
  }, []);

  const updateTerminal = useCallback((patch: Partial<PiWebTerminalConfig>) => {
    setTerminal((prev) => prev ? { ...prev, ...patch } : prev);
    setNotice(null);
  }, []);

  const updateTerminalEnv = useCallback((key: string, nextKey: string, value: string) => {
    setTerminal((prev) => {
      if (!prev) return prev;
      const nextEnv = { ...prev.env };
      delete nextEnv[key];
      if (nextKey) nextEnv[nextKey] = value;
      return { ...prev, env: nextEnv };
    });
    setNotice(null);
  }, []);

  const deleteTerminalEnv = useCallback((key: string) => {
    setTerminal((prev) => {
      if (!prev) return prev;
      const nextEnv = { ...prev.env };
      delete nextEnv[key];
      return { ...prev, env: nextEnv };
    });
    setNotice(null);
  }, []);

  const importRawEnv = useCallback(() => {
    const parsed = parseRawEnv(rawEnvImport);
    if (parsed.errors.length > 0) {
      setError(parsed.errors.join("；"));
      return;
    }
    setTerminal((prev) => prev ? { ...prev, env: { ...prev.env, ...parsed.env } } : prev);
    setRawEnvImport("");
    setError(null);
    setNotice("已解析 raw env 并填入环境变量表格，保存后写入配置。");
  }, [rawEnvImport]);

  const importRawEnvWithAi = useCallback(async () => {
    if (!cwd || !rawEnvImport.trim()) return;
    setTerminalEnvAssistLoading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/terminal/env/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, raw: rawEnvImport }),
      });
      const data = await res.json() as { env?: Record<string, string>; error?: string };
      if (!res.ok || data.error || !data.env) throw new Error(data.error ?? `HTTP ${res.status}`);
      setTerminal((prev) => prev ? { ...prev, env: { ...prev.env, ...data.env } } : prev);
      setRawEnvImport("");
      setNotice("AI 已解析 raw env 并填入环境变量表格，保存后写入配置。");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTerminalEnvAssistLoading(false);
    }
  }, [cwd, rawEnvImport]);

  const updateTerminalEnvAssistantPolicy = useCallback((patch: Partial<PiWebSubagentRunPolicy>) => {
    setTerminal((prev) => prev ? { ...prev, envAssistant: { ...prev.envAssistant, ...patch } } : prev);
    setNotice(null);
  }, []);

  const updateTerminalEnvAssistantFallbackPolicy = useCallback((patch: Partial<PiWebSubagentRunPolicy>) => {
    setTerminal((prev) => prev ? { ...prev, envAssistantFallback: { ...prev.envAssistantFallback, ...patch } } : prev);
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
    setYolk(config.yolk);
    setSavedYolk(config.yolk);
    setWorktree(config.worktree);
    setSavedWorktree(config.worktree);
    setTrellis(config.trellis);
    setSavedTrellis(config.trellis);
    setStudio(config.studio);
    setSavedStudio(config.studio);
    setUsage(config.usage);
    setSavedUsage(config.usage);
    setTerminal(config.terminal);
    setSavedTerminal(config.terminal);
    setChatgpt(config.chatgpt);
    setSavedChatgpt(config.chatgpt);
    setEditor(config.editor);
    setSavedEditor(config.editor);
    setConfigPath(path);
    setExists(configExists);
    onConfigChange?.();
  }, [onConfigChange]);

  const saveConfig = useCallback(async (successNotice?: string): Promise<boolean> => {
    if (!yolk || !worktree || !trellis || !studio || !usage || !terminal || !chatgpt || !editor) return false;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/web-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yolk, worktree, trellis, studio, usage, terminal, chatgpt, editor }),
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
  }, [applyLoadedConfig, yolk, worktree, trellis, studio, usage, terminal, chatgpt, editor]);

  const handleSave = useCallback(async () => {
    await saveConfig("设置已保存。蛋黄𝝅/Studio/Usage/ChatGPT/Trellis/Editor 设置会立即生效，WorkTree 设置会用于下一次创建 New WorkTree。");
  }, [saveConfig]);

  const resetToDefaults = useCallback(() => {
    if (!defaults) return;
    setYolk(defaults.yolk);
    setWorktree(defaults.worktree);
    setTrellis(defaults.trellis);
    setStudio(defaults.studio);
    setUsage(defaults.usage);
    setTerminal(defaults.terminal);
    setChatgpt(defaults.chatgpt);
    setEditor(defaults.editor);
    setNotice("已在表单中恢复默认值，点击保存后会写入 pi-web.json。");
  }, [defaults]);

  const runTrellisInstallAction = useCallback(async () => {
    if (!trellis) return;
    if (dirty) {
      const saved = await saveConfig();
      if (!saved) return;
    }
    setTrellisAction("install");
    setError(null);
    setNotice(null);
    setTrellisOutput(null);
    try {
      const res = await fetch("/api/trellis/setup/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd }),
      });
      const data = await res.json() as TrellisActionResponse;
      if (!res.ok || data.error || !data.status) throw new Error(data.error ?? `HTTP ${res.status}`);
      setTrellisStatus(data.status);
      setTrellisOutput(data.output || "操作完成。");
      setNotice("Trellis CLI 已安装。开启 Trellis 面板后，可在未初始化工作区中打开初始化命令并手动执行。");
      void loadTrellisStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTrellisAction(null);
    }
  }, [cwd, dirty, loadTrellisStatus, saveConfig, trellis]);

  const openTrellisUpdateInTerminal = useCallback(async () => {
    if (!cwd || !trellis || !terminalEnabled || !onOpenTerminalCommand) return;
    if (dirty) {
      const saved = await saveConfig();
      if (!saved) return;
    }
    setNotice(null);
    setError(null);
    onOpenTerminalCommand(cwd, "trellis update");
    onClose();
  }, [cwd, dirty, onClose, onOpenTerminalCommand, saveConfig, terminalEnabled, trellis]);

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
      : trellisStatus?.blockingReasons[0] ?? null;
  const canInstallTrellisCli = !trellisStatus?.cli.installed && !trellisBusy && !trellisStatusLoading;
  const canUpdateTrellis = !!cwd && !!trellisStatus?.canUpdate && terminalEnabled && !!onOpenTerminalCommand && !trellisBusy && !trellisStatusLoading;

  return (
    <>
    <div
      className="pi-modal-overlay"
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
        className="pi-modal-panel settings-modal-panel"
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
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted)" }}>配置 yolk pi web 行为。保存后动态生效，无需重启。</p>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 24, lineHeight: 1, padding: 4 }}
            title="关闭"
          >
            ×
          </button>
        </div>

        <div className="settings-modal-body" style={{ display: "flex", minHeight: 0 }}>
          <div style={{ width: 150, borderRight: "1px solid var(--border)", padding: 10, background: "var(--bg-subtle)", flexShrink: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {renderSectionButton("yolk", "蛋黄𝝅", "新会话默认聊天行为")}
            {renderSectionButton("worktree", "WorkTree", "New WorkTree 默认配置")}
            {renderSectionButton("studio", "Studio", "YPI Studio 成员模型")}
            {renderSectionButton("usage", "Usage", "Usage 统计范围")}
            {renderSectionButton("terminal", "Terminal", "Web 终端设置")}
            {renderSectionButton("chatgpt", "ChatGPT", "ChatGPT 用量悬浮面板")}
            {renderSectionButton("editor", "Editor", "文件编辑器和快捷键")}
            {renderSectionButton("trellis", "Trellis", "Trellis 面板开关")}
          </div>

          <div style={{ padding: 18, overflow: "auto", flex: 1 }}>
            {loading ? (
              <div style={{ color: "var(--text-muted)", fontSize: 13 }}>正在加载设置…</div>
            ) : yolk && worktree && trellis && studio && usage && terminal && chatgpt && editor ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {error && <div style={{ padding: "8px 10px", borderRadius: 8, background: "rgba(239,68,68,0.12)", color: "#f87171", fontSize: 12, overflowWrap: "anywhere" }}>{error}</div>}
                {notice && <div style={{ padding: "8px 10px", borderRadius: 8, background: "rgba(37,99,235,0.12)", color: "var(--accent)", fontSize: 12, overflowWrap: "anywhere" }}>{notice}</div>}

                {section === "yolk" ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    <div>
                      <h3 style={{ margin: 0, color: "var(--text)", fontSize: 15 }}>蛋黄𝝅 默认配置</h3>
                      <p style={{ margin: "5px 0 0", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>
                        控制新聊天的默认交互行为。保存到 <code style={{ fontFamily: "var(--font-mono)", color: "var(--text)", overflowWrap: "anywhere" }}>{configPath}</code>
                        {exists ? "" : "（保存时会自动创建）"}
                      </p>
                    </div>
                    <Field label="默认工具预设" description="新建会话时默认选中的工具预设。仍可在输入框右下角随时手动切换；已有会话会保留当前工具状态。">
                      <SelectDropdown
                        value={yolk.defaultToolPreset}
                        options={TOOL_PRESET_OPTIONS}
                        onChange={(defaultToolPreset) => updateYolk({ defaultToolPreset: defaultToolPreset as PiWebToolPreset })}
                        ariaLabel="选择默认工具预设"
                      />
                    </Field>
                  </div>
                ) : section === "worktree" ? (
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
                        <SelectDropdown
                          value={worktree.sessionDisplay}
                          options={[
                            { value: "separate", label: "独立项目条目" },
                            { value: "tag", label: "在项目内标记" },
                          ]}
                          onChange={(sessionDisplay) => updateWorktree({ sessionDisplay: sessionDisplay as PiWebWorktreeConfig["sessionDisplay"] })}
                          ariaLabel="选择 WorkTree 会话展示方式"
                        />
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
                ) : section === "studio" ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    <div>
                      <h3 style={{ margin: 0, color: "var(--text)", fontSize: 15 }}>YPI Studio 成员运行策略</h3>
                      <p style={{ margin: "5px 0 0", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>
                        配置工作室成员运行时使用的模型与思考强度。该配置保存在本机 <code style={{ fontFamily: "var(--font-mono)", color: "var(--text)", overflowWrap: "anywhere" }}>{configPath}</code>，不会写入项目 <code style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>.ypi/agents</code>。
                        {exists ? "" : "（保存时会自动创建）"}
                      </p>
                    </div>
                    {modelsError && <div style={{ padding: "7px 9px", borderRadius: 7, background: "rgba(239,68,68,0.12)", color: "#f87171", fontSize: 11 }}>{modelsError}</div>}
                    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 12, borderRadius: 10, background: "var(--bg-subtle)", border: "1px solid var(--border)" }}>
                      <div>
                        <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 800 }}>默认策略</div>
                        <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 3, lineHeight: 1.45 }}>当成员没有独立策略，或成员模型策略选择“本层不指定”时使用。显式工具调用入参会覆盖这里的配置。</div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 12 }}>
                        <Field label="默认模型" description="推荐保持跟随主会话；无法解析时会退回 Pi 默认。">
                          <ModelPolicySelect value={studio.defaultPolicy.model} onChange={(model) => updateStudioDefaultPolicy({ model })} models={modelList} />
                        </Field>
                        <Field label="默认思考强度" description="inherit 表示跟随当前聊天 thinking。">
                          <ThinkingSelect value={studio.defaultPolicy.thinking} onChange={(thinking) => updateStudioDefaultPolicy({ thinking })} />
                        </Field>
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 12, borderRadius: 10, background: "var(--bg-subtle)", border: "1px solid var(--border)" }}>
                      <div>
                        <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 800 }}>默认成员</div>
                        <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 3, lineHeight: 1.45 }}>成员职责定义仍来自 .ypi/agents；运行模型和 thinking 在这里单独配置。</div>
                      </div>
                      {STUDIO_MEMBER_NAMES.map((member) => {
                        const policy = studio.members[member] ?? studio.defaultPolicy;
                        return (
                          <div key={member} style={{ display: "grid", gridTemplateColumns: "132px minmax(180px, 1fr) 120px", gap: 8, alignItems: "center" }}>
                            <div style={{ minWidth: 0 }}>
                              <code style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis" }}>{member}</code>
                              <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{STUDIO_MEMBER_LABELS[member]}</span>
                            </div>
                            <ModelPolicySelect value={policy.model} onChange={(model) => updateStudioMemberPolicy(member, { model })} models={modelList} />
                            <ThinkingSelect value={policy.thinking} onChange={(thinking) => updateStudioMemberPolicy(member, { thinking })} />
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ padding: 10, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-subtle)", color: "var(--text-dim)", fontSize: 11, lineHeight: 1.5 }}>
                      优先级：工具入参 model/thinking &gt; 成员配置 &gt; 默认策略 &gt; 主会话 &gt; Pi 默认。YPI child 进程会设置 Trellis 子进程禁用标志，避免成员流程受 Trellis 注入影响。
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
                ) : section === "terminal" ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    <div>
                      <h3 style={{ margin: 0, color: "var(--text)", fontSize: 15 }}>Web 终端</h3>
                      <p style={{ margin: "5px 0 0", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>
                        控制本地 Web 终端。环境变量会明文保存到 <code style={{ fontFamily: "var(--font-mono)", color: "var(--text)", overflowWrap: "anywhere" }}>{configPath}</code>
                        {exists ? "" : "（保存时会自动创建）"}
                      </p>
                    </div>
                    <ToggleField
                      label="启用 Web 终端"
                      description="开启后主界面会显示 Terminal 按钮；后端 API 也会检查这个开关，关闭时不能启动终端。"
                      checked={terminal.enabled}
                      onChange={(enabled) => updateTerminal({ enabled })}
                    />
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <Field label="终端类型" description="Windows 可选择 cmd、Windows PowerShell 或 PowerShell 7；选择 custom 时会使用下面填写的绝对路径。">
                        <SelectDropdown
                          value={terminal.shell}
                          options={[
                            { value: "zsh", label: "zsh" },
                            { value: "bash", label: "bash" },
                            { value: "sh", label: "sh" },
                            { value: "cmd", label: "cmd" },
                            { value: "powershell", label: "Windows PowerShell" },
                            { value: "pwsh", label: "PowerShell 7" },
                            { value: "custom", label: "custom path" },
                          ]}
                          onChange={(shell) => updateTerminal({ shell: shell as PiWebTerminalConfig["shell"] })}
                          ariaLabel="选择终端类型"
                        />
                      </Field>
                      <Field label="Custom shell path" description="必须是可执行文件的绝对路径，例如 /opt/homebrew/bin/fish 或 C:\\Program Files\\PowerShell\\7\\pwsh.exe。">
                        <TextInput
                          value={terminal.customShellPath}
                          onChange={(customShellPath) => updateTerminal({ customShellPath })}
                          placeholder="/absolute/path/to/shell or C:\\path\\to\\shell.exe"
                          disabled={terminal.shell !== "custom"}
                        />
                      </Field>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 12, borderRadius: 10, background: "var(--bg-subtle)", border: "1px solid var(--border)" }}>
                      <div>
                        <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 800 }}>环境变量</div>
                        <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 3, lineHeight: 1.45 }}>
                          下面的值会覆盖或补充 pi-web 服务进程环境，并明文保存；不要填写需要加密管理的长期密钥。
                        </div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "minmax(120px, 0.45fr) minmax(160px, 1fr) 70px", gap: 8, alignItems: "center" }}>
                        <span style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 700 }}>变量名</span>
                        <span style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 700 }}>变量值</span>
                        <span />
                        {Object.entries(terminal.env).map(([key, value]) => (
                          <div key={key} style={{ display: "contents" }}>
                            <TextInput value={key} onChange={(nextKey) => updateTerminalEnv(key, nextKey.trim(), value)} placeholder="HTTP_PROXY" />
                            <TextInput value={value} onChange={(nextValue) => updateTerminalEnv(key, key, nextValue)} placeholder="value" />
                            <button
                              type="button"
                              onClick={() => deleteTerminalEnv(key)}
                              style={{ padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}
                            >
                              删除
                            </button>
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          let index = Object.keys(terminal.env).length + 1;
                          let key = `TERMINAL_ENV_${index}`;
                          while (Object.prototype.hasOwnProperty.call(terminal.env, key)) {
                            index += 1;
                            key = `TERMINAL_ENV_${index}`;
                          }
                          updateTerminal({ env: { ...terminal.env, [key]: "" } });
                        }}
                        style={{ alignSelf: "flex-start", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer", fontSize: 12 }}
                      >
                        添加变量
                      </button>
                      <Field label="Raw env 导入" description="支持 KEY=VALUE / export A=B C=D / # 注释。解析结果会合并到上面的 key-value 表格，保存时只保存表格数据。">
                        <textarea
                          value={rawEnvImport}
                          onChange={(e) => setRawEnvImport(e.target.value)}
                          placeholder={'export https_proxy=http://127.0.0.1:7897 http_proxy=http://127.0.0.1:7897 all_proxy=socks5://127.0.0.1:7897\nNODE_OPTIONS="--max-old-space-size=4096"'}
                          rows={4}
                          spellCheck={false}
                          style={{ ...inputStyle, resize: "vertical", fontFamily: "var(--font-mono)", lineHeight: 1.45 }}
                        />
                      </Field>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <button
                          type="button"
                          onClick={importRawEnv}
                          disabled={!rawEnvImport.trim()}
                          style={{ padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", background: rawEnvImport.trim() ? "var(--bg)" : "var(--border)", color: rawEnvImport.trim() ? "var(--text)" : "var(--text-dim)", cursor: rawEnvImport.trim() ? "pointer" : "not-allowed", fontSize: 12 }}
                        >
                          解析到表格
                        </button>
                        <button
                          type="button"
                          onClick={() => void importRawEnvWithAi()}
                          disabled={!cwd || !rawEnvImport.trim() || terminalEnvAssistLoading}
                          title={cwd ? "用辅助模型解析复杂 env 文本" : "请先选择工作区"}
                          style={{ padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", background: cwd && rawEnvImport.trim() && !terminalEnvAssistLoading ? "var(--bg)" : "var(--border)", color: cwd && rawEnvImport.trim() && !terminalEnvAssistLoading ? "var(--text)" : "var(--text-dim)", cursor: cwd && rawEnvImport.trim() && !terminalEnvAssistLoading ? "pointer" : "not-allowed", fontSize: 12 }}
                        >
                          {terminalEnvAssistLoading ? "AI 解析中…" : "AI 解析"}
                        </button>
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 12, borderRadius: 10, background: "var(--bg-subtle)", border: "1px solid var(--border)" }}>
                      <div>
                        <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 800 }}>Raw env AI 解析模型</div>
                        <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 3, lineHeight: 1.45 }}>
                          用于解析复杂 export/代理变量片段，只返回 key-value 结果并填入上方表格。
                        </div>
                      </div>
                      {modelsError && <div style={{ padding: "7px 9px", borderRadius: 7, background: "rgba(239,68,68,0.12)", color: "#f87171", fontSize: 11 }}>{modelsError}</div>}
                      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 12 }}>
                        <Field label="AI 解析模型" description="默认使用 Pi 默认模型；也可指定某个模型。">
                          <ModelPolicySelect value={terminal.envAssistant.model} onChange={(model) => updateTerminalEnvAssistantPolicy({ model })} models={modelList} />
                        </Field>
                        <Field label="思考强度" description="建议 minimal/low。">
                          <ThinkingSelect value={terminal.envAssistant.thinking} onChange={(thinking) => updateTerminalEnvAssistantPolicy({ thinking })} />
                        </Field>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 12 }}>
                        <Field label="回退模型" description="主模型失败或返回不可解析内容时使用。">
                          <ModelPolicySelect value={terminal.envAssistantFallback.model} onChange={(model) => updateTerminalEnvAssistantFallbackPolicy({ model })} models={modelList} />
                        </Field>
                        <Field label="回退思考强度" description="通常保持 minimal 即可。">
                          <ThinkingSelect value={terminal.envAssistantFallback.thinking} onChange={(thinking) => updateTerminalEnvAssistantFallbackPolicy({ thinking })} />
                        </Field>
                      </div>
                    </div>
                  </div>
                ) : section === "chatgpt" ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    <div>
                      <h3 style={{ margin: 0, color: "var(--text)", fontSize: 15 }}>ChatGPT</h3>
                      <p style={{ margin: "5px 0 0", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>
                        控制 ChatGPT/Codex 账号相关显示。账号预热计划在 Models 的 Warm up 弹窗中管理，并同样保存到 <code style={{ fontFamily: "var(--font-mono)", color: "var(--text)", overflowWrap: "anywhere" }}>{configPath}</code>
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
                ) : section === "editor" ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    <div>
                      <h3 style={{ margin: 0, color: "var(--text)", fontSize: 15 }}>编辑器</h3>
                      <p style={{ margin: "5px 0 0", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>
                        控制文件面板的编辑器实现和快捷键。保存到 <code style={{ fontFamily: "var(--font-mono)", color: "var(--text)", overflowWrap: "anywhere" }}>{configPath}</code>
                        {exists ? "" : "（保存时会自动创建）"}
                      </p>
                    </div>
                    <Field label="编辑器实现" description="当前仅支持 Monaco；后续新增编辑器时会在这里切换。">
                      <SelectDropdown
                        value={editor.kind}
                        options={[{ value: "monaco", label: "Monaco Editor" }]}
                        onChange={(kind) => updateEditor({ kind: kind as PiWebEditorConfig["kind"] })}
                        ariaLabel="选择编辑器实现"
                      />
                    </Field>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 12, borderRadius: 10, background: "var(--bg-subtle)", border: "1px solid var(--border)" }}>
                      <div>
                        <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 800 }}>yolk pi web 自定义快捷键 / 鼠标手势</div>
                        <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 3, lineHeight: 1.45 }}>
                          这些是 yolk pi web 在 Monaco 之上额外接管的操作，可单独关闭；关闭后对应按钮仍可使用。
                        </div>
                      </div>
                      <ToggleField
                        label="保存文件 · Cmd/Ctrl+S"
                        description="阻止浏览器默认保存网页，改为保存当前编辑器里的文件。"
                        checked={editor.shortcuts.saveFile}
                        onChange={(saveFile) => updateEditorShortcuts({ saveFile })}
                      />
                      <ToggleField
                        label="加入聊天 · Cmd/Ctrl+1"
                        description="把当前文件或 Monaco 中选中的行号范围加入聊天输入框。"
                        checked={editor.shortcuts.addSelectionToChat}
                        onChange={(addSelectionToChat) => updateEditorShortcuts({ addSelectionToChat })}
                      />
                      <ToggleField
                        label="查找引用/使用处 · Shift+F12"
                        description="根据当前光标符号在工作区常见文本/代码文件中搜索引用，适合查看变量、方法、类在哪里被使用。"
                        checked={editor.shortcuts.findReferences}
                        onChange={(findReferences) => updateEditorShortcuts({ findReferences })}
                      />
                      <ToggleField
                        label="查找 Java 实现 · Cmd/Ctrl+F12"
                        description="在 Java 文件中根据当前光标符号搜索 implements / extends / 方法实现 / 引用。"
                        checked={editor.shortcuts.findJavaImplementations}
                        onChange={(findJavaImplementations) => updateEditorShortcuts({ findJavaImplementations })}
                      />
                      <ToggleField
                        label="下钻/调用跳转 · Cmd/Ctrl+鼠标点击"
                        description="点击调用处时优先跳到定义；点击定义/接口处时搜索引用/调用处。"
                        checked={editor.shortcuts.cmdClickDrillDown}
                        onChange={(cmdClickDrillDown) => updateEditorShortcuts({ cmdClickDrillDown })}
                      />
                      <ToggleField
                        label="层级跳转 · Shift+鼠标点击"
                        description="点定义时查实现；点实现/调用处时向上查定义。"
                        checked={editor.shortcuts.shiftClickHierarchy}
                        onChange={(shiftClickHierarchy) => updateEditorShortcuts({ shiftClickHierarchy })}
                      />
                    </div>
                    <div style={{ padding: 12, borderRadius: 10, background: "var(--bg-subtle)", border: "1px solid var(--border)", color: "var(--text-dim)", fontSize: 11, lineHeight: 1.6 }}>
                      <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Monaco 内置常用快捷键</div>
                      <div style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: "6px 12px", alignItems: "baseline" }}>
                        {[
                          ["Cmd/Ctrl+F", "当前文件查找"],
                          ["Cmd/Ctrl+H", "当前文件替换"],
                          ["Cmd/Ctrl+/", "切换行注释"],
                          ["Cmd/Ctrl+Space", "触发建议/补全"],
                          ["Alt+↑ / Alt+↓", "移动当前行"],
                          ["Shift+Alt+↑ / ↓", "复制当前行"],
                          ["F12", "跳转定义（需要语言 provider 支持）"],
                          ["Shift+F12", "Monaco 内置查引用（需要语言 provider 支持；yolk pi web 也提供轻量引用搜索）"],
                        ].map(([key, desc]) => (
                          <div key={key} style={{ display: "contents" }}>
                            <code style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 5, padding: "2px 6px" }}>{key}</code>
                            <span>{desc}</span>
                          </div>
                        ))}
                      </div>
                      <div style={{ marginTop: 8 }}>这些是 Monaco 自带编辑行为，不写入 yolk pi web 配置；上面的开关只控制 yolk pi web 额外接管的快捷键/鼠标手势。</div>
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
                        description="只会应用到安装、初始化、更新 Trellis 的子进程，不会修改 yolk pi web 服务本身的环境变量。建议使用 HTTP(S) 代理地址。"
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
                            <SelectDropdown
                              value={trellis.subagents.router.fallbackOnError.modality}
                              options={SUBAGENT_MODALITIES.map((modality) => ({ value: modality, label: SUBAGENT_MODALITY_LABELS[modality] }))}
                              onChange={(modality) => updateRouter({ fallbackOnError: { ...trellis.subagents.router.fallbackOnError, modality: modality as PiWebSubagentModality } })}
                              disabled={!trellis.subagents.enabled || !trellis.subagents.router.enabled}
                              ariaLabel="选择分流失败时的任务类型"
                            />
                          </Field>
                          <Field label="分流失败时的任务等级" description="分流判断不可用时默认按哪个复杂度处理。建议 standard 或 complex。">
                            <SelectDropdown
                              value={trellis.subagents.router.fallbackOnError.tier}
                              options={SUBAGENT_TIERS.map((tier) => ({ value: tier, label: SUBAGENT_TIER_LABELS[tier] }))}
                              onChange={(tier) => updateRouter({ fallbackOnError: { ...trellis.subagents.router.fallbackOnError, tier: tier as PiWebSubagentDifficultyTier } })}
                              disabled={!trellis.subagents.enabled || !trellis.subagents.router.enabled}
                              ariaLabel="选择分流失败时的任务等级"
                            />
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
                              <SelectDropdown
                                value={agentConfig.strategy}
                                options={[
                                  { value: "default", label: "使用默认规则" },
                                  { value: "route", label: "总是自动分流" },
                                  { value: "fixed", label: "固定指定模型" },
                                  { value: "disabled", label: "不使用这里的设置" },
                                ]}
                                onChange={(strategy) => updateSubagentAgent(agent, { strategy: strategy as PiWebSubagentAgentConfig["strategy"] })}
                                disabled={!trellis.subagents.enabled}
                                ariaLabel={`选择 ${agent} 覆盖策略`}
                              />
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

                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <button
                        onClick={() => void runTrellisInstallAction()}
                        disabled={!canInstallTrellisCli}
                        title={trellisStatus?.cli.installed ? "已检测到 Trellis CLI，无需安装" : "只安装 Trellis CLI，不运行会进入交互问询的 trellis init"}
                        style={{ padding: "8px 12px", borderRadius: 8, border: "none", background: canInstallTrellisCli ? "var(--accent)" : "var(--border)", color: "white", cursor: canInstallTrellisCli ? "pointer" : "not-allowed", fontSize: 12, fontWeight: 700 }}
                      >
                        {trellisAction === "install" ? "正在安装…" : trellisStatus?.cli.installed ? "Trellis CLI 已安装" : "安装 Trellis CLI"}
                      </button>
                      <button
                        onClick={() => void openTrellisUpdateInTerminal()}
                        disabled={!canUpdateTrellis}
                        title={canUpdateTrellis ? "在终端中填入 trellis update，由用户执行" : !terminalEnabled ? "请先启用 Web Terminal" : trellisBlockingReason ?? "当前工作区还没有 Trellis，请先初始化"}
                        style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: canUpdateTrellis ? "var(--text)" : "var(--text-dim)", cursor: canUpdateTrellis ? "pointer" : "not-allowed", fontSize: 12, fontWeight: 700 }}
                      >
                        在终端中更新 Trellis
                      </button>
                      {!canUpdateTrellis && trellisBlockingReason && <span style={{ color: "var(--text-dim)", fontSize: 11 }}>{trellisBlockingReason}</span>}
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
              disabled={!worktree || !trellis || !studio || !usage || !terminal || !chatgpt || !editor || loading || saving || !dirty}
              style={{ padding: "7px 14px", borderRadius: 7, border: "none", background: !worktree || !trellis || !studio || !usage || !terminal || !chatgpt || !editor || loading || saving || !dirty ? "var(--border)" : "var(--accent)", color: "white", cursor: !worktree || !trellis || !studio || !usage || !terminal || !chatgpt || !editor || loading || saving || !dirty ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 600 }}
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
