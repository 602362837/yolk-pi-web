import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export type PiWebToolPreset = "none" | "default" | "full" | "subagent";
export type PiWebThinkingLevel = "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface PiWebYolkConfig {
  defaultToolPreset: PiWebToolPreset;
  defaultThinkingLevel: PiWebThinkingLevel;
}

export interface PiWebWorktreeConfig {
  baseRef: string;
  branchNameTemplate: string;
  baseDirTemplate: string;
  pathTemplate: string;
  sessionDisplay: "separate" | "tag";
}

export type PiWebSubagentModelMode = "followMain" | "piDefault" | "specific" | "unset";
export type PiWebSubagentThinking = "inherit" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type PiWebSubagentAgentStrategy = "default" | "route" | "fixed" | "disabled";
export type PiWebSubagentModality = "text" | "multimodal";
export type PiWebSubagentDifficultyTier = "simple" | "standard" | "complex" | "critical";

export interface PiWebSubagentModelRef {
  mode: PiWebSubagentModelMode;
  provider?: string;
  modelId?: string;
}

export interface PiWebSubagentRunPolicy {
  model: PiWebSubagentModelRef;
  thinking: PiWebSubagentThinking;
}

export interface PiWebSubagentAgentConfig {
  strategy: PiWebSubagentAgentStrategy;
  fixed?: PiWebSubagentRunPolicy;
  minimumTier?: PiWebSubagentDifficultyTier;
  maximumTier?: PiWebSubagentDifficultyTier;
}

export interface PiWebSubagentRouterConfig {
  enabled: boolean;
  model: PiWebSubagentModelRef;
  thinking: PiWebSubagentThinking;
  fallbackOnError: { modality: PiWebSubagentModality; tier: PiWebSubagentDifficultyTier };
}

export type PiWebSubagentRouteTable = Record<PiWebSubagentModality, Record<PiWebSubagentDifficultyTier, PiWebSubagentRunPolicy>>;

export interface PiWebTrellisSubagentsConfig {
  enabled: boolean;
  defaultPolicy: PiWebSubagentRunPolicy;
  router: PiWebSubagentRouterConfig;
  routes: PiWebSubagentRouteTable;
  agents: Record<string, PiWebSubagentAgentConfig>;
}

export interface PiWebTrellisConfig {
  enabled: boolean;
  includeArchived: boolean;
  proxyEnabled: boolean;
  proxyUrl: string;
  workflowAssistant: PiWebSubagentRunPolicy;
  workflowAssistantFallback: PiWebSubagentRunPolicy;
  subagents: PiWebTrellisSubagentsConfig;
}

export type PiWebStudioMemberId = "architect" | "ui-designer" | "implementer" | "checker" | string;

export interface PiWebStudioConfig {
  defaultPolicy: PiWebSubagentRunPolicy;
  members: Record<PiWebStudioMemberId, PiWebSubagentRunPolicy>;
}

export interface PiWebUsageConfig {
  includeArchived: boolean;
}

export interface PiWebChatGptWarmupConfig {
  enabled: boolean;
  accountIds: string[];
  times: string[];
}

export type PiWebTerminalShell = "zsh" | "bash" | "sh" | "cmd" | "powershell" | "pwsh" | "custom";

export interface PiWebTerminalConfig {
  enabled: boolean;
  shell: PiWebTerminalShell;
  customShellPath: string;
  env: Record<string, string>;
  envAssistant: PiWebSubagentRunPolicy;
  envAssistantFallback: PiWebSubagentRunPolicy;
}

export interface PiWebChatGptConfig {
  usagePanelEnabled: boolean;
  warmup: PiWebChatGptWarmupConfig;
  autoRefreshEnabled: boolean;
  refreshCycleIntervalSeconds: number;
  refreshCycleSaltMinSeconds: number;
  refreshCycleSaltMaxSeconds: number;
  refreshAccountIntervalSeconds: number;
  refreshAccountSaltMinSeconds: number;
  refreshAccountSaltMaxSeconds: number;
}

export type PiWebEditorKind = "monaco";

export interface PiWebEditorShortcutConfig {
  saveFile: boolean;
  addSelectionToChat: boolean;
  findReferences: boolean;
  findJavaImplementations: boolean;
  cmdClickDrillDown: boolean;
  shiftClickHierarchy: boolean;
}

export interface PiWebEditorConfig {
  kind: PiWebEditorKind;
  shortcuts: PiWebEditorShortcutConfig;
}

export interface PiWebConfig {
  yolk: PiWebYolkConfig;
  worktree: PiWebWorktreeConfig;
  trellis: PiWebTrellisConfig;
  studio: PiWebStudioConfig;
  usage: PiWebUsageConfig;
  terminal: PiWebTerminalConfig;
  chatgpt: PiWebChatGptConfig;
  editor: PiWebEditorConfig;
}

export interface PiWebConfigPatch {
  yolk?: unknown;
  worktree?: unknown;
  trellis?: unknown;
  studio?: unknown;
  usage?: unknown;
  terminal?: unknown;
  chatgpt?: unknown;
  editor?: unknown;
}

export interface PiWebConfigReadResult {
  config: PiWebConfig;
  defaults: PiWebConfig;
  path: string;
  exists: boolean;
  parseError?: string;
}

export class PiWebConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PiWebConfigValidationError";
  }
}

export const PI_WEB_STUDIO_DEFAULT_MEMBERS = ["architect", "ui-designer", "implementer", "checker"] as const;

const DEFAULT_STUDIO_POLICY: PiWebSubagentRunPolicy = {
  model: { mode: "followMain" },
  thinking: "inherit",
};

export const DEFAULT_PI_WEB_CONFIG: PiWebConfig = {
  yolk: {
    defaultToolPreset: "default",
    defaultThinkingLevel: "auto",
  },
  worktree: {
    baseRef: "HEAD",
    branchNameTemplate: "pi/{yyyyMMdd-HHmmss}",
    baseDirTemplate: "{repoParent}/{repoName}.worktrees",
    pathTemplate: "{baseDir}/{branchSlug}",
    sessionDisplay: "separate",
  },
  usage: {
    includeArchived: true,
  },
  terminal: {
    enabled: false,
    shell: process.platform === "win32" ? "powershell" : "zsh",
    customShellPath: "",
    env: {},
    envAssistant: {
      model: { mode: "piDefault" },
      thinking: "minimal",
    },
    envAssistantFallback: {
      model: { mode: "piDefault" },
      thinking: "minimal",
    },
  },
  chatgpt: {
    usagePanelEnabled: false,
    warmup: {
      enabled: false,
      accountIds: [],
      times: ["07:00", "13:00"],
    },
    autoRefreshEnabled: false,
    refreshCycleIntervalSeconds: 1800,
    refreshCycleSaltMinSeconds: 0,
    refreshCycleSaltMaxSeconds: 120,
    refreshAccountIntervalSeconds: 20,
    refreshAccountSaltMinSeconds: 0,
    refreshAccountSaltMaxSeconds: 15,
  },
  editor: {
    kind: "monaco",
    shortcuts: {
      saveFile: true,
      addSelectionToChat: true,
      findReferences: true,
      findJavaImplementations: true,
      cmdClickDrillDown: true,
      shiftClickHierarchy: true,
    },
  },
  studio: {
    defaultPolicy: DEFAULT_STUDIO_POLICY,
    members: Object.fromEntries(PI_WEB_STUDIO_DEFAULT_MEMBERS.map((member) => [member, DEFAULT_STUDIO_POLICY])) as Record<string, PiWebSubagentRunPolicy>,
  },
  trellis: {
    enabled: false,
    includeArchived: false,
    proxyEnabled: false,
    proxyUrl: "",
    workflowAssistant: {
      model: { mode: "followMain" },
      thinking: "minimal",
    },
    workflowAssistantFallback: {
      model: { mode: "piDefault" },
      thinking: "minimal",
    },
    subagents: {
      enabled: true,
      defaultPolicy: {
        model: { mode: "followMain" },
        thinking: "inherit",
      },
      router: {
        enabled: false,
        model: { mode: "piDefault" },
        thinking: "minimal",
        fallbackOnError: { modality: "text", tier: "standard" },
      },
      routes: {
        text: {
          simple: { model: { mode: "followMain" }, thinking: "inherit" },
          standard: { model: { mode: "followMain" }, thinking: "inherit" },
          complex: { model: { mode: "followMain" }, thinking: "high" },
          critical: { model: { mode: "followMain" }, thinking: "xhigh" },
        },
        multimodal: {
          simple: { model: { mode: "followMain" }, thinking: "inherit" },
          standard: { model: { mode: "followMain" }, thinking: "medium" },
          complex: { model: { mode: "followMain" }, thinking: "high" },
          critical: { model: { mode: "followMain" }, thinking: "xhigh" },
        },
      },
      agents: {
        "trellis-design": { strategy: "default", minimumTier: "complex" },
        "trellis-implement": { strategy: "default", minimumTier: "complex" },
        "trellis-check": { strategy: "default", minimumTier: "standard" },
        "trellis-research": { strategy: "default" },
      },
    },
  },
};

export function getPiWebConfigPath(): string {
  return join(getAgentDir(), "pi-web.json");
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}

function readToolPreset(value: unknown, fallback: PiWebToolPreset): PiWebToolPreset {
  return value === "none" || value === "default" || value === "full" || value === "subagent" ? value : fallback;
}

function readThinkingLevel(value: unknown, fallback: PiWebThinkingLevel): PiWebThinkingLevel {
  return value === "auto" || value === "off" || value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh" ? value : fallback;
}

function readSessionDisplay(value: unknown, fallback: "separate" | "tag"): "separate" | "tag" {
  return value === "separate" || value === "tag" ? value : fallback;
}

function normalizeDailyTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function readDailyTimes(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const normalized = normalizeDailyTime(item);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result.length > 0 ? result : fallback;
}

function readTerminalShell(value: unknown, fallback: PiWebTerminalShell): PiWebTerminalShell {
  return value === "zsh" || value === "bash" || value === "sh" || value === "cmd" || value === "powershell" || value === "pwsh" || value === "custom" ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSubagentModelRef(value: unknown, fallback: PiWebSubagentModelRef): PiWebSubagentModelRef {
  if (!isRecord(value)) return fallback;
  const mode = value.mode;
  if (mode === "followMain" || mode === "piDefault" || mode === "unset") return { mode };
  if (mode === "specific") {
    const provider = typeof value.provider === "string" ? value.provider.trim() : "";
    const modelId = typeof value.modelId === "string" ? value.modelId.trim() : "";
    if (provider && modelId) return { mode, provider, modelId };
  }
  return fallback;
}

function readSubagentThinking(value: unknown, fallback: PiWebSubagentThinking): PiWebSubagentThinking {
  return value === "inherit" || value === "off" || value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh"
    ? value
    : fallback;
}

function readSubagentPolicy(value: unknown, fallback: PiWebSubagentRunPolicy): PiWebSubagentRunPolicy {
  const root = isRecord(value) ? value : {};
  return {
    model: readSubagentModelRef(root.model, fallback.model),
    thinking: readSubagentThinking(root.thinking, fallback.thinking),
  };
}

function readSubagentModality(value: unknown, fallback: PiWebSubagentModality): PiWebSubagentModality {
  return value === "text" || value === "multimodal" ? value : fallback;
}

function readSubagentTier(value: unknown, fallback?: PiWebSubagentDifficultyTier): PiWebSubagentDifficultyTier | undefined {
  return value === "simple" || value === "standard" || value === "complex" || value === "critical" ? value : fallback;
}

function readSubagentRouterConfig(value: unknown, fallback: PiWebSubagentRouterConfig): PiWebSubagentRouterConfig {
  const root = isRecord(value) ? value : {};
  const fallbackRoute = fallback.fallbackOnError;
  const rawFallback = isRecord(root.fallbackOnError) ? root.fallbackOnError : {};
  return {
    enabled: readBoolean(root.enabled, fallback.enabled),
    model: readSubagentModelRef(root.model, fallback.model),
    thinking: readSubagentThinking(root.thinking, fallback.thinking),
    fallbackOnError: {
      modality: readSubagentModality(rawFallback.modality, fallbackRoute.modality),
      tier: readSubagentTier(rawFallback.tier, fallbackRoute.tier) ?? fallbackRoute.tier,
    },
  };
}

function readSubagentRoutes(value: unknown, fallback: PiWebSubagentRouteTable): PiWebSubagentRouteTable {
  const root = isRecord(value) ? value : {};
  const out = structuredClone(fallback) as PiWebSubagentRouteTable;
  for (const modality of ["text", "multimodal"] as const) {
    const rawModality = isRecord(root[modality]) ? root[modality] : {};
    for (const tier of ["simple", "standard", "complex", "critical"] as const) {
      out[modality][tier] = readSubagentPolicy(rawModality[tier], fallback[modality][tier]);
    }
  }
  return out;
}

function readSubagentAgentConfig(value: unknown, fallback: PiWebSubagentAgentConfig): PiWebSubagentAgentConfig {
  const root = isRecord(value) ? value : {};
  const strategy = root.strategy === "default" || root.strategy === "route" || root.strategy === "fixed" || root.strategy === "disabled" ? root.strategy : fallback.strategy;
  const fixedFallback = fallback.fixed ?? DEFAULT_PI_WEB_CONFIG.trellis.subagents.defaultPolicy;
  return {
    strategy,
    fixed: root.fixed || fallback.fixed ? readSubagentPolicy(root.fixed, fixedFallback) : undefined,
    minimumTier: readSubagentTier(root.minimumTier, fallback.minimumTier),
    maximumTier: readSubagentTier(root.maximumTier, fallback.maximumTier),
  };
}

function readSubagentAgents(value: unknown, fallback: Record<string, PiWebSubagentAgentConfig>): Record<string, PiWebSubagentAgentConfig> {
  const out: Record<string, PiWebSubagentAgentConfig> = { ...fallback };
  if (!isRecord(value)) return out;
  for (const [agent, rawConfig] of Object.entries(value)) {
    const cleanAgent = agent.trim();
    if (!cleanAgent) continue;
    out[cleanAgent] = readSubagentAgentConfig(rawConfig, out[cleanAgent] ?? { strategy: "default" });
  }
  return out;
}

function readTrellisSubagentsConfig(value: unknown, fallback: PiWebTrellisSubagentsConfig): PiWebTrellisSubagentsConfig {
  const root = isRecord(value) ? value : {};
  return {
    enabled: readBoolean(root.enabled, fallback.enabled),
    defaultPolicy: readSubagentPolicy(root.defaultPolicy, fallback.defaultPolicy),
    router: readSubagentRouterConfig(root.router, fallback.router),
    routes: readSubagentRoutes(root.routes, fallback.routes),
    agents: readSubagentAgents(root.agents, fallback.agents),
  };
}

function readStudioConfig(value: unknown, fallback: PiWebStudioConfig): PiWebStudioConfig {
  const root = isRecord(value) ? value : {};
  const defaultPolicy = readSubagentPolicy(root.defaultPolicy, fallback.defaultPolicy);
  const members: Record<string, PiWebSubagentRunPolicy> = { ...fallback.members };
  const rawMembers = isRecord(root.members) ? root.members : {};
  for (const [member, rawPolicy] of Object.entries(rawMembers)) {
    const cleanMember = member.trim();
    if (!cleanMember) continue;
    members[cleanMember] = readSubagentPolicy(rawPolicy, members[cleanMember] ?? defaultPolicy);
  }
  for (const member of PI_WEB_STUDIO_DEFAULT_MEMBERS) {
    members[member] = readSubagentPolicy(rawMembers[member], members[member] ?? defaultPolicy);
  }
  return { defaultPolicy, members };
}

function readChatGptWarmupConfig(value: unknown, fallback: PiWebChatGptWarmupConfig): PiWebChatGptWarmupConfig {
  const root = isRecord(value) ? value : {};
  return {
    enabled: readBoolean(root.enabled, fallback.enabled),
    accountIds: normalizeStringList(root.accountIds),
    times: readDailyTimes(root.times, fallback.times),
  };
}

function normalizePiWebConfig(raw: unknown): PiWebConfig {
  const defaults = DEFAULT_PI_WEB_CONFIG;
  const root = isRecord(raw) ? raw : {};
  const yolk = isRecord(root.yolk) ? root.yolk : {};
  const worktree = isRecord(root.worktree) ? root.worktree : {};
  const trellis = isRecord(root.trellis) ? root.trellis : {};
  const studio = isRecord(root.studio) ? root.studio : {};
  const usage = isRecord(root.usage) ? root.usage : {};
  const terminal = isRecord(root.terminal) ? root.terminal : {};
  const chatgpt = isRecord(root.chatgpt) ? root.chatgpt : {};
  const editor = isRecord(root.editor) ? root.editor : {};
  const editorShortcuts = isRecord(editor.shortcuts) ? editor.shortcuts : {};
  const terminalEnv: Record<string, string> = {};
  if (isRecord(terminal.env)) {
    for (const [key, value] of Object.entries(terminal.env)) {
      if (typeof value === "string") terminalEnv[key] = value;
    }
  }
  return {
    yolk: {
      defaultToolPreset: readToolPreset(yolk.defaultToolPreset, defaults.yolk.defaultToolPreset),
      defaultThinkingLevel: readThinkingLevel(yolk.defaultThinkingLevel, defaults.yolk.defaultThinkingLevel),
    },
    worktree: {
      baseRef: readString(worktree.baseRef, defaults.worktree.baseRef),
      branchNameTemplate: readString(worktree.branchNameTemplate, defaults.worktree.branchNameTemplate),
      baseDirTemplate: readString(worktree.baseDirTemplate, defaults.worktree.baseDirTemplate),
      pathTemplate: readString(worktree.pathTemplate, defaults.worktree.pathTemplate),
      sessionDisplay: readSessionDisplay(worktree.sessionDisplay, defaults.worktree.sessionDisplay),
    },
    usage: {
      includeArchived: readBoolean(usage.includeArchived, defaults.usage.includeArchived),
    },
    terminal: {
      enabled: readBoolean(terminal.enabled, defaults.terminal.enabled),
      shell: readTerminalShell(terminal.shell, defaults.terminal.shell),
      customShellPath: typeof terminal.customShellPath === "string" ? terminal.customShellPath.trim() : defaults.terminal.customShellPath,
      env: terminalEnv,
      envAssistant: readSubagentPolicy(terminal.envAssistant, defaults.terminal.envAssistant),
      envAssistantFallback: readSubagentPolicy(terminal.envAssistantFallback, defaults.terminal.envAssistantFallback),
    },
    chatgpt: {
      usagePanelEnabled: readBoolean(chatgpt.usagePanelEnabled, defaults.chatgpt.usagePanelEnabled),
      warmup: readChatGptWarmupConfig(chatgpt.warmup, defaults.chatgpt.warmup),
      autoRefreshEnabled: readBoolean(chatgpt.autoRefreshEnabled, defaults.chatgpt.autoRefreshEnabled),
      refreshCycleIntervalSeconds: readInteger(chatgpt.refreshCycleIntervalSeconds, defaults.chatgpt.refreshCycleIntervalSeconds),
      refreshCycleSaltMinSeconds: readInteger(chatgpt.refreshCycleSaltMinSeconds, defaults.chatgpt.refreshCycleSaltMinSeconds),
      refreshCycleSaltMaxSeconds: readInteger(chatgpt.refreshCycleSaltMaxSeconds, defaults.chatgpt.refreshCycleSaltMaxSeconds),
      refreshAccountIntervalSeconds: readInteger(chatgpt.refreshAccountIntervalSeconds, defaults.chatgpt.refreshAccountIntervalSeconds),
      refreshAccountSaltMinSeconds: readInteger(chatgpt.refreshAccountSaltMinSeconds, defaults.chatgpt.refreshAccountSaltMinSeconds),
      refreshAccountSaltMaxSeconds: readInteger(chatgpt.refreshAccountSaltMaxSeconds, defaults.chatgpt.refreshAccountSaltMaxSeconds),
    },
    editor: {
      kind: editor.kind === "monaco" ? "monaco" : defaults.editor.kind,
      shortcuts: {
        saveFile: readBoolean(editorShortcuts.saveFile, defaults.editor.shortcuts.saveFile),
        addSelectionToChat: readBoolean(editorShortcuts.addSelectionToChat, defaults.editor.shortcuts.addSelectionToChat),
        findReferences: readBoolean(editorShortcuts.findReferences, defaults.editor.shortcuts.findReferences),
        findJavaImplementations: readBoolean(editorShortcuts.findJavaImplementations, defaults.editor.shortcuts.findJavaImplementations),
        cmdClickDrillDown: readBoolean(editorShortcuts.cmdClickDrillDown, defaults.editor.shortcuts.cmdClickDrillDown),
        shiftClickHierarchy: readBoolean(editorShortcuts.shiftClickHierarchy, defaults.editor.shortcuts.shiftClickHierarchy),
      },
    },
    trellis: {
      enabled: readBoolean(trellis.enabled, defaults.trellis.enabled),
      includeArchived: readBoolean(trellis.includeArchived, defaults.trellis.includeArchived),
      proxyEnabled: readBoolean(trellis.proxyEnabled, defaults.trellis.proxyEnabled),
      proxyUrl: typeof trellis.proxyUrl === "string" ? trellis.proxyUrl.trim() : defaults.trellis.proxyUrl,
      workflowAssistant: readSubagentPolicy(trellis.workflowAssistant, defaults.trellis.workflowAssistant),
      workflowAssistantFallback: readSubagentPolicy(trellis.workflowAssistantFallback, defaults.trellis.workflowAssistantFallback),
      subagents: readTrellisSubagentsConfig(trellis.subagents, defaults.trellis.subagents),
    },
    studio: readStudioConfig(studio, defaults.studio),
  };
}

function readRawConfigFile(path: string): { raw: Record<string, unknown>; exists: boolean; parseError?: string } {
  if (!existsSync(path)) return { raw: {}, exists: false };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!isRecord(parsed)) {
      return { raw: {}, exists: true, parseError: "Config file root must be a JSON object" };
    }
    return { raw: parsed, exists: true };
  } catch (error) {
    return { raw: {}, exists: true, parseError: error instanceof Error ? error.message : String(error) };
  }
}

export function readPiWebConfigForApi(): PiWebConfigReadResult {
  const path = getPiWebConfigPath();
  const { raw, exists, parseError } = readRawConfigFile(path);
  return {
    config: normalizePiWebConfig(parseError ? {} : raw),
    defaults: DEFAULT_PI_WEB_CONFIG,
    path,
    exists,
    parseError,
  };
}

export function readPiWebConfig(): PiWebConfig {
  return readPiWebConfigForApi().config;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new PiWebConfigValidationError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

export function validatePiWebYolkConfig(value: unknown): PiWebYolkConfig {
  if (!isRecord(value)) {
    throw new PiWebConfigValidationError("yolk config must be an object");
  }
  const defaultToolPreset = value.defaultToolPreset;
  if (defaultToolPreset !== "none" && defaultToolPreset !== "default" && defaultToolPreset !== "full" && defaultToolPreset !== "subagent") {
    throw new PiWebConfigValidationError("yolk.defaultToolPreset must be none, default, full, or subagent");
  }
  const defaultThinkingLevel = value.defaultThinkingLevel;
  if (defaultThinkingLevel !== "auto" && defaultThinkingLevel !== "off" && defaultThinkingLevel !== "minimal" && defaultThinkingLevel !== "low" && defaultThinkingLevel !== "medium" && defaultThinkingLevel !== "high" && defaultThinkingLevel !== "xhigh") {
    throw new PiWebConfigValidationError("yolk.defaultThinkingLevel must be auto, off, minimal, low, medium, high, or xhigh");
  }
  return { defaultToolPreset, defaultThinkingLevel };
}

export function validatePiWebWorktreeConfig(value: unknown): PiWebWorktreeConfig {
  if (!isRecord(value)) {
    throw new PiWebConfigValidationError("worktree config must be an object");
  }
  const sessionDisplay = value.sessionDisplay;
  if (sessionDisplay !== "separate" && sessionDisplay !== "tag") {
    throw new PiWebConfigValidationError("worktree.sessionDisplay must be \"separate\" or \"tag\"");
  }
  return {
    baseRef: requireNonEmptyString(value.baseRef, "worktree.baseRef"),
    branchNameTemplate: requireNonEmptyString(value.branchNameTemplate, "worktree.branchNameTemplate"),
    baseDirTemplate: requireNonEmptyString(value.baseDirTemplate, "worktree.baseDirTemplate"),
    pathTemplate: requireNonEmptyString(value.pathTemplate, "worktree.pathTemplate"),
    sessionDisplay,
  };
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new PiWebConfigValidationError(`${field} must be a boolean`);
  }
  return value;
}

function requireIntegerInRange(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new PiWebConfigValidationError(`${field} must be an integer`);
  }
  if (value < min || value > max) {
    throw new PiWebConfigValidationError(`${field} must be between ${min} and ${max}`);
  }
  return value;
}

function requireSaltRange(minValue: unknown, maxValue: unknown, minField: string, maxField: string, maxAllowed: number): { min: number; max: number } {
  const min = requireIntegerInRange(minValue, minField, 0, maxAllowed);
  const max = requireIntegerInRange(maxValue, maxField, 0, maxAllowed);
  if (max < min) {
    throw new PiWebConfigValidationError(`${maxField} must be greater than or equal to ${minField}`);
  }
  return { min, max };
}

function validateProxyUrl(value: unknown, enabled: boolean): string {
  if (typeof value !== "string") {
    throw new PiWebConfigValidationError("trellis.proxyUrl must be a string");
  }
  const proxyUrl = value.trim();
  if (!enabled || !proxyUrl) return proxyUrl;
  try {
    const parsed = new URL(proxyUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new PiWebConfigValidationError("trellis.proxyUrl must use http:// or https://");
    }
  } catch (error) {
    if (error instanceof PiWebConfigValidationError) throw error;
    throw new PiWebConfigValidationError("trellis.proxyUrl must be a valid URL");
  }
  return proxyUrl;
}

function validateSubagentModelRef(value: unknown, field: string): PiWebSubagentModelRef {
  if (!isRecord(value)) throw new PiWebConfigValidationError(`${field}.model must be an object`);
  const mode = value.mode;
  if (mode === "followMain" || mode === "piDefault" || mode === "unset") return { mode };
  if (mode !== "specific") throw new PiWebConfigValidationError(`${field}.model.mode is invalid`);
  return {
    mode,
    provider: requireNonEmptyString(value.provider, `${field}.model.provider`),
    modelId: requireNonEmptyString(value.modelId, `${field}.model.modelId`),
  };
}

function validateSubagentThinking(value: unknown, field: string): PiWebSubagentThinking {
  if (value === "inherit" || value === "off" || value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh") return value;
  throw new PiWebConfigValidationError(`${field}.thinking is invalid`);
}

function validateSubagentPolicy(value: unknown, field: string): PiWebSubagentRunPolicy {
  if (!isRecord(value)) throw new PiWebConfigValidationError(`${field} must be an object`);
  return {
    model: validateSubagentModelRef(value.model, field),
    thinking: validateSubagentThinking(value.thinking, field),
  };
}

function validateSubagentAgentConfig(value: unknown, field: string): PiWebSubagentAgentConfig {
  if (!isRecord(value)) throw new PiWebConfigValidationError(`${field} must be an object`);
  const strategy = value.strategy;
  if (strategy !== "default" && strategy !== "route" && strategy !== "fixed" && strategy !== "disabled") {
    throw new PiWebConfigValidationError(`${field}.strategy is invalid`);
  }
  return {
    strategy,
    fixed: value.fixed === undefined ? undefined : validateSubagentPolicy(value.fixed, `${field}.fixed`),
    minimumTier: value.minimumTier === undefined ? undefined : validateSubagentTier(value.minimumTier, `${field}.minimumTier`),
    maximumTier: value.maximumTier === undefined ? undefined : validateSubagentTier(value.maximumTier, `${field}.maximumTier`),
  };
}

function validateSubagentModality(value: unknown, field: string): PiWebSubagentModality {
  if (value === "text" || value === "multimodal") return value;
  throw new PiWebConfigValidationError(`${field} is invalid`);
}

function validateSubagentTier(value: unknown, field: string): PiWebSubagentDifficultyTier {
  if (value === "simple" || value === "standard" || value === "complex" || value === "critical") return value;
  throw new PiWebConfigValidationError(`${field} is invalid`);
}

function validateSubagentRouterConfig(value: unknown): PiWebSubagentRouterConfig {
  if (!isRecord(value)) throw new PiWebConfigValidationError("trellis.subagents.router must be an object");
  const fallback = isRecord(value.fallbackOnError) ? value.fallbackOnError : {};
  return {
    enabled: requireBoolean(value.enabled, "trellis.subagents.router.enabled"),
    model: validateSubagentModelRef(value.model, "trellis.subagents.router"),
    thinking: validateSubagentThinking(value.thinking, "trellis.subagents.router"),
    fallbackOnError: {
      modality: validateSubagentModality(fallback.modality, "trellis.subagents.router.fallbackOnError.modality"),
      tier: validateSubagentTier(fallback.tier, "trellis.subagents.router.fallbackOnError.tier"),
    },
  };
}

function validateSubagentRoutes(value: unknown): PiWebSubagentRouteTable {
  if (!isRecord(value)) throw new PiWebConfigValidationError("trellis.subagents.routes must be an object");
  const routes = {} as PiWebSubagentRouteTable;
  for (const modality of ["text", "multimodal"] as const) {
    const rawModality = value[modality];
    if (!isRecord(rawModality)) throw new PiWebConfigValidationError(`trellis.subagents.routes.${modality} must be an object`);
    routes[modality] = {} as Record<PiWebSubagentDifficultyTier, PiWebSubagentRunPolicy>;
    for (const tier of ["simple", "standard", "complex", "critical"] as const) {
      routes[modality][tier] = validateSubagentPolicy(rawModality[tier], `trellis.subagents.routes.${modality}.${tier}`);
    }
  }
  return routes;
}

function validateTrellisSubagentsConfig(value: unknown): PiWebTrellisSubagentsConfig {
  if (!isRecord(value)) throw new PiWebConfigValidationError("trellis.subagents must be an object");
  const agentsRaw = isRecord(value.agents) ? value.agents : {};
  const agents: Record<string, PiWebSubagentAgentConfig> = {};
  for (const [agent, rawConfig] of Object.entries(agentsRaw)) {
    const cleanAgent = agent.trim();
    if (!cleanAgent) throw new PiWebConfigValidationError("trellis.subagents.agents keys must be non-empty");
    agents[cleanAgent] = validateSubagentAgentConfig(rawConfig, `trellis.subagents.agents.${cleanAgent}`);
  }
  return {
    enabled: requireBoolean(value.enabled, "trellis.subagents.enabled"),
    defaultPolicy: validateSubagentPolicy(value.defaultPolicy, "trellis.subagents.defaultPolicy"),
    router: validateSubagentRouterConfig(value.router),
    routes: validateSubagentRoutes(value.routes),
    agents,
  };
}

export function validatePiWebStudioConfig(value: unknown): PiWebStudioConfig {
  if (!isRecord(value)) throw new PiWebConfigValidationError("studio config must be an object");
  const rawMembers = isRecord(value.members) ? value.members : {};
  const members: Record<string, PiWebSubagentRunPolicy> = {};
  for (const member of PI_WEB_STUDIO_DEFAULT_MEMBERS) {
    const rawPolicy = rawMembers[member] ?? DEFAULT_PI_WEB_CONFIG.studio.members[member];
    members[member] = validateSubagentPolicy(rawPolicy, `studio.members.${member}`);
  }
  for (const [member, rawPolicy] of Object.entries(rawMembers)) {
    const cleanMember = member.trim();
    if (!cleanMember) throw new PiWebConfigValidationError("studio.members keys must be non-empty");
    if (Object.prototype.hasOwnProperty.call(members, cleanMember)) continue;
    members[cleanMember] = validateSubagentPolicy(rawPolicy, `studio.members.${cleanMember}`);
  }
  return {
    defaultPolicy: value.defaultPolicy === undefined
      ? DEFAULT_PI_WEB_CONFIG.studio.defaultPolicy
      : validateSubagentPolicy(value.defaultPolicy, "studio.defaultPolicy"),
    members,
  };
}

export function validatePiWebUsageConfig(value: unknown): PiWebUsageConfig {
  if (!isRecord(value)) {
    throw new PiWebConfigValidationError("usage config must be an object");
  }
  return {
    includeArchived: requireBoolean(value.includeArchived, "usage.includeArchived"),
  };
}

function validateTerminalShell(value: unknown): PiWebTerminalShell {
  if (value === "zsh" || value === "bash" || value === "sh" || value === "cmd" || value === "powershell" || value === "pwsh" || value === "custom") return value;
  throw new PiWebConfigValidationError("terminal.shell must be zsh, bash, sh, cmd, powershell, pwsh, or custom");
}

function validateTerminalEnv(value: unknown): Record<string, string> {
  if (!isRecord(value)) throw new PiWebConfigValidationError("terminal.env must be an object");
  const env: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    const cleanKey = key.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(cleanKey)) {
      throw new PiWebConfigValidationError(`terminal.env contains invalid variable name: ${key}`);
    }
    if (typeof rawValue !== "string") {
      throw new PiWebConfigValidationError(`terminal.env.${cleanKey} must be a string`);
    }
    env[cleanKey] = rawValue;
  }
  return env;
}

export function validatePiWebTerminalConfig(value: unknown): PiWebTerminalConfig {
  if (!isRecord(value)) {
    throw new PiWebConfigValidationError("terminal config must be an object");
  }
  return {
    enabled: requireBoolean(value.enabled, "terminal.enabled"),
    shell: validateTerminalShell(value.shell),
    customShellPath: typeof value.customShellPath === "string" ? value.customShellPath.trim() : "",
    env: validateTerminalEnv(value.env),
    envAssistant: value.envAssistant === undefined
      ? DEFAULT_PI_WEB_CONFIG.terminal.envAssistant
      : validateSubagentPolicy(value.envAssistant, "terminal.envAssistant"),
    envAssistantFallback: value.envAssistantFallback === undefined
      ? DEFAULT_PI_WEB_CONFIG.terminal.envAssistantFallback
      : validateSubagentPolicy(value.envAssistantFallback, "terminal.envAssistantFallback"),
  };
}

function validateDailyTimes(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new PiWebConfigValidationError(`${field} must be an array`);
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const normalized = normalizeDailyTime(item);
    if (!normalized) throw new PiWebConfigValidationError(`${field} entries must be HH:mm times`);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  if (result.length === 0) throw new PiWebConfigValidationError(`${field} must include at least one time`);
  return result;
}

function validateChatGptWarmupConfig(value: unknown): PiWebChatGptWarmupConfig {
  if (value === undefined) return DEFAULT_PI_WEB_CONFIG.chatgpt.warmup;
  if (!isRecord(value)) throw new PiWebConfigValidationError("chatgpt.warmup must be an object");
  return {
    enabled: requireBoolean(value.enabled, "chatgpt.warmup.enabled"),
    accountIds: normalizeStringList(value.accountIds),
    times: validateDailyTimes(value.times, "chatgpt.warmup.times"),
  };
}

export function validatePiWebChatGptConfig(value: unknown): PiWebChatGptConfig {
  if (!isRecord(value)) {
    throw new PiWebConfigValidationError("chatgpt config must be an object");
  }
  const cycleSalt = requireSaltRange(value.refreshCycleSaltMinSeconds, value.refreshCycleSaltMaxSeconds, "chatgpt.refreshCycleSaltMinSeconds", "chatgpt.refreshCycleSaltMaxSeconds", 3600);
  const accountSalt = requireSaltRange(value.refreshAccountSaltMinSeconds, value.refreshAccountSaltMaxSeconds, "chatgpt.refreshAccountSaltMinSeconds", "chatgpt.refreshAccountSaltMaxSeconds", 300);
  return {
    usagePanelEnabled: requireBoolean(value.usagePanelEnabled, "chatgpt.usagePanelEnabled"),
    warmup: validateChatGptWarmupConfig(value.warmup),
    autoRefreshEnabled: requireBoolean(value.autoRefreshEnabled, "chatgpt.autoRefreshEnabled"),
    refreshCycleIntervalSeconds: requireIntegerInRange(value.refreshCycleIntervalSeconds, "chatgpt.refreshCycleIntervalSeconds", 300, 86400),
    refreshCycleSaltMinSeconds: cycleSalt.min,
    refreshCycleSaltMaxSeconds: cycleSalt.max,
    refreshAccountIntervalSeconds: requireIntegerInRange(value.refreshAccountIntervalSeconds, "chatgpt.refreshAccountIntervalSeconds", 5, 3600),
    refreshAccountSaltMinSeconds: accountSalt.min,
    refreshAccountSaltMaxSeconds: accountSalt.max,
  };
}

export function validatePiWebEditorConfig(value: unknown): PiWebEditorConfig {
  if (!isRecord(value)) {
    throw new PiWebConfigValidationError("editor config must be an object");
  }
  if (value.kind !== "monaco") {
    throw new PiWebConfigValidationError("editor.kind must be monaco");
  }
  if (!isRecord(value.shortcuts)) {
    throw new PiWebConfigValidationError("editor.shortcuts must be an object");
  }
  return {
    kind: "monaco",
    shortcuts: {
      saveFile: requireBoolean(value.shortcuts.saveFile, "editor.shortcuts.saveFile"),
      addSelectionToChat: requireBoolean(value.shortcuts.addSelectionToChat, "editor.shortcuts.addSelectionToChat"),
      findReferences: requireBoolean(value.shortcuts.findReferences, "editor.shortcuts.findReferences"),
      findJavaImplementations: requireBoolean(value.shortcuts.findJavaImplementations, "editor.shortcuts.findJavaImplementations"),
      cmdClickDrillDown: requireBoolean(value.shortcuts.cmdClickDrillDown, "editor.shortcuts.cmdClickDrillDown"),
      shiftClickHierarchy: requireBoolean(value.shortcuts.shiftClickHierarchy, "editor.shortcuts.shiftClickHierarchy"),
    },
  };
}

export function validatePiWebTrellisConfig(value: unknown): PiWebTrellisConfig {
  if (!isRecord(value)) {
    throw new PiWebConfigValidationError("trellis config must be an object");
  }
  const proxyEnabled = typeof value.proxyEnabled === "boolean" ? value.proxyEnabled : DEFAULT_PI_WEB_CONFIG.trellis.proxyEnabled;
  const proxyUrl = typeof value.proxyUrl === "string" ? value.proxyUrl : DEFAULT_PI_WEB_CONFIG.trellis.proxyUrl;
  return {
    enabled: requireBoolean(value.enabled, "trellis.enabled"),
    includeArchived: requireBoolean(value.includeArchived, "trellis.includeArchived"),
    proxyEnabled,
    proxyUrl: validateProxyUrl(proxyUrl, proxyEnabled),
    workflowAssistant: value.workflowAssistant === undefined
      ? DEFAULT_PI_WEB_CONFIG.trellis.workflowAssistant
      : validateSubagentPolicy(value.workflowAssistant, "trellis.workflowAssistant"),
    workflowAssistantFallback: value.workflowAssistantFallback === undefined
      ? DEFAULT_PI_WEB_CONFIG.trellis.workflowAssistantFallback
      : validateSubagentPolicy(value.workflowAssistantFallback, "trellis.workflowAssistantFallback"),
    subagents: value.subagents === undefined
      ? DEFAULT_PI_WEB_CONFIG.trellis.subagents
      : validateTrellisSubagentsConfig(value.subagents),
  };
}

export function writePiWebConfigPatch(patch: PiWebConfigPatch): PiWebConfigReadResult {
  if (!isRecord(patch)) {
    throw new PiWebConfigValidationError("config patch must be an object");
  }

  const hasYolk = Object.prototype.hasOwnProperty.call(patch, "yolk");
  const hasWorktree = Object.prototype.hasOwnProperty.call(patch, "worktree");
  const hasTrellis = Object.prototype.hasOwnProperty.call(patch, "trellis");
  const hasStudio = Object.prototype.hasOwnProperty.call(patch, "studio");
  const hasUsage = Object.prototype.hasOwnProperty.call(patch, "usage");
  const hasTerminal = Object.prototype.hasOwnProperty.call(patch, "terminal");
  const hasChatGpt = Object.prototype.hasOwnProperty.call(patch, "chatgpt");
  const hasEditor = Object.prototype.hasOwnProperty.call(patch, "editor");
  if (!hasYolk && !hasWorktree && !hasTrellis && !hasStudio && !hasUsage && !hasTerminal && !hasChatGpt && !hasEditor) {
    throw new PiWebConfigValidationError("no supported config sections provided");
  }

  const path = getPiWebConfigPath();
  const current = readRawConfigFile(path);
  const raw = current.parseError ? {} : current.raw;
  const currentConfig = normalizePiWebConfig(raw);
  const chatGptPatch = hasChatGpt ? patch.chatgpt : undefined;
  const normalizedYolk = hasYolk ? validatePiWebYolkConfig(patch.yolk) : undefined;
  const normalizedWorktree = hasWorktree ? validatePiWebWorktreeConfig(patch.worktree) : undefined;
  const normalizedTrellis = hasTrellis ? validatePiWebTrellisConfig(patch.trellis) : undefined;
  const normalizedStudio = hasStudio ? validatePiWebStudioConfig(patch.studio) : undefined;
  const normalizedUsage = hasUsage ? validatePiWebUsageConfig(patch.usage) : undefined;
  const normalizedTerminal = hasTerminal ? validatePiWebTerminalConfig(patch.terminal) : undefined;
  const normalizedChatGpt = hasChatGpt ? validatePiWebChatGptConfig(isRecord(chatGptPatch) ? {
    ...currentConfig.chatgpt,
    ...chatGptPatch,
    warmup: Object.prototype.hasOwnProperty.call(chatGptPatch, "warmup")
      ? chatGptPatch.warmup
      : currentConfig.chatgpt.warmup,
  } : chatGptPatch) : undefined;
  const normalizedEditor = hasEditor ? validatePiWebEditorConfig(patch.editor) : undefined;
  const nextRaw: Record<string, unknown> = { ...raw };

  if (normalizedYolk) {
    const previousYolk = isRecord(raw.yolk) ? raw.yolk : {};
    nextRaw.yolk = {
      ...previousYolk,
      ...normalizedYolk,
    };
  }

  if (normalizedWorktree) {
    const previousWorktree = isRecord(raw.worktree) ? raw.worktree : {};
    nextRaw.worktree = {
      ...previousWorktree,
      ...normalizedWorktree,
    };
  }

  if (normalizedTrellis) {
    const previousTrellis = isRecord(raw.trellis) ? raw.trellis : {};
    nextRaw.trellis = {
      ...previousTrellis,
      ...normalizedTrellis,
    };
  }

  if (normalizedStudio) {
    const previousStudio = isRecord(raw.studio) ? raw.studio : {};
    nextRaw.studio = {
      ...previousStudio,
      ...normalizedStudio,
    };
  }

  if (normalizedUsage) {
    const previousUsage = isRecord(raw.usage) ? raw.usage : {};
    nextRaw.usage = {
      ...previousUsage,
      ...normalizedUsage,
    };
  }

  if (normalizedTerminal) {
    const previousTerminal = isRecord(raw.terminal) ? raw.terminal : {};
    nextRaw.terminal = {
      ...previousTerminal,
      ...normalizedTerminal,
    };
  }

  if (normalizedChatGpt) {
    const previousChatGpt = isRecord(raw.chatgpt) ? raw.chatgpt : {};
    nextRaw.chatgpt = {
      ...previousChatGpt,
      ...normalizedChatGpt,
    };
  }

  if (normalizedEditor) {
    const previousEditor = isRecord(raw.editor) ? raw.editor : {};
    nextRaw.editor = {
      ...previousEditor,
      ...normalizedEditor,
    };
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(nextRaw, null, 2)}\n`, "utf8");

  return {
    config: normalizePiWebConfig(nextRaw),
    defaults: DEFAULT_PI_WEB_CONFIG,
    path,
    exists: true,
  };
}

export function writePiWebWorktreeConfig(worktree: unknown): PiWebConfigReadResult {
  return writePiWebConfigPatch({ worktree });
}
