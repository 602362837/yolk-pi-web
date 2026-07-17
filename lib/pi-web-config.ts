import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type {
  PiWebTerminalSshConfig,
  TerminalSshEndpoint,
  TerminalSshKnownHostsPolicy,
  TerminalSshProfile,
  TerminalSshProfileOptions,
  TerminalSshProxyConfig,
} from "./terminal-ssh-types";

export type {
  PiWebTerminalSshConfig,
  TerminalCredentialSummary,
  TerminalSshEndpoint,
  TerminalSshKnownHostsPolicy,
  TerminalSshProfile,
  TerminalSshProfileOptions,
  TerminalSshProxyConfig,
} from "./terminal-ssh-types";

export type PiWebToolPreset = "none" | "default" | "full" | "subagent";
export type PiWebThinkingLevel = "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

/** New-session default model from Settings → 蛋黄𝝅 (IMP-002 MODEL-PIN-4). */
export type PiWebYolkDefaultModel =
  | { mode: "piDefault" }
  | {
      mode: "specific";
      provider: string;
      modelId: string;
      /** Thinking follows the selected model; optional on disk, filled on normalize when missing. */
      thinking?: PiWebThinkingLevel;
    };

export interface PiWebYolkConfig {
  defaultToolPreset: PiWebToolPreset;
  /**
   * New empty-session initial model (+ thinking when mode is specific).
   * Chat switches remain session-scoped and do not write this field.
   */
  defaultModel: PiWebYolkDefaultModel;
  /**
   * Effective new-session thinking default (derived).
   * Prefer `defaultModel.thinking` when mode is specific.
   * Legacy files with only `defaultThinkingLevel` still populate this on read;
   * saves dual-write it for older readers.
   */
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

export type PiWebStudioMemberId = "architect" | "improver" | "ui-designer" | "implementer" | "checker" | string;

export type PiWebStudioSubagentRunner = "auto" | "sdk" | "cli";

export interface PiWebStudioSubagentsConfig {
  runner: PiWebStudioSubagentRunner;
}

export interface PiWebStudioConfig {
  defaultPolicy: PiWebSubagentRunPolicy;
  members: Record<PiWebStudioMemberId, PiWebSubagentRunPolicy>;
  subagents: PiWebStudioSubagentsConfig;
}

export interface PiWebUsageConfig {
  /** Whether Chat top-bar session_rollup may include archived sessions. Does not control the global ledger. */
  includeArchived: boolean;
  /**
   * Global compact mode for GPT/Grok/Kiro top-bar usage triggers.
   * Only compresses the trigger summary; detailed popovers stay available.
   * Default false preserves the existing full trigger layout.
   * When providerPanelsAggregated is true this value is retained but not applied.
   */
  providerPanelsCompact: boolean;
  /**
   * When true, Chat top-bar mounts one aggregate provider-usage entry instead of
   * standalone GPT/Grok/Kiro triggers. Default false preserves the existing layout.
   */
  providerPanelsAggregated: boolean;
  /** Models explicitly marked as free by the user. Stored as provider:model pairs. */
  explicitFreeModels: Array<{ provider: string; model: string }>;
  /** AI assistant policy for model price suggestion (structured extraction from bounded evidence). */
  pricingAssistant: PiWebSubagentRunPolicy;
  /** Fallback AI assistant policy when the primary fails. */
  pricingAssistantFallback: PiWebSubagentRunPolicy;
}

export interface PiWebChatGptWarmupConfig {
  enabled: boolean;
  accountIds: string[];
  times: string[];
}

export interface PiWebChatGptAutoFailoverConfig {
  enabled: boolean;
  maxAttemptsPerTurn: number;
  maxAccountSwitchesPerTurn: number;
  quotaCacheMaxAgeMs: number;
  exhaustedCooldownMs: number;
  minSwitchIntervalMs: number;
}

export interface PiWebOpencodeGoAutoFailoverConfig {
  enabled: boolean;
  maxAttemptsPerTurn: number;
  maxAccountSwitchesPerTurn: number;
  exhaustedCooldownMs: number;
  minSwitchIntervalMs: number;
}

export interface PiWebOpencodeGoConfig {
  autoFailover: PiWebOpencodeGoAutoFailoverConfig;
}

export interface PiWebGrokAutoFailoverConfig {
  enabled: boolean;
  maxAttemptsPerTurn: number;
  maxAccountSwitchesPerTurn: number;
  quotaCacheMaxAgeMs: number;
  exhaustedCooldownMs: number;
  minSwitchIntervalMs: number;
}

export interface PiWebGrokConfig {
  /** Top-right Grok usage pill; default off so upgrades do not mount or poll. */
  usagePanelEnabled: boolean;
  autoFailover: PiWebGrokAutoFailoverConfig;
}

export interface PiWebKiroAutoFailoverConfig {
  enabled: boolean;
  maxAttemptsPerTurn: number;
  maxAccountSwitchesPerTurn: number;
  quotaCacheMaxAgeMs: number;
  exhaustedCooldownMs: number;
  minSwitchIntervalMs: number;
}

export interface PiWebKiroConfig {
  /** Top-right Kiro usage pill; default off so upgrades do not mount or poll. */
  usagePanelEnabled: boolean;
  autoFailover: PiWebKiroAutoFailoverConfig;
}

export interface PiWebAntigravityAutoFailoverConfig {
  enabled: boolean;
  maxAttemptsPerTurn: number;
  maxAccountSwitchesPerTurn: number;
  quotaCacheMaxAgeMs: number;
  exhaustedCooldownMs: number;
  minSwitchIntervalMs: number;
}

export interface PiWebAntigravityConfig {
  /** Top-right Antigravity usage pill; default off so upgrades do not mount or poll. */
  usagePanelEnabled: boolean;
  autoFailover: PiWebAntigravityAutoFailoverConfig;
}

export type PiWebTerminalShell = "zsh" | "bash" | "sh" | "cmd" | "powershell" | "pwsh" | "custom";

export interface PiWebTerminalConfig {
  enabled: boolean;
  shell: PiWebTerminalShell;
  customShellPath: string;
  env: Record<string, string>;
  envAssistant: PiWebSubagentRunPolicy;
  envAssistantFallback: PiWebSubagentRunPolicy;
  ssh: PiWebTerminalSshConfig;
}

export interface PiWebChatGptConfig {
  usagePanelEnabled: boolean;
  warmup: PiWebChatGptWarmupConfig;
  autoFailover: PiWebChatGptAutoFailoverConfig;
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
  opencodeGo: PiWebOpencodeGoConfig;
  grok: PiWebGrokConfig;
  kiro: PiWebKiroConfig;
  antigravity: PiWebAntigravityConfig;
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
  opencodeGo?: unknown;
  grok?: unknown;
  kiro?: unknown;
  antigravity?: unknown;
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

export const PI_WEB_STUDIO_DEFAULT_MEMBERS = ["architect", "improver", "ui-designer", "implementer", "checker"] as const;

const DEFAULT_STUDIO_POLICY: PiWebSubagentRunPolicy = {
  model: { mode: "followMain" },
  thinking: "inherit",
};

export const DEFAULT_PI_WEB_CONFIG: PiWebConfig = {
  yolk: {
    defaultToolPreset: "default",
    defaultModel: { mode: "piDefault" },
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
    providerPanelsCompact: false,
    providerPanelsAggregated: false,
    explicitFreeModels: [],
    pricingAssistant: {
      model: { mode: "followMain" },
      thinking: "minimal",
    },
    pricingAssistantFallback: {
      model: { mode: "piDefault" },
      thinking: "minimal",
    },
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
    ssh: {
      enabled: false,
      allowCustomProxyCommand: false,
      defaultKnownHostsPolicy: "ask",
      applyTerminalEnvToSsh: false,
      profiles: [],
    },
  },
  chatgpt: {
    usagePanelEnabled: false,
    warmup: {
      enabled: false,
      accountIds: [],
      times: ["07:00", "13:00"],
    },
    autoFailover: {
      enabled: false,
      maxAttemptsPerTurn: 1,
      maxAccountSwitchesPerTurn: 1,
      quotaCacheMaxAgeMs: 5 * 60 * 1000,
      exhaustedCooldownMs: 30 * 60 * 1000,
      minSwitchIntervalMs: 10 * 1000,
    },
    autoRefreshEnabled: false,
    refreshCycleIntervalSeconds: 1800,
    refreshCycleSaltMinSeconds: 0,
    refreshCycleSaltMaxSeconds: 120,
    refreshAccountIntervalSeconds: 20,
    refreshAccountSaltMinSeconds: 0,
    refreshAccountSaltMaxSeconds: 15,
  },
  opencodeGo: {
    autoFailover: {
      enabled: false,
      maxAttemptsPerTurn: 1,
      maxAccountSwitchesPerTurn: 1,
      exhaustedCooldownMs: 30 * 60 * 1000,
      minSwitchIntervalMs: 10 * 1000,
    },
  },
  grok: {
    usagePanelEnabled: false,
    autoFailover: {
      enabled: false,
      maxAttemptsPerTurn: 1,
      maxAccountSwitchesPerTurn: 1,
      quotaCacheMaxAgeMs: 5 * 60 * 1000,
      exhaustedCooldownMs: 30 * 60 * 1000,
      minSwitchIntervalMs: 10 * 1000,
    },
  },
  kiro: {
    usagePanelEnabled: false,
    autoFailover: {
      enabled: false,
      maxAttemptsPerTurn: 1,
      maxAccountSwitchesPerTurn: 1,
      quotaCacheMaxAgeMs: 5 * 60 * 1000,
      exhaustedCooldownMs: 30 * 60 * 1000,
      minSwitchIntervalMs: 10 * 1000,
    },
  },
  antigravity: {
    usagePanelEnabled: false,
    autoFailover: {
      enabled: false,
      maxAttemptsPerTurn: 1,
      maxAccountSwitchesPerTurn: 1,
      quotaCacheMaxAgeMs: 5 * 60 * 1000,
      exhaustedCooldownMs: 30 * 60 * 1000,
      minSwitchIntervalMs: 10 * 1000,
    },
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
    subagents: {
      runner: "auto",
    },
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

function isPiWebThinkingLevel(value: unknown): value is PiWebThinkingLevel {
  return value === "auto" || value === "off" || value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh";
}

function readYolkDefaultModel(value: unknown, fallback: PiWebYolkDefaultModel): PiWebYolkDefaultModel {
  if (!isRecord(value)) return fallback;
  if (value.mode === "piDefault") return { mode: "piDefault" };
  if (value.mode !== "specific") return fallback;
  const provider = typeof value.provider === "string" ? value.provider.trim() : "";
  const modelId = typeof value.modelId === "string" ? value.modelId.trim() : "";
  if (!provider || !modelId) return fallback;
  if (value.thinking === undefined) {
    return { mode: "specific", provider, modelId };
  }
  if (!isPiWebThinkingLevel(value.thinking)) {
    return { mode: "specific", provider, modelId };
  }
  return { mode: "specific", provider, modelId, thinking: value.thinking };
}

/**
 * Normalize yolk defaults: prefer `defaultModel` (+thinking); fall back to legacy
 * top-level `defaultThinkingLevel` when specific thinking is missing.
 */
function readYolkConfig(value: unknown, fallback: PiWebYolkConfig): PiWebYolkConfig {
  const root = isRecord(value) ? value : {};
  const defaultToolPreset = readToolPreset(root.defaultToolPreset, fallback.defaultToolPreset);
  const defaultModelRaw = readYolkDefaultModel(root.defaultModel, fallback.defaultModel);
  const legacyThinking = readThinkingLevel(root.defaultThinkingLevel, fallback.defaultThinkingLevel);

  if (defaultModelRaw.mode === "specific") {
    const thinking = defaultModelRaw.thinking ?? legacyThinking;
    return {
      defaultToolPreset,
      defaultModel: { mode: "specific", provider: defaultModelRaw.provider, modelId: defaultModelRaw.modelId, thinking },
      defaultThinkingLevel: thinking,
    };
  }

  return {
    defaultToolPreset,
    defaultModel: { mode: "piDefault" },
    defaultThinkingLevel: legacyThinking,
  };
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

function readSshKnownHostsPolicy(value: unknown, fallback: TerminalSshKnownHostsPolicy): TerminalSshKnownHostsPolicy {
  return value === "ask" || value === "strict" || value === "accept-new" ? value : fallback;
}

function readOptionalSshKnownHostsPolicy(value: unknown): TerminalSshKnownHostsPolicy | undefined {
  return value === "ask" || value === "strict" || value === "accept-new" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readOptionalIntegerInRange(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : undefined;
}

function readTerminalSshEndpoint(value: unknown, fallback?: TerminalSshEndpoint): TerminalSshEndpoint | null {
  const root = isRecord(value) ? value : {};
  const host = readOptionalString(root.host) ?? fallback?.host;
  const port = readOptionalIntegerInRange(root.port, 1, 65535) ?? fallback?.port ?? 22;
  if (!host) return null;
  return {
    id: readOptionalString(root.id) ?? fallback?.id,
    label: readOptionalString(root.label) ?? fallback?.label,
    host,
    port,
    username: readOptionalString(root.username) ?? fallback?.username,
    credentialId: readOptionalString(root.credentialId) ?? fallback?.credentialId,
  };
}

function readTerminalSshProfileOptions(value: unknown): TerminalSshProfileOptions | undefined {
  if (!isRecord(value)) return undefined;
  const options: TerminalSshProfileOptions = {};
  const connectTimeoutSeconds = readOptionalIntegerInRange(value.connectTimeoutSeconds, 1, 3600);
  const serverAliveIntervalSeconds = readOptionalIntegerInRange(value.serverAliveIntervalSeconds, 1, 3600);
  if (connectTimeoutSeconds !== undefined) options.connectTimeoutSeconds = connectTimeoutSeconds;
  if (serverAliveIntervalSeconds !== undefined) options.serverAliveIntervalSeconds = serverAliveIntervalSeconds;
  if (typeof value.forwardAgent === "boolean") options.forwardAgent = value.forwardAgent;
  if (typeof value.requestTty === "boolean") options.requestTty = value.requestTty;
  const knownHostsPolicy = readOptionalSshKnownHostsPolicy(value.knownHostsPolicy);
  if (knownHostsPolicy) options.knownHostsPolicy = knownHostsPolicy;
  return Object.keys(options).length > 0 ? options : undefined;
}

function readTerminalSshProxyConfig(value: unknown): TerminalSshProxyConfig | undefined {
  if (!isRecord(value)) return undefined;
  if (value.type === "none") return { type: "none" };
  if (value.type === "socks5" || value.type === "http") {
    const host = readOptionalString(value.host);
    const port = readOptionalIntegerInRange(value.port, 1, 65535);
    if (!host || port === undefined) return undefined;
    return { type: value.type, host, port, credentialId: readOptionalString(value.credentialId) };
  }
  if (value.type === "custom") {
    const commandTemplate = typeof value.commandTemplate === "string" ? value.commandTemplate.trim() : "";
    return { type: "custom", commandTemplate, acknowledgedRisk: readBoolean(value.acknowledgedRisk, false) };
  }
  return undefined;
}

function readTerminalSshProfiles(value: unknown): TerminalSshProfile[] {
  if (!Array.isArray(value)) return [];
  const profiles: TerminalSshProfile[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecord(item)) continue;
    const id = readOptionalString(item.id);
    const label = readOptionalString(item.label);
    const target = readTerminalSshEndpoint(item.target);
    const createdAt = readOptionalString(item.createdAt);
    const updatedAt = readOptionalString(item.updatedAt);
    if (!id || !label || !target || !createdAt || !updatedAt || seen.has(id)) continue;
    seen.add(id);
    const jumpHosts = Array.isArray(item.jumpHosts)
      ? item.jumpHosts.flatMap((jumpHost) => {
        const endpoint = readTerminalSshEndpoint(jumpHost);
        return endpoint ? [endpoint] : [];
      })
      : [];
    const proxy = readTerminalSshProxyConfig(item.proxy);
    const options = readTerminalSshProfileOptions(item.options);
    profiles.push({
      id,
      label,
      enabled: readBoolean(item.enabled, true),
      target,
      jumpHosts,
      proxy,
      options,
      createdAt,
      updatedAt,
    });
  }
  return profiles;
}

function readTerminalSshConfig(value: unknown, fallback: PiWebTerminalSshConfig): PiWebTerminalSshConfig {
  const root = isRecord(value) ? value : {};
  return {
    enabled: readBoolean(root.enabled, fallback.enabled),
    allowCustomProxyCommand: readBoolean(root.allowCustomProxyCommand, fallback.allowCustomProxyCommand),
    defaultKnownHostsPolicy: readSshKnownHostsPolicy(root.defaultKnownHostsPolicy, fallback.defaultKnownHostsPolicy),
    applyTerminalEnvToSsh: readBoolean(root.applyTerminalEnvToSsh, fallback.applyTerminalEnvToSsh),
    profiles: readTerminalSshProfiles(root.profiles),
  };
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

function readStudioSubagentRunner(value: unknown, fallback: PiWebStudioSubagentRunner): PiWebStudioSubagentRunner {
  return value === "auto" || value === "sdk" || value === "cli" ? value : fallback;
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
  const rawSubagents = isRecord(root.subagents) ? root.subagents : {};
  return {
    defaultPolicy,
    members,
    subagents: {
      runner: readStudioSubagentRunner(rawSubagents.runner, fallback.subagents.runner),
    },
  };
}

function readChatGptWarmupConfig(value: unknown, fallback: PiWebChatGptWarmupConfig): PiWebChatGptWarmupConfig {
  const root = isRecord(value) ? value : {};
  return {
    enabled: readBoolean(root.enabled, fallback.enabled),
    accountIds: normalizeStringList(root.accountIds),
    times: readDailyTimes(root.times, fallback.times),
  };
}

function readChatGptAutoFailoverConfig(value: unknown, fallback: PiWebChatGptAutoFailoverConfig): PiWebChatGptAutoFailoverConfig {
  const root = isRecord(value) ? value : {};
  return {
    enabled: readBoolean(root.enabled, fallback.enabled),
    maxAttemptsPerTurn: readInteger(root.maxAttemptsPerTurn, fallback.maxAttemptsPerTurn),
    maxAccountSwitchesPerTurn: readInteger(root.maxAccountSwitchesPerTurn, fallback.maxAccountSwitchesPerTurn),
    quotaCacheMaxAgeMs: readInteger(root.quotaCacheMaxAgeMs, fallback.quotaCacheMaxAgeMs),
    exhaustedCooldownMs: readInteger(root.exhaustedCooldownMs, fallback.exhaustedCooldownMs),
    minSwitchIntervalMs: readInteger(root.minSwitchIntervalMs, fallback.minSwitchIntervalMs),
  };
}

function readOpencodeGoAutoFailoverConfig(value: unknown, fallback: PiWebOpencodeGoAutoFailoverConfig): PiWebOpencodeGoAutoFailoverConfig {
  const root = isRecord(value) ? value : {};
  return {
    enabled: readBoolean(root.enabled, fallback.enabled),
    maxAttemptsPerTurn: readInteger(root.maxAttemptsPerTurn, fallback.maxAttemptsPerTurn),
    maxAccountSwitchesPerTurn: readInteger(root.maxAccountSwitchesPerTurn, fallback.maxAccountSwitchesPerTurn),
    exhaustedCooldownMs: readInteger(root.exhaustedCooldownMs, fallback.exhaustedCooldownMs),
    minSwitchIntervalMs: readInteger(root.minSwitchIntervalMs, fallback.minSwitchIntervalMs),
  };
}

function readGrokAutoFailoverConfig(value: unknown, fallback: PiWebGrokAutoFailoverConfig): PiWebGrokAutoFailoverConfig {
  const root = isRecord(value) ? value : {};
  return {
    enabled: readBoolean(root.enabled, fallback.enabled),
    maxAttemptsPerTurn: readInteger(root.maxAttemptsPerTurn, fallback.maxAttemptsPerTurn),
    maxAccountSwitchesPerTurn: readInteger(root.maxAccountSwitchesPerTurn, fallback.maxAccountSwitchesPerTurn),
    quotaCacheMaxAgeMs: readInteger(root.quotaCacheMaxAgeMs, fallback.quotaCacheMaxAgeMs),
    exhaustedCooldownMs: readInteger(root.exhaustedCooldownMs, fallback.exhaustedCooldownMs),
    minSwitchIntervalMs: readInteger(root.minSwitchIntervalMs, fallback.minSwitchIntervalMs),
  };
}

function readKiroAutoFailoverConfig(value: unknown, fallback: PiWebKiroAutoFailoverConfig): PiWebKiroAutoFailoverConfig {
  const root = isRecord(value) ? value : {};
  return {
    enabled: readBoolean(root.enabled, fallback.enabled),
    maxAttemptsPerTurn: readInteger(root.maxAttemptsPerTurn, fallback.maxAttemptsPerTurn),
    maxAccountSwitchesPerTurn: readInteger(root.maxAccountSwitchesPerTurn, fallback.maxAccountSwitchesPerTurn),
    quotaCacheMaxAgeMs: readInteger(root.quotaCacheMaxAgeMs, fallback.quotaCacheMaxAgeMs),
    exhaustedCooldownMs: readInteger(root.exhaustedCooldownMs, fallback.exhaustedCooldownMs),
    minSwitchIntervalMs: readInteger(root.minSwitchIntervalMs, fallback.minSwitchIntervalMs),
  };
}

function readAntigravityAutoFailoverConfig(value: unknown, fallback: PiWebAntigravityAutoFailoverConfig): PiWebAntigravityAutoFailoverConfig {
  const root = isRecord(value) ? value : {};
  return {
    enabled: readBoolean(root.enabled, fallback.enabled),
    maxAttemptsPerTurn: readInteger(root.maxAttemptsPerTurn, fallback.maxAttemptsPerTurn),
    maxAccountSwitchesPerTurn: readInteger(root.maxAccountSwitchesPerTurn, fallback.maxAccountSwitchesPerTurn),
    quotaCacheMaxAgeMs: readInteger(root.quotaCacheMaxAgeMs, fallback.quotaCacheMaxAgeMs),
    exhaustedCooldownMs: readInteger(root.exhaustedCooldownMs, fallback.exhaustedCooldownMs),
    minSwitchIntervalMs: readInteger(root.minSwitchIntervalMs, fallback.minSwitchIntervalMs),
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
  const opencodeGo = isRecord(root.opencodeGo) ? root.opencodeGo : {};
  const grok = isRecord(root.grok) ? root.grok : {};
  const kiro = isRecord(root.kiro) ? root.kiro : {};
  const antigravity = isRecord(root.antigravity) ? root.antigravity : {};
  const editor = isRecord(root.editor) ? root.editor : {};
  const editorShortcuts = isRecord(editor.shortcuts) ? editor.shortcuts : {};
  const terminalEnv: Record<string, string> = {};
  if (isRecord(terminal.env)) {
    for (const [key, value] of Object.entries(terminal.env)) {
      if (typeof value === "string") terminalEnv[key] = value;
    }
  }
  return {
    yolk: readYolkConfig(yolk, defaults.yolk),
    worktree: {
      baseRef: readString(worktree.baseRef, defaults.worktree.baseRef),
      branchNameTemplate: readString(worktree.branchNameTemplate, defaults.worktree.branchNameTemplate),
      baseDirTemplate: readString(worktree.baseDirTemplate, defaults.worktree.baseDirTemplate),
      pathTemplate: readString(worktree.pathTemplate, defaults.worktree.pathTemplate),
      sessionDisplay: readSessionDisplay(worktree.sessionDisplay, defaults.worktree.sessionDisplay),
    },
    usage: {
      // Retired usage.statsSource is ignored on read; ledger is always the global Usage source.
      includeArchived: readBoolean(usage.includeArchived, defaults.usage.includeArchived),
      providerPanelsCompact: readBoolean(usage.providerPanelsCompact, defaults.usage.providerPanelsCompact),
      providerPanelsAggregated: readBoolean(usage.providerPanelsAggregated, defaults.usage.providerPanelsAggregated),
      explicitFreeModels: readExplicitFreeModels(usage.explicitFreeModels),
      pricingAssistant: readSubagentPolicy(usage.pricingAssistant, defaults.usage.pricingAssistant),
      pricingAssistantFallback: readSubagentPolicy(usage.pricingAssistantFallback, defaults.usage.pricingAssistantFallback),
    },
    terminal: {
      enabled: readBoolean(terminal.enabled, defaults.terminal.enabled),
      shell: readTerminalShell(terminal.shell, defaults.terminal.shell),
      customShellPath: typeof terminal.customShellPath === "string" ? terminal.customShellPath.trim() : defaults.terminal.customShellPath,
      env: terminalEnv,
      envAssistant: readSubagentPolicy(terminal.envAssistant, defaults.terminal.envAssistant),
      envAssistantFallback: readSubagentPolicy(terminal.envAssistantFallback, defaults.terminal.envAssistantFallback),
      ssh: readTerminalSshConfig(terminal.ssh, defaults.terminal.ssh),
    },
    chatgpt: {
      usagePanelEnabled: readBoolean(chatgpt.usagePanelEnabled, defaults.chatgpt.usagePanelEnabled),
      warmup: readChatGptWarmupConfig(chatgpt.warmup, defaults.chatgpt.warmup),
      autoFailover: readChatGptAutoFailoverConfig(chatgpt.autoFailover, defaults.chatgpt.autoFailover),
      autoRefreshEnabled: readBoolean(chatgpt.autoRefreshEnabled, defaults.chatgpt.autoRefreshEnabled),
      refreshCycleIntervalSeconds: readInteger(chatgpt.refreshCycleIntervalSeconds, defaults.chatgpt.refreshCycleIntervalSeconds),
      refreshCycleSaltMinSeconds: readInteger(chatgpt.refreshCycleSaltMinSeconds, defaults.chatgpt.refreshCycleSaltMinSeconds),
      refreshCycleSaltMaxSeconds: readInteger(chatgpt.refreshCycleSaltMaxSeconds, defaults.chatgpt.refreshCycleSaltMaxSeconds),
      refreshAccountIntervalSeconds: readInteger(chatgpt.refreshAccountIntervalSeconds, defaults.chatgpt.refreshAccountIntervalSeconds),
      refreshAccountSaltMinSeconds: readInteger(chatgpt.refreshAccountSaltMinSeconds, defaults.chatgpt.refreshAccountSaltMinSeconds),
      refreshAccountSaltMaxSeconds: readInteger(chatgpt.refreshAccountSaltMaxSeconds, defaults.chatgpt.refreshAccountSaltMaxSeconds),
    },
    opencodeGo: {
      autoFailover: readOpencodeGoAutoFailoverConfig(opencodeGo.autoFailover, defaults.opencodeGo.autoFailover),
    },
    grok: {
      usagePanelEnabled: readBoolean(grok.usagePanelEnabled, defaults.grok.usagePanelEnabled),
      autoFailover: readGrokAutoFailoverConfig(grok.autoFailover, defaults.grok.autoFailover),
    },
    kiro: {
      usagePanelEnabled: readBoolean(kiro.usagePanelEnabled, defaults.kiro.usagePanelEnabled),
      autoFailover: readKiroAutoFailoverConfig(kiro.autoFailover, defaults.kiro.autoFailover),
    },
    antigravity: {
      usagePanelEnabled: readBoolean(antigravity.usagePanelEnabled, defaults.antigravity.usagePanelEnabled),
      autoFailover: readAntigravityAutoFailoverConfig(antigravity.autoFailover, defaults.antigravity.autoFailover),
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

function validatePiWebThinkingLevel(value: unknown, field: string): PiWebThinkingLevel {
  if (!isPiWebThinkingLevel(value)) {
    throw new PiWebConfigValidationError(`${field} must be auto, off, minimal, low, medium, high, or xhigh`);
  }
  return value;
}

function validatePiWebYolkDefaultModel(value: unknown): PiWebYolkDefaultModel {
  if (!isRecord(value)) {
    throw new PiWebConfigValidationError("yolk.defaultModel must be an object");
  }
  if (value.mode === "piDefault") return { mode: "piDefault" };
  if (value.mode !== "specific") {
    throw new PiWebConfigValidationError('yolk.defaultModel.mode must be "piDefault" or "specific"');
  }
  const provider = requireNonEmptyString(value.provider, "yolk.defaultModel.provider");
  const modelId = requireNonEmptyString(value.modelId, "yolk.defaultModel.modelId");
  if (value.thinking === undefined) {
    return { mode: "specific", provider, modelId };
  }
  return {
    mode: "specific",
    provider,
    modelId,
    thinking: validatePiWebThinkingLevel(value.thinking, "yolk.defaultModel.thinking"),
  };
}

export function validatePiWebYolkConfig(value: unknown): PiWebYolkConfig {
  if (!isRecord(value)) {
    throw new PiWebConfigValidationError("yolk config must be an object");
  }
  const defaultToolPreset = value.defaultToolPreset;
  if (defaultToolPreset !== "none" && defaultToolPreset !== "default" && defaultToolPreset !== "full" && defaultToolPreset !== "subagent") {
    throw new PiWebConfigValidationError("yolk.defaultToolPreset must be none, default, full, or subagent");
  }

  // Accept missing defaultModel as piDefault so partial UI patches and older clients still validate.
  const defaultModelRaw = value.defaultModel === undefined
    ? ({ mode: "piDefault" } as const)
    : validatePiWebYolkDefaultModel(value.defaultModel);

  const legacyThinking = value.defaultThinkingLevel === undefined
    ? undefined
    : validatePiWebThinkingLevel(value.defaultThinkingLevel, "yolk.defaultThinkingLevel");

  if (defaultModelRaw.mode === "specific") {
    const thinking = defaultModelRaw.thinking ?? legacyThinking ?? "auto";
    return {
      defaultToolPreset,
      defaultModel: {
        mode: "specific",
        provider: defaultModelRaw.provider,
        modelId: defaultModelRaw.modelId,
        thinking,
      },
      defaultThinkingLevel: thinking,
    };
  }

  return {
    defaultToolPreset,
    defaultModel: { mode: "piDefault" },
    defaultThinkingLevel: legacyThinking ?? "auto",
  };
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

function validateStudioSubagentRunner(value: unknown): PiWebStudioSubagentRunner {
  if (value === "auto" || value === "sdk" || value === "cli") return value;
  throw new PiWebConfigValidationError("studio.subagents.runner must be auto, sdk, or cli");
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
  const rawSubagents = isRecord(value.subagents) ? value.subagents : {};
  return {
    defaultPolicy: value.defaultPolicy === undefined
      ? DEFAULT_PI_WEB_CONFIG.studio.defaultPolicy
      : validateSubagentPolicy(value.defaultPolicy, "studio.defaultPolicy"),
    members,
    subagents: {
      runner: rawSubagents.runner === undefined
        ? DEFAULT_PI_WEB_CONFIG.studio.subagents.runner
        : validateStudioSubagentRunner(rawSubagents.runner),
    },
  };
}

function readExplicitFreeModels(value: unknown): Array<{ provider: string; model: string }> {
  if (!Array.isArray(value)) return [];
  const result: Array<{ provider: string; model: string }> = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const provider = typeof (item as Record<string, unknown>).provider === "string" ? ((item as Record<string, unknown>).provider as string).trim() : "";
    const model = typeof (item as Record<string, unknown>).model === "string" ? ((item as Record<string, unknown>).model as string).trim() : "";
    if (!provider || !model) continue;
    const key = `${provider}:${model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ provider, model });
  }
  return result;
}

export function validatePiWebUsageConfig(value: unknown): PiWebUsageConfig {
  if (!isRecord(value)) {
    throw new PiWebConfigValidationError("usage config must be an object");
  }
  return {
    // Retired usage.statsSource is not projected; next save strips it from disk.
    includeArchived: requireBoolean(value.includeArchived, "usage.includeArchived"),
    providerPanelsCompact: value.providerPanelsCompact === undefined
      ? DEFAULT_PI_WEB_CONFIG.usage.providerPanelsCompact
      : requireBoolean(value.providerPanelsCompact, "usage.providerPanelsCompact"),
    providerPanelsAggregated: value.providerPanelsAggregated === undefined
      ? DEFAULT_PI_WEB_CONFIG.usage.providerPanelsAggregated
      : requireBoolean(value.providerPanelsAggregated, "usage.providerPanelsAggregated"),
    explicitFreeModels: readExplicitFreeModels(value.explicitFreeModels),
    pricingAssistant: value.pricingAssistant === undefined
      ? DEFAULT_PI_WEB_CONFIG.usage.pricingAssistant
      : validateSubagentPolicy(value.pricingAssistant, "usage.pricingAssistant"),
    pricingAssistantFallback: value.pricingAssistantFallback === undefined
      ? DEFAULT_PI_WEB_CONFIG.usage.pricingAssistantFallback
      : validateSubagentPolicy(value.pricingAssistantFallback, "usage.pricingAssistantFallback"),
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

const TERMINAL_SSH_FORBIDDEN_SECRET_FIELDS = new Set(["privateKey", "privateKeyPem", "password", "passphrase", "proxyPassword"]);

function rejectTerminalSshSecretFields(value: unknown, field: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectTerminalSshSecretFields(item, `${field}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, nestedValue] of Object.entries(value)) {
    if (TERMINAL_SSH_FORBIDDEN_SECRET_FIELDS.has(key)) {
      throw new PiWebConfigValidationError(`${field}.${key} must be stored in the SSH credential vault, not pi-web.json`);
    }
    rejectTerminalSshSecretFields(nestedValue, `${field}.${key}`);
  }
}

function validateSshKnownHostsPolicy(value: unknown, field: string): TerminalSshKnownHostsPolicy {
  if (value === "ask" || value === "strict" || value === "accept-new") return value;
  throw new PiWebConfigValidationError(`${field} must be ask, strict, or accept-new`);
}

function validateOptionalPlainString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new PiWebConfigValidationError(`${field} must be a string`);
  const trimmed = value.trim();
  return trimmed || undefined;
}

function validateSshEndpoint(value: unknown, field: string): TerminalSshEndpoint {
  if (!isRecord(value)) throw new PiWebConfigValidationError(`${field} must be an object`);
  return {
    id: validateOptionalPlainString(value.id, `${field}.id`),
    label: validateOptionalPlainString(value.label, `${field}.label`),
    host: requireNonEmptyString(value.host, `${field}.host`),
    port: requireIntegerInRange(value.port, `${field}.port`, 1, 65535),
    username: validateOptionalPlainString(value.username, `${field}.username`),
    credentialId: validateOptionalPlainString(value.credentialId, `${field}.credentialId`),
  };
}

function validateSshProfileOptions(value: unknown, field: string): TerminalSshProfileOptions | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new PiWebConfigValidationError(`${field} must be an object`);
  return {
    connectTimeoutSeconds: value.connectTimeoutSeconds === undefined ? undefined : requireIntegerInRange(value.connectTimeoutSeconds, `${field}.connectTimeoutSeconds`, 1, 3600),
    serverAliveIntervalSeconds: value.serverAliveIntervalSeconds === undefined ? undefined : requireIntegerInRange(value.serverAliveIntervalSeconds, `${field}.serverAliveIntervalSeconds`, 1, 3600),
    forwardAgent: value.forwardAgent === undefined ? undefined : requireBoolean(value.forwardAgent, `${field}.forwardAgent`),
    knownHostsPolicy: value.knownHostsPolicy === undefined ? undefined : validateSshKnownHostsPolicy(value.knownHostsPolicy, `${field}.knownHostsPolicy`),
    requestTty: value.requestTty === undefined ? undefined : requireBoolean(value.requestTty, `${field}.requestTty`),
  };
}

function validateSshProxyConfig(value: unknown, field: string): TerminalSshProxyConfig | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new PiWebConfigValidationError(`${field} must be an object`);
  if (value.type === "none") return { type: "none" };
  if (value.type === "socks5" || value.type === "http") {
    return {
      type: value.type,
      host: requireNonEmptyString(value.host, `${field}.host`),
      port: requireIntegerInRange(value.port, `${field}.port`, 1, 65535),
      credentialId: validateOptionalPlainString(value.credentialId, `${field}.credentialId`),
    };
  }
  if (value.type === "custom") {
    const commandTemplate = requireNonEmptyString(value.commandTemplate, `${field}.commandTemplate`);
    if (/[\u0000-\u001f\u007f]/.test(commandTemplate)) {
      throw new PiWebConfigValidationError(`${field}.commandTemplate must not contain control characters`);
    }
    if (/\{\{\s*secret\s*:/i.test(commandTemplate)) {
      throw new PiWebConfigValidationError(`${field}.commandTemplate must not reference secret placeholders`);
    }
    return {
      type: "custom",
      commandTemplate,
      acknowledgedRisk: requireBoolean(value.acknowledgedRisk, `${field}.acknowledgedRisk`),
    };
  }
  throw new PiWebConfigValidationError(`${field}.type must be none, socks5, http, or custom`);
}

function validateSshProfile(value: unknown, field: string): TerminalSshProfile {
  rejectTerminalSshSecretFields(value, field);
  if (!isRecord(value)) throw new PiWebConfigValidationError(`${field} must be an object`);
  if (!Array.isArray(value.jumpHosts)) throw new PiWebConfigValidationError(`${field}.jumpHosts must be an array`);
  return {
    id: requireNonEmptyString(value.id, `${field}.id`),
    label: requireNonEmptyString(value.label, `${field}.label`),
    enabled: requireBoolean(value.enabled, `${field}.enabled`),
    target: validateSshEndpoint(value.target, `${field}.target`),
    jumpHosts: value.jumpHosts.map((jumpHost, index) => validateSshEndpoint(jumpHost, `${field}.jumpHosts[${index}]`)),
    proxy: validateSshProxyConfig(value.proxy, `${field}.proxy`),
    options: validateSshProfileOptions(value.options, `${field}.options`),
    createdAt: requireNonEmptyString(value.createdAt, `${field}.createdAt`),
    updatedAt: requireNonEmptyString(value.updatedAt, `${field}.updatedAt`),
  };
}

function validateTerminalSshConfig(value: unknown): PiWebTerminalSshConfig {
  if (value === undefined) return DEFAULT_PI_WEB_CONFIG.terminal.ssh;
  if (!isRecord(value)) throw new PiWebConfigValidationError("terminal.ssh must be an object");
  if (!Array.isArray(value.profiles)) throw new PiWebConfigValidationError("terminal.ssh.profiles must be an array");
  const seen = new Set<string>();
  const profiles = value.profiles.map((profile, index) => {
    const normalized = validateSshProfile(profile, `terminal.ssh.profiles[${index}]`);
    if (seen.has(normalized.id)) throw new PiWebConfigValidationError(`terminal.ssh.profiles[${index}].id must be unique`);
    seen.add(normalized.id);
    return normalized;
  });
  return {
    enabled: requireBoolean(value.enabled, "terminal.ssh.enabled"),
    allowCustomProxyCommand: requireBoolean(value.allowCustomProxyCommand, "terminal.ssh.allowCustomProxyCommand"),
    defaultKnownHostsPolicy: validateSshKnownHostsPolicy(value.defaultKnownHostsPolicy, "terminal.ssh.defaultKnownHostsPolicy"),
    applyTerminalEnvToSsh: requireBoolean(value.applyTerminalEnvToSsh, "terminal.ssh.applyTerminalEnvToSsh"),
    profiles,
  };
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
    ssh: validateTerminalSshConfig(value.ssh),
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

function validateChatGptAutoFailoverConfig(value: unknown): PiWebChatGptAutoFailoverConfig {
  if (value === undefined) return DEFAULT_PI_WEB_CONFIG.chatgpt.autoFailover;
  if (!isRecord(value)) throw new PiWebConfigValidationError("chatgpt.autoFailover must be an object");
  return {
    enabled: requireBoolean(value.enabled, "chatgpt.autoFailover.enabled"),
    maxAttemptsPerTurn: requireIntegerInRange(value.maxAttemptsPerTurn, "chatgpt.autoFailover.maxAttemptsPerTurn", 0, 3),
    maxAccountSwitchesPerTurn: requireIntegerInRange(value.maxAccountSwitchesPerTurn, "chatgpt.autoFailover.maxAccountSwitchesPerTurn", 0, 3),
    quotaCacheMaxAgeMs: requireIntegerInRange(value.quotaCacheMaxAgeMs, "chatgpt.autoFailover.quotaCacheMaxAgeMs", 0, 24 * 60 * 60 * 1000),
    exhaustedCooldownMs: requireIntegerInRange(value.exhaustedCooldownMs, "chatgpt.autoFailover.exhaustedCooldownMs", 0, 24 * 60 * 60 * 1000),
    minSwitchIntervalMs: requireIntegerInRange(value.minSwitchIntervalMs, "chatgpt.autoFailover.minSwitchIntervalMs", 0, 60 * 60 * 1000),
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
    autoFailover: validateChatGptAutoFailoverConfig(value.autoFailover),
    autoRefreshEnabled: requireBoolean(value.autoRefreshEnabled, "chatgpt.autoRefreshEnabled"),
    refreshCycleIntervalSeconds: requireIntegerInRange(value.refreshCycleIntervalSeconds, "chatgpt.refreshCycleIntervalSeconds", 300, 86400),
    refreshCycleSaltMinSeconds: cycleSalt.min,
    refreshCycleSaltMaxSeconds: cycleSalt.max,
    refreshAccountIntervalSeconds: requireIntegerInRange(value.refreshAccountIntervalSeconds, "chatgpt.refreshAccountIntervalSeconds", 5, 3600),
    refreshAccountSaltMinSeconds: accountSalt.min,
    refreshAccountSaltMaxSeconds: accountSalt.max,
  };
}

function validateOpencodeGoAutoFailoverConfig(value: unknown): PiWebOpencodeGoAutoFailoverConfig {
  if (value === undefined) return DEFAULT_PI_WEB_CONFIG.opencodeGo.autoFailover;
  if (!isRecord(value)) throw new PiWebConfigValidationError("opencodeGo.autoFailover must be an object");
  return {
    enabled: requireBoolean(value.enabled, "opencodeGo.autoFailover.enabled"),
    maxAttemptsPerTurn: requireIntegerInRange(value.maxAttemptsPerTurn, "opencodeGo.autoFailover.maxAttemptsPerTurn", 0, 3),
    maxAccountSwitchesPerTurn: requireIntegerInRange(value.maxAccountSwitchesPerTurn, "opencodeGo.autoFailover.maxAccountSwitchesPerTurn", 0, 3),
    exhaustedCooldownMs: requireIntegerInRange(value.exhaustedCooldownMs, "opencodeGo.autoFailover.exhaustedCooldownMs", 0, 24 * 60 * 60 * 1000),
    minSwitchIntervalMs: requireIntegerInRange(value.minSwitchIntervalMs, "opencodeGo.autoFailover.minSwitchIntervalMs", 0, 60 * 60 * 1000),
  };
}

export function validatePiWebOpencodeGoConfig(value: unknown): PiWebOpencodeGoConfig {
  if (!isRecord(value)) {
    throw new PiWebConfigValidationError("opencodeGo config must be an object");
  }
  return {
    autoFailover: validateOpencodeGoAutoFailoverConfig(value.autoFailover),
  };
}

function validateGrokAutoFailoverConfig(value: unknown): PiWebGrokAutoFailoverConfig {
  if (value === undefined) return DEFAULT_PI_WEB_CONFIG.grok.autoFailover;
  if (!isRecord(value)) throw new PiWebConfigValidationError("grok.autoFailover must be an object");
  return {
    enabled: requireBoolean(value.enabled, "grok.autoFailover.enabled"),
    maxAttemptsPerTurn: requireIntegerInRange(value.maxAttemptsPerTurn, "grok.autoFailover.maxAttemptsPerTurn", 0, 3),
    maxAccountSwitchesPerTurn: requireIntegerInRange(value.maxAccountSwitchesPerTurn, "grok.autoFailover.maxAccountSwitchesPerTurn", 0, 3),
    quotaCacheMaxAgeMs: requireIntegerInRange(value.quotaCacheMaxAgeMs, "grok.autoFailover.quotaCacheMaxAgeMs", 0, 24 * 60 * 60 * 1000),
    exhaustedCooldownMs: requireIntegerInRange(value.exhaustedCooldownMs, "grok.autoFailover.exhaustedCooldownMs", 0, 24 * 60 * 60 * 1000),
    minSwitchIntervalMs: requireIntegerInRange(value.minSwitchIntervalMs, "grok.autoFailover.minSwitchIntervalMs", 0, 60 * 60 * 1000),
  };
}

export function validatePiWebGrokConfig(value: unknown): PiWebGrokConfig {
  if (!isRecord(value)) {
    throw new PiWebConfigValidationError("grok config must be an object");
  }
  return {
    usagePanelEnabled: requireBoolean(value.usagePanelEnabled, "grok.usagePanelEnabled"),
    autoFailover: validateGrokAutoFailoverConfig(value.autoFailover),
  };
}

function validateKiroAutoFailoverConfig(value: unknown): PiWebKiroAutoFailoverConfig {
  if (value === undefined) return DEFAULT_PI_WEB_CONFIG.kiro.autoFailover;
  if (!isRecord(value)) throw new PiWebConfigValidationError("kiro.autoFailover must be an object");
  return {
    enabled: requireBoolean(value.enabled, "kiro.autoFailover.enabled"),
    maxAttemptsPerTurn: requireIntegerInRange(value.maxAttemptsPerTurn, "kiro.autoFailover.maxAttemptsPerTurn", 0, 3),
    maxAccountSwitchesPerTurn: requireIntegerInRange(value.maxAccountSwitchesPerTurn, "kiro.autoFailover.maxAccountSwitchesPerTurn", 0, 3),
    quotaCacheMaxAgeMs: requireIntegerInRange(value.quotaCacheMaxAgeMs, "kiro.autoFailover.quotaCacheMaxAgeMs", 0, 24 * 60 * 60 * 1000),
    exhaustedCooldownMs: requireIntegerInRange(value.exhaustedCooldownMs, "kiro.autoFailover.exhaustedCooldownMs", 0, 24 * 60 * 60 * 1000),
    minSwitchIntervalMs: requireIntegerInRange(value.minSwitchIntervalMs, "kiro.autoFailover.minSwitchIntervalMs", 0, 60 * 60 * 1000),
  };
}

export function validatePiWebKiroConfig(value: unknown): PiWebKiroConfig {
  if (!isRecord(value)) {
    throw new PiWebConfigValidationError("kiro config must be an object");
  }
  return {
    usagePanelEnabled: requireBoolean(value.usagePanelEnabled, "kiro.usagePanelEnabled"),
    autoFailover: validateKiroAutoFailoverConfig(value.autoFailover),
  };
}

function validateAntigravityAutoFailoverConfig(value: unknown): PiWebAntigravityAutoFailoverConfig {
  if (value === undefined) return DEFAULT_PI_WEB_CONFIG.antigravity.autoFailover;
  if (!isRecord(value)) throw new PiWebConfigValidationError("antigravity.autoFailover must be an object");
  return {
    enabled: requireBoolean(value.enabled, "antigravity.autoFailover.enabled"),
    maxAttemptsPerTurn: requireIntegerInRange(value.maxAttemptsPerTurn, "antigravity.autoFailover.maxAttemptsPerTurn", 0, 3),
    maxAccountSwitchesPerTurn: requireIntegerInRange(value.maxAccountSwitchesPerTurn, "antigravity.autoFailover.maxAccountSwitchesPerTurn", 0, 3),
    quotaCacheMaxAgeMs: requireIntegerInRange(value.quotaCacheMaxAgeMs, "antigravity.autoFailover.quotaCacheMaxAgeMs", 0, 24 * 60 * 60 * 1000),
    exhaustedCooldownMs: requireIntegerInRange(value.exhaustedCooldownMs, "antigravity.autoFailover.exhaustedCooldownMs", 0, 24 * 60 * 60 * 1000),
    minSwitchIntervalMs: requireIntegerInRange(value.minSwitchIntervalMs, "antigravity.autoFailover.minSwitchIntervalMs", 0, 60 * 60 * 1000),
  };
}

export function validatePiWebAntigravityConfig(value: unknown): PiWebAntigravityConfig {
  if (!isRecord(value)) {
    throw new PiWebConfigValidationError("antigravity config must be an object");
  }
  return {
    usagePanelEnabled: requireBoolean(value.usagePanelEnabled, "antigravity.usagePanelEnabled"),
    autoFailover: validateAntigravityAutoFailoverConfig(value.autoFailover),
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
  const hasOpencodeGo = Object.prototype.hasOwnProperty.call(patch, "opencodeGo");
  const hasGrok = Object.prototype.hasOwnProperty.call(patch, "grok");
  const hasKiro = Object.prototype.hasOwnProperty.call(patch, "kiro");
  const hasAntigravity = Object.prototype.hasOwnProperty.call(patch, "antigravity");
  const hasEditor = Object.prototype.hasOwnProperty.call(patch, "editor");
  if (!hasYolk && !hasWorktree && !hasTrellis && !hasStudio && !hasUsage && !hasTerminal && !hasChatGpt && !hasOpencodeGo && !hasGrok && !hasKiro && !hasAntigravity && !hasEditor) {
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
  const normalizedUsage = hasUsage ? validatePiWebUsageConfig(isRecord(patch.usage) ? {
    ...currentConfig.usage,
    ...patch.usage,
  } : patch.usage) : undefined;
  const normalizedTerminal = hasTerminal ? validatePiWebTerminalConfig(patch.terminal) : undefined;
  const normalizedChatGpt = hasChatGpt ? validatePiWebChatGptConfig(isRecord(chatGptPatch) ? {
    ...currentConfig.chatgpt,
    ...chatGptPatch,
    warmup: Object.prototype.hasOwnProperty.call(chatGptPatch, "warmup")
      ? chatGptPatch.warmup
      : currentConfig.chatgpt.warmup,
    autoFailover: Object.prototype.hasOwnProperty.call(chatGptPatch, "autoFailover")
      ? chatGptPatch.autoFailover
      : currentConfig.chatgpt.autoFailover,
  } : chatGptPatch) : undefined;
  const normalizedOpencodeGo = hasOpencodeGo ? validatePiWebOpencodeGoConfig(isRecord(patch.opencodeGo) ? {
    ...currentConfig.opencodeGo,
    ...patch.opencodeGo,
    autoFailover: Object.prototype.hasOwnProperty.call(patch.opencodeGo, "autoFailover")
      ? (patch.opencodeGo as Record<string, unknown>).autoFailover
      : currentConfig.opencodeGo.autoFailover,
  } : patch.opencodeGo) : undefined;
  const normalizedGrok = hasGrok ? validatePiWebGrokConfig(isRecord(patch.grok) ? {
    ...currentConfig.grok,
    ...patch.grok,
    autoFailover: Object.prototype.hasOwnProperty.call(patch.grok, "autoFailover")
      ? (patch.grok as Record<string, unknown>).autoFailover
      : currentConfig.grok.autoFailover,
  } : patch.grok) : undefined;
  const normalizedKiro = hasKiro ? validatePiWebKiroConfig(isRecord(patch.kiro) ? {
    ...currentConfig.kiro,
    ...patch.kiro,
    autoFailover: Object.prototype.hasOwnProperty.call(patch.kiro, "autoFailover")
      ? (patch.kiro as Record<string, unknown>).autoFailover
      : currentConfig.kiro.autoFailover,
  } : patch.kiro) : undefined;
  const normalizedAntigravity = hasAntigravity ? validatePiWebAntigravityConfig(isRecord(patch.antigravity) ? {
    ...currentConfig.antigravity,
    ...patch.antigravity,
    autoFailover: Object.prototype.hasOwnProperty.call(patch.antigravity, "autoFailover")
      ? (patch.antigravity as Record<string, unknown>).autoFailover
      : currentConfig.antigravity.autoFailover,
  } : patch.antigravity) : undefined;
  const normalizedEditor = hasEditor ? validatePiWebEditorConfig(patch.editor) : undefined;
  const nextRaw: Record<string, unknown> = { ...raw };

  if (normalizedYolk) {
    const previousYolk = isRecord(raw.yolk) ? raw.yolk : {};
    // Prefer defaultModel (+thinking). Dual-write defaultThinkingLevel for legacy readers.
    nextRaw.yolk = {
      ...previousYolk,
      defaultToolPreset: normalizedYolk.defaultToolPreset,
      defaultModel: normalizedYolk.defaultModel,
      defaultThinkingLevel: normalizedYolk.defaultThinkingLevel,
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
    const nextUsage: Record<string, unknown> = {
      ...previousUsage,
      ...normalizedUsage,
    };
    // Drop retired selector so a config save no longer writes usage.statsSource.
    delete nextUsage.statsSource;
    nextRaw.usage = nextUsage;
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

  if (normalizedOpencodeGo) {
    const previousOpencodeGo = isRecord(raw.opencodeGo) ? raw.opencodeGo : {};
    nextRaw.opencodeGo = {
      ...previousOpencodeGo,
      ...normalizedOpencodeGo,
    };
  }

  if (normalizedGrok) {
    const previousGrok = isRecord(raw.grok) ? raw.grok : {};
    nextRaw.grok = {
      ...previousGrok,
      ...normalizedGrok,
    };
  }

  if (normalizedKiro) {
    const previousKiro = isRecord(raw.kiro) ? raw.kiro : {};
    nextRaw.kiro = {
      ...previousKiro,
      ...normalizedKiro,
    };
  }

  if (normalizedAntigravity) {
    const previousAntigravity = isRecord(raw.antigravity) ? raw.antigravity : {};
    nextRaw.antigravity = {
      ...previousAntigravity,
      ...normalizedAntigravity,
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
