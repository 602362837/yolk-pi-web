/**
 * github-automation-migration — schema v1 → v2 config/job retirement (GIA-01).
 *
 * Responsibilities:
 * - Parse legacy closed-loop config (schema v1) into live schema v2.
 * - Force enabled=false on every migration; never auto-start analysis or close Issues.
 * - Atomically backup non-secret v1 config to a fixed retirement path once.
 * - Write independent retirement sidecars for non-terminal v1 jobs without rewriting
 *   original job/delivery/event files.
 * - Unknown/future config schema versions fail closed (no overwrite).
 *
 * Never persists Issue body, prompt, transcript, absolute path secrets, tokens,
 * or closed-loop execution fields into live v2 records.
 */

import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  stat,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { GithubAutomationError } from "./github-automation-errors";
import {
  GITHUB_AUTOMATION_ANALYSIS_DEFAULT_MAX_CONCURRENCY,
  GITHUB_AUTOMATION_ANALYSIS_MAX_CONCURRENCY_LIMIT,
  GITHUB_AUTOMATION_CONFIG_SCHEMA_VERSION,
  GITHUB_AUTOMATION_CONFIG_SCHEMA_VERSION_V1,
  GITHUB_AUTOMATION_DEFAULT_VALIDATION_COMMANDS,
  GITHUB_AUTOMATION_JOB_KIND_LEGACY_PIPELINE,
  GITHUB_AUTOMATION_LEGACY_PIPELINE_RETIRED_REASON,
  isGithubAutomationMode,
  type GithubAutomationAnalysisConfig,
  type GithubAutomationConfigV1,
  type GithubAutomationConfigV2,
  type GithubAutomationMode,
  type GithubAutomationRepositoryConfig,
  type GithubAutomationRepositoryConfigV1,
  type GithubAutomationTriageConfig,
  type GithubAutomationUnattendedConfig,
} from "./github-automation-types";

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const AUTOMATION_SUBDIR = "github-automation";

/** Fixed non-secret backup of pre-migration v1 config. Never rewritten after first write. */
export const GITHUB_AUTOMATION_CONFIG_V1_RETIREMENT_BACKUP_FILE =
  "config.v1.retirement-backup.json" as const;

function getGithubAutomationRootDirLocal(): string {
  return join(getAgentDir(), AUTOMATION_SUBDIR);
}

/** Stable JSON stringify with sorted object keys (revision / opaque hash). */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
    .join(",")}}`;
}

/** Sidecar suffix for retired non-terminal v1 jobs (`<jobId>.retirement.json`). */
export const GITHUB_AUTOMATION_JOB_RETIREMENT_SIDECAR_SUFFIX =
  ".retirement.json" as const;

export type GithubAutomationConfigMigrationSource =
  | "fresh_default"
  | "v2"
  | "v1_migrated"
  | "missing";

export interface GithubAutomationConfigMigrationResult {
  config: GithubAutomationConfigV2;
  source: GithubAutomationConfigMigrationSource;
  /** True when a v1 backup was written during this call. */
  wroteV1Backup: boolean;
  /** True when live config.json was rewritten to schema v2 during this call. */
  wroteLiveConfig: boolean;
}

export interface GithubAutomationJobRetirementRecord {
  schemaVersion: 1;
  kind: typeof GITHUB_AUTOMATION_JOB_KIND_LEGACY_PIPELINE;
  reason: typeof GITHUB_AUTOMATION_LEGACY_PIPELINE_RETIRED_REASON;
  jobId: string;
  repositoryId: number | null;
  issueNumber: number | null;
  /** Original job status when retirement was first recorded. */
  originalStatus: string | null;
  /** Original job phase when retirement was first recorded. */
  originalPhase: string | null;
  originalSchemaVersion: number | null;
  retiredAt: string;
  /** Opaque hash of the original job file at retirement time (audit only). */
  originalJobSha256Prefix: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asPositiveInt(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new GithubAutomationError("invalid_config", `Invalid ${field}`, {
      status: 400,
    });
  }
  return value;
}

function asString(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== "string") {
    throw new GithubAutomationError("invalid_config", `Invalid ${field}`, {
      status: 400,
    });
  }
  const trimmed = value.trim();
  if (!allowEmpty && trimmed.length === 0) {
    throw new GithubAutomationError("invalid_config", `Invalid ${field}`, {
      status: 400,
    });
  }
  return trimmed;
}

/** GitHub owner/repo segment: no slashes, whitespace, or control characters. */
const GITHUB_NAME_SEGMENT_RE = /^[A-Za-z0-9_.-]+$/;

function parseFullName(fullName: string, field: string): string {
  const trimmed = typeof fullName === "string" ? fullName.trim() : "";
  const parts = trimmed.split("/");
  if (parts.length !== 2) {
    throw new GithubAutomationError("invalid_config", `Invalid ${field}`, {
      status: 400,
      details: { reason: "malformed_full_name" },
    });
  }
  const owner = parts[0] ?? "";
  const repo = parts[1] ?? "";
  if (
    !owner ||
    !repo ||
    !GITHUB_NAME_SEGMENT_RE.test(owner) ||
    !GITHUB_NAME_SEGMENT_RE.test(repo) ||
    owner === "." ||
    owner === ".." ||
    repo === "." ||
    repo === ".."
  ) {
    throw new GithubAutomationError("invalid_config", `Invalid ${field}`, {
      status: 400,
      details: { reason: "malformed_full_name" },
    });
  }
  return `${owner}/${repo}`;
}

function normalizeProjectIdLoose(
  raw: unknown,
  index: number,
): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") {
    throw new GithubAutomationError(
      "invalid_config",
      `Invalid repositories[${index}].projectId`,
      { status: 400 },
    );
  }
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("..") ||
    trimmed.startsWith("~") ||
    trimmed.startsWith(".") ||
    /^[A-Za-z]:\\/.test(trimmed) ||
    trimmed.length > 128
  ) {
    throw new GithubAutomationError(
      "invalid_config",
      `Invalid repositories[${index}].projectId`,
      { status: 400, details: { reason: "project_id_looks_like_path" } },
    );
  }
  return trimmed;
}

function normalizeBaseRefV1(raw: unknown, index: number): string {
  if (raw === undefined || raw === null || raw === "") return "main";
  if (typeof raw !== "string") {
    throw new GithubAutomationError(
      "invalid_config",
      `Invalid repositories[${index}].baseRef`,
      { status: 400 },
    );
  }
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 255) {
    throw new GithubAutomationError(
      "invalid_config",
      `Invalid repositories[${index}].baseRef`,
      { status: 400 },
    );
  }
  if (
    trimmed.includes("..") ||
    trimmed.includes("\\") ||
    trimmed.includes("\0") ||
    trimmed.startsWith("/") ||
    /[\s~^:?*\[\\]/.test(trimmed) ||
    trimmed.endsWith(".lock") ||
    trimmed.endsWith("/")
  ) {
    throw new GithubAutomationError(
      "invalid_config",
      `Invalid repositories[${index}].baseRef`,
      { status: 400, details: { reason: "invalid_base_ref" } },
    );
  }
  return trimmed;
}

function normalizeOwnerActorIdsV1(raw: unknown, index: number): number[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new GithubAutomationError(
      "invalid_config",
      `Invalid repositories[${index}].ownerActorIds`,
      { status: 400 },
    );
  }
  const ownerActorIds: number[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < raw.length; i++) {
    const id = asPositiveInt(
      raw[i],
      `repositories[${index}].ownerActorIds[${i}]`,
    );
    if (seen.has(id)) continue;
    seen.add(id);
    ownerActorIds.push(id);
  }
  if (ownerActorIds.length > 64) {
    throw new GithubAutomationError(
      "invalid_config",
      `Invalid repositories[${index}].ownerActorIds`,
      { status: 400, details: { reason: "too_many_owner_actor_ids" } },
    );
  }
  return ownerActorIds;
}

function normalizeRepositoryV1(
  raw: unknown,
  index: number,
): GithubAutomationRepositoryConfigV1 {
  if (!isRecord(raw)) {
    throw new GithubAutomationError(
      "invalid_config",
      `Invalid repositories[${index}]`,
      { status: 400 },
    );
  }
  const repositoryId = asPositiveInt(
    raw.repositoryId,
    `repositories[${index}].repositoryId`,
  );
  const fullName = parseFullName(
    asString(raw.fullName, `repositories[${index}].fullName`),
    `repositories[${index}].fullName`,
  );

  let installationId: number | null = null;
  if (raw.installationId !== null && raw.installationId !== undefined) {
    installationId = asPositiveInt(
      raw.installationId,
      `repositories[${index}].installationId`,
    );
  }

  const projectRoot =
    typeof raw.projectRoot === "string" ? raw.projectRoot : "";
  const projectId = normalizeProjectIdLoose(raw.projectId, index);
  const ownerActorIds = normalizeOwnerActorIdsV1(raw.ownerActorIds, index);
  const baseRef = normalizeBaseRefV1(raw.baseRef, index);

  if (
    raw.assigneeIdentitySource !== undefined &&
    raw.assigneeIdentitySource !== "machine-active-credential"
  ) {
    throw new GithubAutomationError(
      "invalid_config",
      "assigneeIdentitySource must be machine-active-credential",
      { status: 400 },
    );
  }

  return {
    repositoryId,
    fullName,
    installationId,
    projectId,
    projectRoot,
    ownerActorIds,
    assigneeIdentitySource: "machine-active-credential",
    baseRef,
  };
}

function normalizeTriageV1(raw: unknown): GithubAutomationTriageConfig {
  if (raw === undefined || raw === null) return { maxConcurrency: 2 };
  if (!isRecord(raw)) {
    throw new GithubAutomationError("invalid_config", "Invalid triage", {
      status: 400,
    });
  }
  const maxConcurrency =
    raw.maxConcurrency === undefined
      ? 2
      : asPositiveInt(raw.maxConcurrency, "triage.maxConcurrency");
  return {
    maxConcurrency: Math.min(
      maxConcurrency,
      GITHUB_AUTOMATION_ANALYSIS_MAX_CONCURRENCY_LIMIT,
    ),
  };
}

function normalizeUnattendedV1(raw: unknown): GithubAutomationUnattendedConfig {
  const defaults: GithubAutomationUnattendedConfig = {
    enabled: false,
    executionProfile: "full-agent",
    riskProfile: "docs-and-small-bugfix",
    maxConcurrency: 1,
    maxFiles: 12,
    maxChangedLines: 500,
    validationCommands: [...GITHUB_AUTOMATION_DEFAULT_VALIDATION_COMMANDS],
  };
  if (raw === undefined || raw === null) return defaults;
  if (!isRecord(raw)) {
    throw new GithubAutomationError("invalid_config", "Invalid unattended", {
      status: 400,
    });
  }

  const enabled = raw.enabled === true;
  if (
    raw.executionProfile !== undefined &&
    raw.executionProfile !== "full-agent"
  ) {
    throw new GithubAutomationError(
      "invalid_config",
      "executionProfile must be full-agent",
      { status: 400 },
    );
  }
  if (
    raw.riskProfile !== undefined &&
    raw.riskProfile !== "docs-and-small-bugfix"
  ) {
    throw new GithubAutomationError(
      "invalid_config",
      "riskProfile must be docs-and-small-bugfix",
      { status: 400 },
    );
  }

  const maxConcurrency =
    raw.maxConcurrency === undefined
      ? defaults.maxConcurrency
      : asPositiveInt(raw.maxConcurrency, "unattended.maxConcurrency");
  const maxFiles =
    raw.maxFiles === undefined
      ? defaults.maxFiles
      : asPositiveInt(raw.maxFiles, "unattended.maxFiles");
  const maxChangedLines =
    raw.maxChangedLines === undefined
      ? defaults.maxChangedLines
      : asPositiveInt(raw.maxChangedLines, "unattended.maxChangedLines");

  let validationCommands = [...defaults.validationCommands];
  if (raw.validationCommands !== undefined) {
    if (!Array.isArray(raw.validationCommands)) {
      throw new GithubAutomationError(
        "invalid_config",
        "Invalid unattended.validationCommands",
        { status: 400 },
      );
    }
    validationCommands = raw.validationCommands.map((cmd, i) => {
      if (typeof cmd !== "string" || !cmd.trim()) {
        throw new GithubAutomationError(
          "invalid_config",
          `Invalid unattended.validationCommands[${i}]`,
          { status: 400 },
        );
      }
      return cmd.trim();
    });
  }

  return {
    enabled,
    executionProfile: "full-agent",
    riskProfile: "docs-and-small-bugfix",
    maxConcurrency: Math.min(maxConcurrency, 2),
    maxFiles,
    maxChangedLines,
    validationCommands,
  };
}

function computeRevision(body: Record<string, unknown>): string {
  const rest: Record<string, unknown> = { ...body };
  delete rest.revision;
  return createHash("sha256")
    .update(stableStringify(rest))
    .digest("hex")
    .slice(0, 16);
}

/**
 * Strict parse of historical schema v1 closed-loop config.
 * Does not write disk; used only as migration input.
 */
export function parseGithubAutomationConfigV1(
  raw: unknown,
  options?: { updatedAt?: string },
): GithubAutomationConfigV1 {
  if (!isRecord(raw)) {
    throw new GithubAutomationError("invalid_config", "Config must be an object", {
      status: 400,
    });
  }
  if (raw.schemaVersion !== GITHUB_AUTOMATION_CONFIG_SCHEMA_VERSION_V1) {
    throw new GithubAutomationError(
      "invalid_config",
      "Unsupported github-automation config schemaVersion",
      { status: 400, details: { schemaVersion: String(raw.schemaVersion) } },
    );
  }

  const enabled = raw.enabled === true;
  const paused = raw.paused === true;
  let mode: GithubAutomationMode = "off";
  if (raw.mode !== undefined) {
    if (!isGithubAutomationMode(raw.mode)) {
      throw new GithubAutomationError("invalid_config", "Invalid mode", {
        status: 400,
      });
    }
    mode = raw.mode;
  }

  if (!Array.isArray(raw.repositories)) {
    throw new GithubAutomationError(
      "invalid_config",
      "repositories must be an array",
      { status: 400 },
    );
  }

  const repositories = raw.repositories.map((repo, i) =>
    normalizeRepositoryV1(repo, i),
  );
  const seenIds = new Set<number>();
  const seenNames = new Set<string>();
  for (const repo of repositories) {
    if (seenIds.has(repo.repositoryId)) {
      throw new GithubAutomationError(
        "invalid_config",
        "Duplicate repositoryId in repositories",
        { status: 400 },
      );
    }
    seenIds.add(repo.repositoryId);
    const nameKey = repo.fullName.trim().toLowerCase();
    if (seenNames.has(nameKey)) {
      throw new GithubAutomationError(
        "invalid_config",
        "Duplicate fullName in repositories",
        { status: 400 },
      );
    }
    seenNames.add(nameKey);
  }

  const triage = normalizeTriageV1(raw.triage);
  const unattended = normalizeUnattendedV1(raw.unattended);
  const updatedAt =
    typeof options?.updatedAt === "string" && options.updatedAt
      ? options.updatedAt
      : typeof raw.updatedAt === "string" && raw.updatedAt
        ? raw.updatedAt
        : new Date().toISOString();

  const body = {
    schemaVersion: GITHUB_AUTOMATION_CONFIG_SCHEMA_VERSION_V1,
    enabled,
    mode,
    paused,
    repositories,
    triage,
    unattended,
    updatedAt,
  };

  return {
    ...body,
    revision: computeRevision(body),
  };
}

/**
 * Convert a validated v1 repository into a v2 binding only when identity is complete.
 * Incomplete / legacy-seeded entries are dropped rather than written half-bound.
 */
export function migrateRepositoryV1ToV2(
  repo: GithubAutomationRepositoryConfigV1,
): GithubAutomationRepositoryConfig | null {
  if (
    typeof repo.installationId !== "number" ||
    !Number.isInteger(repo.installationId) ||
    repo.installationId <= 0
  ) {
    return null;
  }
  const projectId =
    typeof repo.projectId === "string" ? repo.projectId.trim() : "";
  if (!projectId) return null;
  const projectRoot =
    typeof repo.projectRoot === "string" ? repo.projectRoot : "";
  return {
    repositoryId: repo.repositoryId,
    fullName: repo.fullName,
    installationId: repo.installationId,
    projectId,
    projectRoot,
  };
}

export function createDefaultAnalysisConfig(): GithubAutomationAnalysisConfig {
  return {
    maxConcurrency: GITHUB_AUTOMATION_ANALYSIS_DEFAULT_MAX_CONCURRENCY,
  };
}

/**
 * Pure v1 → v2 migration. Always forces enabled=false.
 * Drops closed-loop fields and incomplete repository bindings.
 */
export function migrateGithubAutomationConfigV1ToV2(
  v1: GithubAutomationConfigV1,
  options?: { updatedAt?: string },
): GithubAutomationConfigV2 {
  const repositories: GithubAutomationRepositoryConfig[] = [];
  for (const repo of v1.repositories) {
    const next = migrateRepositoryV1ToV2(repo);
    if (next) repositories.push(next);
  }

  const maxConcurrency = Math.min(
    Math.max(1, v1.triage?.maxConcurrency ?? GITHUB_AUTOMATION_ANALYSIS_DEFAULT_MAX_CONCURRENCY),
    GITHUB_AUTOMATION_ANALYSIS_MAX_CONCURRENCY_LIMIT,
  );

  const updatedAt =
    typeof options?.updatedAt === "string" && options.updatedAt
      ? options.updatedAt
      : new Date().toISOString();

  const body = {
    schemaVersion: GITHUB_AUTOMATION_CONFIG_SCHEMA_VERSION,
    // Migration always disables automation; operator re-verifies then enables.
    enabled: false,
    paused: v1.paused === true,
    repositories,
    analysis: { maxConcurrency },
    updatedAt,
  };

  return {
    ...body,
    revision: computeRevision(body),
  };
}

export function getGithubAutomationConfigV1RetirementBackupPath(): string {
  return join(
    getGithubAutomationRootDirLocal(),
    GITHUB_AUTOMATION_CONFIG_V1_RETIREMENT_BACKUP_FILE,
  );
}

/** Sidecar path: jobs/<jobId>.retirement.json (never overwrites <jobId>.json). */
export function getGithubAutomationJobRetirementSidecarPath(jobId: string): string {
  return join(
    getGithubAutomationRootDirLocal(),
    "jobs",
    `${jobId}.retirement.json`,
  );
}

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: DIR_MODE });
  try {
    await chmod(path, DIR_MODE);
  } catch {
    // best-effort
  }
}

async function atomicWriteJsonOnce(
  path: string,
  value: unknown,
): Promise<"written" | "exists"> {
  await ensureDir(dirname(path));
  // Exclusive create: idempotent backup / sidecar.
  try {
    const handle = await open(path, "wx", FILE_MODE);
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await chmod(path, FILE_MODE);
    } catch {
      // best-effort
    }
    return "written";
  } catch (err) {
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? String((err as { code?: unknown }).code)
        : undefined;
    if (code === "EEXIST") return "exists";
    throw err;
  }
}

async function atomicWriteJsonOverwrite(
  path: string,
  value: unknown,
): Promise<void> {
  await ensureDir(dirname(path));
  const tmp = join(
    dirname(path),
    `.${Date.now()}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`,
  );
  const handle = await open(tmp, "w", FILE_MODE);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await chmod(tmp, FILE_MODE);
  } catch {
    // best-effort
  }
  await rename(tmp, path);
  try {
    await chmod(path, FILE_MODE);
  } catch {
    // best-effort
  }
}

/**
 * Persist a fixed non-secret v1 retirement backup once.
 * Subsequent calls are no-ops when the backup already exists.
 */
export async function writeGithubAutomationConfigV1RetirementBackup(
  v1: GithubAutomationConfigV1,
): Promise<"written" | "exists"> {
  // Only non-secret fields (config never holds secrets); still strip nothing extra.
  const backup = {
    schemaVersion: v1.schemaVersion,
    enabled: v1.enabled,
    mode: v1.mode,
    paused: v1.paused,
    repositories: v1.repositories.map((repo) => ({
      repositoryId: repo.repositoryId,
      fullName: repo.fullName,
      installationId: repo.installationId,
      projectId: repo.projectId,
      // projectRoot is server-only historical state; keep for operator recovery,
      // never projected by live APIs.
      projectRoot: repo.projectRoot,
      ownerActorIds: [...repo.ownerActorIds],
      assigneeIdentitySource: repo.assigneeIdentitySource,
      baseRef: repo.baseRef,
    })),
    triage: { ...v1.triage },
    unattended: {
      enabled: v1.unattended.enabled,
      executionProfile: v1.unattended.executionProfile,
      riskProfile: v1.unattended.riskProfile,
      maxConcurrency: v1.unattended.maxConcurrency,
      maxFiles: v1.unattended.maxFiles,
      maxChangedLines: v1.unattended.maxChangedLines,
      // Commands are operator-owned non-secret strings already on disk.
      validationCommands: [...v1.unattended.validationCommands],
    },
    revision: v1.revision,
    updatedAt: v1.updatedAt,
    retiredAt: new Date().toISOString(),
    reason: GITHUB_AUTOMATION_LEGACY_PIPELINE_RETIRED_REASON,
  };
  return atomicWriteJsonOnce(
    getGithubAutomationConfigV1RetirementBackupPath(),
    backup,
  );
}

export function isLegacyNonTerminalJobStatus(status: unknown): boolean {
  return (
    status === "queued" ||
    status === "running" ||
    status === "retry_due" ||
    status === "paused"
  );
}

/**
 * Build a retirement sidecar for a legacy job without mutating the original file.
 */
export function buildGithubAutomationJobRetirementRecord(input: {
  jobId: string;
  repositoryId?: number | null;
  issueNumber?: number | null;
  originalStatus?: string | null;
  originalPhase?: string | null;
  originalSchemaVersion?: number | null;
  originalJobSha256Prefix?: string | null;
  retiredAt?: string;
}): GithubAutomationJobRetirementRecord {
  return {
    schemaVersion: 1,
    kind: GITHUB_AUTOMATION_JOB_KIND_LEGACY_PIPELINE,
    reason: GITHUB_AUTOMATION_LEGACY_PIPELINE_RETIRED_REASON,
    jobId: input.jobId,
    repositoryId:
      typeof input.repositoryId === "number" && Number.isInteger(input.repositoryId)
        ? input.repositoryId
        : null,
    issueNumber:
      typeof input.issueNumber === "number" && Number.isInteger(input.issueNumber)
        ? input.issueNumber
        : null,
    originalStatus:
      typeof input.originalStatus === "string" ? input.originalStatus : null,
    originalPhase:
      typeof input.originalPhase === "string" ? input.originalPhase : null,
    originalSchemaVersion:
      typeof input.originalSchemaVersion === "number" &&
      Number.isInteger(input.originalSchemaVersion)
        ? input.originalSchemaVersion
        : null,
    retiredAt: input.retiredAt ?? new Date().toISOString(),
    originalJobSha256Prefix:
      typeof input.originalJobSha256Prefix === "string"
        ? input.originalJobSha256Prefix
        : null,
  };
}

/**
 * Write retirement sidecar if missing. Never rewrites an existing sidecar or job file.
 */
export async function writeGithubAutomationJobRetirementSidecar(
  record: GithubAutomationJobRetirementRecord,
): Promise<"written" | "exists"> {
  return atomicWriteJsonOnce(
    getGithubAutomationJobRetirementSidecarPath(record.jobId),
    record,
  );
}

export async function readGithubAutomationJobRetirementSidecar(
  jobId: string,
): Promise<GithubAutomationJobRetirementRecord | null> {
  const path = getGithubAutomationJobRetirementSidecarPath(jobId);
  try {
    const text = await readFile(path, "utf8");
    const parsed = JSON.parse(text) as unknown;
    if (!isRecord(parsed)) return null;
    if (parsed.reason !== GITHUB_AUTOMATION_LEGACY_PIPELINE_RETIRED_REASON) {
      return null;
    }
    if (typeof parsed.jobId !== "string" || !parsed.jobId) return null;
    return {
      schemaVersion: 1,
      kind: GITHUB_AUTOMATION_JOB_KIND_LEGACY_PIPELINE,
      reason: GITHUB_AUTOMATION_LEGACY_PIPELINE_RETIRED_REASON,
      jobId: parsed.jobId,
      repositoryId:
        typeof parsed.repositoryId === "number" ? parsed.repositoryId : null,
      issueNumber:
        typeof parsed.issueNumber === "number" ? parsed.issueNumber : null,
      originalStatus:
        typeof parsed.originalStatus === "string" ? parsed.originalStatus : null,
      originalPhase:
        typeof parsed.originalPhase === "string" ? parsed.originalPhase : null,
      originalSchemaVersion:
        typeof parsed.originalSchemaVersion === "number"
          ? parsed.originalSchemaVersion
          : null,
      retiredAt:
        typeof parsed.retiredAt === "string"
          ? parsed.retiredAt
          : new Date(0).toISOString(),
      originalJobSha256Prefix:
        typeof parsed.originalJobSha256Prefix === "string"
          ? parsed.originalJobSha256Prefix
          : null,
    };
  } catch (err) {
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? String((err as { code?: unknown }).code)
        : undefined;
    if (code === "ENOENT") return null;
    return null;
  }
}

/**
 * True when a raw job JSON object is a legacy closed-loop record that must not
 * acquire a v2 analysis lease.
 */
export function isLegacyGithubAutomationJobRecord(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  const schemaVersion = raw.schemaVersion;
  if (schemaVersion === 2) {
    // v2 jobs are never "legacy" even if kind is missing (fail closed elsewhere).
    return false;
  }
  // Missing/1/unknown non-2 with closed-loop phases or absent kind ⇒ legacy.
  if (schemaVersion === 1 || schemaVersion === undefined || schemaVersion === null) {
    return true;
  }
  if (raw.kind === GITHUB_AUTOMATION_JOB_KIND_LEGACY_PIPELINE) return true;
  return false;
}

/**
 * True only for schema v2 issue_analysis jobs eligible for the analysis scheduler.
 */
export function isSchedulableGithubIssueAnalysisJob(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  if (raw.schemaVersion !== 2) return false;
  if (raw.kind !== "issue_analysis") return false;
  if (typeof raw.jobId !== "string" || !raw.jobId) return false;
  return true;
}

export function hashOpaqueJsonPrefix(value: unknown): string {
  return createHash("sha256")
    .update(stableStringify(value))
    .digest("hex")
    .slice(0, 16);
}

/**
 * Scan jobs dir and write retirement sidecars for non-terminal legacy jobs.
 * Never rewrites original job files. Idempotent.
 */
export async function retireLegacyGithubAutomationJobs(options?: {
  jobs?: readonly Record<string, unknown>[];
}): Promise<{ scanned: number; retired: number; alreadyRetired: number }> {
  let jobs: Record<string, unknown>[] = [];
  if (options?.jobs) {
    jobs = options.jobs.map((j) => ({ ...j }));
  } else {
    // Lazy import to avoid circular init with store path helpers.
    const store = await import("./github-automation-store");
    const listed = await store.listGithubAutomationJobsRaw();
    jobs = listed;
  }

  let retired = 0;
  let alreadyRetired = 0;
  for (const job of jobs) {
    if (!isLegacyGithubAutomationJobRecord(job)) continue;
    if (!isLegacyNonTerminalJobStatus(job.status)) continue;
    const jobId = typeof job.jobId === "string" ? job.jobId : null;
    if (!jobId) continue;

    const existing = await readGithubAutomationJobRetirementSidecar(jobId);
    if (existing) {
      alreadyRetired += 1;
      continue;
    }

    const record = buildGithubAutomationJobRetirementRecord({
      jobId,
      repositoryId:
        typeof job.repositoryId === "number" ? job.repositoryId : null,
      issueNumber: typeof job.issueNumber === "number" ? job.issueNumber : null,
      originalStatus: typeof job.status === "string" ? job.status : null,
      originalPhase: typeof job.phase === "string" ? job.phase : null,
      originalSchemaVersion:
        typeof job.schemaVersion === "number" ? job.schemaVersion : 1,
      originalJobSha256Prefix: hashOpaqueJsonPrefix(job),
    });
    const result = await writeGithubAutomationJobRetirementSidecar(record);
    if (result === "written") retired += 1;
    else alreadyRetired += 1;
  }

  return { scanned: jobs.length, retired, alreadyRetired };
}

/**
 * Read live config.json text and decide migration. Callers that need the config
 * lock should hold it outside this helper.
 */
export async function migrateGithubAutomationConfigFromRaw(
  rawText: string | null,
  options?: {
    /** When true, write v1 backup + live v2 config.json. */
    persist?: boolean;
    now?: string;
  },
): Promise<GithubAutomationConfigMigrationResult> {
  const persist = options?.persist !== false;
  const now = options?.now ?? new Date().toISOString();

  if (rawText === null) {
    // Missing file — fresh default is created by config reader, not here.
    const { createDefaultGithubAutomationConfig } = await import(
      "./github-automation-config"
    );
    return {
      config: createDefaultGithubAutomationConfig(now),
      source: "missing",
      wroteV1Backup: false,
      wroteLiveConfig: false,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText) as unknown;
  } catch {
    throw new GithubAutomationError(
      "invalid_config",
      "github-automation config is not valid JSON",
      { status: 400 },
    );
  }

  if (!isRecord(parsed)) {
    throw new GithubAutomationError("invalid_config", "Config must be an object", {
      status: 400,
    });
  }

  const schemaVersion = parsed.schemaVersion;
  if (schemaVersion === GITHUB_AUTOMATION_CONFIG_SCHEMA_VERSION) {
    const { normalizeGithubAutomationConfig } = await import(
      "./github-automation-config"
    );
    // Preserve on-disk updatedAt so pure reads do not churn revision.
    return {
      config: normalizeGithubAutomationConfig(parsed),
      source: "v2",
      wroteV1Backup: false,
      wroteLiveConfig: false,
    };
  }

  if (schemaVersion === GITHUB_AUTOMATION_CONFIG_SCHEMA_VERSION_V1) {
    const v1 = parseGithubAutomationConfigV1(parsed);
    const migrated = migrateGithubAutomationConfigV1ToV2(v1, { updatedAt: now });
    // Canonicalize through the live normalizer so revision/body match pure v2 reads.
    const { normalizeGithubAutomationConfig } = await import(
      "./github-automation-config"
    );
    const v2 = normalizeGithubAutomationConfig(migrated, { updatedAt: now });
    let wroteV1Backup = false;
    let wroteLiveConfig = false;
    if (persist) {
      const backupResult = await writeGithubAutomationConfigV1RetirementBackup(v1);
      wroteV1Backup = backupResult === "written";
      await atomicWriteJsonOverwrite(
        join(getGithubAutomationRootDirLocal(), "config.json"),
        v2,
      );
      wroteLiveConfig = true;
      // Best-effort: retire non-terminal v1 jobs when config migrates.
      try {
        await retireLegacyGithubAutomationJobs();
      } catch {
        // Retirement is additive; config migration must still succeed.
      }
    }
    return {
      config: v2,
      source: "v1_migrated",
      wroteV1Backup,
      wroteLiveConfig,
    };
  }

  // Unknown / future schema: fail closed, never overwrite.
  throw new GithubAutomationError(
    "invalid_config",
    "Unsupported github-automation config schemaVersion",
    {
      status: 400,
      details: {
        reason: "unknown_schema_version",
        schemaVersion: String(schemaVersion),
      },
    },
  );
}

/** Test helper: whether retirement backup exists. */
export async function githubAutomationConfigV1RetirementBackupExists(): Promise<boolean> {
  try {
    await stat(getGithubAutomationConfigV1RetirementBackupPath());
    return true;
  } catch {
    return false;
  }
}

