/**
 * github-automation-projection — safe wire types for Settings / ops APIs (GHA-09).
 *
 * Projection rules (hard):
 * - Include: assignee login/readiness/source, executionProfile=full-agent,
 *   riskProfile=docs-and-small-bugfix, residual-risk flag/codes, safe jobs.
 * - Exclude: credentials/tokens, absolute paths, Issue/comment body, prompt,
 *   transcript, raw webhook, private key material, worktree/session files.
 * - Status/refresh must not enqueue work or start the scheduler.
 * - Residual-risk warning cannot be disabled by config.
 */

import { getGithubAppCredentialSafeProjection } from "./github-app-credentials";
import {
  getGithubInstallationCapability,
} from "./github-app-client";
import {
  listGithubAutomationProjectChoices,
  parseGithubAutomationRepositoryWireDraftList,
  patchGithubAutomationConfig,
  readGithubAutomationConfig,
  resolveGithubAutomationRepositoryWireDrafts,
  toGithubAutomationConfigSafeProjection,
  toGithubAutomationRepositorySafeProjection,
  type GithubAutomationConfigSafeProjection,
  type GithubAutomationProjectChoiceSafeProjection,
  type GithubAutomationRepositorySafeProjection,
  type GithubAutomationRepositoryWireDraft,
} from "./github-automation-config";
import {
  GithubAutomationError,
  isGithubAutomationError,
  safeGithubAutomationErrorMessage,
} from "./github-automation-errors";
import {
  appendGithubAutomationSafeEvent,
  listGithubAutomationJobs,
  readGithubAutomationIssueState,
  readGithubAutomationJob,
  readGithubAutomationJobTerminalDisposition,
  writeGithubAutomationJob,
  type GithubAutomationJobPhase,
  type GithubAutomationJobRecord,
  type GithubAutomationJobStatus,
} from "./github-automation-store";
import {
  GITHUB_FULL_AGENT_PROFILE,
  GITHUB_UNATTENDED_POLICY_ID,
  GITHUB_UNATTENDED_POLICY_VERSION,
  toGithubFullAgentProfileSafeProjection,
  type GithubFullAgentResidualRiskCode,
} from "./github-full-agent-profile";
import { getMachineGithubAssigneeSafeProjection } from "./github-machine-assignee";
import type {
  GithubAppCapabilitySnapshot,
  GithubAppCredentialSafeProjection,
  GithubAutomationAgentExecutionState,
  GithubAutomationBlockedLayer,
  GithubAutomationConfigV1,
  GithubAutomationEvaluatedProvenance,
  GithubAutomationJobProgressCounts,
  GithubAutomationMode,
  GithubAutomationRetryability,
  GithubAutomationRuntimeProvenance,
  GithubAutomationSafeProgressSummary,
  GithubAutomationSchedulerState,
  GithubAutomationSessionAvailability,
  GithubAutomationTerminalDisposition,
  GithubMachineAssigneeSafeProjection,
} from "./github-automation-types";
import {
  classifyGithubAutomationRetryability,
  createLegacyGithubAutomationJobObservability,
  emptyPermissionSnapshot,
  deriveGithubAppCapability,
  githubRiskPolicyStageToBlockedLayer,
} from "./github-automation-types";
import {
  requestGithubUnattendedJobPause,
  wakeGithubUnattendedJobForRetry,
  readGithubAutomationRunnerState,
  reconcileGithubAutomationLegacyJob,
  isGithubAutomationDeterministicBlockUnchanged,
  type GithubAutomationRunnerStateV1,
} from "./github-automation-runner";
import {
  isGithubAutomationProductionHandlerReadinessDisabled,
  wakeGithubAutomationScheduler,
} from "./github-automation-scheduler";
import { ensureGithubAutomationJobHandlerReady } from "./github-automation-handler-runtime";
import { getGithubAutomationRuntimeProvenance } from "./github-automation-provenance";

export {
  getGithubAutomationCodeRevision,
  getGithubAutomationRuntimeProvenance,
  getGithubAutomationEvaluatedProvenance,
  _testResetGithubAutomationRuntimeProvenanceCache,
} from "./github-automation-provenance";

// ─── Forbidden field names (tests assert absence) ────────────────────────────

export const GITHUB_AUTOMATION_PROJECTION_FORBIDDEN_KEYS = [
  "token",
  "password",
  "privateKey",
  "private_key",
  "webhookSecret",
  "webhook_secret",
  "authorization",
  "rawBody",
  "raw_body",
  "signature",
  "prompt",
  "transcript",
  "projectRoot",
  "worktreePath",
  "sessionFile",
  "sessionPath",
  "absolutePath",
  "issueBody",
  "commentBody",
  "body",
  "installationToken",
  "appJwt",
  "credential",
  // Local credential store internals (never wire these containers/values).
  "privateKeyPem",
  "private_key_pem",
  "privateKeyFile",
  "keyFile",
  "keySha256",
  "fingerprint",
  "appIdValue",
] as const;

/**
 * Safe additive credential-projection field names that may contain forbidden
 * substrings (e.g. hasPrivateKey contains "privateKey") but are never secret
 * containers. Exact-match only; do not broaden to prefix/suffix wildcards.
 */
const GITHUB_AUTOMATION_PROJECTION_SAFE_KEY_ALLOWLIST = new Set([
  "hasprivatekey",
  "hasprivatekeyfile",
  "haswebhooksecret",
  "hasappid",
  "haskey",
  "haswebhook",
  // Checklist item codes (not secret containers).
  "private_key_file",
  "webhook_secret",
  "app_id",
]);

// ─── Wire types ──────────────────────────────────────────────────────────────

export type GithubAutomationWebhookHealthCode =
  | "unknown"
  | "healthy"
  | "error";

export type GithubAutomationAssigneeClaimProjection =
  | "complete"
  | "blocked_claim_assignee"
  | "incomplete"
  | "unknown";

export interface GithubAutomationReadinessProjection {
  app: GithubAppCredentialSafeProjection;
  installation: {
    present: boolean;
    installationIdCount: number;
    readiness: "ready" | "missing" | "partial";
  };
  permissions: {
    p0Triage: boolean;
    p1Unattended: boolean;
    missingForP0: string[];
    missingForP1: string[];
    /** Safe permission levels only. */
    snapshot: ReturnType<typeof emptyPermissionSnapshot>;
  };
  assignee: GithubMachineAssigneeSafeProjection;
  webhook: {
    health: GithubAutomationWebhookHealthCode;
    /** ISO time of last verified delivery when known; never raw delivery body. */
    lastVerifiedAt: string | null;
  };
  allowlist: {
    repositoryCount: number;
    ready: boolean;
  };
}

export interface GithubAutomationRuntimeProjection {
  enabled: boolean;
  mode: GithubAutomationMode;
  paused: boolean;
  executionProfile: "full-agent";
  riskProfile: "docs-and-small-bugfix";
  /** Always true — cannot be turned off by config. */
  residualRiskWarningRequired: true;
  residualRiskCodes: readonly GithubFullAgentResidualRiskCode[];
  residualRiskSummary: string;
  counts: {
    queued: number;
    running: number;
    retry: number;
    blocked: number;
    paused: number;
    prOpen: number;
    completed: number;
  };
}

export interface GithubAutomationRepositoryStatusProjection
  extends GithubAutomationRepositorySafeProjection {
  installationBound: boolean;
  baseRef: string;
  assignee: GithubMachineAssigneeSafeProjection;
  claimSemantics: "ypi_claimed_plus_machine_login";
  /**
   * Safe local project label for Settings cards.
   * Never an absolute path — Project Registry display name or repo short name.
   */
  projectDisplayName: string | null;
}

export interface GithubAutomationPolicyProjection {
  policyId: string;
  policyVersion: string;
  riskProfile: "docs-and-small-bugfix";
  executionProfile: "full-agent";
  unattendedEnabled: boolean;
  maxConcurrency: number;
  maxFiles: number;
  maxChangedLines: number;
  validationCommandCount: number;
  residualRiskWarningRequired: true;
  residualRiskCodes: readonly GithubFullAgentResidualRiskCode[];
  residualRiskSummary: string;
  recommendedDeployment: string;
  sandboxed: false;
  alwaysManual: readonly string[];
  capabilityBlockers: string[];
}

export type GithubAutomationJobActionName = "retry" | "pause" | "resume";

export interface GithubAutomationJobActionAvailability {
  action: GithubAutomationJobActionName;
  available: boolean;
  reasonCode: string | null;
}

export interface GithubAutomationTerminalDispositionSafeProjection {
  kind: GithubAutomationTerminalDisposition["kind"];
  reasonCode: GithubAutomationTerminalDisposition["reasonCode"];
  blockedAtLayer: GithubAutomationTerminalDisposition["blockedAtLayer"];
  retryability: GithubAutomationTerminalDisposition["retryability"];
  recordedAt: string;
  notification: GithubAutomationTerminalDisposition["notification"];
}

export interface GithubAutomationJobSafeProjection {
  jobId: string;
  repositoryId: number;
  repositoryFullName: string;
  issueNumber: number;
  issueTitlePreview: string | null;
  phase: GithubAutomationJobPhase;
  status: GithubAutomationJobStatus;
  /**
   * Legacy field: scheduler lease run count only.
   * UI must label as "调度尝试", never "第 N 次执行" / Agent runs.
   */
  attempt: number;
  generation: number;
  traceId: string;
  reasonCode: string | null;
  nextRetryAt: string | null;
  createdAt: string;
  updatedAt: string;
  checkpoint: string | null;
  claimStatus: GithubAutomationAssigneeClaimProjection;
  prNumber: number | null;
  headBranch: string | null;
  hasPullRequest: boolean;
  actions: GithubAutomationJobActionAvailability[];
  // ── Additive GHA-CLOSE-01/04 observability (safe; defaults for legacy jobs) ──
  schedulerState: GithubAutomationSchedulerState;
  agentExecutionState: GithubAutomationAgentExecutionState;
  sessionAvailability: GithubAutomationSessionAvailability;
  blockedAtLayer: GithubAutomationBlockedLayer | null;
  retryability: GithubAutomationRetryability;
  lastMeaningfulProgress: GithubAutomationSafeProgressSummary;
  counts: GithubAutomationJobProgressCounts;
  /** Safe workspace label only — never absolute path. */
  workspaceLabel: string | null;
  /** Opaque short session id when available (never sessionFile/path). */
  sessionIdShort: string | null;
  /** Provenance captured when the current block/decision was evaluated. */
  evaluatedProvenance: GithubAutomationEvaluatedProvenance | null;
  /** IMP2-01 safe terminal outcome; no child output, fence, hash, or raw errors. */
  terminalDisposition: GithubAutomationTerminalDispositionSafeProjection | null;
  /** Missing/invalid historical disposition must be handled by an operator, never inferred. */
  terminalDispositionState: "valid" | "legacy_missing" | "invalid";
}

export interface GithubAutomationStatusProjection {
  revision: string;
  generatedAt: string;
  readiness: GithubAutomationReadinessProjection;
  runtime: GithubAutomationRuntimeProjection;
  repositories: GithubAutomationRepositoryStatusProjection[];
  policy: GithubAutomationPolicyProjection;
  jobs: GithubAutomationJobSafeProjection[];
  config: GithubAutomationConfigSafeProjection;
  /**
   * Running process package/build/policy provenance (GHA-CLOSE-04).
   * Compare with job.evaluatedProvenance to detect stale runtime after code deploy.
   */
  runtimeProvenance: GithubAutomationRuntimeProvenance;
}

// ─── Action policy ───────────────────────────────────────────────────────────

const RETRYABLE_STATUSES = new Set<GithubAutomationJobStatus>([
  "blocked",
  "retry_due",
  "paused",
]);

const PAUSABLE_STATUSES = new Set<GithubAutomationJobStatus>([
  "queued",
  "running",
  "retry_due",
]);

const RESUMABLE_STATUSES = new Set<GithubAutomationJobStatus>(["paused"]);

const NON_RETRYABLE_REASON_CODES = new Set([
  "pr_merged",
  "already_merged",
]);

export function evaluateGithubAutomationJobActions(
  job: GithubAutomationJobRecord,
  options?: {
    automationEnabled?: boolean;
    mode?: GithubAutomationMode;
    globalPaused?: boolean;
    /** Live process code revision for deterministic-block retry gate (GHA-CLOSE-05). */
    runtimeCodeRevision?: string | null;
    /** Live process policy version for deterministic-block retry gate. */
    runtimePolicyVersion?: string | null;
    /** Force retry unavailable (tests / explicit operator messaging). */
    blockUnchangedRetry?: boolean;
  },
): GithubAutomationJobActionAvailability[] {
  const enabled = options?.automationEnabled !== false;
  const mode = options?.mode ?? "triage";
  const modeOff = mode === "off" || !enabled;

  const retryBlockedReason = (() => {
    if (modeOff) return "automation_disabled";
    if (!RETRYABLE_STATUSES.has(job.status) && job.phase !== "blocked" && job.phase !== "blocked_claim_assignee" && job.phase !== "retry_due" && job.phase !== "paused") {
      return "phase_not_retryable";
    }
    if (job.phase === "completed" || job.status === "completed") {
      return "job_completed";
    }
    if (job.phase === "cancelled" || job.status === "cancelled") {
      return "job_cancelled";
    }
    if (job.reasonCode && NON_RETRYABLE_REASON_CODES.has(job.reasonCode)) {
      return "merged_not_retryable";
    }
    if (
      job.status !== "blocked" &&
      job.status !== "retry_due" &&
      job.status !== "paused" &&
      job.phase !== "blocked" &&
      job.phase !== "blocked_claim_assignee"
    ) {
      return "status_not_retryable";
    }
    // GHA-CLOSE-05: deterministic policy/manual block with unchanged fingerprint +
    // evaluated provenance must not allow blind operator retry spin.
    if (
      isGithubAutomationDeterministicBlockUnchanged(job, {
        codeRevision: options?.runtimeCodeRevision ?? "",
        policyVersion: options?.runtimePolicyVersion ?? "",
      }) &&
      options?.runtimeCodeRevision &&
      options?.runtimePolicyVersion
    ) {
      return "retry_conditions_unchanged";
    }
    // When runtime provenance omitted, still block if caller passed explicit flag.
    if (options?.blockUnchangedRetry === true) {
      return "retry_conditions_unchanged";
    }
    return null;
  })();

  const pauseBlockedReason = (() => {
    if (modeOff) return "automation_disabled";
    if (job.status === "paused" || job.phase === "paused") {
      return "already_paused";
    }
    if (job.status === "completed" || job.phase === "completed") {
      return "job_completed";
    }
    if (job.status === "cancelled" || job.phase === "cancelled") {
      return "job_cancelled";
    }
    if (job.status === "blocked" && job.phase !== "implementing") {
      return "status_not_pausable";
    }
    if (!PAUSABLE_STATUSES.has(job.status) && job.phase !== "implementing" && job.phase !== "checking" && job.phase !== "publishing" && job.phase !== "planning") {
      return "status_not_pausable";
    }
    return null;
  })();

  const resumeBlockedReason = (() => {
    if (modeOff) return "automation_disabled";
    if (job.status !== "paused" && job.phase !== "paused") {
      return "not_paused";
    }
    if (options?.globalPaused) {
      // Still allow job-level resume flag clear; global pause is separate.
    }
    if (!RESUMABLE_STATUSES.has(job.status) && job.phase !== "paused") {
      return "status_not_resumable";
    }
    return null;
  })();

  return [
    {
      action: "retry",
      available: retryBlockedReason === null,
      reasonCode: retryBlockedReason,
    },
    {
      action: "pause",
      available: pauseBlockedReason === null,
      reasonCode: pauseBlockedReason,
    },
    {
      action: "resume",
      available: resumeBlockedReason === null,
      reasonCode: resumeBlockedReason,
    },
  ];
}

// ─── Job projection ──────────────────────────────────────────────────────────

function effectRemoteId(
  job: GithubAutomationJobRecord,
  name: "pull_request" | "branch",
): string | null {
  const effects = Array.isArray(job.effects) ? job.effects : [];
  for (let i = effects.length - 1; i >= 0; i -= 1) {
    const e = effects[i];
    if (e?.name === name && typeof e.remoteId === "string" && e.remoteId) {
      return e.remoteId;
    }
  }
  return null;
}

/** Opaque short id for UI — never the session file path. */
export function toGithubAutomationSessionIdShort(
  sessionId: string | null | undefined,
): string | null {
  if (typeof sessionId !== "string") return null;
  const trimmed = sessionId.trim();
  if (!trimmed) return null;
  // Reject anything that looks like a path.
  if (
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("..") ||
    trimmed.startsWith("~")
  ) {
    return null;
  }
  if (trimmed.length <= 12) return trimmed;
  return `${trimmed.slice(0, 8)}…${trimmed.slice(-4)}`;
}

/**
 * Safe workspace label for Settings (never absolute path / sessionFile).
 * Example: "yolk-pi-web · WT issue-22 g1"
 */
export function buildGithubAutomationWorkspaceLabel(input: {
  repositoryFullName: string;
  issueNumber: number;
  generation: number;
  projectDisplayName?: string | null;
  branchName?: string | null;
  hasWorktreeBinding?: boolean;
}): string | null {
  const hasBinding =
    input.hasWorktreeBinding === true ||
    (typeof input.branchName === "string" && input.branchName.trim().length > 0);
  if (!hasBinding && !input.projectDisplayName) {
    // Without WorkTree evidence, do not invent a label.
    return null;
  }
  const shortRepo = input.repositoryFullName.includes("/")
    ? input.repositoryFullName.split("/").pop() ?? input.repositoryFullName
    : input.repositoryFullName;
  const project =
    typeof input.projectDisplayName === "string" && input.projectDisplayName.trim()
      ? input.projectDisplayName.trim().slice(0, 64)
      : shortRepo.slice(0, 64);
  // Prefer issue+generation over branch (branch may contain repo id numeric segment).
  const issue =
    Number.isFinite(input.issueNumber) && input.issueNumber > 0
      ? Math.floor(input.issueNumber)
      : 0;
  const gen =
    Number.isFinite(input.generation) && input.generation > 0
      ? Math.floor(input.generation)
      : 1;
  if (issue > 0) {
    return `${project} · WT issue-${issue} g${gen}`;
  }
  if (typeof input.branchName === "string" && input.branchName.trim()) {
    // Only keep trailing alnum/hyphen fragments — never full path.
    const frag = input.branchName
      .trim()
      .split("/")
      .filter(Boolean)
      .pop()
      ?.replace(/[^a-zA-Z0-9._-]+/g, "-")
      .slice(0, 40);
    if (frag) return `${project} · WT ${frag}`;
  }
  return `${project} · WT`;
}

export interface DeriveGithubAutomationJobObservabilityOptions {
  /** Optional runner sidecar (GHA-CLOSE-03/04). Never projected raw. */
  runner?: GithubAutomationRunnerStateV1 | null;
  /** Safe project display name from config (no absolute path). */
  projectDisplayName?: string | null;
  /** Inject runtime provenance for evaluated comparison (defaults to live). */
  runtimeProvenance?: GithubAutomationRuntimeProvenance;
}

/**
 * Derive conservative dual-layer observability from durable job + optional runner.
 * Missing additive fields ⇒ unknown_legacy / not_started — never fake Agent active.
 */
export function deriveGithubAutomationJobObservabilityFromRecord(
  job: GithubAutomationJobRecord,
  options: DeriveGithubAutomationJobObservabilityOptions = {},
): {
  schedulerState: GithubAutomationSchedulerState;
  agentExecutionState: GithubAutomationAgentExecutionState;
  sessionAvailability: GithubAutomationSessionAvailability;
  blockedAtLayer: GithubAutomationBlockedLayer | null;
  retryability: GithubAutomationRetryability;
  lastMeaningfulProgress: GithubAutomationSafeProgressSummary;
  counts: GithubAutomationJobProgressCounts;
  workspaceLabel: string | null;
  sessionIdShort: string | null;
  evaluatedProvenance: GithubAutomationEvaluatedProvenance | null;
  terminalDisposition: GithubAutomationTerminalDispositionSafeProjection | null;
  terminalDispositionState: "valid" | "legacy_missing" | "invalid";
} {
  const terminalRead = readGithubAutomationJobTerminalDisposition(job);
  const terminalDisposition = terminalRead.disposition
    ? {
        kind: terminalRead.disposition.kind,
        reasonCode: terminalRead.disposition.reasonCode,
        blockedAtLayer: terminalRead.disposition.blockedAtLayer,
        retryability: terminalRead.disposition.retryability,
        recordedAt: terminalRead.disposition.recordedAt,
        notification: terminalRead.disposition.notification,
      }
    : null;
  const legacy = createLegacyGithubAutomationJobObservability(job.attempt);
  const runner = options.runner ?? null;
  const hasProgressFields =
    job.progressRevision != null ||
    job.agentRunCount != null ||
    job.noProgressRunCount != null ||
    job.meaningfulProgressCount != null ||
    job.blockedAtLayer != null ||
    job.evaluatedCodeRevision != null ||
    job.evaluatedPolicyVersion != null;
  const hasRunnerSidecar = runner != null;

  let schedulerState: GithubAutomationSchedulerState = legacy.schedulerState;
  if (job.status === "paused" || job.phase === "paused") {
    schedulerState = "paused";
  } else if (job.status === "completed" || job.status === "cancelled" || job.status === "ignored") {
    schedulerState = "terminal";
  } else if (job.status === "retry_due" || job.phase === "retry_due") {
    schedulerState = "backoff";
  } else if (job.status === "running") {
    schedulerState = "leased";
  } else if (job.status === "queued") {
    schedulerState = "queued";
  } else if (job.status === "blocked") {
    schedulerState = "idle";
  }

  // Session truth: prefer runner sessionId; never invent active from phase alone.
  const runnerSessionId =
    typeof runner?.sessionId === "string" && runner.sessionId.trim()
      ? runner.sessionId.trim()
      : null;
  const sessionIdShort = toGithubAutomationSessionIdShort(runnerSessionId);

  let sessionAvailability: GithubAutomationSessionAvailability =
    hasProgressFields || hasRunnerSidecar ? "none" : "unknown_legacy";
  let agentExecutionState: GithubAutomationAgentExecutionState =
    hasProgressFields || hasRunnerSidecar ? "not_started" : "unknown";

  let agentRuns =
    typeof job.agentRunCount === "number" && Number.isFinite(job.agentRunCount)
      ? Math.max(0, Math.floor(job.agentRunCount))
      : 0;
  // Sidecar session without stamped agentRunCount still proves at least one bootstrap.
  if (agentRuns === 0 && runnerSessionId) {
    agentRuns = 1;
  }

  if (runnerSessionId) {
    if (job.phase === "completed" || job.status === "completed") {
      sessionAvailability = "ended";
      agentExecutionState = "ended";
    } else if (
      job.status === "blocked" &&
      (job.reasonCode === "session_bootstrap_failed" ||
        job.blockedAtLayer === "session_bootstrap")
    ) {
      sessionAvailability = "failed";
      agentExecutionState = "failed";
    } else if (
      // Parent binding Session exists, but full-agent never produced meaningful
      // agent work (IMP-001): do not claim Agent "implementing" from sessionId alone.
      (job.reasonCode === "implementer_error" ||
        job.reasonCode === "implementer_failed" ||
        job.reasonCode === "full_agent_prompt_sentinel" ||
        (job.blockedAtLayer === "agent" &&
          (job.status === "blocked" || job.phase === "blocked"))) &&
      (job.lastMeaningfulProgressKind == null ||
        job.lastMeaningfulProgressKind === "session_created")
    ) {
      sessionAvailability = "active";
      agentExecutionState = "failed";
    } else if (
      job.lastMeaningfulProgressKind === "session_created" &&
      (job.phase === "paused" || job.status === "paused" || job.status === "blocked") &&
      (typeof job.meaningfulProgressCount !== "number" ||
        job.meaningfulProgressCount <= 1)
    ) {
      // Binding-only parent Session after bootstrap; Agent child not proven active.
      sessionAvailability = "active";
      agentExecutionState =
        job.status === "blocked" || job.phase === "blocked" ? "failed" : "bootstrapping";
    } else {
      sessionAvailability = "active";
      if (job.phase === "checking") agentExecutionState = "checking";
      else if (
        job.phase === "publishing" ||
        job.phase === "final_policy" ||
        job.phase === "pr_open"
      ) {
        agentExecutionState = "publishing";
      } else if (job.status === "blocked" || job.phase === "blocked") {
        // Session exists but job blocked later (policy_final etc.) — not "implementing".
        agentExecutionState = "failed";
      } else {
        agentExecutionState = "implementing";
      }
    }
  } else if (agentRuns > 0) {
    // Count says Agent started but sidecar lost session id.
    sessionAvailability = "unknown_legacy";
    if (job.phase === "checking") agentExecutionState = "checking";
    else if (job.phase === "publishing" || job.phase === "final_policy") {
      agentExecutionState = "publishing";
    } else if (job.phase === "completed" || job.status === "completed") {
      agentExecutionState = "ended";
      sessionAvailability = "ended";
    } else if (job.status === "blocked" || job.phase === "blocked") {
      agentExecutionState = "failed";
    } else {
      agentExecutionState = "implementing";
    }
  } else if (
    job.phase === "implementing" ||
    job.checkpoint === "implementing" ||
    runner?.checkpoint === "implementing"
  ) {
    // Entered implementing without session id yet: bootstrapping, not active.
    agentExecutionState =
      hasProgressFields || hasRunnerSidecar ? "bootstrapping" : "unknown";
    sessionAvailability =
      hasProgressFields || hasRunnerSidecar ? "creating" : "unknown_legacy";
    if (
      job.reasonCode === "session_bootstrap_failed" ||
      job.reasonCode === "session_bootstrap_transient" ||
      job.blockedAtLayer === "session_bootstrap"
    ) {
      sessionAvailability =
        job.reasonCode === "session_bootstrap_failed" ? "failed" : "creating";
      agentExecutionState =
        job.reasonCode === "session_bootstrap_failed" ? "failed" : "bootstrapping";
    }
  } else if (
    job.phase === "checking" ||
    job.phase === "publishing" ||
    job.phase === "final_policy"
  ) {
    // Late phases without session evidence: do not claim active Session.
    agentExecutionState =
      hasProgressFields || hasRunnerSidecar ? "bootstrapping" : "unknown";
    sessionAvailability =
      hasProgressFields || hasRunnerSidecar ? "creating" : "unknown_legacy";
  } else if (
    job.phase === "planning" ||
    job.phase === "policy_check" ||
    job.phase === "accepted_waiting_automation" ||
    job.phase === "implementation_queued" ||
    job.checkpoint === "studio_task_ready" ||
    job.checkpoint === "policy_plan" ||
    job.checkpoint === "worktree_ready" ||
    runner?.checkpoint === "studio_task_ready" ||
    runner?.checkpoint === "planning" ||
    runner?.checkpoint === "policy_check"
  ) {
    // Policy/Studio gate before Session is a legitimate none.
    agentExecutionState =
      hasProgressFields || hasRunnerSidecar ? "not_started" : "unknown";
    sessionAvailability =
      hasProgressFields || hasRunnerSidecar ? "none" : "unknown_legacy";
  }

  let blockedAtLayer: GithubAutomationBlockedLayer | null = null;
  if (typeof job.blockedAtLayer === "string" && job.blockedAtLayer) {
    blockedAtLayer = job.blockedAtLayer as GithubAutomationBlockedLayer;
  } else if (job.status === "blocked" || job.phase === "blocked") {
    if (
      job.reasonCode === "session_bootstrap_failed" ||
      job.reasonCode === "session_bootstrap_transient" ||
      job.reasonCode === "blocked_session_binding"
    ) {
      blockedAtLayer = "session_bootstrap";
    } else if (job.reasonCode?.startsWith("blocked_")) {
      if (job.phase === "final_policy" || job.checkpoint === "final_policy") {
        blockedAtLayer = githubRiskPolicyStageToBlockedLayer("final");
      } else if (
        job.phase === "planning" ||
        job.phase === "policy_check" ||
        job.checkpoint === "studio_task_ready" ||
        job.checkpoint === "policy_plan" ||
        job.checkpoint === "blocked"
      ) {
        blockedAtLayer = githubRiskPolicyStageToBlockedLayer("plan");
      } else if (
        job.phase === "implementation_queued" ||
        job.checkpoint === "implementation_queued"
      ) {
        blockedAtLayer = githubRiskPolicyStageToBlockedLayer("pre");
      } else {
        blockedAtLayer = "unknown";
      }
    } else if (
      job.reasonCode === "runner_no_progress" ||
      job.reasonCode === "handler_not_ready"
    ) {
      blockedAtLayer = "scheduler";
    } else {
      blockedAtLayer = "unknown";
    }
  }

  const retryability: GithubAutomationRetryability =
    typeof job.retryability === "string" && job.retryability
      ? (job.retryability as GithubAutomationRetryability)
      : classifyGithubAutomationRetryability(job.reasonCode);

  const lastMeaningfulProgress: GithubAutomationSafeProgressSummary = {
    at:
      typeof job.lastMeaningfulProgressAt === "string"
        ? job.lastMeaningfulProgressAt
        : null,
    kind:
      typeof job.lastMeaningfulProgressKind === "string"
        ? (job.lastMeaningfulProgressKind as GithubAutomationSafeProgressSummary["kind"])
        : null,
  };

  const counts: GithubAutomationJobProgressCounts = {
    schedulerRuns:
      typeof job.attempt === "number" && Number.isFinite(job.attempt)
        ? Math.max(0, Math.floor(job.attempt))
        : 0,
    agentRuns,
    noProgressRuns:
      typeof job.noProgressRunCount === "number" &&
      Number.isFinite(job.noProgressRunCount)
        ? Math.max(0, Math.floor(job.noProgressRunCount))
        : 0,
    meaningfulProgress:
      typeof job.meaningfulProgressCount === "number" &&
      Number.isFinite(job.meaningfulProgressCount)
        ? Math.max(0, Math.floor(job.meaningfulProgressCount))
        : 0,
  };

  const workspaceLabel = buildGithubAutomationWorkspaceLabel({
    repositoryFullName: job.repositoryFullName,
    issueNumber: job.issueNumber,
    generation: job.generation,
    projectDisplayName: options.projectDisplayName ?? null,
    branchName: runner?.branchName ?? effectRemoteId(job, "branch"),
    hasWorktreeBinding: Boolean(
      runner?.branchName ||
        runner?.projectId ||
        runner?.spaceId ||
        runner?.worktreePath ||
        runner?.checkpoint === "worktree_ready" ||
        runner?.checkpoint === "studio_task_ready" ||
        runner?.checkpoint === "implementing" ||
        runner?.checkpoint === "awaiting_publish" ||
        runner?.checkpoint === "publishing" ||
        runner?.checkpoint === "pr_open",
    ),
  });

  let evaluatedProvenance: GithubAutomationEvaluatedProvenance | null = null;
  if (
    typeof job.evaluatedCodeRevision === "string" &&
    job.evaluatedCodeRevision.trim() &&
    typeof job.evaluatedPolicyVersion === "string" &&
    job.evaluatedPolicyVersion.trim()
  ) {
    evaluatedProvenance = {
      codeRevision: job.evaluatedCodeRevision.trim().slice(0, 120),
      policyVersion: job.evaluatedPolicyVersion.trim().slice(0, 64),
    };
  } else if (job.status === "blocked" || job.phase === "blocked") {
    // Legacy blocks: mark unknown rather than inventing current runtime.
    evaluatedProvenance = null;
  }

  return {
    schedulerState,
    agentExecutionState,
    sessionAvailability,
    blockedAtLayer,
    retryability,
    lastMeaningfulProgress,
    counts,
    workspaceLabel,
    sessionIdShort,
    evaluatedProvenance,
    terminalDisposition,
    terminalDispositionState: terminalRead.state,
  };
}

export function toGithubAutomationJobSafeProjection(
  job: GithubAutomationJobRecord,
  options?: {
    claimStatus?: GithubAutomationAssigneeClaimProjection;
    automationEnabled?: boolean;
    mode?: GithubAutomationMode;
    globalPaused?: boolean;
    runner?: GithubAutomationRunnerStateV1 | null;
    projectDisplayName?: string | null;
    /** When false, skip disk read of runner sidecar (tests may inject runner). */
    resolveRunner?: boolean;
  },
): GithubAutomationJobSafeProjection {
  const prRemote = effectRemoteId(job, "pull_request");
  const prNumber =
    prRemote && /^\d+$/.test(prRemote) ? Number.parseInt(prRemote, 10) : null;
  const headBranch = effectRemoteId(job, "branch");
  const claimStatus = options?.claimStatus ?? "unknown";
  const runner =
    options?.runner !== undefined
      ? options.runner
      : options?.resolveRunner === false
        ? null
        : readGithubAutomationRunnerState(job.jobId);
  const observability = deriveGithubAutomationJobObservabilityFromRecord(job, {
    runner,
    projectDisplayName: options?.projectDisplayName ?? null,
  });

  return {
    jobId: job.jobId,
    repositoryId: job.repositoryId,
    repositoryFullName: job.repositoryFullName,
    issueNumber: job.issueNumber,
    issueTitlePreview: job.issueTitlePreview,
    phase: job.phase,
    status: job.status,
    attempt: job.attempt,
    generation: job.generation,
    traceId: job.traceId,
    reasonCode: job.reasonCode,
    nextRetryAt: job.nextRetryAt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    checkpoint: job.checkpoint,
    claimStatus,
    prNumber: Number.isInteger(prNumber) ? prNumber : null,
    headBranch,
    hasPullRequest: prNumber !== null,
    actions: evaluateGithubAutomationJobActions(job, {
      automationEnabled: options?.automationEnabled,
      mode: options?.mode,
      globalPaused: options?.globalPaused,
      runtimeCodeRevision: getGithubAutomationRuntimeProvenance().codeRevision,
      runtimePolicyVersion: getGithubAutomationRuntimeProvenance().policyVersion,
    }),
    schedulerState: observability.schedulerState,
    agentExecutionState: observability.agentExecutionState,
    sessionAvailability: observability.sessionAvailability,
    blockedAtLayer: observability.blockedAtLayer,
    retryability: observability.retryability,
    lastMeaningfulProgress: observability.lastMeaningfulProgress,
    counts: observability.counts,
    workspaceLabel: observability.workspaceLabel,
    sessionIdShort: observability.sessionIdShort,
    evaluatedProvenance: observability.evaluatedProvenance,
    terminalDisposition: observability.terminalDisposition,
    terminalDispositionState: observability.terminalDispositionState,
  };
}

function countJobs(jobs: readonly GithubAutomationJobRecord[]): GithubAutomationRuntimeProjection["counts"] {
  const counts = {
    queued: 0,
    running: 0,
    retry: 0,
    blocked: 0,
    paused: 0,
    prOpen: 0,
    completed: 0,
  };
  for (const job of jobs) {
    if (job.status === "queued") counts.queued += 1;
    if (job.status === "running") counts.running += 1;
    if (job.status === "retry_due" || job.phase === "retry_due") counts.retry += 1;
    if (job.status === "blocked" || job.phase === "blocked" || job.phase === "blocked_claim_assignee") {
      counts.blocked += 1;
    }
    if (job.status === "paused" || job.phase === "paused") counts.paused += 1;
    if (job.phase === "pr_open") counts.prOpen += 1;
    if (job.status === "completed" || job.phase === "completed") counts.completed += 1;
  }
  return counts;
}

async function resolveClaimStatus(
  job: GithubAutomationJobRecord,
): Promise<GithubAutomationAssigneeClaimProjection> {
  const issue = await readGithubAutomationIssueState(
    job.repositoryId,
    job.issueNumber,
  );
  if (!issue?.claimStatus) {
    if (job.phase === "blocked_claim_assignee") return "blocked_claim_assignee";
    return "unknown";
  }
  if (issue.claimStatus === "complete") return "complete";
  if (issue.claimStatus === "blocked_claim_assignee") return "blocked_claim_assignee";
  return "incomplete";
}

// ─── Status builder ──────────────────────────────────────────────────────────

export interface BuildGithubAutomationStatusOptions {
  config?: GithubAutomationConfigV1;
  /**
   * When true (default), resolve live assignee/app readiness.
   * Tests may inject projections instead.
   */
  resolveLive?: boolean;
  assigneeProjection?: GithubMachineAssigneeSafeProjection;
  appProjection?: GithubAppCredentialSafeProjection;
  capability?: GithubAppCapabilitySnapshot | null;
  webhookHealth?: GithubAutomationWebhookHealthCode;
  webhookLastVerifiedAt?: string | null;
  jobs?: readonly GithubAutomationJobRecord[];
  /** Max jobs in projection (default 10). */
  jobLimit?: number;
}

export async function buildGithubAutomationStatusProjection(
  options: BuildGithubAutomationStatusOptions = {},
): Promise<GithubAutomationStatusProjection> {
  const config = options.config ?? (await readGithubAutomationConfig());
  const generatedAt = new Date().toISOString();
  const profile = toGithubFullAgentProfileSafeProjection();

  const app =
    options.appProjection ??
    (await getGithubAppCredentialSafeProjection());

  const assignee =
    options.assigneeProjection ??
    (await getMachineGithubAssigneeSafeProjection());

  let capability: GithubAppCapabilitySnapshot =
    options.capability ??
    deriveGithubAppCapability(emptyPermissionSnapshot());

  const installationIds = config.repositories
    .map((r) => r.installationId)
    .filter((id): id is number => typeof id === "number" && id > 0);
  const uniqueInstallationIds = [...new Set(installationIds)];

  if (options.capability === undefined && options.resolveLive !== false) {
    if (uniqueInstallationIds.length === 1 && app.configured) {
      try {
        capability = await getGithubInstallationCapability(uniqueInstallationIds[0]!);
      } catch (err) {
        // Readiness stays fail-closed without throwing the whole status page.
        if (isGithubAutomationError(err) && err.code === "installation_missing") {
          capability = deriveGithubAppCapability(emptyPermissionSnapshot());
        } else if (isGithubAutomationError(err) && err.code === "not_configured") {
          capability = deriveGithubAppCapability(emptyPermissionSnapshot());
        } else {
          capability = deriveGithubAppCapability(emptyPermissionSnapshot());
        }
      }
    }
  }

  const installationPresent = uniqueInstallationIds.length > 0;
  const installationReadiness: GithubAutomationReadinessProjection["installation"]["readiness"] =
    !installationPresent
      ? "missing"
      : uniqueInstallationIds.length === config.repositories.length
        ? "ready"
        : "partial";

  const jobs =
    options.jobs !== undefined
      ? [...options.jobs]
      : await listGithubAutomationJobs();
  jobs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const limit = Math.max(1, Math.min(options.jobLimit ?? 10, 50));
  const limitedJobs = jobs.slice(0, limit);

  const projectDisplayByRepoId = new Map<number, string>();
  for (const repo of config.repositories) {
    const shortName = repo.fullName.includes("/")
      ? repo.fullName.split("/").pop() ?? repo.fullName
      : repo.fullName;
    projectDisplayByRepoId.set(repo.repositoryId, shortName);
  }

  const jobProjections: GithubAutomationJobSafeProjection[] = [];
  for (const job of limitedJobs) {
    const claimStatus = await resolveClaimStatus(job);
    jobProjections.push(
      toGithubAutomationJobSafeProjection(job, {
        claimStatus,
        automationEnabled: config.enabled,
        mode: config.mode,
        globalPaused: config.paused,
        projectDisplayName:
          projectDisplayByRepoId.get(job.repositoryId) ?? null,
      }),
    );
  }

  const runtimeProvenance = getGithubAutomationRuntimeProvenance();

  const capabilityBlockers: string[] = [];
  if (!app.configured) capabilityBlockers.push("app_not_configured");
  if (!installationPresent) capabilityBlockers.push("installation_missing");
  if (!capability.p0Triage) capabilityBlockers.push("p0_permissions_missing");
  if (!capability.p1Unattended) capabilityBlockers.push("p1_permissions_missing");
  if (assignee.readiness !== "ready") capabilityBlockers.push("assignee_not_ready");
  if (!config.unattended.enabled) capabilityBlockers.push("unattended_disabled");
  if (config.mode !== "unattended") capabilityBlockers.push("mode_not_unattended");

  const repositories: GithubAutomationRepositoryStatusProjection[] = config.repositories.map(
    (repo) => {
      const base = toGithubAutomationRepositorySafeProjection(repo);
      // Prefer short GitHub name as a safe display label; absolute paths stay off-wire.
      const shortName = repo.fullName.includes("/")
        ? repo.fullName.split("/").pop() ?? repo.fullName
        : repo.fullName;
      return {
        ...base,
        installationBound: repo.installationId !== null,
        baseRef: repo.baseRef,
        assignee,
        claimSemantics: "ypi_claimed_plus_machine_login" as const,
        projectDisplayName: shortName,
      };
    },
  );

  const configProjection = toGithubAutomationConfigSafeProjection(config);

  return {
    revision: config.revision,
    generatedAt,
    readiness: {
      app,
      installation: {
        present: installationPresent,
        installationIdCount: uniqueInstallationIds.length,
        readiness: installationReadiness,
      },
      permissions: {
        p0Triage: capability.p0Triage,
        p1Unattended: capability.p1Unattended,
        missingForP0: capability.missingForP0,
        missingForP1: capability.missingForP1,
        snapshot: capability.permissions,
      },
      assignee,
      webhook: {
        health: options.webhookHealth ?? "unknown",
        lastVerifiedAt: options.webhookLastVerifiedAt ?? null,
      },
      allowlist: {
        repositoryCount: config.repositories.length,
        ready: config.repositories.length > 0,
      },
    },
    runtime: {
      enabled: config.enabled,
      mode: config.mode,
      paused: config.paused,
      executionProfile: "full-agent",
      riskProfile: "docs-and-small-bugfix",
      residualRiskWarningRequired: true,
      residualRiskCodes: profile.residualRiskCodes,
      residualRiskSummary: profile.residualRiskSummary,
      counts: countJobs(jobs),
    },
    repositories,
    policy: {
      policyId: GITHUB_UNATTENDED_POLICY_ID,
      policyVersion: GITHUB_UNATTENDED_POLICY_VERSION,
      riskProfile: "docs-and-small-bugfix",
      executionProfile: "full-agent",
      unattendedEnabled: config.unattended.enabled,
      maxConcurrency: config.unattended.maxConcurrency,
      maxFiles: config.unattended.maxFiles,
      maxChangedLines: config.unattended.maxChangedLines,
      validationCommandCount: config.unattended.validationCommands.length,
      residualRiskWarningRequired: true,
      residualRiskCodes: profile.residualRiskCodes,
      residualRiskSummary: profile.residualRiskSummary,
      recommendedDeployment: profile.recommendedDeployment,
      sandboxed: false,
      alwaysManual: [
        "ui",
        "workflow",
        "release",
        "secret_auth",
        "dependency_lockfile",
        "large_refactor_or_over_limit_diff",
      ],
      capabilityBlockers,
    },
    jobs: jobProjections,
    config: configProjection,
    runtimeProvenance,
  };
}

/**
 * Recursively assert a projection has no forbidden keys / secret-like strings.
 * Throws GithubAutomationError(invalid_config) on violation (tests / preflight).
 */
export function assertGithubAutomationProjectionSafe(
  value: unknown,
  path = "root",
): void {
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    if (
      /-----BEGIN[ A-Z0-9]*PRIVATE KEY-----/i.test(value) ||
      /\b(gho|ghu|ghs|ghp|github_pat)_[A-Za-z0-9_]{8,}/.test(value) ||
      /x-hub-signature-256/i.test(value)
    ) {
      throw new GithubAutomationError(
        "invalid_config",
        "Projection contained secret-like material",
        { status: 500, details: { path } },
      );
    }
    // Absolute local paths (Unix/mac) — projectRoot must never leak.
    if (value.startsWith("/Users/") || value.startsWith("/home/") || value.startsWith("/var/folders/")) {
      throw new GithubAutomationError(
        "invalid_config",
        "Projection contained absolute path",
        { status: 500, details: { path } },
      );
    }
    return;
  }
  if (typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertGithubAutomationProjectionSafe(item, `${path}[${i}]`));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    // Explicit safe boolean / checklist code names pass even when they contain
    // forbidden substrings (hasPrivateKey, hasWebhookSecret, private_key_file).
    if (GITHUB_AUTOMATION_PROJECTION_SAFE_KEY_ALLOWLIST.has(lower)) {
      assertGithubAutomationProjectionSafe(child, `${path}.${key}`);
      continue;
    }
    for (const forbidden of GITHUB_AUTOMATION_PROJECTION_FORBIDDEN_KEYS) {
      if (lower === forbidden.toLowerCase() || lower.includes(forbidden.toLowerCase())) {
        // Allow safe nested field names that are not secret containers:
        // e.g. hasInstallationId, residualRiskSummary — only exact-ish matches for body/token.
        if (
          forbidden === "body" &&
          (lower === "nobody" || lower.endsWith("body") === false)
        ) {
          // continue checks below
        }
        if (
          lower === "body" ||
          lower === "token" ||
          lower === "password" ||
          lower === "prompt" ||
          lower === "transcript" ||
          lower === "projectroot" ||
          lower === "worktreepath" ||
          lower === "sessionfile" ||
          lower === "sessionpath" ||
          lower === "rawbody" ||
          lower === "webhooksecret" ||
          lower === "privatekey" ||
          lower === "privatekeypem" ||
          lower === "private_key_pem" ||
          lower === "privatekeyfile" ||
          lower === "keyfile" ||
          lower === "keysha256" ||
          lower === "fingerprint" ||
          lower === "appidvalue" ||
          lower === "installationtoken" ||
          lower === "appjwt" ||
          lower === "authorization" ||
          lower === "signature" ||
          lower === "credential" ||
          lower === "issuebody" ||
          lower === "commentbody"
        ) {
          throw new GithubAutomationError(
            "invalid_config",
            "Projection contained forbidden field",
            { status: 500, details: { path: `${path}.${key}` } },
          );
        }
      }
    }
    assertGithubAutomationProjectionSafe(child, `${path}.${key}`);
  }
}

// ─── Config patch allowlist ──────────────────────────────────────────────────

export interface GithubAutomationConfigWirePatch {
  revision: string;
  enabled?: boolean;
  mode?: GithubAutomationMode;
  paused?: boolean;
  /**
   * Full allowlist replacement drafts when provided.
   * Server resolves projectId → projectRoot and cross-checks GitHub identity.
   * Never contains absolute projectRoot.
   */
  repositories?: GithubAutomationRepositoryWireDraft[];
  unattended?: {
    enabled?: boolean;
    maxConcurrency?: number;
    maxFiles?: number;
    maxChangedLines?: number;
  };
}

/**
 * Parse a browser/API config patch. Rejects credential source overrides,
 * residual-risk disable, absolute path injection, and unknown secret fields.
 * Repository drafts are shape-validated only — identity/project binding happens
 * in applyGithubAutomationConfigWirePatch (server-side).
 */
export function parseGithubAutomationConfigWirePatch(
  body: unknown,
): GithubAutomationConfigWirePatch {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new GithubAutomationError("invalid_config", "Config patch must be an object", {
      status: 400,
    });
  }
  const rec = body as Record<string, unknown>;

  // Hard reject forbidden keys at top level.
  for (const key of Object.keys(rec)) {
    const lower = key.toLowerCase();
    if (
      lower.includes("token") ||
      lower.includes("secret") ||
      lower.includes("private") ||
      lower.includes("password") ||
      lower.includes("credential") ||
      lower === "projectroot" ||
      lower === "assigneeidentitysource" ||
      lower === "residualriskwarningrequired" ||
      lower === "executionprofile" ||
      lower === "riskprofile" ||
      lower === "validationcommands" ||
      lower === "jobsfordeletegate" ||
      lower === "enforcedeletegate" ||
      lower === "skipnetworklookup"
    ) {
      throw new GithubAutomationError(
        "invalid_config",
        "Config patch contains disallowed field",
        { status: 400, details: { field: key } },
      );
    }
  }

  if (typeof rec.revision !== "string" || !rec.revision.trim()) {
    throw new GithubAutomationError("invalid_config", "revision is required", {
      status: 400,
    });
  }

  const patch: GithubAutomationConfigWirePatch = {
    revision: rec.revision.trim(),
  };

  if (rec.enabled !== undefined) {
    if (typeof rec.enabled !== "boolean") {
      throw new GithubAutomationError("invalid_config", "enabled must be boolean", {
        status: 400,
      });
    }
    patch.enabled = rec.enabled;
  }

  if (rec.mode !== undefined) {
    if (rec.mode !== "off" && rec.mode !== "triage" && rec.mode !== "unattended") {
      throw new GithubAutomationError("invalid_config", "mode is invalid", {
        status: 400,
      });
    }
    patch.mode = rec.mode;
  }

  if (rec.paused !== undefined) {
    if (typeof rec.paused !== "boolean") {
      throw new GithubAutomationError("invalid_config", "paused must be boolean", {
        status: 400,
      });
    }
    patch.paused = rec.paused;
  }

  if (rec.repositories !== undefined) {
    // Full-list replacement; empty array clears the allowlist (when no active jobs).
    patch.repositories = parseGithubAutomationRepositoryWireDraftList(
      rec.repositories,
    );
  }

  if (rec.unattended !== undefined) {
    if (!rec.unattended || typeof rec.unattended !== "object" || Array.isArray(rec.unattended)) {
      throw new GithubAutomationError("invalid_config", "unattended must be an object", {
        status: 400,
      });
    }
    const u = rec.unattended as Record<string, unknown>;
    for (const key of Object.keys(u)) {
      const lower = key.toLowerCase();
      if (
        lower === "executionprofile" ||
        lower === "riskprofile" ||
        lower.includes("token") ||
        lower.includes("secret") ||
        lower === "validationcommands"
      ) {
        // validationCommands are operator-owned on server; not editable from wire in P2.
        throw new GithubAutomationError(
          "invalid_config",
          "unattended patch contains disallowed field",
          { status: 400, details: { field: key } },
        );
      }
    }
    const unattended: NonNullable<GithubAutomationConfigWirePatch["unattended"]> = {};
    if (u.enabled !== undefined) {
      if (typeof u.enabled !== "boolean") {
        throw new GithubAutomationError("invalid_config", "unattended.enabled must be boolean", {
          status: 400,
        });
      }
      unattended.enabled = u.enabled;
    }
    if (u.maxConcurrency !== undefined) {
      if (typeof u.maxConcurrency !== "number" || !Number.isInteger(u.maxConcurrency) || u.maxConcurrency < 1 || u.maxConcurrency > 4) {
        throw new GithubAutomationError("invalid_config", "unattended.maxConcurrency invalid", {
          status: 400,
        });
      }
      unattended.maxConcurrency = u.maxConcurrency;
    }
    if (u.maxFiles !== undefined) {
      if (typeof u.maxFiles !== "number" || !Number.isInteger(u.maxFiles) || u.maxFiles < 1 || u.maxFiles > 200) {
        throw new GithubAutomationError("invalid_config", "unattended.maxFiles invalid", {
          status: 400,
        });
      }
      unattended.maxFiles = u.maxFiles;
    }
    if (u.maxChangedLines !== undefined) {
      if (
        typeof u.maxChangedLines !== "number" ||
        !Number.isInteger(u.maxChangedLines) ||
        u.maxChangedLines < 1 ||
        u.maxChangedLines > 20_000
      ) {
        throw new GithubAutomationError(
          "invalid_config",
          "unattended.maxChangedLines invalid",
          { status: 400 },
        );
      }
      unattended.maxChangedLines = u.maxChangedLines;
    }
    patch.unattended = unattended;
  }

  // Residual risk is never configurable — enforce invariant on response side.
  void GITHUB_FULL_AGENT_PROFILE.residualRiskCodes;

  return patch;
}

export interface ApplyGithubAutomationConfigWirePatchOptions {
  /** Tests only: skip fixed-host GitHub repository lookup. */
  skipNetworkLookup?: boolean;
  /** Tests only: inject jobs for the delete gate. */
  jobsForDeleteGate?: readonly GithubAutomationJobRecord[];
  /** Abort signal for GitHub lookups. */
  signal?: AbortSignal;
  /** When false, allow repositories without projectId (tests/legacy). Default true. */
  requireProjectId?: boolean;
}

/**
 * Apply a browser wire patch end-to-end:
 * parse → GitHub identity cross-check → Project Registry bind → CAS write → safe projection.
 * Never enqueues jobs or wakes the scheduler.
 */
export async function applyGithubAutomationConfigWirePatch(
  body: unknown,
  options: ApplyGithubAutomationConfigWirePatchOptions = {},
): Promise<{
  config: GithubAutomationConfigV1;
  projection: GithubAutomationConfigSafeProjection;
}> {
  const wirePatch = parseGithubAutomationConfigWirePatch(body);
  const current = await readGithubAutomationConfig();

  // CAS is enforced inside patchGithubAutomationConfig; resolve drafts first so
  // expensive network/project work still fails closed on stale revision before write.
  if (wirePatch.revision !== current.revision) {
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

  let repositories: GithubAutomationConfigV1["repositories"] | undefined;
  if (wirePatch.repositories !== undefined) {
    repositories = await resolveGithubAutomationRepositoryWireDrafts(
      wirePatch.repositories,
      current,
      {
        signal: options.signal,
        skipNetworkLookup: options.skipNetworkLookup,
        requireProjectId: options.requireProjectId,
      },
    );
  }

  const updated = await patchGithubAutomationConfig({
    revision: wirePatch.revision,
    enabled: wirePatch.enabled,
    mode: wirePatch.mode,
    paused: wirePatch.paused,
    repositories,
    unattended: wirePatch.unattended
      ? {
          enabled: wirePatch.unattended.enabled,
          maxConcurrency: wirePatch.unattended.maxConcurrency,
          maxFiles: wirePatch.unattended.maxFiles,
          maxChangedLines: wirePatch.unattended.maxChangedLines,
          executionProfile: "full-agent",
          riskProfile: "docs-and-small-bugfix",
        }
      : undefined,
    enforceDeleteGate: true,
    jobsForDeleteGate: options.jobsForDeleteGate,
  });

  const projection = toGithubAutomationConfigSafeProjection(updated);
  assertGithubAutomationProjectionSafe(projection);
  return { config: updated, projection };
}

/** Safe GET payload extras for Settings (project choices, no absolute paths). */
export async function buildGithubAutomationConfigGetPayload(): Promise<{
  config: GithubAutomationConfigSafeProjection;
  projectChoices: GithubAutomationProjectChoiceSafeProjection[];
}> {
  const config = await readGithubAutomationConfig();
  const projection = toGithubAutomationConfigSafeProjection(config);
  assertGithubAutomationProjectionSafe(projection);
  const projectChoices = await listGithubAutomationProjectChoices();
  assertGithubAutomationProjectionSafe(projectChoices);
  return { config: projection, projectChoices };
}

// ─── Job actions ─────────────────────────────────────────────────────────────

export type GithubAutomationJobActionResultCode =
  | "accepted"
  | "not_found"
  | "not_allowed"
  | "rate_limited"
  | "conflict";

export interface GithubAutomationJobActionResult {
  ok: boolean;
  code: GithubAutomationJobActionResultCode;
  message: string;
  job: GithubAutomationJobSafeProjection | null;
  /** Action was recorded; client may need to refresh for full phase truth. */
  partial: boolean;
}

const actionRateWindow = new Map<string, number[]>();
const ACTION_RATE_LIMIT = 20;
const ACTION_RATE_WINDOW_MS = 60_000;

function checkActionRateLimit(jobId: string, action: string): boolean {
  const key = `${jobId}:${action}`;
  const now = Date.now();
  const window = (actionRateWindow.get(key) ?? []).filter(
    (t) => now - t < ACTION_RATE_WINDOW_MS,
  );
  if (window.length >= ACTION_RATE_LIMIT) {
    actionRateWindow.set(key, window);
    return false;
  }
  window.push(now);
  actionRateWindow.set(key, window);
  return true;
}

/** Test helper. */
export function _testResetGithubAutomationActionRateLimit(): void {
  actionRateWindow.clear();
}

export async function applyGithubAutomationJobAction(options: {
  jobId: string;
  action: GithubAutomationJobActionName;
  config?: GithubAutomationConfigV1;
  /** When true (default for pause/resume/retry), wake scheduler after state change. */
  wakeScheduler?: boolean;
}): Promise<GithubAutomationJobActionResult> {
  const config = options.config ?? (await readGithubAutomationConfig());
  const job = await readGithubAutomationJob(options.jobId);
  if (!job) {
    return {
      ok: false,
      code: "not_found",
      message: "Job not found",
      job: null,
      partial: false,
    };
  }

  if (!checkActionRateLimit(job.jobId, options.action)) {
    return {
      ok: false,
      code: "rate_limited",
      message: "Job action rate limited",
      job: toGithubAutomationJobSafeProjection(job, {
        automationEnabled: config.enabled,
        mode: config.mode,
        globalPaused: config.paused,
      }),
      partial: false,
    };
  }

  // GHA-CLOSE-05: normalize legacy command/space/checkpoint before action gates.
  // Reconcile is idempotent and never creates generation / skips policy.
  let working = job;
  try {
    const reconciled = await reconcileGithubAutomationLegacyJob({
      jobId: job.jobId,
      config,
    });
    if (reconciled.job) {
      working = reconciled.job;
    }
  } catch {
    // Best-effort; action gate still uses on-disk job.
  }

  const runtime = getGithubAutomationRuntimeProvenance();
  const actions = evaluateGithubAutomationJobActions(working, {
    automationEnabled: config.enabled,
    mode: config.mode,
    globalPaused: config.paused,
    runtimeCodeRevision: runtime.codeRevision,
    runtimePolicyVersion: runtime.policyVersion,
  });
  const gate = actions.find((a) => a.action === options.action);
  if (!gate?.available) {
    return {
      ok: false,
      code: "not_allowed",
      message: gate?.reasonCode
        ? `Action not allowed: ${gate.reasonCode}`
        : "Action not allowed",
      job: toGithubAutomationJobSafeProjection(working, {
        claimStatus: await resolveClaimStatus(working),
        automationEnabled: config.enabled,
        mode: config.mode,
        globalPaused: config.paused,
      }),
      partial: false,
    };
  }

  let next = working;
  if (options.action === "pause") {
    // Prefer runner pause flag when unattended state exists; always mark durable job paused.
    await requestGithubUnattendedJobPause(working.jobId);
    next = await writeGithubAutomationJob({
      ...working,
      status: working.status === "running" ? "running" : "paused",
      // Running jobs keep running until checkpoint; queued/retry park immediately.
      phase: working.status === "running" ? working.phase : "paused",
      reasonCode: working.status === "running" ? "pause_requested" : "paused",
      // Preserve generation + attempt audit.
      attempt: working.attempt,
      generation: working.generation,
      updatedAt: new Date().toISOString(),
    });
    if (working.status !== "running") {
      next = await writeGithubAutomationJob({
        ...next,
        status: "paused",
        phase: "paused",
      });
    }
  } else if (options.action === "resume" || options.action === "retry") {
    // GHR-01: ensure full triage/unattended handler is registry-ready BEFORE
    // queue mutation + scheduler wake. Cold process without a webhook must still
    // register the complete handler; readiness failure is visible, not silent.
    // Explicit isolation tests may disable production readiness (default handler);
    // those paths skip the gate so GHA-02/GHA-09 fixtures keep working.
    if (!isGithubAutomationProductionHandlerReadinessDisabled()) {
      const readiness = await ensureGithubAutomationJobHandlerReady();
      if (readiness.kind === "not_ready") {
        const now = new Date().toISOString();
        next = await writeGithubAutomationJob({
          ...working,
          status: "retry_due",
          reasonCode: "handler_not_ready",
          blockedAtLayer: "scheduler",
          retryability:
            readiness.retryability === "operator" ? "operator" : "automatic",
          nextRetryAt: new Date(Date.now() + 5_000).toISOString(),
          // Preserve generation + attempt audit; no lease was taken.
          attempt: working.attempt,
          generation: working.generation,
          updatedAt: now,
        });
        try {
          const {
            buildGithubAutomationHandlerNotReadyEventMeta,
            shouldEmitGithubAutomationHandlerNotReadyEvent,
          } = await import("./github-automation-handler-runtime");
          if (shouldEmitGithubAutomationHandlerNotReadyEvent(readiness)) {
            await appendGithubAutomationSafeEvent({
              at: now,
              kind: "github_automation_handler_not_ready",
              repositoryId: next.repositoryId,
              issueNumber: next.issueNumber,
              jobId: next.jobId,
              deliveryId: next.deliveryId,
              phase: next.phase,
              reasonCode: "handler_not_ready",
              traceId: next.traceId,
              meta: buildGithubAutomationHandlerNotReadyEventMeta(readiness),
            });
          }
        } catch {
          // Best-effort safe event; job reason is already durable.
        }
        // Still wake so tick can re-check readiness with backoff; tick will not
        // take a business lease while not ready.
        if (options.wakeScheduler !== false) {
          wakeGithubAutomationScheduler();
        }
        const claimStatusNotReady = await resolveClaimStatus(next);
        return {
          ok: true,
          code: "accepted",
          message:
            "Retry/resume accepted but handler runtime is not ready; job parked as handler_not_ready without a lease run",
          job: toGithubAutomationJobSafeProjection(next, {
            claimStatus: claimStatusNotReady,
            automationEnabled: config.enabled,
            mode: config.mode,
            globalPaused: config.paused,
          }),
          partial: true,
        };
      }
    }

    next = await wakeGithubUnattendedJobForRetry({
      job: working,
      clearPause: true,
      config,
    });
    // wakeGithubUnattendedJobForRetry no-ops runner state when absent; ensure durable queued.
    if (next.status !== "queued") {
      next = await writeGithubAutomationJob({
        ...next,
        status: "queued",
        reasonCode: options.action === "resume" ? "resume_wake" : "retry_wake",
        nextRetryAt: null,
        attempt: next.attempt,
        generation: next.generation,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  if (options.wakeScheduler !== false) {
    // Job actions may wake; pure status/config GET must not call this.
    wakeGithubAutomationScheduler();
  }

  const claimStatus = await resolveClaimStatus(next);
  return {
    ok: true,
    code: "accepted",
    message:
      options.action === "pause"
        ? "Pause recorded; in-flight Git commands are not force-killed"
        : options.action === "resume"
          ? "Resume accepted; job re-queued at next safe checkpoint"
          : "Retry accepted; legacy state reconciled and job re-queued at last safe checkpoint (same generation)",
    job: toGithubAutomationJobSafeProjection(next, {
      claimStatus,
      automationEnabled: config.enabled,
      mode: config.mode,
      globalPaused: config.paused,
    }),
    partial: true,
  };
}

export function safeGithubAutomationActionErrorMessage(err: unknown): string {
  return safeGithubAutomationErrorMessage(err, "Internal GitHub automation error");
}

/** Expose runner pause flag for tests. */
export function _testReadRunnerPauseFlag(jobId: string): boolean | null {
  const state = readGithubAutomationRunnerState(jobId);
  return state ? state.pauseRequested : null;
}
