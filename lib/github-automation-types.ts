/**
 * github-automation-types — shared contracts for the GitHub App automation domain (GHA-01+).
 *
 * ## Isolation
 *
 * This domain is separate from:
 * - Links / GitHub OAuth Device Flow (`lib/links-*`, `lib/github-link-oauth.ts`)
 * - CredentialStore / ModelRuntime / oauth-accounts / auth-api-key-accounts
 * - Interactive YPI Studio approval grants
 *
 * ## Security boundary
 *
 * Wire / config / store projections MUST NOT contain:
 * - App private key material, App JWT, installation tokens, webhook secrets
 * - machine personal tokens / git credential passwords
 * - raw webhook bodies, signatures, Issue/comment bodies, prompts, transcripts
 * - absolute local projectRoot / worktree / session paths (server-only in config)
 *
 * Safe assignee projection may include login, actor id, identity source, checkedAt,
 * and readiness codes only.
 */

// ─── Schema / modes ──────────────────────────────────────────────────────────

export const GITHUB_AUTOMATION_CONFIG_SCHEMA_VERSION = 1 as const;

export type GithubAutomationConfigSchemaVersion =
  typeof GITHUB_AUTOMATION_CONFIG_SCHEMA_VERSION;

/** Runtime kill-switch modes. */
export type GithubAutomationMode = "off" | "triage" | "unattended";

export type GithubAutomationExecutionProfile = "full-agent";

export type GithubAutomationRiskProfile = "docs-and-small-bugfix";

/** How the machine assignee login was discovered. */
export type GithubMachineAssigneeIdentitySource = "gh" | "git-credential";

// ─── Legacy seeded allowlist (compat only; never re-seed as user config) ────

/**
 * Historical auto-seeded repository.id from early GHA builds.
 * Kept only so readers can recognize old on-disk defaults.
 * Fresh installs MUST start with repositories: [] and MUST NOT re-write this entry.
 */
export const GITHUB_AUTOMATION_LEGACY_SEEDED_REPOSITORY_ID = 602362837;

/** Historical auto-seeded display full_name (compat recognition only). */
export const GITHUB_AUTOMATION_LEGACY_SEEDED_REPOSITORY_FULL_NAME =
  "602362837/yolk-pi-web";

/**
 * @deprecated Use GITHUB_AUTOMATION_LEGACY_SEEDED_REPOSITORY_ID. Not a product default.
 */
export const GITHUB_AUTOMATION_DEFAULT_REPOSITORY_ID =
  GITHUB_AUTOMATION_LEGACY_SEEDED_REPOSITORY_ID;

/**
 * @deprecated Use GITHUB_AUTOMATION_LEGACY_SEEDED_REPOSITORY_FULL_NAME. Not a product default.
 */
export const GITHUB_AUTOMATION_DEFAULT_REPOSITORY_FULL_NAME =
  GITHUB_AUTOMATION_LEGACY_SEEDED_REPOSITORY_FULL_NAME;

// ─── Permission capability (P0 vs P1 reported separately) ────────────────────

/** GitHub App permission names we care about (safe projection). */
export type GithubAppPermissionName =
  | "metadata"
  | "issues"
  | "pull_requests"
  | "contents";

export type GithubAppPermissionLevel = "none" | "read" | "write";

export interface GithubAppPermissionSnapshot {
  metadata: GithubAppPermissionLevel;
  issues: GithubAppPermissionLevel;
  pull_requests: GithubAppPermissionLevel;
  contents: GithubAppPermissionLevel;
}

/**
 * Capability flags derived from installation permissions.
 * P0 and P1 are reported separately so Settings can disable unattended without
 * pretending triage is ready when only Issues is missing, etc.
 */
export interface GithubAppCapabilitySnapshot {
  /** Metadata read + Issues read/write. */
  p0Triage: boolean;
  /** P0 + Pull requests read/write + Contents read/write. */
  p1Unattended: boolean;
  permissions: GithubAppPermissionSnapshot;
  missingForP0: GithubAppPermissionName[];
  missingForP1: GithubAppPermissionName[];
}

// ─── Machine assignee readiness ──────────────────────────────────────────────

export type GithubMachineAssigneeReadinessCode =
  | "ready"
  | "gh_unavailable"
  | "gh_not_logged_in"
  | "gh_no_active_account"
  | "gh_host_unsupported"
  | "git_credential_unavailable"
  | "git_credential_empty"
  | "git_credential_host_unsupported"
  | "credential_invalid"
  | "credential_timeout"
  | "user_lookup_failed"
  | "unassignable"
  | "readback_failed"
  | "unknown";

/**
 * Safe projection of the machine assignee identity.
 * Never includes tokens, password, Authorization headers, or raw credential fill output.
 */
export interface GithubMachineAssigneeSafeProjection {
  login: string | null;
  actorId: number | null;
  identitySource: GithubMachineAssigneeIdentitySource | null;
  checkedAt: string;
  readiness: GithubMachineAssigneeReadinessCode;
  assignable: boolean | null;
  reasonCode: GithubMachineAssigneeReadinessCode | null;
}

export interface GithubMachineAssigneeResolvedIdentity {
  login: string;
  actorId: number;
  identitySource: GithubMachineAssigneeIdentitySource;
  checkedAt: string;
}

// ─── Claim status (stored later; typed here for contract stability) ──────────

export type GithubIssueClaimStatus =
  | "incomplete"
  | "complete"
  | "blocked_claim_assignee";

export interface GithubIssueClaimState {
  status: GithubIssueClaimStatus;
  assigneeLogin: string | null;
  assigneeActorId: number | null;
  identitySource: GithubMachineAssigneeIdentitySource | null;
  assigneeReadBack: boolean;
  labelReadBack: boolean;
}

// ─── Config (disk; may contain server-only paths, never secrets) ─────────────

export interface GithubAutomationRepositoryConfig {
  /** Immutable GitHub repository.id — primary key. */
  repositoryId: number;
  /** Display full_name; may lag renames until refresh. */
  fullName: string;
  /** Installation id when known; null until installation events bind it. */
  installationId: number | null;
  /**
   * Project Registry project id (`prj_…`) chosen by the operator.
   * Safe to project on the wire; server resolves it to `projectRoot`.
   * Null when unbound or only a legacy absolute path is present on disk.
   */
  projectId: string | null;
  /**
   * Canonical Project Registry root on the server.
   * Server-only: never projected to browser wire APIs.
   * Derived from `projectId` via Project Registry on write/bind paths.
   */
  projectRoot: string;
  /**
   * Explicit owner actor ids for org-owned repos.
   * User-owned repos may leave this empty and compare to repository.owner.id.
   */
  ownerActorIds: number[];
  /** Always machine-active-credential for this product decision. */
  assigneeIdentitySource: "machine-active-credential";
  baseRef: string;
}

export interface GithubAutomationTriageConfig {
  maxConcurrency: number;
}

export interface GithubAutomationUnattendedConfig {
  enabled: boolean;
  executionProfile: GithubAutomationExecutionProfile;
  riskProfile: GithubAutomationRiskProfile;
  maxConcurrency: number;
  maxFiles: number;
  maxChangedLines: number;
  /** Operator-owned validation commands; Issue text cannot override these. */
  validationCommands: string[];
}

/**
 * Non-secret automation config stored under
 * `~/.pi/agent/github-automation/config.json` (or PI_CODING_AGENT_DIR override).
 *
 * App ID / private-key path / webhook secret are env-only and never written here.
 */
export interface GithubAutomationConfigV1 {
  schemaVersion: GithubAutomationConfigSchemaVersion;
  enabled: boolean;
  mode: GithubAutomationMode;
  /** Global pause of new work; independent of mode. */
  paused: boolean;
  repositories: GithubAutomationRepositoryConfig[];
  triage: GithubAutomationTriageConfig;
  unattended: GithubAutomationUnattendedConfig;
  /** Opaque revision for CAS (sha256 prefix of canonical JSON). */
  revision: string;
  updatedAt: string;
}

/** Default validation commands for unattended profile. */
export const GITHUB_AUTOMATION_DEFAULT_VALIDATION_COMMANDS: readonly string[] = [
  "npm run lint",
  "node_modules/.bin/tsc --noEmit",
] as const;

// ─── App credential readiness (safe) ─────────────────────────────────────────

export type GithubAppCredentialReadinessCode =
  | "ready"
  | "missing_app_id"
  | "missing_private_key_file"
  | "private_key_unreadable"
  | "private_key_invalid"
  | "missing_webhook_secret"
  | "unknown";

export interface GithubAppCredentialSafeProjection {
  configured: boolean;
  readiness: GithubAppCredentialReadinessCode;
  /** Optional App slug when provided via env; never a secret. */
  appSlug: string | null;
  /** Whether App id is present (not the id value when we choose not to expose it). */
  hasAppId: boolean;
  hasPrivateKeyFile: boolean;
  hasWebhookSecret: boolean;
  checkedAt: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function isGithubAutomationMode(value: unknown): value is GithubAutomationMode {
  return value === "off" || value === "triage" || value === "unattended";
}

export function emptyPermissionSnapshot(): GithubAppPermissionSnapshot {
  return {
    metadata: "none",
    issues: "none",
    pull_requests: "none",
    contents: "none",
  };
}

/**
 * Derive P0/P1 capability from a permission snapshot.
 * Does not perform network I/O — pure projection helper for GHA-01 contracts.
 */
export function deriveGithubAppCapability(
  permissions: GithubAppPermissionSnapshot,
): GithubAppCapabilitySnapshot {
  const missingForP0: GithubAppPermissionName[] = [];
  const missingForP1: GithubAppPermissionName[] = [];

  if (permissions.metadata === "none") missingForP0.push("metadata");
  if (permissions.issues !== "write") missingForP0.push("issues");

  missingForP1.push(...missingForP0);
  if (permissions.pull_requests !== "write") missingForP1.push("pull_requests");
  if (permissions.contents !== "write") missingForP1.push("contents");

  const p0Triage = missingForP0.length === 0;
  const p1Unattended = missingForP1.length === 0;

  return {
    p0Triage,
    p1Unattended,
    permissions,
    missingForP0,
    missingForP1,
  };
}

export function createBlockedAssigneeProjection(
  readiness: GithubMachineAssigneeReadinessCode,
  checkedAt: string = new Date().toISOString(),
): GithubMachineAssigneeSafeProjection {
  return {
    login: null,
    actorId: null,
    identitySource: null,
    checkedAt,
    readiness,
    assignable: null,
    reasonCode: readiness === "ready" ? null : readiness,
  };
}
