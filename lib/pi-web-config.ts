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

export interface PiWebConfig {
  worktree: PiWebWorktreeConfig;
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
};

export function getPiWebConfigPath(): string {
  return join(getAgentDir(), "pi-web.json");
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function readSessionDisplay(value: unknown, fallback: "separate" | "tag"): "separate" | "tag" {
  return value === "separate" || value === "tag" ? value : fallback;
}

function normalizePiWebConfig(raw: unknown): PiWebConfig {
  const defaults = DEFAULT_PI_WEB_CONFIG;
  const root = isRecord(raw) ? raw : {};
  const worktree = isRecord(root.worktree) ? root.worktree : {};
  return {
    worktree: {
      baseRef: readString(worktree.baseRef, defaults.worktree.baseRef),
      branchNameTemplate: readString(worktree.branchNameTemplate, defaults.worktree.branchNameTemplate),
      baseDirTemplate: readString(worktree.baseDirTemplate, defaults.worktree.baseDirTemplate),
      pathTemplate: readString(worktree.pathTemplate, defaults.worktree.pathTemplate),
      sessionDisplay: readSessionDisplay(worktree.sessionDisplay, defaults.worktree.sessionDisplay),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

export function writePiWebWorktreeConfig(worktree: unknown): PiWebConfigReadResult {
  const normalizedWorktree = validatePiWebWorktreeConfig(worktree);
  const path = getPiWebConfigPath();
  const current = readRawConfigFile(path);
  const raw = current.parseError ? {} : current.raw;
  const previousWorktree = isRecord(raw.worktree) ? raw.worktree : {};
  const nextRaw: Record<string, unknown> = {
    ...raw,
    worktree: {
      ...previousWorktree,
      ...normalizedWorktree,
    },
  };

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(nextRaw, null, 2)}\n`, "utf8");

  return {
    config: normalizePiWebConfig(nextRaw),
    defaults: DEFAULT_PI_WEB_CONFIG,
    path,
    exists: true,
  };
}
