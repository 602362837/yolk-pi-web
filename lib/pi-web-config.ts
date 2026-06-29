import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface PiWebWorktreeConfig {
  baseRef: string;
  branchNameTemplate: string;
  baseDirTemplate: string;
  pathTemplate: string;
  sessionDisplay: "separate" | "tag";
}

export type PiWebSubagentModelMode = "followMain" | "piDefault" | "specific" | "unset";
export type PiWebSubagentThinking = "inherit" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type PiWebSubagentAgentStrategy = "default" | "fixed" | "disabled";

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
}

export interface PiWebTrellisSubagentsConfig {
  enabled: boolean;
  defaultPolicy: PiWebSubagentRunPolicy;
  agents: Record<string, PiWebSubagentAgentConfig>;
}

export interface PiWebTrellisConfig {
  enabled: boolean;
  includeArchived: boolean;
  proxyEnabled: boolean;
  proxyUrl: string;
  subagents: PiWebTrellisSubagentsConfig;
}

export interface PiWebConfig {
  worktree: PiWebWorktreeConfig;
  trellis: PiWebTrellisConfig;
}

export interface PiWebConfigPatch {
  worktree?: unknown;
  trellis?: unknown;
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

export const DEFAULT_PI_WEB_CONFIG: PiWebConfig = {
  worktree: {
    baseRef: "HEAD",
    branchNameTemplate: "pi/{yyyyMMdd-HHmmss}",
    baseDirTemplate: "{repoParent}/{repoName}.worktrees",
    pathTemplate: "{baseDir}/{branchSlug}",
    sessionDisplay: "separate",
  },
  trellis: {
    enabled: false,
    includeArchived: false,
    proxyEnabled: false,
    proxyUrl: "",
    subagents: {
      enabled: true,
      defaultPolicy: {
        model: { mode: "followMain" },
        thinking: "inherit",
      },
      agents: {
        "trellis-implement": { strategy: "default" },
        "trellis-check": { strategy: "default" },
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

function readSessionDisplay(value: unknown, fallback: "separate" | "tag"): "separate" | "tag" {
  return value === "separate" || value === "tag" ? value : fallback;
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

function readSubagentAgentConfig(value: unknown, fallback: PiWebSubagentAgentConfig): PiWebSubagentAgentConfig {
  const root = isRecord(value) ? value : {};
  const strategy = root.strategy === "default" || root.strategy === "fixed" || root.strategy === "disabled" ? root.strategy : fallback.strategy;
  const fixedFallback = fallback.fixed ?? DEFAULT_PI_WEB_CONFIG.trellis.subagents.defaultPolicy;
  return {
    strategy,
    fixed: root.fixed || fallback.fixed ? readSubagentPolicy(root.fixed, fixedFallback) : undefined,
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
    agents: readSubagentAgents(root.agents, fallback.agents),
  };
}

function normalizePiWebConfig(raw: unknown): PiWebConfig {
  const defaults = DEFAULT_PI_WEB_CONFIG;
  const root = isRecord(raw) ? raw : {};
  const worktree = isRecord(root.worktree) ? root.worktree : {};
  const trellis = isRecord(root.trellis) ? root.trellis : {};
  return {
    worktree: {
      baseRef: readString(worktree.baseRef, defaults.worktree.baseRef),
      branchNameTemplate: readString(worktree.branchNameTemplate, defaults.worktree.branchNameTemplate),
      baseDirTemplate: readString(worktree.baseDirTemplate, defaults.worktree.baseDirTemplate),
      pathTemplate: readString(worktree.pathTemplate, defaults.worktree.pathTemplate),
      sessionDisplay: readSessionDisplay(worktree.sessionDisplay, defaults.worktree.sessionDisplay),
    },
    trellis: {
      enabled: readBoolean(trellis.enabled, defaults.trellis.enabled),
      includeArchived: readBoolean(trellis.includeArchived, defaults.trellis.includeArchived),
      proxyEnabled: readBoolean(trellis.proxyEnabled, defaults.trellis.proxyEnabled),
      proxyUrl: typeof trellis.proxyUrl === "string" ? trellis.proxyUrl.trim() : defaults.trellis.proxyUrl,
      subagents: readTrellisSubagentsConfig(trellis.subagents, defaults.trellis.subagents),
    },
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
  if (strategy !== "default" && strategy !== "fixed" && strategy !== "disabled") {
    throw new PiWebConfigValidationError(`${field}.strategy is invalid`);
  }
  return {
    strategy,
    fixed: value.fixed === undefined ? undefined : validateSubagentPolicy(value.fixed, `${field}.fixed`),
  };
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
    agents,
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
    subagents: value.subagents === undefined
      ? DEFAULT_PI_WEB_CONFIG.trellis.subagents
      : validateTrellisSubagentsConfig(value.subagents),
  };
}

export function writePiWebConfigPatch(patch: PiWebConfigPatch): PiWebConfigReadResult {
  if (!isRecord(patch)) {
    throw new PiWebConfigValidationError("config patch must be an object");
  }

  const hasWorktree = Object.prototype.hasOwnProperty.call(patch, "worktree");
  const hasTrellis = Object.prototype.hasOwnProperty.call(patch, "trellis");
  if (!hasWorktree && !hasTrellis) {
    throw new PiWebConfigValidationError("no supported config sections provided");
  }

  const normalizedWorktree = hasWorktree ? validatePiWebWorktreeConfig(patch.worktree) : undefined;
  const normalizedTrellis = hasTrellis ? validatePiWebTrellisConfig(patch.trellis) : undefined;
  const path = getPiWebConfigPath();
  const current = readRawConfigFile(path);
  const raw = current.parseError ? {} : current.raw;
  const nextRaw: Record<string, unknown> = { ...raw };

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
