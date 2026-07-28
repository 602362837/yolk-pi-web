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
 * App ID / private key / webhook secret never live here. Local secret material is
 * stored separately under `credentials.v1.json` + generation PEM files; process
 * env may override those values at runtime (see github-app-credentials).
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

/**
 * Where an effective credential field came from after env → local → missing overlay.
 * Safe to project; never includes values, paths, or fingerprints.
 */
export type GithubAppCredentialValueSource = "env" | "local" | "missing";

/**
 * Local on-disk credential bundle readiness (independent of env overlay).
 * - ready: complete valid v1 bundle
 * - missing: no local bundle
 * - invalid: present but unreadable / inconsistent / non-RSA / fingerprint mismatch
 * - unsupported: unknown/future schema or kind (fail closed; ordinary upsert must not overwrite)
 */
export type GithubAppLocalCredentialReadiness =
  | "ready"
  | "missing"
  | "invalid"
  | "unsupported";

/** Server-only schema version for credentials.v1.json under github-automation/. */
export const GITHUB_APP_LOCAL_CREDENTIALS_SCHEMA_VERSION = 1 as const;

/** Discriminator written into credentials.v1.json. */
export const GITHUB_APP_LOCAL_CREDENTIALS_KIND =
  "ypi-github-app-local-credentials" as const;

/**
 * Safe summary of the local (disk) credential bundle only.
 * Never includes App ID value, webhook secret, PEM, path, basename, or fingerprint.
 */
export interface GithubAppLocalCredentialSafeSummary {
  configured: boolean;
  readiness: GithubAppLocalCredentialReadiness;
  hasAppId: boolean;
  hasKey: boolean;
  hasWebhook: boolean;
  updatedAt: string | null;
}

export interface GithubAppCredentialSafeProjection {
  configured: boolean;
  readiness: GithubAppCredentialReadinessCode;
  /** Optional App slug when provided via env/local; never a secret. */
  appSlug: string | null;
  /** Whether App id is present (not the id value). */
  hasAppId: boolean;
  hasPrivateKeyFile: boolean;
  hasWebhookSecret: boolean;
  checkedAt: string;
  /**
   * Additive alias of hasPrivateKeyFile. Present after local/env credential productization.
   * Optional for backward-compatible wire consumers.
   */
  hasPrivateKey?: boolean;
  /** Local disk bundle summary (independent of env overlay). Additive. */
  local?: GithubAppLocalCredentialSafeSummary;
  /** Per-field effective source after env → local → missing. Additive. */
  sources?: {
    appId: GithubAppCredentialValueSource;
    key: GithubAppCredentialValueSource;
    webhook: GithubAppCredentialValueSource;
    slug: GithubAppCredentialValueSource;
  };
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

// ─── GHA-CLOSE-01 observability / disposition contracts (additive) ───────────
//
// These types freeze the product semantics for later scheduler / projection /
// UI work (GHA-CLOSE-02…06). Values are additive on wire; missing fields on
// legacy records MUST project as unknown_legacy / null, never as Agent active.

/**
 * Product layer where a job is currently blocked or last evaluated.
 * Used by safe projection and block fingerprints — not free text.
 */
export type GithubAutomationBlockedLayer =
  | "start_gate"
  | "worktree"
  | "studio_task"
  | "policy_pre"
  | "policy_plan"
  | "session_bootstrap"
  | "agent"
  | "validation"
  | "policy_final"
  | "publisher"
  | "lifecycle"
  | "scheduler"
  | "unknown";

/**
 * Durable handler disposition for one scheduler lease (GHA-CLOSE-02).
 * Scheduler must not infer queued from "still running".
 */
export type GithubAutomationJobDispositionKind =
  | "progressed"
  | "waiting"
  | "retry_due"
  | "blocked"
  | "terminal";

export type GithubAutomationJobDisposition =
  | {
      kind: "progressed";
      progressRevision: number;
      checkpoint: string;
    }
  | {
      kind: "waiting";
      wakeOn: "agent" | "external" | "timer";
    }
  | {
      kind: "retry_due";
      reasonCode: string;
      nextRetryAt: string;
      retryClass: "infra" | "runtime" | "network" | "session" | "unknown";
    }
  | {
      kind: "blocked";
      reasonCode: string;
      layer: GithubAutomationBlockedLayer;
      fingerprint: string;
      retryability: GithubAutomationRetryability;
    }
  | {
      kind: "terminal";
      status: "completed" | "cancelled" | "ignored";
    };

/**
 * How (if at all) a blocked/retry state may be retried.
 * Deterministic policy/manual blocks are never automatic.
 */
export type GithubAutomationRetryability =
  | "automatic"
  | "operator_after_change"
  | "operator"
  | "none";

/** Scheduler view of a job (not Agent execution). */
export type GithubAutomationSchedulerState =
  | "queued"
  | "leased"
  | "backoff"
  | "paused"
  | "idle"
  | "terminal"
  | "unknown";

/**
 * Whether an Agent session has real execution evidence.
 * No Session ⇒ not_started; never derive from phase/status/attempt alone.
 */
export type GithubAutomationAgentExecutionState =
  | "not_started"
  | "bootstrapping"
  | "implementing"
  | "checking"
  | "publishing"
  | "ended"
  | "failed"
  | "unknown";

/**
 * Session availability for Jobs UI.
 * Policy/Studio gates before implementing may legitimately be `none`.
 */
export type GithubAutomationSessionAvailability =
  | "none"
  | "creating"
  | "active"
  | "ended"
  | "failed"
  | "unknown_legacy";

/**
 * Allowlisted meaningful-progress kinds. Free text / tool payloads are forbidden.
 * Scheduler heartbeats and lease renewals are NOT meaningful progress.
 */
export type GithubAutomationSafeProgressKind =
  | "checkpoint_advanced"
  | "session_created"
  | "child_run_terminal"
  | "validation_terminal"
  | "policy_terminal"
  | "publisher_terminal"
  | "command_consumed"
  | "reconciled";

export interface GithubAutomationSafeProgressSummary {
  at: string | null;
  kind: GithubAutomationSafeProgressKind | null;
}

export interface GithubAutomationJobProgressCounts {
  /** Compatible with legacy `attempt` (scheduler lease runs). */
  schedulerRuns: number;
  /** Successful parent Session bootstrap / child start only. */
  agentRuns: number;
  /** Lease runs with no progressRevision change. */
  noProgressRuns: number;
  /** Count of allowlisted meaningful progress events. */
  meaningfulProgress: number;
}

/**
 * Safe runtime provenance for status / block evaluation comparison.
 * Never includes absolute paths, secrets, or package tarball contents.
 */
export interface GithubAutomationRuntimeProvenance {
  packageVersion: string;
  buildId: string;
  codeRevision: string;
  processEpoch: string;
  processStartedAt: string;
  policyVersion: string;
}

/** Provenance recorded when a block/decision was evaluated. */
export interface GithubAutomationEvaluatedProvenance {
  codeRevision: string;
  policyVersion: string;
}

/**
 * Additive safe job observability fields (GHA-CLOSE-04 will project these).
 * Declared here so policy/runner/store share one vocabulary.
 */
export interface GithubAutomationJobObservabilityContract {
  schedulerState: GithubAutomationSchedulerState;
  agentExecutionState: GithubAutomationAgentExecutionState;
  sessionAvailability: GithubAutomationSessionAvailability;
  blockedAtLayer: GithubAutomationBlockedLayer | null;
  retryability: GithubAutomationRetryability;
  lastMeaningfulProgress: GithubAutomationSafeProgressSummary;
  counts: GithubAutomationJobProgressCounts;
  workspaceLabel: string | null;
  runtimeProvenance?: GithubAutomationRuntimeProvenance;
  evaluatedProvenance?: GithubAutomationEvaluatedProvenance | null;
}

/**
 * Legacy defaults when additive fields are absent on disk.
 * Must never invent Agent active / session present.
 */
export function createLegacyGithubAutomationJobObservability(
  attempt: number = 0,
): GithubAutomationJobObservabilityContract {
  return {
    schedulerState: "unknown",
    agentExecutionState: "unknown",
    sessionAvailability: "unknown_legacy",
    blockedAtLayer: null,
    retryability: "operator",
    lastMeaningfulProgress: { at: null, kind: null },
    counts: {
      schedulerRuns: Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0,
      agentRuns: 0,
      noProgressRuns: 0,
      meaningfulProgress: 0,
    },
    workspaceLabel: null,
    evaluatedProvenance: null,
  };
}

/**
 * Map a risk-policy stage block onto blockedAtLayer vocabulary.
 */
export function githubRiskPolicyStageToBlockedLayer(
  stage: "pre" | "plan" | "final" | string | null | undefined,
): GithubAutomationBlockedLayer {
  if (stage === "pre") return "policy_pre";
  if (stage === "plan") return "policy_plan";
  if (stage === "final") return "policy_final";
  return "unknown";
}

/**
 * Deterministic vs recoverable classification for reason codes known at contract freeze.
 * Scheduler (GHA-CLOSE-02) uses this to avoid re-running the same policy gate.
 */
/**
 * Build a deterministic block fingerprint for re-evaluation gates (GHA-CLOSE-02).
 * Inputs must be allowlisted scalars — never free text / paths / secrets.
 */
export function buildGithubAutomationBlockFingerprint(input: {
  layer: GithubAutomationBlockedLayer | string;
  reasonCode: string;
  checkpoint: string | null | undefined;
  policyVersion?: string | null;
  codeRevision?: string | null;
  scopeFingerprint?: string | null;
  inputHash?: string | null;
}): string {
  const material = [
    String(input.layer ?? "unknown"),
    String(input.reasonCode ?? ""),
    String(input.checkpoint ?? ""),
    String(input.policyVersion ?? ""),
    String(input.codeRevision ?? ""),
    String(input.scopeFingerprint ?? ""),
    String(input.inputHash ?? ""),
  ].join("|");
  // Lightweight stable hash without importing crypto in every consumer:
  // FNV-1a 32-bit — fingerprint is for equality, not secrecy.
  let h = 0x811c9dc5;
  for (let i = 0; i < material.length; i += 1) {
    h ^= material.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `bf_${(h >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Phases where a remote_confirmed owner command must NOT cut off unattended
 * runner continuation (the #22 spin root cause).
 */
export const GITHUB_AUTOMATION_UNATTENDED_CONTINUATION_PHASES: ReadonlySet<string> =
  new Set([
    "implementation_queued",
    "planning",
    "policy_check",
    "implementing",
    "checking",
    "final_policy",
    "publishing",
  ]);

export function isGithubAutomationUnattendedContinuationPhase(
  phase: string | null | undefined,
): boolean {
  return Boolean(phase && GITHUB_AUTOMATION_UNATTENDED_CONTINUATION_PHASES.has(phase));
}

export function classifyGithubAutomationRetryability(
  reasonCode: string | null | undefined,
): GithubAutomationRetryability {
  if (!reasonCode) return "operator";
  if (
    reasonCode.startsWith("blocked_") ||
    reasonCode === "blocked_manual_ui_approval" ||
    reasonCode === "deferred_no_declared_files"
  ) {
    // Deterministic policy/manual outcomes: operator may re-evaluate only after change.
    if (
      reasonCode === "blocked_uncertain" ||
      reasonCode === "blocked_empty_diff" ||
      reasonCode === "blocked_ui_interaction" ||
      reasonCode === "blocked_manual_ui_approval" ||
      reasonCode === "blocked_workflow_ci" ||
      reasonCode === "blocked_release_publish" ||
      reasonCode === "blocked_secret_auth" ||
      reasonCode === "blocked_dependency_lockfile" ||
      reasonCode === "blocked_infra" ||
      reasonCode === "blocked_cross_repo" ||
      reasonCode === "blocked_large_refactor" ||
      reasonCode === "blocked_binary_or_symlink" ||
      reasonCode === "blocked_submodule" ||
      reasonCode === "blocked_generated_artifact" ||
      reasonCode === "blocked_over_limit" ||
      reasonCode === "blocked_risk_profile"
    ) {
      return "operator_after_change";
    }
  }
  if (
    reasonCode.includes("timeout") ||
    reasonCode.includes("network") ||
    reasonCode.includes("transient") ||
    reasonCode.includes("lease") ||
    reasonCode === "retry_wake" ||
    reasonCode === "session_bootstrap_transient" ||
    reasonCode === "handler_not_ready"
  ) {
    return "automatic";
  }
  if (reasonCode === "pr_merged" || reasonCode === "already_merged") {
    return "none";
  }
  return "operator";
}
