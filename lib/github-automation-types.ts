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

/**
 * Live on-disk / runtime config schema for Issue Analysis (GIA-01+).
 * Schema v1 remains a legacy parse/migration input only.
 */
export const GITHUB_AUTOMATION_CONFIG_SCHEMA_VERSION = 2 as const;

/** Historical closed-loop config schema (read-only migration input). */
export const GITHUB_AUTOMATION_CONFIG_SCHEMA_VERSION_V1 = 1 as const;

export type GithubAutomationConfigSchemaVersion =
  typeof GITHUB_AUTOMATION_CONFIG_SCHEMA_VERSION;

export type GithubAutomationConfigSchemaVersionV1 =
  typeof GITHUB_AUTOMATION_CONFIG_SCHEMA_VERSION_V1;

/**
 * @deprecated Closed-loop runtime modes. Not present on schema v2.
 * Kept only for legacy on-disk parse and pre-retirement modules.
 */
export type GithubAutomationMode = "off" | "triage" | "unattended";

/** @deprecated Closed-loop execution profile; removed from schema v2. */
export type GithubAutomationExecutionProfile = "full-agent";

/** @deprecated Closed-loop risk profile; removed from schema v2. */
export type GithubAutomationRiskProfile = "docs-and-small-bugfix";

/** How the machine assignee login was discovered (legacy closed-loop only). */
export type GithubMachineAssigneeIdentitySource = "gh" | "git-credential";

/** Durable job kind. v2 scheduler only leases `issue_analysis`. */
export type GithubAutomationJobKind = "issue_analysis" | "legacy_pipeline";

export const GITHUB_AUTOMATION_JOB_KIND_ISSUE_ANALYSIS =
  "issue_analysis" as const;

export const GITHUB_AUTOMATION_JOB_KIND_LEGACY_PIPELINE =
  "legacy_pipeline" as const;

/** Fixed retirement reason for non-terminal v1 closed-loop jobs. */
export const GITHUB_AUTOMATION_LEGACY_PIPELINE_RETIRED_REASON =
  "legacy_pipeline_retired" as const;

// ─── Issue Analysis product vocabulary (GIA-01 contracts) ────────────────────

export type GithubIssueAnalysisCategory =
  | "bug"
  | "feature"
  | "docs"
  | "question"
  | "other";

export type GithubIssueAnalysisTruthVerdict =
  | "confirmed"
  | "not_exists"
  | "inconclusive"
  | "not_applicable";

export type GithubIssueAnalysisConfidence = "high" | "medium" | "low";

/** Minimal analysis phase machine (durable job.phase for schema v2). */
export type GithubIssueAnalysisPhase =
  | "received"
  | "analyzing"
  | "result_ready"
  | "commenting"
  | "closing"
  | "completed";

/** Scheduler-visible job status for schema v2 analysis jobs. */
export type GithubIssueAnalysisStatus =
  | "queued"
  | "running"
  | "retry_due"
  | "blocked"
  | "completed";

/** Safe terminal outcome semantics projected from phase/status + close effect. */
export type GithubIssueAnalysisOutcome =
  | "completed_open"
  | "completed_closed"
  | "inconclusive"
  | "blocked"
  | "retry_due"
  | "running"
  | "queued";

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

/**
 * Live repository allowlist entry (schema v2).
 * installationId + projectId are required for analysis; projectRoot is server-only.
 */
export interface GithubAutomationRepositoryConfig {
  /** Immutable GitHub repository.id — primary key. */
  repositoryId: number;
  /** Display full_name; may lag renames until refresh. */
  fullName: string;
  /** Installation id — required positive integer on schema v2. */
  installationId: number;
  /**
   * Project Registry project id (`prj_…`) chosen by the operator.
   * Safe to project on the wire; server resolves it to `projectRoot`.
   */
  projectId: string;
  /**
   * Canonical Project Registry root on the server.
   * Server-only: never projected to browser wire APIs.
   * Derived from `projectId` via Project Registry on write/bind paths.
   */
  projectRoot: string;
}

/**
 * @deprecated Legacy closed-loop repository shape (schema v1 on-disk only).
 * Never written by live config paths after GIA-01.
 */
export interface GithubAutomationRepositoryConfigV1 {
  repositoryId: number;
  fullName: string;
  installationId: number | null;
  projectId: string | null;
  projectRoot: string;
  ownerActorIds: number[];
  assigneeIdentitySource: "machine-active-credential";
  baseRef: string;
}

export interface GithubAutomationAnalysisConfig {
  /** Concurrent analysis leases (default 2, clamp 1..8). */
  maxConcurrency: number;
}

/** @deprecated Schema v1 triage concurrency; migrated into analysis.maxConcurrency. */
export interface GithubAutomationTriageConfig {
  maxConcurrency: number;
}

/** @deprecated Schema v1 unattended closed-loop settings. */
export interface GithubAutomationUnattendedConfig {
  enabled: boolean;
  executionProfile: GithubAutomationExecutionProfile;
  riskProfile: GithubAutomationRiskProfile;
  maxConcurrency: number;
  maxFiles: number;
  maxChangedLines: number;
  validationCommands: string[];
}

/**
 * Live non-secret automation config (schema v2) stored under
 * `~/.pi/agent/github-automation/config.json` (or PI_CODING_AGENT_DIR override).
 *
 * App ID / private key / webhook secret never live here.
 * Closed-loop fields (mode/unattended/baseRef/ownerActorIds/assignee) are absent.
 */
export interface GithubAutomationConfigV2 {
  schemaVersion: GithubAutomationConfigSchemaVersion;
  /** Fresh installs and v1 migrations always start false. */
  enabled: boolean;
  /** Operator stop-bleed; independent of enabled. */
  paused: boolean;
  repositories: GithubAutomationRepositoryConfig[];
  analysis: GithubAutomationAnalysisConfig;
  /** Opaque revision for CAS (sha256 prefix of canonical JSON). */
  revision: string;
  updatedAt: string;
}

/** Live config alias — schema v2 only. */
export type GithubAutomationConfig = GithubAutomationConfigV2;

/**
 * Temporary structural bridge for closed-loop modules still present until GIA-06.
 * Live durable config is always GithubAutomationConfigV2; these fields are never
 * persisted by config I/O after GIA-01 and must not be written to disk.
 */
export type GithubAutomationConfigCompat = GithubAutomationConfigV2 & {
  /** Always treated as off for closed-loop paths after GIA-01. */
  mode?: GithubAutomationMode;
  triage?: GithubAutomationTriageConfig;
  unattended?: GithubAutomationUnattendedConfig;
};

/** Temporary repo bridge for residual closed-loop readers until GIA-06. */
export type GithubAutomationRepositoryConfigCompat = GithubAutomationRepositoryConfig & {
  ownerActorIds?: number[];
  assigneeIdentitySource?: "machine-active-credential";
  baseRef?: string;
};


/**
 * @deprecated Historical closed-loop config (schema v1). Migration input only.
 * Never written by live config APIs after GIA-01.
 */
export interface GithubAutomationConfigV1 {
  schemaVersion: GithubAutomationConfigSchemaVersionV1;
  enabled: boolean;
  mode: GithubAutomationMode;
  paused: boolean;
  repositories: GithubAutomationRepositoryConfigV1[];
  triage: GithubAutomationTriageConfig;
  unattended: GithubAutomationUnattendedConfig;
  revision: string;
  updatedAt: string;
}

/**
 * @deprecated Closed-loop validation defaults. Retained only for legacy parse helpers.
 */
export const GITHUB_AUTOMATION_DEFAULT_VALIDATION_COMMANDS: readonly string[] = [
  "npm run lint",
  "node_modules/.bin/tsc --noEmit",
] as const;

export const GITHUB_AUTOMATION_ANALYSIS_DEFAULT_MAX_CONCURRENCY = 2 as const;
export const GITHUB_AUTOMATION_ANALYSIS_MAX_CONCURRENCY_LIMIT = 8 as const;

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
  /** A durable terminal outcome is awaiting only label/comment delivery. */
  | "operator_notification"
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

// ─── Scheduler handler contract (leaf; no runtime imports) ───────────────────

/**
 * Structural job snapshot accepted by the scheduler handler boundary.
 * Concrete durable records live in `github-automation-store`; this leaf shape
 * keeps the runner free of a runtime import cycle with the scheduler.
 *
 * Extra durable fields are allowed by structural typing (no index signature),
 * so store `GithubAutomationJobRecord` remains assignable here.
 */
export type GithubAutomationSchedulableJob = {
  jobId: string;
  schemaVersion?: number;
  kind?: string;
  status: string;
  phase: string;
  attempt: number;
  repositoryId: number;
  issueNumber: number;
  deliveryId?: string | null;
  traceId?: string | null;
  reasonCode?: string | null;
  nextRetryAt?: string | null;
  updatedAt?: string;
  createdAt?: string;
  checkpoint?: string | null;
  progressRevision?: number;
  leaseOwner?: string | null;
  leaseFencingToken?: string | null;
};

/**
 * Result returned by one durable scheduler lease-run of the analysis handler.
 * `job` is intentionally structural so store records assign without cycles.
 */
export type GithubAutomationJobHandlerResult = {
  job: GithubAutomationSchedulableJob;
  /**
   * When true, scheduler will re-check queue soon (e.g. more work available).
   * Default false. singleStep may set this only after real checkpoint progress.
   */
  wakeAgain?: boolean;
  /**
   * Explicit lease disposition (GHA-CLOSE-02). When absent, scheduler derives a
   * conservative disposition from job status/progressRevision change.
   */
  disposition?: GithubAutomationJobDisposition;
};

/**
 * Minimal config surface passed into the analysis job handler.
 * Production handlers cast to the live config type as needed.
 */
export type GithubAutomationHandlerConfig = {
  enabled: boolean;
  paused: boolean;
  analysis?: { maxConcurrency?: number };
  repositories?: ReadonlyArray<unknown>;
  schemaVersion?: number;
  revision?: string;
  updatedAt?: string;
};

/**
 * Lease handle surface available to long-running handlers for heartbeat / fence.
 * Matches the durable store lease handle without importing the store module.
 */
export type GithubAutomationHandlerLease = {
  ownerId: string;
  fencingToken: string;
  heartbeat: () => Promise<boolean>;
  isHeld?: () => Promise<boolean>;
  release?: () => Promise<void>;
};

/**
 * Job handler runs under job lease. Production always uses the single-purpose
 * issue analysis handler; focused tests may inject an explicit override.
 */
export type GithubAutomationJobHandler = (
  job: GithubAutomationSchedulableJob,
  context: {
    config: GithubAutomationHandlerConfig;
    ownerId: string;
    lease?: GithubAutomationHandlerLease;
  },
) => Promise<GithubAutomationJobHandlerResult>;

// ─── IMP2-01 implementer terminal disposition / notification contract ───────

/** Server-normalized implementer result. Child status/output is never authority. */
export type GithubImplementerDispositionKind =
  | "succeeded"
  | "needs_user_decision"
  | "policy_blocked"
  | "provider_transport_failure"
  | "check_failure"
  | "cancelled"
  | "paused"
  | "runtime_failed";

/** Closed reason vocabulary persisted for implementer terminal outcomes. */
export type GithubImplementerDispositionReasonCode =
  | "automation_state_inconsistent"
  | "blocked_manual_ui_approval"
  | "needs_user_decision"
  | "policy_blocked"
  | "provider_transport_failure"
  | "check_failure"
  | "cancelled"
  | "paused"
  | "runtime_failed";

export type GithubAutomationNotificationOperationStatus =
  | "pending"
  | "confirmed"
  | "failed";

export interface GithubAutomationNotificationState {
  labels: GithubAutomationNotificationOperationStatus;
  comment: GithubAutomationNotificationOperationStatus;
  /** Operation name only; raw remote errors and response bodies are forbidden. */
  lastFailureOperation?: "labels" | "comment" | "reconcile";
}

/**
 * Durable, generation/run-fence-bound terminal outcome. All fields are safe
 * scalars: never persist child output, Issue/comment text, paths, or provider errors.
 */
export interface GithubAutomationTerminalDisposition {
  generation: number;
  runFence: string;
  runOrdinal: number;
  kind: GithubImplementerDispositionKind;
  reasonCode: GithubImplementerDispositionReasonCode | null;
  blockedAtLayer: GithubAutomationBlockedLayer | null;
  retryability: GithubAutomationRetryability;
  recordedAt: string;
  provenanceHash: string;
  notificationRevision: string;
  notification: GithubAutomationNotificationState;
}

export type GithubAutomationTerminalDispositionReadResult =
  | { state: "valid"; disposition: GithubAutomationTerminalDisposition }
  | { state: "legacy_missing" | "invalid"; disposition: null };

const IMPLEMENTER_DISPOSITION_KINDS = new Set<GithubImplementerDispositionKind>([
  "succeeded", "needs_user_decision", "policy_blocked",
  "provider_transport_failure", "check_failure", "cancelled", "paused", "runtime_failed",
]);
const IMPLEMENTER_DISPOSITION_REASONS = new Set<GithubImplementerDispositionReasonCode>([
  "automation_state_inconsistent", "blocked_manual_ui_approval", "needs_user_decision",
  "policy_blocked", "provider_transport_failure", "check_failure", "cancelled", "paused", "runtime_failed",
]);
const NOTIFICATION_OPERATION_STATUSES = new Set<GithubAutomationNotificationOperationStatus>([
  "pending", "confirmed", "failed",
]);

/** Strict parser for persisted terminal data; missing/invalid records fail closed. */
export function readGithubAutomationTerminalDisposition(
  value: unknown,
): GithubAutomationTerminalDispositionReadResult {
  if (value === undefined || value === null) {
    return { state: "legacy_missing", disposition: null };
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return { state: "invalid", disposition: null };
  }
  const raw = value as Record<string, unknown>;
  const notification = raw.notification;
  if (typeof notification !== "object" || notification === null || Array.isArray(notification)) {
    return { state: "invalid", disposition: null };
  }
  const note = notification as Record<string, unknown>;
  const generation = raw.generation;
  const runOrdinal = raw.runOrdinal;
  const kind = raw.kind;
  const reasonCode = raw.reasonCode;
  const layer = raw.blockedAtLayer;
  const retryability = raw.retryability;
  const valid =
    Number.isInteger(generation) && (generation as number) > 0 &&
    Number.isInteger(runOrdinal) && (runOrdinal as number) > 0 &&
    typeof raw.runFence === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(raw.runFence) &&
    typeof kind === "string" && IMPLEMENTER_DISPOSITION_KINDS.has(kind as GithubImplementerDispositionKind) &&
    (reasonCode === null || (typeof reasonCode === "string" && IMPLEMENTER_DISPOSITION_REASONS.has(reasonCode as GithubImplementerDispositionReasonCode))) &&
    (layer === null || (typeof layer === "string" && ["agent", "operator_notification"].includes(layer))) &&
    (retryability === "automatic" || retryability === "operator_after_change" || retryability === "operator" || retryability === "none") &&
    typeof raw.recordedAt === "string" && !Number.isNaN(Date.parse(raw.recordedAt)) &&
    typeof raw.provenanceHash === "string" && /^[a-f0-9]{64}$/.test(raw.provenanceHash) &&
    typeof raw.notificationRevision === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(raw.notificationRevision) &&
    typeof note.labels === "string" && NOTIFICATION_OPERATION_STATUSES.has(note.labels as GithubAutomationNotificationOperationStatus) &&
    typeof note.comment === "string" && NOTIFICATION_OPERATION_STATUSES.has(note.comment as GithubAutomationNotificationOperationStatus) &&
    (note.lastFailureOperation === undefined || ["labels", "comment", "reconcile"].includes(note.lastFailureOperation as string));
  if (!valid) return { state: "invalid", disposition: null };

  // A terminal success has no block/retry/notification-failure semantics.
  if (kind === "succeeded" && (reasonCode !== null || layer !== null || retryability !== "none")) {
    return { state: "invalid", disposition: null };
  }
  if (kind !== "succeeded" && reasonCode === null) {
    return { state: "invalid", disposition: null };
  }
  const reasonMatchesKind =
    (kind === "succeeded" && reasonCode === null) ||
    (kind === "needs_user_decision" &&
      (reasonCode === "blocked_manual_ui_approval" || reasonCode === "needs_user_decision") &&
      retryability === "operator_after_change") ||
    (kind === "policy_blocked" && reasonCode === "policy_blocked" && retryability === "operator_after_change") ||
    (kind === "provider_transport_failure" && reasonCode === "provider_transport_failure" && retryability === "automatic") ||
    (kind === "check_failure" && reasonCode === "check_failure" && retryability === "operator") ||
    (kind === "cancelled" && reasonCode === "cancelled" && retryability === "operator") ||
    (kind === "paused" && reasonCode === "paused" && retryability === "operator") ||
    (kind === "runtime_failed" &&
      (reasonCode === "runtime_failed" || reasonCode === "automation_state_inconsistent") &&
      retryability === "operator");
  if (!reasonMatchesKind) return { state: "invalid", disposition: null };
  return {
    state: "valid",
    disposition: {
      generation: generation as number,
      runFence: raw.runFence as string,
      runOrdinal: runOrdinal as number,
      kind: kind as GithubImplementerDispositionKind,
      reasonCode: reasonCode as GithubImplementerDispositionReasonCode | null,
      blockedAtLayer: layer as GithubAutomationBlockedLayer | null,
      retryability: retryability as GithubAutomationRetryability,
      recordedAt: raw.recordedAt as string,
      provenanceHash: raw.provenanceHash as string,
      notificationRevision: raw.notificationRevision as string,
      notification: {
        labels: note.labels as GithubAutomationNotificationOperationStatus,
        comment: note.comment as GithubAutomationNotificationOperationStatus,
        ...(note.lastFailureOperation === undefined
          ? {}
          : { lastFailureOperation: note.lastFailureOperation as "labels" | "comment" | "reconcile" }),
      },
    },
  };
}

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
