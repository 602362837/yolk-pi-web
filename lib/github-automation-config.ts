/**
 * github-automation-config — non-secret config for GitHub App Issue Analysis.
 *
 * Storage: `~/.pi/agent/github-automation/config.json` (via getAgentDir()).
 *
 * Rules:
 * - Live schema is v2 (enabled/paused/repositories/analysis only).
 * - Schema v1 is read only for migration: backup + force enabled=false + drop
 *   closed-loop fields. Unknown/future schema fails closed without overwrite.
 * - Repositories keyed by immutable repositoryId; fresh default allowlist is [].
 * - v2 repositories require positive installationId + Project Registry projectId.
 * - Never stores App private key, JWT, installation token, webhook secret,
 *   or machine personal tokens.
 * - projectId is the operator-facing Project Registry binding; projectRoot is
 *   resolved server-side only and excluded from safe wire projection.
 * - CAS via opaque revision (sha256 prefix of canonical JSON body).
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
import type {
  GithubAutomationJobRecord,
  GithubAutomationJobStatus,
} from "./github-automation-store";
import {
  GITHUB_AUTOMATION_ANALYSIS_DEFAULT_MAX_CONCURRENCY,
  GITHUB_AUTOMATION_ANALYSIS_MAX_CONCURRENCY_LIMIT,
  GITHUB_AUTOMATION_CONFIG_SCHEMA_VERSION,
  GITHUB_AUTOMATION_LEGACY_SEEDED_REPOSITORY_FULL_NAME,
  GITHUB_AUTOMATION_LEGACY_SEEDED_REPOSITORY_ID,
  type GithubAutomationAnalysisConfig,
  type GithubAutomationConfigV2,
  type GithubAutomationRepositoryConfig,
  type GithubAutomationRepositoryConfigV1,
} from "./github-automation-types";

/** Live config type alias (schema v2). */
export type GithubAutomationConfig = GithubAutomationConfigV2;
import {
  canonicalizeProjectPath,
  getProject,
  listProjects,
  ProjectRegistryError,
} from "./project-registry";
import type { PiWebProjectRecord } from "./project-registry-types";

// ─── Paths / modes ───────────────────────────────────────────────────────────

const AUTOMATION_SUBDIR = "github-automation";
const CONFIG_FILE = "config.json";
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

export function getGithubAutomationRootDir(): string {
  return join(getAgentDir(), AUTOMATION_SUBDIR);
}

export function getGithubAutomationConfigPath(): string {
  return join(getGithubAutomationRootDir(), CONFIG_FILE);
}

// ─── Defaults ────────────────────────────────────────────────────────────────

/**
 * Empty repository template for operators / tests that build a draft entry.
 * Does NOT seed the historical yolk-pi-web allowlist.
 */
export function createEmptyGithubAutomationRepository(input?: {
  repositoryId?: number;
  fullName?: string;
  installationId?: number;
  projectId?: string;
  projectRoot?: string;
}): GithubAutomationRepositoryConfig {
  return {
    repositoryId: input?.repositoryId ?? 0,
    fullName: input?.fullName ?? "",
    installationId: input?.installationId ?? 0,
    projectId: input?.projectId ?? "",
    projectRoot: input?.projectRoot ?? "",
  };
}

/**
 * @deprecated Historical helper that returned the fixed yolk-pi-web seed.
 * Prefer createEmptyGithubAutomationRepository(). Kept as an alias that now
 * returns an empty draft so callers never reintroduce the fixed allowlist.
 */
export function createDefaultGithubAutomationRepository(): GithubAutomationRepositoryConfig {
  return createEmptyGithubAutomationRepository();
}

export function createDefaultAnalysisConfig(): GithubAutomationAnalysisConfig {
  return {
    maxConcurrency: GITHUB_AUTOMATION_ANALYSIS_DEFAULT_MAX_CONCURRENCY,
  };
}

/** @deprecated Schema v1 triage alias; use createDefaultAnalysisConfig(). */
export function createDefaultTriageConfig(): GithubAutomationAnalysisConfig {
  return createDefaultAnalysisConfig();
}

export function createDefaultGithubAutomationConfig(
  now: string = new Date().toISOString(),
): GithubAutomationConfigV2 {
  const body = {
    schemaVersion: GITHUB_AUTOMATION_CONFIG_SCHEMA_VERSION,
    enabled: false,
    paused: false,
    // Fresh installs start with zero allowlisted repositories.
    repositories: [] as GithubAutomationRepositoryConfig[],
    analysis: createDefaultAnalysisConfig(),
    updatedAt: now,
  };
  return {
    ...body,
    revision: computeGithubAutomationConfigRevision(body),
  };
}

/**
 * True when a repository entry matches the historical auto-seeded yolk-pi-web
 * allowlist (immutable id + full_name, no project binding). Used only for
 * migration/compat detection — never re-written as user config.
 */
export function isLegacySeededGithubAutomationRepository(
  repo: Pick<
    GithubAutomationRepositoryConfig | GithubAutomationRepositoryConfigV1,
    "repositoryId" | "fullName" | "projectId" | "projectRoot" | "installationId"
  >,
): boolean {
  const fullName = repo.fullName.trim().toLowerCase();
  const legacyName =
    GITHUB_AUTOMATION_LEGACY_SEEDED_REPOSITORY_FULL_NAME.toLowerCase();
  const projectId =
    typeof repo.projectId === "string" ? repo.projectId.trim() : "";
  const projectRoot =
    typeof repo.projectRoot === "string" ? repo.projectRoot.trim() : "";
  const installationId = repo.installationId;
  return (
    repo.repositoryId === GITHUB_AUTOMATION_LEGACY_SEEDED_REPOSITORY_ID &&
    fullName === legacyName &&
    !projectId &&
    !projectRoot &&
    (installationId === null ||
      installationId === undefined ||
      installationId === 0)
  );
}

// ─── Canonical JSON / revision ───────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Stable JSON stringify with sorted object keys (for revision hashing).
 * Arrays preserve order.
 */
export function stableStringify(value: unknown): string {
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

/** Body used for revision: everything except the revision field itself. */
export type GithubAutomationConfigRevisionBody = Omit<
  GithubAutomationConfigV2,
  "revision"
>;

export function computeGithubAutomationConfigRevision(
  body: GithubAutomationConfigRevisionBody | Record<string, unknown>,
): string {
  const rest: Record<string, unknown> = {
    ...(body as Record<string, unknown>),
  };
  delete rest.revision;
  return createHash("sha256").update(stableStringify(rest)).digest("hex").slice(0, 16);
}

// ─── Validation / normalize ──────────────────────────────────────────────────

function asPositiveInt(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new GithubAutomationError(
      "invalid_config",
      `Invalid ${field}`,
      { status: 400 },
    );
  }
  return value;
}

function asString(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== "string") {
    throw new GithubAutomationError(
      "invalid_config",
      `Invalid ${field}`,
      { status: 400 },
    );
  }
  const trimmed = value.trim();
  if (!allowEmpty && trimmed.length === 0) {
    throw new GithubAutomationError(
      "invalid_config",
      `Invalid ${field}`,
      { status: 400 },
    );
  }
  return trimmed;
}

/** GitHub owner/repo segment: no slashes, whitespace, or control characters. */
const GITHUB_NAME_SEGMENT_RE = /^[A-Za-z0-9_.-]+$/;

/**
 * Parse and validate a GitHub repository full_name (`owner/repo`).
 * Accepts any valid owner/repo shape — not restricted to yolk-pi-web.
 */
export function parseGithubRepositoryFullName(fullName: string): {
  owner: string;
  repo: string;
  fullName: string;
} {
  const trimmed = typeof fullName === "string" ? fullName.trim() : "";
  const parts = trimmed.split("/");
  if (parts.length !== 2) {
    throw new GithubAutomationError(
      "invalid_config",
      "Invalid repository fullName",
      { status: 400, details: { reason: "malformed_full_name" } },
    );
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
    throw new GithubAutomationError(
      "invalid_config",
      "Invalid repository fullName",
      { status: 400, details: { reason: "malformed_full_name" } },
    );
  }
  return { owner, repo, fullName: `${owner}/${repo}` };
}

function normalizeProjectIdField(
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
  // Project Registry ids are opaque `prj_<hex>` tokens — reject path-like values.
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

function normalizeRepository(
  raw: unknown,
  index: number,
): GithubAutomationRepositoryConfig {
  if (!isRecord(raw)) {
    throw new GithubAutomationError(
      "invalid_config",
      `Invalid repositories[${index}]`,
      { status: 400 },
    );
  }

  // Reject closed-loop fields on live schema v2.
  for (const banned of [
    "baseRef",
    "ownerActorIds",
    "assigneeIdentitySource",
    "mode",
    "unattended",
    "triage",
  ] as const) {
    if (raw[banned] !== undefined) {
      throw new GithubAutomationError(
        "invalid_config",
        `repositories[${index}] contains retired field ${banned}`,
        { status: 400, details: { field: banned, index } },
      );
    }
  }

  const repositoryId = asPositiveInt(
    raw.repositoryId,
    `repositories[${index}].repositoryId`,
  );
  const fullNameRaw = asString(raw.fullName, `repositories[${index}].fullName`);
  const parsedName = parseGithubRepositoryFullName(fullNameRaw);

  const installationId = asPositiveInt(
    raw.installationId,
    `repositories[${index}].installationId`,
  );

  // Disk may still carry projectRoot (server-only). Browser wire never supplies it;
  // higher-level bind helpers recompute root from projectId.
  const projectRoot =
    typeof raw.projectRoot === "string" ? raw.projectRoot : "";
  const projectId = normalizeProjectIdField(raw.projectId, index);
  if (!projectId) {
    throw new GithubAutomationError(
      "invalid_config",
      `repositories[${index}].projectId is required`,
      { status: 400, details: { reason: "project_id_required", index } },
    );
  }

  return {
    repositoryId,
    fullName: parsedName.fullName,
    installationId,
    projectId,
    projectRoot,
  };
}

function normalizeAnalysis(raw: unknown): GithubAutomationAnalysisConfig {
  if (raw === undefined || raw === null) return createDefaultAnalysisConfig();
  if (!isRecord(raw)) {
    throw new GithubAutomationError("invalid_config", "Invalid analysis", {
      status: 400,
    });
  }
  const maxConcurrency =
    raw.maxConcurrency === undefined
      ? GITHUB_AUTOMATION_ANALYSIS_DEFAULT_MAX_CONCURRENCY
      : asPositiveInt(raw.maxConcurrency, "analysis.maxConcurrency");
  return {
    maxConcurrency: Math.min(
      maxConcurrency,
      GITHUB_AUTOMATION_ANALYSIS_MAX_CONCURRENCY_LIMIT,
    ),
  };
}

/**
 * Parse and normalize unknown JSON into live GithubAutomationConfigV2.
 * Recomputes revision from body (disk revision is ignored if present).
 * Does NOT migrate schema v1 — use readGithubAutomationConfig / migration helpers.
 */
export function normalizeGithubAutomationConfig(
  raw: unknown,
  options?: { updatedAt?: string },
): GithubAutomationConfigV2 {
  if (!isRecord(raw)) {
    throw new GithubAutomationError("invalid_config", "Config must be an object", {
      status: 400,
    });
  }

  const schemaVersion = raw.schemaVersion;
  if (schemaVersion !== GITHUB_AUTOMATION_CONFIG_SCHEMA_VERSION) {
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

  // Reject closed-loop top-level fields on live v2 writes/normalize.
  for (const banned of [
    "mode",
    "unattended",
    "triage",
    "executionProfile",
    "riskProfile",
  ] as const) {
    if (raw[banned] !== undefined) {
      throw new GithubAutomationError(
        "invalid_config",
        `Config contains retired field ${banned}`,
        { status: 400, details: { field: banned } },
      );
    }
  }

  const enabled = raw.enabled === true;
  const paused = raw.paused === true;

  if (!Array.isArray(raw.repositories)) {
    throw new GithubAutomationError(
      "invalid_config",
      "repositories must be an array",
      { status: 400 },
    );
  }

  // Empty allowlist is valid (fresh install / operator cleared all repos).
  const repositories = raw.repositories.map((repo, i) =>
    normalizeRepository(repo, i),
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

  const analysis = normalizeAnalysis(raw.analysis);

  const updatedAt =
    typeof options?.updatedAt === "string" && options.updatedAt
      ? options.updatedAt
      : typeof raw.updatedAt === "string" && raw.updatedAt
        ? raw.updatedAt
        : new Date().toISOString();

  const body: GithubAutomationConfigRevisionBody = {
    schemaVersion: GITHUB_AUTOMATION_CONFIG_SCHEMA_VERSION,
    enabled,
    paused,
    repositories,
    analysis,
    updatedAt,
  };

  return {
    ...body,
    revision: computeGithubAutomationConfigRevision(body),
  };
}

// ─── Project Registry binding (server-only root resolution) ──────────────────

export type GithubAutomationProjectBindingStatus =
  | "bound"
  | "unbound"
  | "missing"
  | "archived"
  | "path_missing";

export interface GithubAutomationProjectChoiceSafeProjection {
  projectId: string;
  displayName: string;
  /** pathKey status only — never the absolute path. */
  pathStatus: "ok" | "missing" | "archived";
  archived: boolean;
  missing: boolean;
}

export interface GithubAutomationResolvedProjectBinding {
  projectId: string;
  /** Canonical absolute root for server-side git/worktree use only. */
  projectRoot: string;
  pathKey: string;
  displayName: string | null;
  status: GithubAutomationProjectBindingStatus;
}

function projectDisplayName(project: PiWebProjectRecord): string {
  if (typeof project.displayName === "string" && project.displayName.trim()) {
    return project.displayName.trim();
  }
  const root = project.rootPath || project.realRootPath || project.pathKey || project.id;
  const parts = root.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || project.id;
}

function mainSpaceMissing(project: PiWebProjectRecord): boolean {
  const main = project.spaces?.main;
  if (main && main.missing === true) return true;
  return false;
}

/**
 * Resolve a Project Registry id to a canonical server-only projectRoot.
 * Fail-closed for unknown / archived / path-missing projects.
 */
export async function resolveGithubAutomationProjectBinding(
  projectId: string,
): Promise<GithubAutomationResolvedProjectBinding> {
  const id = typeof projectId === "string" ? projectId.trim() : "";
  if (!id) {
    throw new GithubAutomationError(
      "invalid_config",
      "projectId is required",
      { status: 400 },
    );
  }

  let project: PiWebProjectRecord;
  try {
    project = await getProject(id);
  } catch (err) {
    if (err instanceof ProjectRegistryError) {
      throw new GithubAutomationError(
        "invalid_config",
        "Unknown Project Registry projectId",
        { status: 400, details: { projectId: id, status: "missing" } },
      );
    }
    throw err;
  }

  if (project.archived) {
    throw new GithubAutomationError(
      "invalid_config",
      "Project Registry project is archived",
      { status: 400, details: { projectId: id, status: "archived" } },
    );
  }

  const rootCandidate =
    (typeof project.realRootPath === "string" && project.realRootPath.trim()
      ? project.realRootPath.trim()
      : "") ||
    (typeof project.rootPath === "string" && project.rootPath.trim()
      ? project.rootPath.trim()
      : "") ||
    (typeof project.pathKey === "string" && project.pathKey.trim()
      ? project.pathKey.trim()
      : "");

  if (!rootCandidate) {
    throw new GithubAutomationError(
      "invalid_config",
      "Project Registry project has no root path",
      { status: 400, details: { projectId: id, status: "path_missing" } },
    );
  }

  const pathInfo = await canonicalizeProjectPath(rootCandidate);
  if (pathInfo.missing || !pathInfo.realPath || mainSpaceMissing(project)) {
    throw new GithubAutomationError(
      "invalid_config",
      "Project Registry project root is missing on this host",
      { status: 400, details: { projectId: id, status: "path_missing" } },
    );
  }

  return {
    projectId: project.id,
    projectRoot: pathInfo.realPath,
    pathKey: pathInfo.pathKey,
    displayName: project.displayName ?? null,
    status: "bound",
  };
}

/**
 * Apply server-side projectId → projectRoot binding on a repository draft.
 * Does not trust client-supplied projectRoot; ignores / overwrites it.
 */
export async function bindGithubAutomationRepositoryProject(
  repo: GithubAutomationRepositoryConfig,
  options?: { requireProjectId?: boolean },
): Promise<GithubAutomationRepositoryConfig> {
  const projectId =
    typeof repo.projectId === "string" && repo.projectId.trim()
      ? repo.projectId.trim()
      : "";

  if (!projectId) {
    // Schema v2 always requires projectId for durable repositories.
    if (options?.requireProjectId !== false) {
      throw new GithubAutomationError(
        "invalid_config",
        "projectId is required",
        { status: 400, details: { repositoryId: repo.repositoryId } },
      );
    }
    throw new GithubAutomationError(
      "invalid_config",
      "projectId is required",
      { status: 400, details: { repositoryId: repo.repositoryId } },
    );
  }

  const binding = await resolveGithubAutomationProjectBinding(projectId);
  return {
    repositoryId: repo.repositoryId,
    fullName: repo.fullName,
    installationId: repo.installationId,
    projectId: binding.projectId,
    projectRoot: binding.projectRoot,
  };
}

// ─── Wire repository drafts + GitHub identity cross-check ────────────────────

/** Browser/API repository draft — never includes projectRoot or secrets. */
export interface GithubAutomationRepositoryWireDraft {
  repositoryId: number;
  fullName: string;
  installationId: number;
  projectId: string;
}

/**
 * Parse one repository draft from the wire (browser PATCH body).
 * Rejects projectRoot / absolute path injection and secret-like fields.
 * Does NOT perform GitHub network lookup or Project Registry binding.
 */
export function parseGithubAutomationRepositoryWireDraft(
  raw: unknown,
  index: number,
): GithubAutomationRepositoryWireDraft {
  if (!isRecord(raw)) {
    throw new GithubAutomationError(
      "invalid_config",
      `Invalid repositories[${index}]`,
      { status: 400 },
    );
  }

  for (const key of Object.keys(raw)) {
    const lower = key.toLowerCase();
    if (
      lower === "projectroot" ||
      lower === "worktreepath" ||
      lower === "absolutepath" ||
      lower === "realpath" ||
      lower === "path" ||
      lower === "rootpath" ||
      lower === "baseref" ||
      lower === "owneractorids" ||
      lower.includes("token") ||
      lower.includes("secret") ||
      lower.includes("password") ||
      lower.includes("private") ||
      lower.includes("credential") ||
      lower === "assigneeidentitysource" ||
      lower === "validationcommands" ||
      lower === "mode" ||
      lower === "unattended" ||
      lower === "triage"
    ) {
      throw new GithubAutomationError(
        "invalid_config",
        "Repository draft contains disallowed field",
        { status: 400, details: { field: key, index } },
      );
    }
  }

  // Reject absolute path masquerading as projectId before normalizeProjectIdField.
  if (typeof raw.projectId === "string") {
    const pid = raw.projectId.trim();
    if (
      pid.startsWith("/") ||
      pid.startsWith("~") ||
      /^[A-Za-z]:[\\/]/.test(pid) ||
      pid.includes("\\") ||
      pid.includes("/")
    ) {
      throw new GithubAutomationError(
        "invalid_config",
        "Client cannot set projectRoot absolute path",
        {
          status: 400,
          details: { reason: "absolute_path_rejected", index },
        },
      );
    }
  }

  // Force projectRoot empty on the wire path — client absolute roots are never trusted.
  const normalized = normalizeRepository(
    {
      ...raw,
      projectRoot: "",
    },
    index,
  );

  return {
    repositoryId: normalized.repositoryId,
    fullName: normalized.fullName,
    installationId: normalized.installationId,
    projectId: normalized.projectId,
  };
}

export function parseGithubAutomationRepositoryWireDraftList(
  raw: unknown,
): GithubAutomationRepositoryWireDraft[] {
  if (!Array.isArray(raw)) {
    throw new GithubAutomationError(
      "invalid_config",
      "repositories must be an array",
      { status: 400 },
    );
  }
  if (raw.length > 64) {
    throw new GithubAutomationError(
      "invalid_config",
      "Too many repositories",
      { status: 400, details: { reason: "repositories_limit" } },
    );
  }

  const drafts = raw.map((item, index) =>
    parseGithubAutomationRepositoryWireDraft(item, index),
  );

  const seenIds = new Set<number>();
  const seenNames = new Set<string>();
  for (const draft of drafts) {
    if (seenIds.has(draft.repositoryId)) {
      throw new GithubAutomationError(
        "invalid_config",
        "Duplicate repositoryId in repositories",
        {
          status: 400,
          details: { reason: "duplicate_repository_id", repositoryId: draft.repositoryId },
        },
      );
    }
    seenIds.add(draft.repositoryId);
    const nameKey = draft.fullName.trim().toLowerCase();
    if (seenNames.has(nameKey)) {
      throw new GithubAutomationError(
        "invalid_config",
        "Duplicate fullName in repositories",
        {
          status: 400,
          details: { reason: "duplicate_full_name", fullName: draft.fullName },
        },
      );
    }
    seenNames.add(nameKey);
  }

  return drafts;
}

/**
 * Cross-check repositoryId + fullName against GitHub via installation token.
 * Client values are untrusted until this confirms them.
 */
export async function verifyGithubAutomationRepositoryIdentity(
  draft: GithubAutomationRepositoryWireDraft,
  options?: { signal?: AbortSignal; skipNetworkLookup?: boolean },
): Promise<GithubAutomationRepositoryWireDraft> {
  if (options?.skipNetworkLookup) {
    return draft;
  }

  if (
    typeof draft.installationId !== "number" ||
    !Number.isInteger(draft.installationId) ||
    draft.installationId <= 0
  ) {
    throw new GithubAutomationError(
      "installation_missing",
      "installationId is required to verify repository identity",
      {
        status: 400,
        details: {
          reason: "installation_required_for_lookup",
          repositoryId: draft.repositoryId,
        },
      },
    );
  }

  const { owner, repo } = parseGithubRepositoryFullName(draft.fullName);
  // Dynamic import avoids a static cycle with store/runtime consumers of config paths.
  const { lookupGithubRepositoryIdentity } = await import("./github-app-client");
  const identity = await lookupGithubRepositoryIdentity({
    installationId: draft.installationId,
    owner,
    repo,
    signal: options?.signal,
  });

  if (identity.repositoryId !== draft.repositoryId) {
    throw new GithubAutomationError(
      "invalid_config",
      "repositoryId does not match GitHub repository identity",
      {
        status: 400,
        details: {
          reason: "repository_id_mismatch",
          repositoryId: draft.repositoryId,
          githubRepositoryId: identity.repositoryId,
        },
      },
    );
  }

  // Prefer GitHub's canonical full_name (handles renames / case).
  const canonicalFullName = identity.fullName || draft.fullName;
  if (canonicalFullName.toLowerCase() !== draft.fullName.toLowerCase()) {
    throw new GithubAutomationError(
      "invalid_config",
      "fullName does not match GitHub repository identity",
      {
        status: 400,
        details: {
          reason: "full_name_mismatch",
          fullName: draft.fullName,
        },
      },
    );
  }

  return {
    ...draft,
    fullName: canonicalFullName,
    repositoryId: identity.repositoryId,
  };
}

// ─── Active-job delete / edit gates ──────────────────────────────────────────

/** Job statuses that block repository removal from the allowlist. */
const REPOSITORY_DELETE_BLOCKING_STATUSES = new Set<GithubAutomationJobStatus>([
  "queued",
  "running",
  "retry_due",
  "paused",
]);

export function isGithubAutomationJobBlockingRepositoryDelete(
  job: Pick<GithubAutomationJobRecord, "status" | "phase">,
): boolean {
  if (REPOSITORY_DELETE_BLOCKING_STATUSES.has(job.status)) return true;
  // Analysis phases + any residual closed-loop phase names still block delete.
  if (
    job.phase === "analyzing" ||
    job.phase === "result_ready" ||
    job.phase === "commenting" ||
    job.phase === "closing" ||
    job.phase === "received" ||
    job.phase === "implementing" ||
    job.phase === "checking" ||
    job.phase === "publishing" ||
    job.phase === "planning" ||
    job.phase === "policy_check" ||
    job.phase === "final_policy" ||
    job.phase === "triaging" ||
    job.phase === "claim_readiness" ||
    job.phase === "implementation_queued"
  ) {
    return true;
  }
  return false;
}

export interface GithubAutomationRepositoryDeleteBlock {
  repositoryId: number;
  fullName: string;
  jobId: string;
  jobStatus: GithubAutomationJobStatus;
  reasonCode: "active_job";
}

/**
 * Find active jobs that block removing a repository from the allowlist.
 * Pure helper — does not enqueue work.
 */
export function findGithubAutomationRepositoryDeleteBlocks(
  repositoryIds: readonly number[],
  jobs: readonly GithubAutomationJobRecord[],
  fullNameById?: ReadonlyMap<number, string>,
): GithubAutomationRepositoryDeleteBlock[] {
  const targets = new Set(repositoryIds);
  const blocks: GithubAutomationRepositoryDeleteBlock[] = [];
  const seenRepos = new Set<number>();
  for (const job of jobs) {
    if (!targets.has(job.repositoryId)) continue;
    if (!isGithubAutomationJobBlockingRepositoryDelete(job)) continue;
    if (seenRepos.has(job.repositoryId)) continue;
    seenRepos.add(job.repositoryId);
    blocks.push({
      repositoryId: job.repositoryId,
      fullName:
        fullNameById?.get(job.repositoryId) ??
        job.repositoryFullName ??
        `repo-${job.repositoryId}`,
      jobId: job.jobId,
      jobStatus: job.status,
      reasonCode: "active_job",
    });
  }
  return blocks;
}

/**
 * Assert removed repositories have no active jobs. Throws invalid_config when blocked.
 * Does not enqueue jobs or wake the scheduler.
 */
export async function assertGithubAutomationRepositoriesDeletable(
  current: GithubAutomationConfigV2,
  nextRepositoryIds: readonly number[],
  options?: { jobs?: readonly GithubAutomationJobRecord[] },
): Promise<void> {
  const nextIds = new Set(nextRepositoryIds);
  const removed = current.repositories.filter(
    (repo) => !nextIds.has(repo.repositoryId),
  );
  if (removed.length === 0) return;

 // Dynamic import: github-automation-store imports getGithubAutomationRootDir from this module.
  const jobs =
    options?.jobs ??
    (await (await import("./github-automation-store")).listGithubAutomationJobs());
  const fullNameById = new Map(
    current.repositories.map((repo) => [repo.repositoryId, repo.fullName] as const),
  );
  const blocks = findGithubAutomationRepositoryDeleteBlocks(
    removed.map((repo) => repo.repositoryId),
    jobs,
    fullNameById,
  );
  if (blocks.length === 0) return;

  const first = blocks[0]!;
  throw new GithubAutomationError(
    "invalid_config",
    "Cannot remove repository while jobs are active",
    {
      status: 409,
      details: {
        reason: "active_job",
        repositoryId: first.repositoryId,
        fullName: first.fullName,
        jobId: first.jobId,
        jobStatus: first.jobStatus,
      },
    },
  );
}

/**
 * Resolve wire repository drafts into durable server config entries:
 * 1. GitHub identity cross-check (unless skipped for tests)
 * 2. Project Registry projectId → canonical projectRoot
 * 3. Preserve existing projectRoot only when projectId is unbound (legacy)
 */
export async function resolveGithubAutomationRepositoryWireDrafts(
  drafts: readonly GithubAutomationRepositoryWireDraft[],
  current: GithubAutomationConfigV2,
  options?: {
    signal?: AbortSignal;
    /** Tests only: skip fixed-host GitHub lookup. */
    skipNetworkLookup?: boolean;
    /** When true (default for operator PATCH), projectId is required. */
    requireProjectId?: boolean;
  },
): Promise<GithubAutomationRepositoryConfig[]> {
  const requireProjectId = options?.requireProjectId !== false;
  const currentById = new Map(
    current.repositories.map((repo) => [repo.repositoryId, repo] as const),
  );
  const resolved: GithubAutomationRepositoryConfig[] = [];

  for (const draft of drafts) {
    const verified = await verifyGithubAutomationRepositoryIdentity(draft, {
      signal: options?.signal,
      skipNetworkLookup: options?.skipNetworkLookup,
    });

    const previous = currentById.get(verified.repositoryId);
    const bound = await bindGithubAutomationRepositoryProject(
      {
        repositoryId: verified.repositoryId,
        fullName: verified.fullName,
        installationId: verified.installationId,
        projectId: verified.projectId,
        // Never take projectRoot from the wire draft.
        projectRoot: previous?.projectRoot ?? "",
      },
      { requireProjectId },
    );
    resolved.push(bound);
  }

  return resolved;
}

/**
 * Safe Project Registry choices for Settings selectors.
 * Never includes absolute path / realRootPath / pathKey path values.
 */
export async function listGithubAutomationProjectChoices(): Promise<
  GithubAutomationProjectChoiceSafeProjection[]
> {
  const projects = await listProjects();
  return projects.map((project) => {
    const archived = project.archived === true;
    const missing = mainSpaceMissing(project);
    const pathStatus: GithubAutomationProjectChoiceSafeProjection["pathStatus"] =
      archived ? "archived" : missing ? "missing" : "ok";
    return {
      projectId: project.id,
      displayName: projectDisplayName(project),
      pathStatus,
      archived,
      missing,
    };
  });
}

// ─── Safe wire projection (no projectRoot / secrets) ─────────────────────────

export interface GithubAutomationRepositorySafeProjection {
  repositoryId: number;
  fullName: string;
  /** Installation id (required positive integer on v2). */
  installationId: number;
  hasInstallationId: boolean;
  /** Project Registry id when bound; never an absolute path. */
  projectId: string;
  /** Whether a non-empty projectRoot is configured (not the path itself). */
  projectRootConfigured: boolean;
  /**
   * True when this entry matches the historical auto-seeded yolk-pi-web allowlist.
   * UI must not present it as operator-configured product setup.
   */
  legacySeeded: boolean;
}

export interface GithubAutomationConfigSafeProjection {
  schemaVersion: typeof GITHUB_AUTOMATION_CONFIG_SCHEMA_VERSION;
  enabled: boolean;
  paused: boolean;
  revision: string;
  updatedAt: string;
  repositories: GithubAutomationRepositorySafeProjection[];
  analysis: GithubAutomationAnalysisConfig;
}

export function toGithubAutomationRepositorySafeProjection(
  repo: GithubAutomationRepositoryConfig,
): GithubAutomationRepositorySafeProjection {
  const projectId =
    typeof repo.projectId === "string" && repo.projectId.trim()
      ? repo.projectId.trim()
      : "";
  const projectRootConfigured =
    typeof repo.projectRoot === "string" && repo.projectRoot.trim().length > 0;
  return {
    repositoryId: repo.repositoryId,
    fullName: repo.fullName,
    installationId: repo.installationId,
    hasInstallationId:
      typeof repo.installationId === "number" && repo.installationId > 0,
    projectId,
    projectRootConfigured: projectRootConfigured || projectId.length > 0,
    legacySeeded: isLegacySeededGithubAutomationRepository(repo),
  };
}

export function toGithubAutomationConfigSafeProjection(
  config: GithubAutomationConfigV2,
): GithubAutomationConfigSafeProjection {
  return {
    schemaVersion: config.schemaVersion,
    enabled: config.enabled,
    paused: config.paused,
    revision: config.revision,
    updatedAt: config.updatedAt,
    repositories: config.repositories.map((repo) =>
      toGithubAutomationRepositorySafeProjection(repo),
    ),
    analysis: { ...config.analysis },
  };
}

// ─── Lookups ─────────────────────────────────────────────────────────────────

export function findRepositoryConfigById(
  config: GithubAutomationConfigV2,
  repositoryId: number,
): GithubAutomationRepositoryConfig | null {
  return (
    config.repositories.find((repo) => repo.repositoryId === repositoryId) ??
    null
  );
}

export function isRepositoryAllowlisted(
  config: GithubAutomationConfigV2,
  repositoryId: number,
): boolean {
  return findRepositoryConfigById(config, repositoryId) !== null;
}

// ─── Disk I/O ────────────────────────────────────────────────────────────────

async function ensureAutomationDir(): Promise<void> {
  const dir = getGithubAutomationRootDir();
  await mkdir(dir, { recursive: true, mode: DIR_MODE });
  try {
    await chmod(dir, DIR_MODE);
  } catch {
    // Best-effort on platforms without chmod semantics.
  }
}

async function atomicWriteFile(path: string, contents: string): Promise<void> {
  await ensureAutomationDir();
  const dir = dirname(path);
  const tmpPath = join(
    dir,
    `.${CONFIG_FILE}.${process.pid}.${Date.now()}.tmp`,
  );
  const handle = await open(tmpPath, "w", FILE_MODE);
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await chmod(tmpPath, FILE_MODE);
  } catch {
    // Best-effort.
  }
  await rename(tmpPath, path);
  try {
    await chmod(path, FILE_MODE);
  } catch {
    // Best-effort.
  }
}

/**
 * Read config from disk. Missing file returns defaults (not an error).
 * Schema v1 is migrated under-process (backup + force enabled=false).
 * Unknown/future schema fails closed without overwrite.
 * Corrupt JSON throws GithubAutomationError(invalid_config).
 */
export async function readGithubAutomationConfig(): Promise<GithubAutomationConfigV2> {
  const path = getGithubAutomationConfigPath();
  let rawText: string | null = null;
  try {
    rawText = await readFile(path, "utf8");
  } catch (err: unknown) {
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? String((err as { code?: unknown }).code)
        : undefined;
    if (code === "ENOENT") {
      return createDefaultGithubAutomationConfig();
    }
    throw new GithubAutomationError(
      "invalid_config",
      "Failed to read github-automation config",
      { status: 500 },
    );
  }

  // Dynamic import avoids a static cycle with migration ↔ store retirement.
  const { migrateGithubAutomationConfigFromRaw } = await import(
    "./github-automation-migration"
  );
  const migrated = await migrateGithubAutomationConfigFromRaw(rawText, {
    persist: true,
  });
  return migrated.config;
}

/**
 * Write a fully normalized config. Recomputes revision and updatedAt.
 * Does not perform CAS — use patchGithubAutomationConfig for revision checks.
 */
export async function writeGithubAutomationConfig(
  config: GithubAutomationConfigV2 | GithubAutomationConfigRevisionBody,
): Promise<GithubAutomationConfigV2> {
  const normalized = normalizeGithubAutomationConfig(
    {
      ...config,
      // Force recompute path through normalize.
    },
    { updatedAt: new Date().toISOString() },
  );
  const serialized = `${JSON.stringify(normalized, null, 2)}\n`;
  await atomicWriteFile(getGithubAutomationConfigPath(), serialized);
  return normalized;
}

export interface GithubAutomationConfigPatch {
  revision: string;
  enabled?: boolean;
  paused?: boolean;
  /**
   * Full repository list replacement when provided.
   * Callers that accept browser drafts MUST resolve them through
   * resolveGithubAutomationRepositoryWireDrafts first (server-side roots only).
   */
  repositories?: GithubAutomationRepositoryConfig[];
  analysis?: Partial<GithubAutomationAnalysisConfig>;
  /**
   * When true (default), refuse to drop repositories that still have active jobs.
   * Pure config write — never enqueues jobs.
   */
  enforceDeleteGate?: boolean;
  /** Injected job list for tests; otherwise loaded from durable store. */
  jobsForDeleteGate?: readonly GithubAutomationJobRecord[];
}

/**
 * CAS patch: requires matching revision; returns updated config.
 * Never enqueues jobs or wakes the scheduler.
 */
export async function patchGithubAutomationConfig(
  patch: GithubAutomationConfigPatch,
): Promise<GithubAutomationConfigV2> {
  const current = await readGithubAutomationConfig();
  if (patch.revision !== current.revision) {
    throw new GithubAutomationError(
      "stale_revision",
      "Configuration revision conflict",
      {
        status: 409,
        details: {
          reason: "revision_conflict",
          serverRevision: current.revision,
        },
      },
    );
  }

  // Reject any attempt to reintroduce closed-loop fields via untyped casts.
  const patchRecord = patch as unknown as Record<string, unknown>;
  for (const banned of ["mode", "unattended", "triage"] as const) {
    if (patchRecord[banned] !== undefined) {
      throw new GithubAutomationError(
        "invalid_config",
        `Config patch contains retired field ${banned}`,
        { status: 400, details: { field: banned } },
      );
    }
  }

  const nextRepositories = patch.repositories ?? current.repositories;

  if (patch.repositories !== undefined && patch.enforceDeleteGate !== false) {
    await assertGithubAutomationRepositoriesDeletable(
      current,
      nextRepositories.map((repo) => repo.repositoryId),
      { jobs: patch.jobsForDeleteGate },
    );
  }

  const nextRaw: Record<string, unknown> = {
    schemaVersion: GITHUB_AUTOMATION_CONFIG_SCHEMA_VERSION,
    enabled: patch.enabled ?? current.enabled,
    paused: patch.paused ?? current.paused,
    repositories: nextRepositories,
    analysis: {
      ...current.analysis,
      ...(patch.analysis ?? {}),
    },
  };

  const normalized = normalizeGithubAutomationConfig(nextRaw, {
    updatedAt: new Date().toISOString(),
  });
  const serialized = `${JSON.stringify(normalized, null, 2)}\n`;
  await atomicWriteFile(getGithubAutomationConfigPath(), serialized);
  return normalized;
}

/** Test helper: whether config path exists. */
export async function githubAutomationConfigExists(): Promise<boolean> {
  try {
    await stat(getGithubAutomationConfigPath());
    return true;
  } catch {
    return false;
  }
}
