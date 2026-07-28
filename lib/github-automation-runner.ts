/**
 * github-automation-runner — durable P1 orchestration after owner adoption (GHA-06).
 *
 * Pipeline (under job lease, checkpointed):
 *   accepted_waiting_automation | implementation_queued
 *     → gates: mode unattended + enabled, complete claim, allowlist, not paused
 *     → WorkTree (config + Project Registry only)
 *     → Studio github_unattended task + ownerAuthorization + policyGrant
 *     → planning / policy_check / implementing (full agent) checkpoints
 *     → pause honored at checkpoints; comment retry only wakes the durable job
 *
 * GHA-07 publish path (server-only, after awaiting_publish):
 * - Final diff policy (docs + small-bugfix) + checker + operator validation
 * - Server App commit/push/PR via github-git-publisher (agent cannot call it)
 * - Exactly one same-repo Fixes #N PR; no merge / no Issue close
 *
 * Explicit non-goals for this module:
 * - Restricted-runtime launch gate (rejected product decision)
 * - Claiming host filesystem/network isolation
 * - Auto-merge / force push / main direct push
 *
 * Secrets:
 * - Never deliberately inject App private key/JWT/token, webhook secret, or
 *   machine personal credential into prompt/task/session/child env.
 * - Publisher capability stays server-only (not exposed to agent).
 *
 * Residual risk (not a sandbox):
 * Full agent may run arbitrary commands, use the network, read same-OS-user
 * files outside the WorkTree, and produce non-Git side effects before any final
 * diff gate. Owner-only, WorkTree, and diff gates are business/publish guards
 * only — they do not provide host isolation.
 */

import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { findRepositoryConfigById } from "./github-automation-config";
import {
  GithubAutomationError,
  isGithubAutomationError,
  safeGithubAutomationErrorMessage,
} from "./github-automation-errors";
import {
  appendGithubAutomationSafeEvent,
  getGithubAutomationJobsDir,
  readGithubAutomationIssueState,
  upsertEffectMarker,
  upsertGithubAutomationIssueState,
  writeGithubAutomationJob,
  type GithubAutomationJobRecord,
} from "./github-automation-store";
import type { GithubAutomationJobHandlerResult } from "./github-automation-scheduler";
import type {
  GithubAutomationBlockedLayer,
  GithubAutomationConfigV1,
  GithubAutomationJobDisposition,
  GithubAutomationRepositoryConfig,
  GithubAutomationRetryability,
} from "./github-automation-types";
import {
  buildGithubAutomationBlockFingerprint,
  classifyGithubAutomationRetryability,
} from "./github-automation-types";
/** Opaque short session id for safe events — never paths / sessionFile. */
function toSafeSessionIdShort(sessionId: string | null | undefined): string | null {
  if (typeof sessionId !== "string") return null;
  const trimmed = sessionId.trim();
  if (!trimmed) return null;
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
import {
  GITHUB_FULL_AGENT_PROFILE,
  containsGithubAutomationSecretInjectionMarker,
} from "./github-full-agent-profile";
import {
  ensureGithubAutomationWorktree,
  resolveGithubAutomationProjectRoot,
  resolveGithubAutomationWorktreeSpaceId,
  assertWorktreeNotControlledByIssue,
} from "./github-automation-worktree";
import { getGithubAutomationEvaluatedProvenance } from "./github-automation-provenance";
import {
  ensureGithubUnattendedStudioTask,
  transitionGithubUnattendedTaskToImplementing,
  bootstrapGithubAutomationAgentSession,
  buildGithubFullAgentPromptEnvelope,
  runGithubFullAgentMember,
  reconcileGithubAutomationRuntimeLostRuns,
  hashGithubOwnerCommentForAuthorization,
  buildGithubUnattendedPolicyHash,
  type GithubOwnerAuthorizationSeed,
} from "./github-automation-session";
import {
  assertValidationCommandsNotFromIssue,
  runGithubValidationBroker,
} from "./github-validation-broker";
import {
  assertDiffArgsNotFromIssue,
  evaluateGithubDiffPolicy,
  isGithubFinalDiffAllowed,
} from "./github-diff-policy";
import { publishGithubAutomationChange } from "./github-git-publisher";
import {
  evaluateYpiStudioUnattendedImplementationAuthorization,
  getYpiStudioTaskDetail,
  recordYpiStudioUnattendedCompletionEvidence,
} from "./ypi-studio-tasks";

// ─── Durable runner checkpoint payload (job-sidecar, non-secret) ─────────────

export type GithubAutomationRunnerCheckpoint =
  | "implementation_queued"
  | "worktree_ready"
  | "studio_task_ready"
  | "planning"
  | "policy_check"
  | "implementing"
  | "checking"
  | "awaiting_publish"
  | "publishing"
  | "pr_open"
  | "paused"
  | "blocked";

export interface GithubAutomationRunnerStateV1 {
  schemaVersion: 1;
  jobId: string;
  repositoryId: number;
  issueNumber: number;
  generation: number;
  checkpoint: GithubAutomationRunnerCheckpoint;
  worktreePath: string | null;
  branchName: string | null;
  baseRef: string | null;
  projectId: string | null;
  /**
   * Additive WorkTree space binding (wt_…). Required with projectId for parent
   * Session bootstrap. Legacy sidecars may omit it; runner re-resolves on read.
   */
  spaceId?: string | null;
  taskId: string | null;
  sessionId: string | null;
  contextId: string | null;
  sessionFile: string | null;
  scopeFingerprint: string | null;
  ownerActorId: number | null;
  ownerCommentId: number | null;
  ownerCommentHash: string | null;
  lastMember: string | null;
  lastRunId: string | null;
  pauseRequested: boolean;
  updatedAt: string;
  /** Safe reason only. */
  reasonCode: string | null;
}

function runnerStatePath(jobId: string): string {
  // Keep beside jobs; never store secrets here.
  return join(getGithubAutomationJobsDir(), `${jobId}.runner.json`);
}

export function readGithubAutomationRunnerState(
  jobId: string,
): GithubAutomationRunnerStateV1 | null {
  const path = runnerStatePath(jobId);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as GithubAutomationRunnerStateV1;
    if (!raw || raw.schemaVersion !== 1 || raw.jobId !== jobId) return null;
    // Refuse to load if secret markers ever appear (corruption / bug).
    if (containsGithubAutomationSecretInjectionMarker(raw)) return null;
    return raw;
  } catch {
    return null;
  }
}

export function writeGithubAutomationRunnerState(
  state: GithubAutomationRunnerStateV1,
): GithubAutomationRunnerStateV1 {
  const next: GithubAutomationRunnerStateV1 = {
    ...state,
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
  };
  if (containsGithubAutomationSecretInjectionMarker(next)) {
    throw new Error("Refusing to persist runner state containing secret markers");
  }
  const path = runnerStatePath(next.jobId);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, path);
  return next;
}

function emptyRunnerState(job: GithubAutomationJobRecord): GithubAutomationRunnerStateV1 {
  return {
    schemaVersion: 1,
    jobId: job.jobId,
    repositoryId: job.repositoryId,
    issueNumber: job.issueNumber,
    generation: job.generation,
    checkpoint: "implementation_queued",
    worktreePath: null,
    branchName: null,
    baseRef: null,
    projectId: null,
    spaceId: null,
    taskId: null,
    sessionId: null,
    contextId: null,
    sessionFile: null,
    scopeFingerprint: null,
    ownerActorId: null,
    ownerCommentId: null,
    ownerCommentHash: null,
    lastMember: null,
    lastRunId: null,
    pauseRequested: false,
    updatedAt: new Date().toISOString(),
    reasonCode: null,
  };
}

// ─── Global unattended concurrency (process-local + generation) ──────────────

declare global {
  var __piGithubUnattendedInFlight: Set<string> | undefined;
}

function unattendedInFlight(): Set<string> {
  if (!globalThis.__piGithubUnattendedInFlight) {
    globalThis.__piGithubUnattendedInFlight = new Set();
  }
  return globalThis.__piGithubUnattendedInFlight;
}

export function _testResetGithubUnattendedInFlight(): void {
  unattendedInFlight().clear();
}

// ─── Gate helpers ────────────────────────────────────────────────────────────

export interface GithubUnattendedStartGateResult {
  ok: boolean;
  reasonCode: string | null;
  repository: GithubAutomationRepositoryConfig | null;
}

/**
 * Pre-start gates: owner path already authorized; still re-check config + claim.
 * Does not start full agent when any gate fails.
 */
export async function evaluateGithubUnattendedStartGates(input: {
  job: GithubAutomationJobRecord;
  config: GithubAutomationConfigV1;
  claimComplete: boolean;
}): Promise<GithubUnattendedStartGateResult> {
  const { job, config, claimComplete } = input;

  if (!config.enabled) {
    return { ok: false, reasonCode: "automation_disabled", repository: null };
  }
  if (config.paused) {
    return { ok: false, reasonCode: "automation_paused", repository: null };
  }
  if (config.mode !== "unattended") {
    return { ok: false, reasonCode: "mode_not_unattended", repository: null };
  }
  if (!config.unattended.enabled) {
    return { ok: false, reasonCode: "unattended_disabled", repository: null };
  }
  if (config.unattended.executionProfile !== "full-agent") {
    return { ok: false, reasonCode: "execution_profile_unsupported", repository: null };
  }
  if (config.unattended.riskProfile !== "docs-and-small-bugfix") {
    return { ok: false, reasonCode: "risk_profile_unsupported", repository: null };
  }
  if (!claimComplete) {
    return { ok: false, reasonCode: "incomplete_claim", repository: null };
  }

  const repository = findRepositoryConfigById(config, job.repositoryId);
  if (!repository) {
    return { ok: false, reasonCode: "repository_not_allowlisted", repository: null };
  }
  if (!repository.projectRoot?.trim()) {
    return { ok: false, reasonCode: "project_root_missing", repository: null };
  }

  // Global concurrency = 1 for P1 unattended.
  const inflight = unattendedInFlight();
  if (
    config.unattended.maxConcurrency <= 1 &&
    inflight.size > 0 &&
    !inflight.has(job.jobId)
  ) {
    return { ok: false, reasonCode: "unattended_concurrency_limit", repository };
  }

  return { ok: true, reasonCode: null, repository };
}

// ─── Persist helpers ─────────────────────────────────────────────────────────

async function persistJob(
  job: GithubAutomationJobRecord,
): Promise<GithubAutomationJobRecord> {
  let next: GithubAutomationJobRecord = {
    ...job,
    updatedAt: new Date().toISOString(),
  };
  // Stamp evaluated build/policy provenance on newly entered blocks (GHA-CLOSE-04).
  // Additive only; never overwrite an existing stamp (legacy / re-persist).
  if (
    (next.status === "blocked" || next.phase === "blocked") &&
    (!next.evaluatedCodeRevision || !next.evaluatedPolicyVersion)
  ) {
    try {
      const { getGithubAutomationEvaluatedProvenance } = await import(
        "./github-automation-provenance"
      );
      const evaluated = getGithubAutomationEvaluatedProvenance();
      next = {
        ...next,
        evaluatedCodeRevision:
          next.evaluatedCodeRevision ?? evaluated.codeRevision,
        evaluatedPolicyVersion:
          next.evaluatedPolicyVersion ?? evaluated.policyVersion,
      };
    } catch {
      // Provenance is best-effort; blocking must still persist.
    }
  }
  await writeGithubAutomationJob(next);
  return next;
}

function effectRemoteId(pathOrId: string | null | undefined): string | null {
  if (!pathOrId) return null;
  // Store basename only — never absolute paths in effect markers projected later.
  const parts = pathOrId.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || pathOrId.slice(0, 80);
}

/** Explicit blocked disposition so scheduler cannot fold into runner_no_progress. */
function blockedDisposition(input: {
  reasonCode: string;
  layer: GithubAutomationBlockedLayer;
  checkpoint?: string | null;
  retryability?: GithubAutomationRetryability;
}): GithubAutomationJobDisposition {
  const retryability =
    input.retryability ?? classifyGithubAutomationRetryability(input.reasonCode);
  return {
    kind: "blocked",
    reasonCode: input.reasonCode,
    layer: input.layer,
    fingerprint: buildGithubAutomationBlockFingerprint({
      layer: input.layer,
      reasonCode: input.reasonCode,
      checkpoint: input.checkpoint ?? "blocked",
    }),
    retryability,
  };
}

/** Explicit retry_due disposition preserving the real reasonCode. */
function retryDueDisposition(input: {
  reasonCode: string;
  nextRetryAt: string;
  retryClass?: "infra" | "runtime" | "network" | "session" | "unknown";
}): GithubAutomationJobDisposition {
  return {
    kind: "retry_due",
    reasonCode: input.reasonCode,
    nextRetryAt: input.nextRetryAt,
    retryClass: input.retryClass ?? "unknown",
  };
}

const SESSION_BOOTSTRAP_TRANSIENT_DELAY_MS = 15_000;

// ─── Public: seed owner adoption into runner ─────────────────────────────────

export interface QueueGithubUnattendedImplementationInput {
  job: GithubAutomationJobRecord;
  config: GithubAutomationConfigV1;
  owner: GithubOwnerAuthorizationSeed;
  claimComplete: boolean;
}

/**
 * Called when owner adoption is authorized and P1 unattended is enabled.
 * Records implementation_queued and durable runner state; does not run agent inline
 * when concurrency is saturated (returns retry_due).
 */
export async function queueGithubUnattendedImplementation(
  input: QueueGithubUnattendedImplementationInput,
): Promise<GithubAutomationJobHandlerResult> {
  const gates = await evaluateGithubUnattendedStartGates({
    job: input.job,
    config: input.config,
    claimComplete: input.claimComplete,
  });

  if (!gates.ok && gates.reasonCode === "unattended_disabled") {
    // P0 semantics: park as accepted_waiting_automation without WorkTree.
    const job = await persistJob({
      ...input.job,
      phase: "accepted_waiting_automation",
      status: "completed",
      checkpoint: "accepted_waiting_automation",
      reasonCode: "accepted_waiting_automation",
      leaseOwner: null,
      leaseExpiresAt: null,
    });
    return { job, wakeAgain: false };
  }

  if (!gates.ok && gates.reasonCode === "mode_not_unattended") {
    const job = await persistJob({
      ...input.job,
      phase: "accepted_waiting_automation",
      status: "completed",
      checkpoint: "accepted_waiting_automation",
      reasonCode: "accepted_waiting_automation",
      leaseOwner: null,
      leaseExpiresAt: null,
    });
    return { job, wakeAgain: false };
  }

  if (!gates.ok && gates.reasonCode === "incomplete_claim") {
    const job = await persistJob({
      ...input.job,
      phase: "blocked",
      status: "blocked",
      checkpoint: "blocked",
      reasonCode: "incomplete_claim",
      blockedAtLayer: "start_gate",
      retryability: "operator",
      leaseOwner: null,
      leaseExpiresAt: null,
    });
    return {
      job,
      wakeAgain: false,
      disposition: blockedDisposition({
        reasonCode: "incomplete_claim",
        layer: "start_gate",
        checkpoint: "blocked",
        retryability: "operator",
      }),
    };
  }

  if (!gates.ok && gates.reasonCode === "unattended_concurrency_limit") {
    const prior = readGithubAutomationRunnerState(input.job.jobId) ?? emptyRunnerState(input.job);
    writeGithubAutomationRunnerState({
      ...prior,
      checkpoint: "implementation_queued",
      ownerActorId: input.owner.ownerActorId,
      ownerCommentId: input.owner.ownerCommentId,
      ownerCommentHash: input.owner.ownerCommentHash,
      reasonCode: "unattended_concurrency_limit",
    });
    const nextRetryAt = new Date(Date.now() + 15_000).toISOString();
    const job = await persistJob({
      ...input.job,
      phase: "implementation_queued",
      status: "retry_due",
      checkpoint: "implementation_queued",
      reasonCode: "unattended_concurrency_limit",
      nextRetryAt,
      retryability: "automatic",
      leaseOwner: null,
      leaseExpiresAt: null,
    });
    await appendGithubAutomationSafeEvent({
      at: new Date().toISOString(),
      kind: "unattended_queue_deferred",
      repositoryId: job.repositoryId,
      issueNumber: job.issueNumber,
      jobId: job.jobId,
      deliveryId: job.deliveryId,
      phase: job.phase,
      reasonCode: job.reasonCode,
      traceId: job.traceId,
    });
    return {
      job,
      wakeAgain: true,
      disposition: retryDueDisposition({
        reasonCode: "unattended_concurrency_limit",
        nextRetryAt,
        retryClass: "runtime",
      }),
    };
  }

  if (!gates.ok) {
    const job = await persistJob({
      ...input.job,
      phase: "blocked",
      status: "blocked",
      checkpoint: "blocked",
      reasonCode: gates.reasonCode,
      blockedAtLayer: "start_gate",
      retryability: classifyGithubAutomationRetryability(gates.reasonCode),
      leaseOwner: null,
      leaseExpiresAt: null,
    });
    return {
      job,
      wakeAgain: false,
      disposition: blockedDisposition({
        reasonCode: gates.reasonCode ?? "blocked",
        layer: "start_gate",
        checkpoint: "blocked",
      }),
    };
  }

  const priorState = readGithubAutomationRunnerState(input.job.jobId) ?? emptyRunnerState(input.job);
  writeGithubAutomationRunnerState({
    ...priorState,
    checkpoint: "implementation_queued",
    ownerActorId: input.owner.ownerActorId,
    ownerCommentId: input.owner.ownerCommentId,
    ownerCommentHash: input.owner.ownerCommentHash,
    reasonCode: null,
    pauseRequested: false,
  });

  const job = await persistJob({
    ...input.job,
    phase: "implementation_queued",
    status: "queued",
    checkpoint: "implementation_queued",
    reasonCode: null,
    nextRetryAt: null,
    // Keep runnable under scheduler — clear lease so tick can re-acquire.
    leaseOwner: null,
    leaseExpiresAt: null,
  });

  await appendGithubAutomationSafeEvent({
    at: new Date().toISOString(),
    kind: "unattended_implementation_queued",
    repositoryId: job.repositoryId,
    issueNumber: job.issueNumber,
    jobId: job.jobId,
    deliveryId: job.deliveryId,
    phase: job.phase,
    reasonCode: null,
    traceId: job.traceId,
    meta: {
      executionProfile: GITHUB_FULL_AGENT_PROFILE.executionProfile,
      riskProfile: GITHUB_FULL_AGENT_PROFILE.riskProfile,
      ownerActorId: input.owner.ownerActorId,
      ownerCommentId: input.owner.ownerCommentId,
    },
  });

  // Continue in the same lease when caller already holds it.
  return runGithubUnattendedImplementation({
    job,
    config: input.config,
    claimComplete: input.claimComplete,
  });
}

// ─── Main runner ─────────────────────────────────────────────────────────────

export interface RunGithubUnattendedImplementationInput {
  job: GithubAutomationJobRecord;
  config: GithubAutomationConfigV1;
  claimComplete: boolean;
  /** When true, only advance one checkpoint (tests / cooperative pause). */
  singleStep?: boolean;
}

/**
 * Advance durable unattended implementation checkpoints.
 * Safe to call again after restart; reuses WorkTree/task/session refs.
 */
export async function runGithubUnattendedImplementation(
  input: RunGithubUnattendedImplementationInput,
): Promise<GithubAutomationJobHandlerResult> {
  let job = input.job;
  const gates = await evaluateGithubUnattendedStartGates({
    job,
    config: input.config,
    claimComplete: input.claimComplete,
  });

  if (!gates.ok) {
    if (gates.reasonCode === "automation_paused" || gates.reasonCode === "unattended_concurrency_limit") {
      const nextRetryAt = new Date(Date.now() + 15_000).toISOString();
      job = await persistJob({
        ...job,
        phase: job.phase === "received" ? "implementation_queued" : job.phase,
        status: "retry_due",
        reasonCode: gates.reasonCode,
        nextRetryAt,
        retryability: "automatic",
        leaseOwner: null,
        leaseExpiresAt: null,
      });
      return {
        job,
        wakeAgain: gates.reasonCode === "unattended_concurrency_limit",
        disposition: retryDueDisposition({
          reasonCode: gates.reasonCode,
          nextRetryAt,
          retryClass: "runtime",
        }),
      };
    }
    job = await persistJob({
      ...job,
      phase: "blocked",
      status: "blocked",
      checkpoint: "blocked",
      reasonCode: gates.reasonCode,
      blockedAtLayer: "start_gate",
      retryability: classifyGithubAutomationRetryability(gates.reasonCode),
      leaseOwner: null,
      leaseExpiresAt: null,
    });
    return {
      job,
      wakeAgain: false,
      disposition: blockedDisposition({
        reasonCode: gates.reasonCode ?? "blocked",
        layer: "start_gate",
        checkpoint: "blocked",
      }),
    };
  }

  const repository = gates.repository!;
  const inflight = unattendedInFlight();
  inflight.add(job.jobId);

  try {
    // Do NOT mutate shared process.env here. Agent/bash isolation uses scrubbed
    // env copies (GHA-CLOSE-03). Server publisher credentials stay intact.

    let state = readGithubAutomationRunnerState(job.jobId) ?? emptyRunnerState(job);

    // Jobs parked at awaiting_publish (final_policy) are not operator-paused; they
    // continue into the GHA-07 publisher path even if status was historically "paused".
    const awaitingPublish =
      state.checkpoint === "awaiting_publish" ||
      state.checkpoint === "publishing" ||
      job.phase === "final_policy" ||
      job.phase === "publishing" ||
      job.checkpoint === "awaiting_publish" ||
      job.checkpoint === "publishing";

    // Honor job/global pause at checkpoints (not for pure publish continuation unless
    // operator explicitly set pauseRequested or global config.paused).
    if (
      input.config.paused ||
      state.pauseRequested ||
      (job.status === "paused" && !awaitingPublish)
    ) {
      state = writeGithubAutomationRunnerState({
        ...state,
        checkpoint: awaitingPublish ? "awaiting_publish" : "paused",
        pauseRequested: true,
        reasonCode: input.config.paused
          ? "automation_paused"
          : "paused_at_checkpoint",
      });
      job = await persistJob({
        ...job,
        phase: awaitingPublish ? "final_policy" : "paused",
        status: "paused",
        checkpoint: awaitingPublish ? "awaiting_publish" : "paused",
        reasonCode: input.config.paused
          ? "automation_paused"
          : "paused_at_checkpoint",
        leaseOwner: null,
        leaseExpiresAt: null,
      });
      await appendGithubAutomationSafeEvent({
        at: new Date().toISOString(),
        kind: "unattended_paused",
        repositoryId: job.repositoryId,
        issueNumber: job.issueNumber,
        jobId: job.jobId,
        deliveryId: job.deliveryId,
        phase: job.phase,
        reasonCode: job.reasonCode,
        traceId: job.traceId,
      });
      return { job, wakeAgain: false };
    }

    // ── 1. WorkTree ──────────────────────────────────────────────────────────
    if (!state.worktreePath || !existsSync(state.worktreePath)) {
      assertWorktreeNotControlledByIssue({});
      // Validate registry root early for clearer errors.
      await resolveGithubAutomationProjectRoot(repository);

      const wt = await ensureGithubAutomationWorktree({
        repository,
        issueNumber: job.issueNumber,
        generation: job.generation,
        existingWorktreePath: state.worktreePath,
        existingBranchName: state.branchName,
      });

      state = writeGithubAutomationRunnerState({
        ...state,
        checkpoint: "worktree_ready",
        worktreePath: wt.worktreePath,
        branchName: wt.branchName,
        baseRef: wt.baseRef,
        projectId: wt.projectId,
        spaceId: wt.spaceId,
        reasonCode: null,
      });

      job = await persistJob({
        ...job,
        phase: "implementation_queued",
        status: "running",
        checkpoint: "worktree_ready",
        effects: upsertEffectMarker(job.effects, {
          name: "worktree",
          status: "local_committed",
          remoteId: effectRemoteId(wt.worktreePath),
          generation: job.generation,
          reasonCode: wt.reused ? "worktree_reused" : "worktree_created",
        }),
        // Also mark branch effect.
      });
      job = await persistJob({
        ...job,
        effects: upsertEffectMarker(job.effects, {
          name: "branch",
          status: "local_committed",
          remoteId: wt.branchName,
          generation: job.generation,
          reasonCode: wt.reused ? "branch_reused" : "branch_created",
        }),
      });

      await appendGithubAutomationSafeEvent({
        at: new Date().toISOString(),
        kind: "unattended_worktree_ready",
        repositoryId: job.repositoryId,
        issueNumber: job.issueNumber,
        jobId: job.jobId,
        deliveryId: job.deliveryId,
        phase: job.phase,
        reasonCode: wt.reused ? "worktree_reused" : "worktree_created",
        traceId: job.traceId,
        meta: {
          branchName: wt.branchName,
          reused: wt.reused,
          spaceSynced: wt.spaceSynced,
        },
      });

      if (input.singleStep) {
        return { job, wakeAgain: true };
      }
    }

    // Legacy sidecars / reuse: repair missing spaceId while WorkTree already exists.
    if (state.worktreePath && state.projectId && !state.spaceId) {
      try {
        const repoRoot =
          (await resolveGithubAutomationProjectRoot(repository)).rootPath;
        const space = await resolveGithubAutomationWorktreeSpaceId({
          projectId: state.projectId,
          repoRoot,
          worktreePath: state.worktreePath,
          branchName: state.branchName,
          baseRef: state.baseRef,
        });
        if (space.spaceId) {
          state = writeGithubAutomationRunnerState({
            ...state,
            spaceId: space.spaceId,
          });
        }
      } catch {
        // Visible later at Session bootstrap if still unbound.
      }
    }

    // ── 2. Studio task + policy ──────────────────────────────────────────────
    if (!state.taskId || !state.ownerCommentHash) {
      if (!state.ownerActorId || !state.ownerCommentId || !state.ownerCommentHash) {
        // Owner seed must have been written by queueGithubUnattendedImplementation.
        job = await persistJob({
          ...job,
          phase: "blocked",
          status: "blocked",
          checkpoint: "blocked",
          reasonCode: "missing_owner_authorization_seed",
          blockedAtLayer: "start_gate",
          retryability: "operator",
          leaseOwner: null,
          leaseExpiresAt: null,
        });
        return {
          job,
          wakeAgain: false,
          disposition: blockedDisposition({
            reasonCode: "missing_owner_authorization_seed",
            layer: "start_gate",
            checkpoint: "blocked",
            retryability: "operator",
          }),
        };
      }

      const ensured = ensureGithubUnattendedStudioTask({
        worktreePath: state.worktreePath!,
        repository,
        issueNumber: job.issueNumber,
        issueTitlePreview: job.issueTitlePreview,
        jobId: job.jobId,
        generation: job.generation,
        owner: {
          ownerActorId: state.ownerActorId,
          ownerCommentId: state.ownerCommentId,
          ownerCommentHash: state.ownerCommentHash,
        },
        uiGate: "pass",
        existingTaskId: state.taskId,
      });

      if (!ensured.authorized) {
        const reasonCode =
          ensured.authorizationReasonCode ?? "policy_not_authorized";
        job = await persistJob({
          ...job,
          phase: "blocked",
          status: "blocked",
          checkpoint: "blocked",
          reasonCode,
          blockedAtLayer: "policy_pre",
          retryability: classifyGithubAutomationRetryability(reasonCode),
          leaseOwner: null,
          leaseExpiresAt: null,
        });
        state = writeGithubAutomationRunnerState({
          ...state,
          checkpoint: "blocked",
          taskId: ensured.task.id,
          scopeFingerprint: ensured.binding.scopeFingerprint,
          reasonCode: job.reasonCode,
        });
        return {
          job,
          wakeAgain: false,
          disposition: blockedDisposition({
            reasonCode,
            layer: "policy_pre",
            checkpoint: "blocked",
          }),
        };
      }

      state = writeGithubAutomationRunnerState({
        ...state,
        checkpoint: "studio_task_ready",
        taskId: ensured.task.id,
        scopeFingerprint: ensured.binding.scopeFingerprint,
        reasonCode: null,
      });

      job = await persistJob({
        ...job,
        phase: "planning",
        status: "running",
        checkpoint: "studio_task_ready",
        reasonCode: null,
      });

      await appendGithubAutomationSafeEvent({
        at: new Date().toISOString(),
        kind: "unattended_studio_task_ready",
        repositoryId: job.repositoryId,
        issueNumber: job.issueNumber,
        jobId: job.jobId,
        deliveryId: job.deliveryId,
        phase: job.phase,
        reasonCode: ensured.created ? "task_created" : "task_reused",
        traceId: job.traceId,
        meta: {
          taskId: ensured.task.id,
          authorized: true,
        },
      });

      if (input.singleStep) {
        return { job, wakeAgain: true };
      }
    }

    // Reconcile runtime_lost child runs after restart.
    if (state.taskId && state.worktreePath) {
      reconcileGithubAutomationRuntimeLostRuns({
        worktreePath: state.worktreePath,
        taskId: state.taskId,
      });
    }

    // ── 3. Transition to implementing (policy gate) ──────────────────────────
    if (
      state.checkpoint === "studio_task_ready" ||
      state.checkpoint === "planning" ||
      state.checkpoint === "policy_check" ||
      job.phase === "planning" ||
      job.phase === "policy_check"
    ) {
      // Plan-stage risk gate (title/plan hints only; full final gate runs after validation).
      try {
        const planGate = await evaluateGithubDiffPolicy({
          stage: "plan",
          cwd: state.worktreePath!,
          baseRef: state.baseRef || repository.baseRef || "main",
          limits: {
            maxFiles: input.config.unattended.maxFiles,
            maxChangedLines: input.config.unattended.maxChangedLines,
          },
          riskProfile: input.config.unattended.riskProfile,
          // Title is untrusted advisory only — never copy into planText (GHA-CLOSE-01).
          issueTitlePreview: job.issueTitlePreview,
          planText: null,
          // Empty/WIP tree is ok at plan; high-confidence title hints can still block UI/release/secret.
          snapshot: {
            baseRef: state.baseRef || repository.baseRef || "main",
            files: [],
            nameStatusRawPreview: "",
            numstatRawPreview: "",
          },
        });
        // deferred empty plan (outcome=defer) continues; only hard blocks stop.
        if (planGate.policy.decision === "block" || planGate.policy.outcome === "block") {
          const reasonCode = planGate.policy.reasonCode;
          job = await persistJob({
            ...job,
            phase: "blocked",
            status: "blocked",
            checkpoint: "blocked",
            reasonCode,
            blockedAtLayer: "policy_plan",
            retryability: classifyGithubAutomationRetryability(reasonCode),
            leaseOwner: null,
            leaseExpiresAt: null,
          });
          state = writeGithubAutomationRunnerState({
            ...state,
            checkpoint: "blocked",
            reasonCode,
          });
          await appendGithubAutomationSafeEvent({
            at: new Date().toISOString(),
            kind: "unattended_plan_policy_blocked",
            repositoryId: job.repositoryId,
            issueNumber: job.issueNumber,
            jobId: job.jobId,
            deliveryId: job.deliveryId,
            phase: job.phase,
            reasonCode: job.reasonCode,
            traceId: job.traceId,
            meta: { classification: planGate.policy.classification },
          });
          return {
            job,
            wakeAgain: false,
            disposition: blockedDisposition({
              reasonCode,
              layer: "policy_plan",
              checkpoint: "blocked",
            }),
          };
        }
      } catch (err) {
        // Diff collection failures at plan stage are non-fatal; final gate still runs.
        await appendGithubAutomationSafeEvent({
          at: new Date().toISOString(),
          kind: "unattended_plan_policy_skipped",
          repositoryId: job.repositoryId,
          issueNumber: job.issueNumber,
          jobId: job.jobId,
          deliveryId: job.deliveryId,
          phase: job.phase,
          reasonCode: "plan_policy_error",
          traceId: job.traceId,
          meta: {
            message: safeGithubAutomationErrorMessage(err).slice(0, 120),
          },
        });
      }

      try {
        const task = transitionGithubUnattendedTaskToImplementing({
          worktreePath: state.worktreePath!,
          taskId: state.taskId!,
          issueNumber: job.issueNumber,
          repositoryId: job.repositoryId,
          policyHash: buildGithubUnattendedPolicyHash({
            maxFiles: input.config.unattended.maxFiles,
            maxChangedLines: input.config.unattended.maxChangedLines,
          }),
        });

        state = writeGithubAutomationRunnerState({
          ...state,
          checkpoint: "implementing",
          reasonCode: null,
        });
        job = await persistJob({
          ...job,
          phase: "implementing",
          status: "running",
          checkpoint: "implementing",
          reasonCode: null,
        });

        await appendGithubAutomationSafeEvent({
          at: new Date().toISOString(),
          kind: "unattended_implementing",
          repositoryId: job.repositoryId,
          issueNumber: job.issueNumber,
          jobId: job.jobId,
          deliveryId: job.deliveryId,
          phase: job.phase,
          reasonCode: null,
          traceId: job.traceId,
          meta: {
            taskId: task.id,
            taskStatus: task.status,
            executionProfile: GITHUB_FULL_AGENT_PROFILE.executionProfile,
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const uiBlocked =
          /blocked_manual_ui_approval|uiGate|UI\/user-visible/i.test(message);
        const reasonCode = uiBlocked
          ? "blocked_manual_ui_approval"
          : "policy_transition_failed";
        job = await persistJob({
          ...job,
          phase: "blocked",
          status: "blocked",
          checkpoint: "blocked",
          reasonCode,
          blockedAtLayer: uiBlocked ? "policy_plan" : "policy_pre",
          retryability: classifyGithubAutomationRetryability(reasonCode),
          leaseOwner: null,
          leaseExpiresAt: null,
        });
        state = writeGithubAutomationRunnerState({
          ...state,
          checkpoint: "blocked",
          reasonCode: job.reasonCode,
        });
        await appendGithubAutomationSafeEvent({
          at: new Date().toISOString(),
          kind: "unattended_policy_blocked",
          repositoryId: job.repositoryId,
          issueNumber: job.issueNumber,
          jobId: job.jobId,
          deliveryId: job.deliveryId,
          phase: job.phase,
          reasonCode: job.reasonCode,
          traceId: job.traceId,
          meta: {
            message: safeGithubAutomationErrorMessage(err).slice(0, 160),
          },
        });
        return {
          job,
          wakeAgain: false,
          disposition: blockedDisposition({
            reasonCode,
            layer: uiBlocked ? "policy_plan" : "policy_pre",
            checkpoint: "blocked",
          }),
        };
      }

      if (input.singleStep) {
        return { job, wakeAgain: true };
      }
    }

    // ── 4. Full-agent implementer pass (optional when already checking) ──────
    if (state.checkpoint === "implementing" || job.phase === "implementing") {
      // Pause check again at this checkpoint.
      const latestState = readGithubAutomationRunnerState(job.jobId);
      if (latestState?.pauseRequested || input.config.paused) {
        return runGithubUnattendedImplementation({
          ...input,
          job: {
            ...job,
            status: "paused",
          },
        });
      }

      // Parent Session bootstrap is required before claiming Agent active.
      // projectId+spaceId must be paired; failure is a visible blocker (GHA-CLOSE-03).
      if (!state.sessionId) {
        // Legacy sidecars may only have projectId; re-resolve WorkTree space.
        if (state.projectId && !state.spaceId && state.worktreePath) {
          try {
            const repoRoot =
              (await resolveGithubAutomationProjectRoot(repository)).rootPath;
            const space = await resolveGithubAutomationWorktreeSpaceId({
              projectId: state.projectId,
              repoRoot,
              worktreePath: state.worktreePath,
              branchName: state.branchName,
              baseRef: state.baseRef,
            });
            if (space.spaceId) {
              state = writeGithubAutomationRunnerState({
                ...state,
                spaceId: space.spaceId,
              });
            }
          } catch {
            // handled below as binding failure
          }
        }

        if (!state.projectId || !state.spaceId) {
          // Stable main reason for Jobs UI; typed code lives in safe event meta.
          const reasonCode = "session_bootstrap_failed";
          const bootstrapCode = "session_binding_invalid";
          const safeMessage = "Session binding is invalid";
          state = writeGithubAutomationRunnerState({
            ...state,
            reasonCode,
          });
          job = await persistJob({
            ...job,
            phase: "blocked",
            status: "blocked",
            checkpoint: "blocked",
            reasonCode,
            blockedAtLayer: "session_bootstrap",
            retryability: "operator",
            leaseOwner: null,
            leaseExpiresAt: null,
          });
          await appendGithubAutomationSafeEvent({
            at: new Date().toISOString(),
            kind: "unattended_session_bootstrap_failed",
            repositoryId: job.repositoryId,
            issueNumber: job.issueNumber,
            jobId: job.jobId,
            deliveryId: job.deliveryId,
            phase: job.phase,
            reasonCode,
            traceId: job.traceId,
            meta: {
              bootstrapCode,
              stage: "binding",
              retryable: false,
              message: safeMessage,
              hasProjectId: Boolean(state.projectId),
              hasSpaceId: Boolean(state.spaceId),
            },
          });
          return {
            job,
            wakeAgain: false,
            disposition: blockedDisposition({
              reasonCode,
              layer: "session_bootstrap",
              checkpoint: "blocked",
              retryability: "operator",
            }),
          };
        }

        try {
          const boot = await bootstrapGithubAutomationAgentSession({
            worktreePath: state.worktreePath!,
            projectId: state.projectId,
            spaceId: state.spaceId,
          });
          // Dispose immediately — child runs use SDK sessions; we only need binding ids.
          // Prefer destroy so the process-local wrapper is not left live as "Session none".
          try {
            const disposable = boot.session as {
              dispose?: () => void;
              destroy?: () => void;
            };
            if (typeof disposable.destroy === "function") {
              disposable.destroy();
            } else {
              disposable.dispose?.();
            }
          } catch {
            // ignore
          }
          const sessionFile =
            (boot as { sessionFile?: string | null }).sessionFile ??
            boot.session.sessionFile ??
            null;
          state = writeGithubAutomationRunnerState({
            ...state,
            sessionId: boot.sessionId,
            contextId: boot.contextId,
            sessionFile,
            reasonCode: null,
          });
          // Stamp agentRunCount only after successful parent Session bootstrap.
          const priorRuns =
            typeof job.agentRunCount === "number" && Number.isFinite(job.agentRunCount)
              ? Math.max(0, Math.floor(job.agentRunCount))
              : 0;
          const createdAt = new Date().toISOString();
          const nextProgressRevision =
            (typeof job.progressRevision === "number" ? job.progressRevision : 0) +
            1;
          job = await persistJob({
            ...job,
            agentRunCount: priorRuns + 1,
            lastMeaningfulProgressAt: createdAt,
            lastMeaningfulProgressKind: "session_created",
            meaningfulProgressCount:
              (typeof job.meaningfulProgressCount === "number"
                ? job.meaningfulProgressCount
                : 0) + 1,
            progressRevision: nextProgressRevision,
            reasonCode: null,
            blockedAtLayer: null,
          });
          const sessionIdShort = toSafeSessionIdShort(boot.sessionId);
          await appendGithubAutomationSafeEvent({
            at: createdAt,
            kind: "unattended_session_created",
            repositoryId: job.repositoryId,
            issueNumber: job.issueNumber,
            jobId: job.jobId,
            deliveryId: job.deliveryId,
            phase: job.phase,
            reasonCode: null,
            traceId: job.traceId,
            meta: {
              // Opaque short id only — never sessionFile / absolute path.
              ...(sessionIdShort ? { sessionIdShort } : {}),
              hasProjectId: true,
              hasSpaceId: true,
              hasContextId: Boolean(boot.contextId),
              hasSessionFile: Boolean(sessionFile),
            },
          });
        } catch (err) {
          // Classify from typed error / Node cause codes BEFORE generic sanitize.
          // Never regex the sanitized "Internal GitHub automation error" text.
          const {
            classifyAgentSessionBootstrapFailure,
            isAgentSessionBootstrapError,
          } = await import("./agent-session-bootstrap-errors");
          const classified = isAgentSessionBootstrapError(err)
            ? {
                bootstrapCode: err.bootstrapCode,
                stage: err.stage,
                retryability: err.retryability,
                safeMessage: err.safeMessage,
                reasonCode:
                  err.retryability === "automatic"
                    ? ("session_bootstrap_transient" as const)
                    : ("session_bootstrap_failed" as const),
              }
            : classifyAgentSessionBootstrapFailure(err, "runtime_start");
          const reasonCode = classified.reasonCode;
          const transient = classified.retryability === "automatic";
          const nextRetryAt = transient
            ? new Date(Date.now() + SESSION_BOOTSTRAP_TRANSIENT_DELAY_MS).toISOString()
            : null;
          state = writeGithubAutomationRunnerState({
            ...state,
            // Retain g1 WorkTree/task/project/space; session stays null.
            sessionId: null,
            contextId: null,
            sessionFile: null,
            reasonCode,
          });
          job = await persistJob({
            ...job,
            // Transient → explicit retry_due; hard → stable blocked.
            phase: transient ? "implementing" : "blocked",
            status: transient ? "retry_due" : "blocked",
            // Keep recoverable checkpoint at implementing so resume re-enters bootstrap.
            checkpoint: transient ? "implementing" : "blocked",
            reasonCode,
            blockedAtLayer: "session_bootstrap",
            retryability: transient ? "automatic" : "operator",
            nextRetryAt,
            leaseOwner: null,
            leaseExpiresAt: null,
          });
          await appendGithubAutomationSafeEvent({
            at: new Date().toISOString(),
            kind: "unattended_session_bootstrap_failed",
            repositoryId: job.repositoryId,
            issueNumber: job.issueNumber,
            jobId: job.jobId,
            deliveryId: job.deliveryId,
            phase: job.phase,
            reasonCode,
            traceId: job.traceId,
            meta: {
              bootstrapCode: classified.bootstrapCode,
              stage: classified.stage,
              retryable: transient,
              message: classified.safeMessage,
            },
          });
          if (transient && nextRetryAt) {
            return {
              job,
              wakeAgain: false,
              disposition: retryDueDisposition({
                reasonCode,
                nextRetryAt,
                retryClass: "session",
              }),
            };
          }
          return {
            job,
            wakeAgain: false,
            disposition: blockedDisposition({
              reasonCode,
              layer: "session_bootstrap",
              checkpoint: "blocked",
              retryability: "operator",
            }),
          };
        }
      }

      const runId = `gha-impl-${randomUUID().slice(0, 12)}`;
      const prompt = buildGithubFullAgentPromptEnvelope({
        member: "implementer",
        taskId: state.taskId!,
        issueNumber: job.issueNumber,
        repositoryFullName: job.repositoryFullName,
        instructions: [
          "Implement only documentation or a clear local low-risk bugfix within the WorkTree.",
          "Do not change UI/interaction, workflows, release, secrets/auth, dependencies/lockfiles, or infra.",
          "Do not push, open PRs, or modify git remotes. Server publisher handles publish after gates.",
          "Report files changed and how to verify. Prefer minimal diffs.",
        ].join("\n"),
        untrustedIssueExcerpt: job.issueTitlePreview
          ? `title: ${job.issueTitlePreview}`
          : undefined,
      });

      try {
        const result = await runGithubFullAgentMember({
          worktreePath: state.worktreePath!,
          taskId: state.taskId!,
          member: "implementer",
          prompt,
          runId,
          parentSessionId: state.sessionId ?? undefined,
          parentSessionFile: state.sessionFile ?? undefined,
        });

        state = writeGithubAutomationRunnerState({
          ...state,
          checkpoint: "checking",
          lastMember: "implementer",
          lastRunId: runId,
          reasonCode:
            result.status === "succeeded" ? null : `implementer_${result.status}`,
        });

        job = await persistJob({
          ...job,
          phase: "checking",
          status: "running",
          checkpoint: "checking",
          reasonCode: state.reasonCode,
        });

        await appendGithubAutomationSafeEvent({
          at: new Date().toISOString(),
          kind: "unattended_implementer_finished",
          repositoryId: job.repositoryId,
          issueNumber: job.issueNumber,
          jobId: job.jobId,
          deliveryId: job.deliveryId,
          phase: job.phase,
          reasonCode: state.reasonCode,
          traceId: job.traceId,
          meta: {
            runId,
            childStatus: result.status,
            // Never store full transcript/output — only length.
            outputChars: result.output?.length ?? 0,
          },
        });

        if (result.status === "cancelled") {
          job = await persistJob({
            ...job,
            phase: "paused",
            status: "paused",
            checkpoint: "paused",
            reasonCode: "implementer_cancelled",
            leaseOwner: null,
            leaseExpiresAt: null,
          });
          return {
            job,
            wakeAgain: false,
            disposition: { kind: "waiting", wakeOn: "external" },
          };
        }

        if (result.status === "failed") {
          job = await persistJob({
            ...job,
            phase: "blocked",
            status: "blocked",
            checkpoint: "blocked",
            reasonCode: "implementer_failed",
            blockedAtLayer: "agent",
            retryability: "operator",
            leaseOwner: null,
            leaseExpiresAt: null,
          });
          return {
            job,
            wakeAgain: false,
            disposition: blockedDisposition({
              reasonCode: "implementer_failed",
              layer: "agent",
              checkpoint: "blocked",
              retryability: "operator",
            }),
          };
        }
      } catch (err) {
        const message = safeGithubAutomationErrorMessage(err);
        const errDetails =
          err &&
          typeof err === "object" &&
          "details" in err &&
          err.details &&
          typeof err.details === "object"
            ? (err.details as Record<string, unknown>)
            : null;
        const implementerCode =
          typeof errDetails?.implementerCode === "string" &&
          /^[a-z][a-z0-9_]{0,63}$/i.test(errDetails.implementerCode)
            ? errDetails.implementerCode
            : null;
        const implementerStage =
          typeof errDetails?.stage === "string" &&
          /^[a-z][a-z0-9_]{0,63}$/i.test(errDetails.stage)
            ? errDetails.stage
            : null;
        // runtime_lost / preflight: park for retry rather than hard block when recoverable
        const retryable =
          errDetails?.retryable === true ||
          /runtime_lost|ECONNRESET|timed out/i.test(
            err instanceof Error ? err.message : String(err),
          );
        // Prompt-sentinel / hard preflight refusals are operator-visible blocks, not auto-retry spin.
        const hardPreflight =
          implementerCode === "full_agent_prompt_sentinel" ||
          implementerStage === "full_agent_preflight";
        const reasonCode = hardPreflight
          ? "implementer_error"
          : retryable
            ? "implementer_retry"
            : "implementer_error";
        const nextRetryAt =
          !hardPreflight && retryable
            ? new Date(Date.now() + 20_000).toISOString()
            : null;
        job = await persistJob({
          ...job,
          phase: !hardPreflight && retryable ? "implementing" : "blocked",
          status: !hardPreflight && retryable ? "retry_due" : "blocked",
          checkpoint: !hardPreflight && retryable ? "implementing" : "blocked",
          reasonCode,
          blockedAtLayer: "agent",
          retryability: !hardPreflight && retryable ? "automatic" : "operator",
          nextRetryAt,
          leaseOwner: null,
          leaseExpiresAt: null,
        });
        await appendGithubAutomationSafeEvent({
          at: new Date().toISOString(),
          kind: "unattended_implementer_error",
          repositoryId: job.repositoryId,
          issueNumber: job.issueNumber,
          jobId: job.jobId,
          deliveryId: job.deliveryId,
          phase: job.phase,
          reasonCode: job.reasonCode,
          traceId: job.traceId,
          meta: {
            message: message.slice(0, 160),
            retryable: !hardPreflight && retryable,
            ...(implementerCode ? { implementerCode } : {}),
            ...(implementerStage ? { stage: implementerStage } : {}),
          },
        });
        if (!hardPreflight && retryable && nextRetryAt) {
          return {
            job,
            wakeAgain: false,
            disposition: retryDueDisposition({
              reasonCode,
              nextRetryAt,
              retryClass: "runtime",
            }),
          };
        }
        return {
          job,
          wakeAgain: false,
          disposition: blockedDisposition({
            reasonCode,
            layer: "agent",
            checkpoint: "blocked",
            retryability: "operator",
          }),
        };
      }

      if (input.singleStep) {
        return { job, wakeAgain: true };
      }
    }

    // ── 5. Operator validation broker (config only; Issue cannot set cmds) ───
    if (state.checkpoint === "checking" || job.phase === "checking") {
      assertValidationCommandsNotFromIssue({});
      const validation = await runGithubValidationBroker({
        cwd: state.worktreePath!,
        unattended: input.config.unattended,
      });

      if (!validation.ok) {
        const reasonCode = validation.reasonCode ?? "validation_failed";
        job = await persistJob({
          ...job,
          phase: "blocked",
          status: "blocked",
          checkpoint: "blocked",
          reasonCode,
          blockedAtLayer: "validation",
          retryability: classifyGithubAutomationRetryability(reasonCode),
          leaseOwner: null,
          leaseExpiresAt: null,
        });
        state = writeGithubAutomationRunnerState({
          ...state,
          checkpoint: "blocked",
          reasonCode: job.reasonCode,
        });
        await appendGithubAutomationSafeEvent({
          at: new Date().toISOString(),
          kind: "unattended_validation_failed",
          repositoryId: job.repositoryId,
          issueNumber: job.issueNumber,
          jobId: job.jobId,
          deliveryId: job.deliveryId,
          phase: job.phase,
          reasonCode: job.reasonCode,
          traceId: job.traceId,
          meta: {
            commandCount: validation.commandCount,
            failedLabel: validation.results.find((r) => !r.ok)?.commandLabel ?? null,
          },
        });
        return {
          job,
          wakeAgain: false,
          disposition: blockedDisposition({
            reasonCode,
            layer: "validation",
            checkpoint: "blocked",
          }),
        };
      }

      // Validation passed → enter final_policy / awaiting_publish; publish continues below.
      state = writeGithubAutomationRunnerState({
        ...state,
        checkpoint: "awaiting_publish",
        reasonCode: "validation_passed",
      });
      job = await persistJob({
        ...job,
        phase: "final_policy",
        status: "running",
        checkpoint: "awaiting_publish",
        reasonCode: "validation_passed",
      });

      await appendGithubAutomationSafeEvent({
        at: new Date().toISOString(),
        kind: "unattended_awaiting_publish",
        repositoryId: job.repositoryId,
        issueNumber: job.issueNumber,
        jobId: job.jobId,
        deliveryId: job.deliveryId,
        phase: job.phase,
        reasonCode: job.reasonCode,
        traceId: job.traceId,
        meta: {
          taskId: state.taskId,
          branchName: state.branchName,
          validationCommandCount: validation.commandCount,
          residualRisk:
            "full-agent may have executed arbitrary commands/network/host reads; final diff gate cannot undo side effects",
        },
      });

      if (input.singleStep) {
        job = await persistJob({
          ...job,
          leaseOwner: null,
          leaseExpiresAt: null,
        });
        return { job, wakeAgain: true };
      }
    }

    // ── 6. Final diff policy + server App publisher (GHA-07) ─────────────────
    if (
      state.checkpoint === "awaiting_publish" ||
      state.checkpoint === "publishing" ||
      job.phase === "final_policy" ||
      job.phase === "publishing"
    ) {
      if (state.pauseRequested || input.config.paused) {
        job = await persistJob({
          ...job,
          phase: "paused",
          status: "paused",
          checkpoint: "awaiting_publish",
          reasonCode: "paused_before_publish",
          leaseOwner: null,
          leaseExpiresAt: null,
        });
        state = writeGithubAutomationRunnerState({
          ...state,
          checkpoint: "paused",
          reasonCode: "paused_before_publish",
        });
        return { job, wakeAgain: false };
      }

      // Do not re-run full start gates (concurrency) here — publish is single-job under lease.
      const repository = findRepositoryConfigById(input.config, job.repositoryId);

      if (!repository) {
        job = await persistJob({
          ...job,
          phase: "blocked",
          status: "blocked",
          checkpoint: "blocked",
          reasonCode: "repository_not_allowlisted",
          blockedAtLayer: "start_gate",
          retryability: "operator",
          leaseOwner: null,
          leaseExpiresAt: null,
        });
        return {
          job,
          wakeAgain: false,
          disposition: blockedDisposition({
            reasonCode: "repository_not_allowlisted",
            layer: "start_gate",
            checkpoint: "blocked",
            retryability: "operator",
          }),
        };
      }

      if (!state.worktreePath || !state.branchName || !state.baseRef) {
        job = await persistJob({
          ...job,
          phase: "blocked",
          status: "blocked",
          checkpoint: "blocked",
          reasonCode: "missing_worktree_for_publish",
          blockedAtLayer: "worktree",
          retryability: "operator",
          leaseOwner: null,
          leaseExpiresAt: null,
        });
        return {
          job,
          wakeAgain: false,
          disposition: blockedDisposition({
            reasonCode: "missing_worktree_for_publish",
            layer: "worktree",
            checkpoint: "blocked",
            retryability: "operator",
          }),
        };
      }

      if (
        repository.installationId == null ||
        !Number.isInteger(repository.installationId) ||
        repository.installationId <= 0
      ) {
        job = await persistJob({
          ...job,
          phase: "blocked",
          status: "blocked",
          checkpoint: "blocked",
          reasonCode: "installation_missing",
          blockedAtLayer: "publisher",
          retryability: "operator",
          leaseOwner: null,
          leaseExpiresAt: null,
        });
        return {
          job,
          wakeAgain: false,
          disposition: blockedDisposition({
            reasonCode: "installation_missing",
            layer: "publisher",
            checkpoint: "blocked",
            retryability: "operator",
          }),
        };
      }

      assertDiffArgsNotFromIssue({});

      // Infer docs-only vs explicit small bugfix from path classes after collect.
      // Fail closed: non-docs requires explicitSmallBugfix=true only when all
      // non-doc paths look like local source/scripts (risk policy still applies).
      let explicitSmallBugfix = false;
      const preflight = await evaluateGithubDiffPolicy({
        stage: "final",
        cwd: state.worktreePath,
        baseRef: state.baseRef,
        limits: {
          maxFiles: input.config.unattended.maxFiles,
          maxChangedLines: input.config.unattended.maxChangedLines,
        },
        riskProfile: input.config.unattended.riskProfile,
        issueTitlePreview: job.issueTitlePreview,
        explicitSmallBugfix: false,
      });

      if (
        preflight.policy.decision === "block" &&
        preflight.policy.reasonCode === "blocked_uncertain" &&
        preflight.snapshot.files.every((f) => {
          const p = f.path.replace(/\\/g, "/");
          return (
            /(?:^|\/)(?:lib|app\/api|scripts|bin)\//i.test(p) ||
            /\.(?:ts|tsx|js|jsx|mjs|cjs)$/i.test(p)
          ) && !/(?:^|\/)(?:components|hooks|app\/(?!api\/)|public)\//i.test(p);
        }) &&
        preflight.snapshot.files.length > 0
      ) {
        // Treat as explicit small bugfix only when every path is local non-UI source.
        explicitSmallBugfix = true;
      }

      const finalEval =
        explicitSmallBugfix
          ? await evaluateGithubDiffPolicy({
              stage: "final",
              cwd: state.worktreePath,
              baseRef: state.baseRef,
              limits: {
                maxFiles: input.config.unattended.maxFiles,
                maxChangedLines: input.config.unattended.maxChangedLines,
              },
              riskProfile: input.config.unattended.riskProfile,
              issueTitlePreview: job.issueTitlePreview,
              explicitSmallBugfix: true,
              snapshot: preflight.snapshot,
            })
          : preflight;

      if (!isGithubFinalDiffAllowed(finalEval)) {
        const reasonCode = finalEval.policy.reasonCode;
        job = await persistJob({
          ...job,
          phase: "blocked",
          status: "blocked",
          checkpoint: "blocked",
          reasonCode,
          blockedAtLayer: "policy_final",
          retryability: classifyGithubAutomationRetryability(reasonCode),
          leaseOwner: null,
          leaseExpiresAt: null,
        });
        state = writeGithubAutomationRunnerState({
          ...state,
          checkpoint: "blocked",
          reasonCode,
        });
        await appendGithubAutomationSafeEvent({
          at: new Date().toISOString(),
          kind: "unattended_final_diff_blocked",
          repositoryId: job.repositoryId,
          issueNumber: job.issueNumber,
          jobId: job.jobId,
          deliveryId: job.deliveryId,
          phase: job.phase,
          reasonCode: job.reasonCode,
          traceId: job.traceId,
          meta: {
            classification: finalEval.policy.classification,
            fileCount: finalEval.policy.fileCount,
            changedLines: finalEval.policy.changedLines,
          },
        });
        return {
          job,
          wakeAgain: false,
          disposition: blockedDisposition({
            reasonCode,
            layer: "policy_final",
            checkpoint: "blocked",
          }),
        };
      }

      // Record Studio completion evidence (checker + validation + final diff).
      if (state.taskId && state.worktreePath) {
        try {
          recordYpiStudioUnattendedCompletionEvidence({
            cwd: state.worktreePath,
            taskId: state.taskId,
            checkerPassed: true,
            validationPassed: true,
            finalDiffAllowed: true,
            notesHash: `files:${finalEval.policy.fileCount};lines:${finalEval.policy.changedLines}`,
          });
        } catch (err) {
          const message = safeGithubAutomationErrorMessage(err);
          job = await persistJob({
            ...job,
            phase: "blocked",
            status: "blocked",
            checkpoint: "blocked",
            reasonCode: "completion_evidence_failed",
            blockedAtLayer: "lifecycle",
            retryability: "operator",
            leaseOwner: null,
            leaseExpiresAt: null,
          });
          await appendGithubAutomationSafeEvent({
            at: new Date().toISOString(),
            kind: "unattended_completion_evidence_failed",
            repositoryId: job.repositoryId,
            issueNumber: job.issueNumber,
            jobId: job.jobId,
            deliveryId: job.deliveryId,
            phase: job.phase,
            reasonCode: job.reasonCode,
            traceId: job.traceId,
            meta: { message: message.slice(0, 160) },
          });
          return {
            job,
            wakeAgain: false,
            disposition: blockedDisposition({
              reasonCode: "completion_evidence_failed",
              layer: "lifecycle",
              checkpoint: "blocked",
              retryability: "operator",
            }),
          };
        }
      }

      state = writeGithubAutomationRunnerState({
        ...state,
        checkpoint: "publishing",
        reasonCode: "publishing",
      });
      job = await persistJob({
        ...job,
        phase: "publishing",
        status: "running",
        checkpoint: "publishing",
        reasonCode: "publishing",
      });

      try {
        // Narrowed above; re-bind for definite assignment into publisher target.
        const worktreePath = state.worktreePath as string;
        const headBranch = state.branchName as string;
        const baseRef = state.baseRef as string;
        const installationId = repository.installationId as number;

        const published = await publishGithubAutomationChange({
          repository,
          target: {
            repositoryId: repository.repositoryId,
            repositoryFullName: repository.fullName,
            installationId,
            baseRef,
            headBranch,
            issueNumber: job.issueNumber,
            worktreePath,
          },
          finalDiffAllowed: true,
          checkerPassed: true,
          validationPassed: true,
          commitMessage: `ypi: automation for #${job.issueNumber}`,
          prTitle:
            job.issueTitlePreview && job.issueTitlePreview.trim()
              ? `修复：${job.issueTitlePreview.trim().slice(0, 80)}`
              : `修复：自动化处理 #${job.issueNumber}`,
          scopeSummary: `Automated docs/small-bugfix for #${job.issueNumber} (${finalEval.policy.classification}; files=${finalEval.policy.fileCount}, lines=${finalEval.policy.changedLines}).`,
          validationSummary: `Operator validation commands passed; final risk policy ${finalEval.policy.reasonCode}.`,
          riskSummary: GITHUB_FULL_AGENT_PROFILE.residualRiskSummary,
          traceId: job.traceId,
          classification: finalEval.policy.classification,
        });

        if (
          containsGithubAutomationSecretInjectionMarker(published.pr) ||
          containsGithubAutomationSecretInjectionMarker(published.push)
        ) {
          throw new Error("Publisher result contained secret markers");
        }

        job = await persistJob({
          ...job,
          phase: "pr_open",
          status: "completed",
          checkpoint: "pr_open",
          reasonCode: published.pr.reused ? "pr_reused" : "pr_created",
          leaseOwner: null,
          leaseExpiresAt: null,
          effects: upsertEffectMarker(job.effects, {
            name: "pull_request",
            status: "remote_confirmed",
            remoteId: String(published.pr.prNumber),
            generation: job.generation,
            updatedAt: new Date().toISOString(),
            reasonCode: published.pr.reasonCode,
          }),
        });
        // Also mark branch effect.
        job = await persistJob({
          ...job,
          effects: upsertEffectMarker(job.effects, {
            name: "branch",
            status: "remote_confirmed",
            remoteId: headBranch,
            generation: job.generation,
            updatedAt: new Date().toISOString(),
            reasonCode: published.push.pushed ? "pushed" : "push_unknown_pr_ok",
          }),
        });

        state = writeGithubAutomationRunnerState({
          ...state,
          checkpoint: "pr_open",
          reasonCode: job.reasonCode,
        });

        await upsertGithubAutomationIssueState({
          repositoryId: job.repositoryId,
          issueNumber: job.issueNumber,
          activeJobId: job.jobId,
          generation: job.generation,
        });

        await appendGithubAutomationSafeEvent({
          at: new Date().toISOString(),
          kind: "unattended_pr_open",
          repositoryId: job.repositoryId,
          issueNumber: job.issueNumber,
          jobId: job.jobId,
          deliveryId: job.deliveryId,
          phase: job.phase,
          reasonCode: job.reasonCode,
          traceId: job.traceId,
          meta: {
            prNumber: published.pr.prNumber,
            reused: published.pr.reused,
            headBranch: published.pr.headBranch,
            baseRef: published.pr.baseRef,
            // htmlUrl host/path only — still non-secret
            hasHtmlUrl: Boolean(published.pr.htmlUrl),
          },
        });

        return {
          job,
          wakeAgain: false,
          disposition: {
            kind: "terminal",
            status: "completed",
          },
        };
      } catch (err) {
        const reason = isGithubAutomationError(err)
          ? err.code
          : "publish_failed";
        const message = safeGithubAutomationErrorMessage(err);
        const retryable =
          reason === "github_rate_limited" ||
          reason === "github_timeout" ||
          reason === "github_network_error" ||
          /push_failed|ECONNRESET|timed out/i.test(message);
        const reasonCode = retryable ? "publish_retry" : reason;
        const nextRetryAt = retryable
          ? new Date(Date.now() + 30_000).toISOString()
          : null;

        job = await persistJob({
          ...job,
          phase: retryable ? "publishing" : "blocked",
          status: retryable ? "retry_due" : "blocked",
          checkpoint: retryable ? "awaiting_publish" : "blocked",
          reasonCode,
          blockedAtLayer: "publisher",
          retryability: retryable ? "automatic" : "operator",
          nextRetryAt,
          leaseOwner: null,
          leaseExpiresAt: null,
        });
        state = writeGithubAutomationRunnerState({
          ...state,
          checkpoint: retryable ? "awaiting_publish" : "blocked",
          reasonCode: job.reasonCode,
        });
        await appendGithubAutomationSafeEvent({
          at: new Date().toISOString(),
          kind: "unattended_publish_error",
          repositoryId: job.repositoryId,
          issueNumber: job.issueNumber,
          jobId: job.jobId,
          deliveryId: job.deliveryId,
          phase: job.phase,
          reasonCode: job.reasonCode,
          traceId: job.traceId,
          meta: { message: message.slice(0, 160), retryable },
        });
        if (retryable && nextRetryAt) {
          return {
            job,
            wakeAgain: false,
            disposition: retryDueDisposition({
              reasonCode,
              nextRetryAt,
              retryClass: "network",
            }),
          };
        }
        return {
          job,
          wakeAgain: false,
          disposition: blockedDisposition({
            reasonCode,
            layer: "publisher",
            checkpoint: "blocked",
            retryability: "operator",
          }),
        };
      }
    }

    // Default: re-queue for next tick if unknown checkpoint mid-flight.
    // Explicit retry_due keeps reason (never runner_no_progress) without inventing progress.
    const nextRetryAt = new Date(Date.now() + 2_000).toISOString();
    job = await persistJob({
      ...job,
      status: "retry_due",
      reasonCode: "runner_continue",
      nextRetryAt,
      retryability: "automatic",
      leaseOwner: null,
      leaseExpiresAt: null,
    });
    return {
      job,
      wakeAgain: true,
      disposition: retryDueDisposition({
        reasonCode: "runner_continue",
        nextRetryAt,
        retryClass: "runtime",
      }),
    };
  } catch (err) {
    const reason = isGithubAutomationError(err)
      ? err.code
      : "unattended_runner_error";
    const message = safeGithubAutomationErrorMessage(err);
    job = await persistJob({
      ...job,
      phase: "blocked",
      status: "blocked",
      checkpoint: "blocked",
      reasonCode: reason,
      blockedAtLayer: "agent",
      retryability: classifyGithubAutomationRetryability(reason),
      leaseOwner: null,
      leaseExpiresAt: null,
    });
    await appendGithubAutomationSafeEvent({
      at: new Date().toISOString(),
      kind: "unattended_runner_error",
      repositoryId: job.repositoryId,
      issueNumber: job.issueNumber,
      jobId: job.jobId,
      deliveryId: job.deliveryId,
      phase: job.phase,
      reasonCode: reason,
      traceId: job.traceId,
      meta: { message: message.slice(0, 160) },
    });
    return {
      job,
      wakeAgain: false,
      disposition: blockedDisposition({
        reasonCode: reason,
        layer: "agent",
        checkpoint: "blocked",
      }),
    };
  } finally {
    inflight.delete(job.jobId);
  }
}

// ─── Legacy / #22 reconcile (GHA-CLOSE-05) ───────────────────────────────────

/** Allowlisted repair codes for operator-visible reconcile summaries. */
export type GithubAutomationLegacyRepairCode =
  | "pending_command_consumed"
  | "space_id_repaired"
  | "checkpoint_normalized"
  | "blocked_layer_cleared_for_resume"
  | "lease_fields_cleared";

export type GithubAutomationLegacyReconcileCode =
  | "reconciled"
  | "unchanged"
  | "not_found"
  | "terminal";

export interface GithubAutomationLegacyReconcileResult {
  code: GithubAutomationLegacyReconcileCode;
  changed: boolean;
  job: GithubAutomationJobRecord | null;
  runner: GithubAutomationRunnerStateV1 | null;
  /** Allowlisted repair codes only — never free text / paths. */
  repairs: GithubAutomationLegacyRepairCode[];
  /** Safe checkpoint after reconcile (null when job missing). */
  safeCheckpoint: string | null;
  generation: number | null;
  /** Legacy `attempt` retained as scheduler-run audit; never rewritten. */
  preservedAttempt: number | null;
}

const SAFE_RESUME_CHECKPOINTS = new Set<GithubAutomationRunnerCheckpoint>([
  "implementation_queued",
  "worktree_ready",
  "studio_task_ready",
  "planning",
  "policy_check",
  "implementing",
  "checking",
  "awaiting_publish",
  "publishing",
]);

/**
 * Compute the last safe durable checkpoint for a legacy/#22-shaped job.
 * Never invents implementing when no Session exists; never advances generation.
 */
export function resolveGithubAutomationSafeRecoveryCheckpoint(input: {
  job: GithubAutomationJobRecord;
  state: GithubAutomationRunnerStateV1 | null;
}): GithubAutomationRunnerCheckpoint {
  const state = input.state;
  const phase = input.job.phase;
  const raw =
    state?.checkpoint ??
    (typeof input.job.checkpoint === "string"
      ? (input.job.checkpoint as GithubAutomationRunnerCheckpoint)
      : null);

  if (
    raw === "awaiting_publish" ||
    raw === "publishing" ||
    phase === "final_policy" ||
    phase === "publishing"
  ) {
    return "awaiting_publish";
  }
  if (raw === "checking" || phase === "checking" || state?.lastMember === "checker") {
    return "checking";
  }
  if (
    state?.sessionId ||
    raw === "implementing" ||
    phase === "implementing" ||
    state?.lastMember === "implementer"
  ) {
    // Only claim implementing when a Session already exists or we were mid-implement.
    if (state?.sessionId || raw === "implementing" || phase === "implementing") {
      return "implementing";
    }
  }
  if (
    state?.taskId ||
    raw === "studio_task_ready" ||
    raw === "planning" ||
    phase === "planning"
  ) {
    return "studio_task_ready";
  }
  if (state?.worktreePath || raw === "worktree_ready") {
    return "worktree_ready";
  }
  if (raw && SAFE_RESUME_CHECKPOINTS.has(raw) && raw !== "blocked") {
    return raw;
  }
  return "implementation_queued";
}

/**
 * Repair missing WorkTree `spaceId` on a runner sidecar (additive write only).
 * Does not create WorkTrees, generations, or Sessions.
 */
export async function repairGithubAutomationRunnerSpaceBinding(input: {
  state: GithubAutomationRunnerStateV1;
  config: GithubAutomationConfigV1;
}): Promise<{ state: GithubAutomationRunnerStateV1; repaired: boolean }> {
  const state = input.state;
  if (state.spaceId || !state.projectId || !state.worktreePath) {
    return { state, repaired: false };
  }
  const repository = findRepositoryConfigById(
    input.config,
    state.repositoryId,
  );
  if (!repository) {
    return { state, repaired: false };
  }
  try {
    const repoRoot = (await resolveGithubAutomationProjectRoot(repository)).rootPath;
    const space = await resolveGithubAutomationWorktreeSpaceId({
      projectId: state.projectId,
      repoRoot,
      worktreePath: state.worktreePath,
      branchName: state.branchName,
      baseRef: state.baseRef,
    });
    if (!space.spaceId) {
      return { state, repaired: false };
    }
    const next = writeGithubAutomationRunnerState({
      ...state,
      spaceId: space.spaceId,
    });
    return { state: next, repaired: true };
  } catch {
    return { state, repaired: false };
  }
}

/**
 * Consume a pending owner command when the durable effect is already
 * `remote_confirmed` (the #22 adoption replay trap). Audit `deliveryId` stays.
 * Idempotent: repeated calls do not re-emit side effects or change generation.
 */
export function consumeGithubAutomationLegacyPendingCommand(
  job: GithubAutomationJobRecord,
): { job: GithubAutomationJobRecord; repaired: boolean } {
  const now = new Date().toISOString();
  const remoteConfirmedCommand = job.effects.find(
    (e) => e.name === "owner_command" && e.status === "remote_confirmed",
  );

  // Prefer exact pending work item; fall back to any pending when delivery matches.
  if (job.pendingCommand?.state === "consumed") {
    return { job, repaired: false };
  }

  if (job.pendingCommand?.state === "pending") {
    const nextPending = {
      ...job.pendingCommand,
      state: "consumed" as const,
      updatedAt: now,
    };
    return {
      job: { ...job, pendingCommand: nextPending },
      repaired: true,
    };
  }

  // Legacy spin: deliveryId still points at adoption, effect remote_confirmed,
  // but pendingCommand was never written (pre-GHA-CLOSE-02 schema).
  if (remoteConfirmedCommand) {
    const commandKey =
      typeof remoteConfirmedCommand.remoteId === "string" &&
      remoteConfirmedCommand.remoteId.trim()
        ? remoteConfirmedCommand.remoteId.trim()
        : `legacy:${job.jobId}:owner_command`;
    return {
      job: {
        ...job,
        pendingCommand: {
          deliveryId: job.deliveryId ?? "",
          commentId: 0,
          versionHash: "legacy_reconcile",
          commandKey,
          state: "consumed",
          updatedAt: now,
        },
      },
      repaired: true,
    };
  }

  return { job, repaired: false };
}

/**
 * Idempotent legacy/#22 reconcile:
 * - consume already remote_confirmed owner commands (no re-side-effect)
 * - repair missing WorkTree spaceId when projectId+path exist
 * - normalize checkpoint to last safe resume point (no Session invent)
 * - preserve generation, attempt, worktree, branch, task, events
 * - never skip policy, never create g2, never delete history
 *
 * Does **not** auto-wake the scheduler. Operator must pause (stop-bleed),
 * deploy/restart, reconcile, then single retry/resume.
 */
export async function reconcileGithubAutomationLegacyJob(input: {
  jobId: string;
  config?: GithubAutomationConfigV1;
}): Promise<GithubAutomationLegacyReconcileResult> {
  const { readGithubAutomationConfig } = await import("./github-automation-config");
  const { readGithubAutomationJob } = await import("./github-automation-store");
  const config = input.config ?? (await readGithubAutomationConfig());
  const existing = await readGithubAutomationJob(input.jobId);
  if (!existing) {
    return {
      code: "not_found",
      changed: false,
      job: null,
      runner: null,
      repairs: [],
      safeCheckpoint: null,
      generation: null,
      preservedAttempt: null,
    };
  }

  if (
    existing.status === "completed" ||
    existing.status === "cancelled" ||
    existing.status === "ignored" ||
    existing.phase === "completed" ||
    existing.phase === "cancelled"
  ) {
    return {
      code: "terminal",
      changed: false,
      job: existing,
      runner: readGithubAutomationRunnerState(existing.jobId),
      repairs: [],
      safeCheckpoint: existing.checkpoint,
      generation: existing.generation,
      preservedAttempt: existing.attempt,
    };
  }

  const repairs: GithubAutomationLegacyRepairCode[] = [];
  let job = existing;
  let state = readGithubAutomationRunnerState(job.jobId);
  const preservedAttempt = job.attempt;
  const generation = job.generation;

  // 1) One-shot command consume for already-confirmed adoption.
  const commandResult = consumeGithubAutomationLegacyPendingCommand(job);
  if (commandResult.repaired) {
    job = commandResult.job;
    repairs.push("pending_command_consumed");
  }

  // 2) spaceId repair on runner sidecar (reuse g1 WorkTree).
  if (state) {
    const spaceResult = await repairGithubAutomationRunnerSpaceBinding({
      state,
      config,
    });
    if (spaceResult.repaired) {
      state = spaceResult.state;
      repairs.push("space_id_repaired");
    }
  }

  // 3) Safe checkpoint normalization — never invent Session / implementing without evidence.
  const safeCheckpoint = resolveGithubAutomationSafeRecoveryCheckpoint({
    job,
    state,
  });
  const jobCheckpoint = job.checkpoint;
  const runnerCheckpoint = state?.checkpoint ?? null;
  const clearStalePlanBlock =
    (job.phase === "planning" || job.checkpoint === "studio_task_ready") &&
    safeCheckpoint === "studio_task_ready" &&
    job.blockedAtLayer === "policy_plan" &&
    !state?.sessionId;
  const needsCheckpointNorm =
    jobCheckpoint !== safeCheckpoint ||
    (state != null && runnerCheckpoint !== safeCheckpoint) ||
    clearStalePlanBlock;

  if (needsCheckpointNorm) {
    if (state) {
      state = writeGithubAutomationRunnerState({
        ...state,
        checkpoint: safeCheckpoint,
        // Do not clear pauseRequested here — operator owns pause/resume.
        reasonCode:
          state.reasonCode === "retry_wake" ? state.reasonCode : "legacy_reconciled",
      });
    }
    let nextPhase = job.phase;
    if (safeCheckpoint === "studio_task_ready" || safeCheckpoint === "planning") {
      nextPhase = "planning";
    } else if (safeCheckpoint === "checking") {
      nextPhase = "checking";
    } else if (
      safeCheckpoint === "awaiting_publish" ||
      safeCheckpoint === "publishing"
    ) {
      nextPhase = "final_policy";
    } else if (safeCheckpoint === "implementing") {
      nextPhase = "implementing";
    } else if (
      job.phase === "blocked" &&
      (safeCheckpoint === "worktree_ready" ||
        safeCheckpoint === "implementation_queued")
    ) {
      nextPhase = "implementation_queued";
    }
    job = {
      ...job,
      checkpoint: safeCheckpoint,
      phase: nextPhase,
      blockedAtLayer: clearStalePlanBlock ? null : job.blockedAtLayer,
      blockFingerprint: clearStalePlanBlock ? null : job.blockFingerprint,
      // Preserve attempt / generation / deliveryId / effects history.
      attempt: preservedAttempt,
      generation,
    };
    repairs.push("checkpoint_normalized");
    if (clearStalePlanBlock) {
      repairs.push("blocked_layer_cleared_for_resume");
    }
  }

  // 4) Clear stale lease ownership when not actively fenced (offline reconcile).
  if (job.leaseOwner || job.leaseExpiresAt) {
    job = {
      ...job,
      leaseOwner: null,
      leaseExpiresAt: null,
      leaseFencingToken: null,
      leaseHeartbeatAt: null,
    };
    repairs.push("lease_fields_cleared");
  }

  if (repairs.length === 0) {
    return {
      code: "unchanged",
      changed: false,
      job,
      runner: state,
      repairs: [],
      safeCheckpoint,
      generation,
      preservedAttempt,
    };
  }

  job = await persistJob({
    ...job,
    // Reason is safe enum-like; do not wipe operator pause/retry reasons.
    reasonCode:
      job.reasonCode === "retry_wake" ||
      job.reasonCode === "paused" ||
      job.reasonCode === "pause_requested" ||
      job.reasonCode === "resume_wake"
        ? job.reasonCode
        : job.reasonCode ?? "legacy_reconciled",
    attempt: preservedAttempt,
    generation,
  });

  await appendGithubAutomationSafeEvent({
    at: new Date().toISOString(),
    kind: "legacy_job_reconciled",
    repositoryId: job.repositoryId,
    issueNumber: job.issueNumber,
    jobId: job.jobId,
    deliveryId: job.deliveryId,
    phase: job.phase,
    reasonCode: "legacy_reconciled",
    traceId: job.traceId,
    meta: {
      repairCount: repairs.length,
      // Bounded join of allowlisted codes only.
      repairs: repairs.join(",").slice(0, 160),
      safeCheckpoint,
      generation,
      preservedAttempt,
      injectsCommentText: false,
      createsGeneration: false,
    },
  });

  return {
    code: "reconciled",
    changed: true,
    job,
    runner: state,
    repairs,
    safeCheckpoint,
    generation,
    preservedAttempt,
  };
}

/**
 * True when a deterministic policy/manual block must not be re-run blindly:
 * fingerprint present and evaluated provenance still matches the live process.
 * Missing fingerprint/provenance (legacy) ⇒ allow one operator re-evaluation.
 */
export function isGithubAutomationDeterministicBlockUnchanged(
  job: GithubAutomationJobRecord,
  runtime?: { codeRevision: string; policyVersion: string },
): boolean {
  const retryability =
    typeof job.retryability === "string" && job.retryability
      ? job.retryability
      : null;
  const isDeterministic =
    retryability === "operator_after_change" ||
    (job.reasonCode != null &&
      (job.reasonCode.startsWith("blocked_") ||
        job.reasonCode === "blocked_manual_ui_approval"));
  if (!isDeterministic) return false;
  if (job.status !== "blocked" && job.phase !== "blocked") return false;
  if (!job.blockFingerprint) return false;
  if (!job.evaluatedCodeRevision || !job.evaluatedPolicyVersion) return false;
  let codeRevision = runtime?.codeRevision ?? null;
  let policyVersion = runtime?.policyVersion ?? null;
  if (!codeRevision || !policyVersion) {
    try {
      const live = getGithubAutomationEvaluatedProvenance();
      codeRevision = codeRevision ?? live.codeRevision;
      policyVersion = policyVersion ?? live.policyVersion;
    } catch {
      return false;
    }
  }
  return (
    job.evaluatedCodeRevision === codeRevision &&
    job.evaluatedPolicyVersion === policyVersion
  );
}

// ─── Pause / resume / retry wake ─────────────────────────────────────────────

/**
 * Request pause at next checkpoint (does not kill in-flight OS commands).
 */
export async function requestGithubUnattendedJobPause(
  jobId: string,
): Promise<GithubAutomationRunnerStateV1 | null> {
  const state = readGithubAutomationRunnerState(jobId);
  if (!state) return null;
  return writeGithubAutomationRunnerState({
    ...state,
    pauseRequested: true,
    reasonCode: "pause_requested",
  });
}

/**
 * Clear pause flag and mark job queued so scheduler can resume same generation.
 * Comment "@bot 重试" should call this (or queue path) — never inject comment text as agent command.
 *
 * When the job/runner is parked at `blocked`, roll the durable checkpoint back to the last
 * safe advance point (worktree / Studio task / implementing / checking / publish). Otherwise a
 * plan-policy false positive leaves checkpoint=blocked and plain re-queue never starts a session.
 */
function resolveGithubUnattendedRetryResume(input: {
  job: GithubAutomationJobRecord;
  state: GithubAutomationRunnerStateV1 | null;
}): {
  phase: GithubAutomationJobRecord["phase"];
  checkpoint: GithubAutomationRunnerCheckpoint;
} {
  const state = input.state;
  const phase = input.job.phase;
  const checkpoint =
    state?.checkpoint ??
    (input.job.checkpoint as GithubAutomationRunnerCheckpoint | null) ??
    null;

  if (
    checkpoint === "awaiting_publish" ||
    checkpoint === "publishing" ||
    phase === "final_policy" ||
    phase === "publishing"
  ) {
    return { phase: "final_policy", checkpoint: "awaiting_publish" };
  }

  if (
    checkpoint === "blocked" ||
    phase === "blocked" ||
    input.job.status === "blocked"
  ) {
    if (state?.lastMember === "checker" || checkpoint === "checking") {
      return { phase: "checking", checkpoint: "checking" };
    }
    if (
      state?.lastMember === "implementer" ||
      state?.sessionId ||
      checkpoint === "implementing" ||
      phase === "implementing"
    ) {
      return { phase: "implementing", checkpoint: "implementing" };
    }
    if (state?.taskId) {
      return { phase: "planning", checkpoint: "studio_task_ready" };
    }
    if (state?.worktreePath) {
      return {
        phase: "implementation_queued",
        checkpoint: "worktree_ready",
      };
    }
    return {
      phase: "implementation_queued",
      checkpoint: "implementation_queued",
    };
  }

  if (phase === "paused") {
    if (checkpoint === "checking") {
      return { phase: "checking", checkpoint: "checking" };
    }
    if (checkpoint === "studio_task_ready" || checkpoint === "planning") {
      return { phase: "planning", checkpoint: "studio_task_ready" };
    }
    if (
      checkpoint === "worktree_ready" ||
      checkpoint === "implementation_queued"
    ) {
      return {
        phase: "implementation_queued",
        checkpoint: checkpoint ?? "worktree_ready",
      };
    }
    return { phase: "implementing", checkpoint: "implementing" };
  }

  // retry_due / other non-blocked phases keep their durable phase and checkpoint.
  return {
    phase,
    checkpoint: checkpoint ?? "implementation_queued",
  };
}

export async function wakeGithubUnattendedJobForRetry(input: {
  job: GithubAutomationJobRecord;
  clearPause?: boolean;
  /** Optional config for legacy reconcile (spaceId repair). */
  config?: GithubAutomationConfigV1;
}): Promise<GithubAutomationJobRecord> {
  // GHA-CLOSE-05: idempotent legacy normalize before wake (command consume, space, checkpoint).
  // Does not create generation / skip policy / delete history.
  let job = input.job;
  try {
    const reconciled = await reconcileGithubAutomationLegacyJob({
      jobId: input.job.jobId,
      config: input.config,
    });
    if (reconciled.job) {
      job = reconciled.job;
    }
  } catch {
    // Reconcile is best-effort; wake still uses durable resume rules.
  }
  let state = readGithubAutomationRunnerState(job.jobId);
  const resume = resolveGithubUnattendedRetryResume({
    job,
    state,
  });
  if (state) {
    state = writeGithubAutomationRunnerState({
      ...state,
      checkpoint: resume.checkpoint,
      pauseRequested: input.clearPause === false ? state.pauseRequested : false,
      reasonCode: "retry_wake",
    });
  }
  job = await persistJob({
    ...job,
    status: "queued",
    phase: resume.phase,
    checkpoint: resume.checkpoint,
    reasonCode: "retry_wake",
    nextRetryAt: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    // Preserve legacy scheduler-run audit counter; do not reset attempt.
    attempt: job.attempt,
    generation: job.generation,
  });
  await appendGithubAutomationSafeEvent({
    at: new Date().toISOString(),
    kind: "unattended_retry_wake",
    repositoryId: job.repositoryId,
    issueNumber: job.issueNumber,
    jobId: job.jobId,
    deliveryId: job.deliveryId,
    phase: job.phase,
    reasonCode: job.reasonCode,
    traceId: job.traceId,
    meta: {
      // Explicit: retry does not inject comment command text into agent.
      injectsCommentText: false,
      resumeCheckpoint: resume.checkpoint,
    },
  });
  return job;
}

/**
 * Entry used by triage handler when unattended is enabled after owner adoption.
 */
export async function handleGithubUnattendedAfterOwnerAdoption(input: {
  job: GithubAutomationJobRecord;
  config: GithubAutomationConfigV1;
  ownerActorId: number;
  ownerCommentId: number;
  ownerCommentStrippedText: string;
  matchedPhrase?: string | null;
  claimComplete: boolean;
}): Promise<GithubAutomationJobHandlerResult> {
  const owner: GithubOwnerAuthorizationSeed = {
    ownerActorId: input.ownerActorId,
    ownerCommentId: input.ownerCommentId,
    ownerCommentHash: hashGithubOwnerCommentForAuthorization(
      input.ownerCommentStrippedText,
    ),
    matchedPhrase: input.matchedPhrase ?? undefined,
  };
  return queueGithubUnattendedImplementation({
    job: input.job,
    config: input.config,
    owner,
    claimComplete: input.claimComplete,
  });
}

/**
 * Scheduler-facing continue for jobs already past accepted_waiting_automation.
 */
export async function continueGithubUnattendedJob(input: {
  job: GithubAutomationJobRecord;
  config: GithubAutomationConfigV1;
}): Promise<GithubAutomationJobHandlerResult | null> {
  const phase = input.job.phase;
  const unattendedPhases = new Set([
    "implementation_queued",
    "planning",
    "policy_check",
    "implementing",
    "checking",
    "final_policy",
    "publishing",
    "pr_open",
    "paused",
    "retry_due",
  ]);
  if (!unattendedPhases.has(phase) && input.job.checkpoint !== "implementation_queued") {
    return null;
  }

  // Already published — terminal.
  const state = readGithubAutomationRunnerState(input.job.jobId);
  if (
    phase === "pr_open" ||
    state?.checkpoint === "pr_open" ||
    input.job.status === "completed"
  ) {
    return {
      job: input.job,
      wakeAgain: false,
    };
  }

  // Claim completeness from issue state when available.
  const issueState = await readGithubAutomationIssueState(
    input.job.repositoryId,
    input.job.issueNumber,
  );
  const claimComplete = issueState?.claimStatus === "complete";

  return runGithubUnattendedImplementation({
    job: input.job,
    config: input.config,
    claimComplete,
  });
}

/**
 * Test helper: inspect whether a task exists and is unattended-authorized.
 */
export function inspectGithubUnattendedTaskAuthorization(input: {
  worktreePath: string;
  taskId: string;
}): {
  exists: boolean;
  executionMode: string | null;
  authorized: boolean;
  hasPolicyGrant: boolean;
  hasOwnerAuthorization: boolean;
  hasApprovalGrant: boolean;
} {
  const task = getYpiStudioTaskDetail(input.worktreePath, input.taskId);
  if (!task) {
    return {
      exists: false,
      executionMode: null,
      authorized: false,
      hasPolicyGrant: false,
      hasOwnerAuthorization: false,
      hasApprovalGrant: false,
    };
  }
  const auth = evaluateYpiStudioUnattendedImplementationAuthorization(
    task as unknown as import("./ypi-studio-types").YpiStudioTaskRecord,
  );
  return {
    exists: true,
    executionMode: task.meta?.executionMode ?? null,
    authorized: auth.authorized,
    hasPolicyGrant: Boolean(task.meta?.policyGrant),
    hasOwnerAuthorization: Boolean(task.meta?.ownerAuthorization),
    hasApprovalGrant: Boolean(task.meta?.approvalGrant),
  };
}

// Re-export error type for callers.
export { GithubAutomationError };
