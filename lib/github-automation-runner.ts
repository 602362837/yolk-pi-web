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
  GithubAutomationConfigV1,
  GithubAutomationRepositoryConfig,
} from "./github-automation-types";
import {
  GITHUB_FULL_AGENT_PROFILE,
  scrubGithubAutomationOwnedSecretsFromEnv,
  containsGithubAutomationSecretInjectionMarker,
} from "./github-full-agent-profile";
import {
  ensureGithubAutomationWorktree,
  resolveGithubAutomationProjectRoot,
  assertWorktreeNotControlledByIssue,
} from "./github-automation-worktree";
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
  const next = { ...job, updatedAt: new Date().toISOString() };
  await writeGithubAutomationJob(next);
  return next;
}

function effectRemoteId(pathOrId: string | null | undefined): string | null {
  if (!pathOrId) return null;
  // Store basename only — never absolute paths in effect markers projected later.
  const parts = pathOrId.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || pathOrId.slice(0, 80);
}

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
      leaseOwner: null,
      leaseExpiresAt: null,
    });
    return { job, wakeAgain: false };
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
    const job = await persistJob({
      ...input.job,
      phase: "implementation_queued",
      status: "retry_due",
      checkpoint: "implementation_queued",
      reasonCode: "unattended_concurrency_limit",
      nextRetryAt: new Date(Date.now() + 15_000).toISOString(),
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
    return { job, wakeAgain: true };
  }

  if (!gates.ok) {
    const job = await persistJob({
      ...input.job,
      phase: "blocked",
      status: "blocked",
      checkpoint: "blocked",
      reasonCode: gates.reasonCode,
      leaseOwner: null,
      leaseExpiresAt: null,
    });
    return { job, wakeAgain: false };
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
      job = await persistJob({
        ...job,
        phase: job.phase === "received" ? "implementation_queued" : job.phase,
        status: "retry_due",
        reasonCode: gates.reasonCode,
        nextRetryAt: new Date(Date.now() + 15_000).toISOString(),
        leaseOwner: null,
        leaseExpiresAt: null,
      });
      return { job, wakeAgain: gates.reasonCode === "unattended_concurrency_limit" };
    }
    job = await persistJob({
      ...job,
      phase: "blocked",
      status: "blocked",
      checkpoint: "blocked",
      reasonCode: gates.reasonCode,
      leaseOwner: null,
      leaseExpiresAt: null,
    });
    return { job, wakeAgain: false };
  }

  const repository = gates.repository!;
  const inflight = unattendedInFlight();
  inflight.add(job.jobId);

  try {
    // Scrub automation-owned secrets from process env for the duration of agent work.
    scrubGithubAutomationOwnedSecretsFromEnv(process.env);

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
          leaseOwner: null,
          leaseExpiresAt: null,
        });
        return { job, wakeAgain: false };
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
        job = await persistJob({
          ...job,
          phase: "blocked",
          status: "blocked",
          checkpoint: "blocked",
          reasonCode: ensured.authorizationReasonCode ?? "policy_not_authorized",
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
        return { job, wakeAgain: false };
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
          issueTitlePreview: job.issueTitlePreview,
          planText: job.issueTitlePreview,
          // Empty/WIP tree is ok at plan; title hints can still block UI/release/secret.
          snapshot: {
            baseRef: state.baseRef || repository.baseRef || "main",
            files: [],
            nameStatusRawPreview: "",
            numstatRawPreview: "",
          },
        });
        if (planGate.policy.decision === "block") {
          job = await persistJob({
            ...job,
            phase: "blocked",
            status: "blocked",
            checkpoint: "blocked",
            reasonCode: planGate.policy.reasonCode,
            leaseOwner: null,
            leaseExpiresAt: null,
          });
          state = writeGithubAutomationRunnerState({
            ...state,
            checkpoint: "blocked",
            reasonCode: planGate.policy.reasonCode,
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
          return { job, wakeAgain: false };
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
        job = await persistJob({
          ...job,
          phase: "blocked",
          status: "blocked",
          checkpoint: "blocked",
          reasonCode: uiBlocked
            ? "blocked_manual_ui_approval"
            : "policy_transition_failed",
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
          meta: { message: message.slice(0, 160) },
        });
        return { job, wakeAgain: false };
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

      // Bootstrap session once for parent context (full tools).
      if (!state.sessionId) {
        try {
          const boot = await bootstrapGithubAutomationAgentSession({
            worktreePath: state.worktreePath!,
            projectId: state.projectId,
          });
          // Dispose immediately — child runs use SDK sessions; we only need binding ids.
          try {
            // AgentSessionWrapper.destroy/dispose may not always exist; best-effort.
            const disposable = boot.session as { dispose?: () => void; destroy?: () => void };
            disposable.dispose?.();
            disposable.destroy?.();
          } catch {
            // ignore
          }
          state = writeGithubAutomationRunnerState({
            ...state,
            sessionId: boot.sessionId,
            contextId: boot.contextId,
            sessionFile:
              (boot as { sessionFile?: string | null }).sessionFile ??
              boot.session.sessionFile ??
              null,
          });
        } catch (err) {
          // Session bootstrap failure is non-fatal for pure child SDK path; record safe reason.
          await appendGithubAutomationSafeEvent({
            at: new Date().toISOString(),
            kind: "unattended_session_bootstrap_failed",
            repositoryId: job.repositoryId,
            issueNumber: job.issueNumber,
            jobId: job.jobId,
            deliveryId: job.deliveryId,
            phase: job.phase,
            reasonCode: "session_bootstrap_failed",
            traceId: job.traceId,
            meta: {
              message: safeGithubAutomationErrorMessage(err).slice(0, 120),
            },
          });
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
          return { job, wakeAgain: false };
        }

        if (result.status === "failed") {
          job = await persistJob({
            ...job,
            phase: "blocked",
            status: "blocked",
            checkpoint: "blocked",
            reasonCode: "implementer_failed",
            leaseOwner: null,
            leaseExpiresAt: null,
          });
          return { job, wakeAgain: false };
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // runtime_lost / preflight: park for retry rather than hard block when recoverable
        const retryable =
          /runtime_lost|preflight|ECONNRESET|timed out/i.test(message);
        job = await persistJob({
          ...job,
          phase: retryable ? "implementing" : "blocked",
          status: retryable ? "retry_due" : "blocked",
          checkpoint: retryable ? "implementing" : "blocked",
          reasonCode: retryable ? "implementer_retry" : "implementer_error",
          nextRetryAt: retryable
            ? new Date(Date.now() + 20_000).toISOString()
            : null,
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
          meta: { message: message.slice(0, 160), retryable },
        });
        return { job, wakeAgain: retryable };
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
        job = await persistJob({
          ...job,
          phase: "blocked",
          status: "blocked",
          checkpoint: "blocked",
          reasonCode: validation.reasonCode ?? "validation_failed",
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
        return { job, wakeAgain: false };
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
          leaseOwner: null,
          leaseExpiresAt: null,
        });
        return { job, wakeAgain: false };
      }

      if (!state.worktreePath || !state.branchName || !state.baseRef) {
        job = await persistJob({
          ...job,
          phase: "blocked",
          status: "blocked",
          checkpoint: "blocked",
          reasonCode: "missing_worktree_for_publish",
          leaseOwner: null,
          leaseExpiresAt: null,
        });
        return { job, wakeAgain: false };
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
          leaseOwner: null,
          leaseExpiresAt: null,
        });
        return { job, wakeAgain: false };
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
        job = await persistJob({
          ...job,
          phase: "blocked",
          status: "blocked",
          checkpoint: "blocked",
          reasonCode: finalEval.policy.reasonCode,
          leaseOwner: null,
          leaseExpiresAt: null,
        });
        state = writeGithubAutomationRunnerState({
          ...state,
          checkpoint: "blocked",
          reasonCode: finalEval.policy.reasonCode,
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
        return { job, wakeAgain: false };
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
          return { job, wakeAgain: false };
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

        return { job, wakeAgain: false };
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

        job = await persistJob({
          ...job,
          phase: retryable ? "publishing" : "blocked",
          status: retryable ? "retry_due" : "blocked",
          checkpoint: retryable ? "awaiting_publish" : "blocked",
          reasonCode: retryable ? "publish_retry" : reason,
          nextRetryAt: retryable
            ? new Date(Date.now() + 30_000).toISOString()
            : null,
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
        return { job, wakeAgain: retryable };
      }
    }

    // Default: re-queue for next tick if unknown checkpoint mid-flight.
    job = await persistJob({
      ...job,
      status: "queued",
      reasonCode: "runner_continue",
      leaseOwner: null,
      leaseExpiresAt: null,
    });
    return { job, wakeAgain: true };
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
    return { job, wakeAgain: false };
  } finally {
    inflight.delete(job.jobId);
  }
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
 */
export async function wakeGithubUnattendedJobForRetry(input: {
  job: GithubAutomationJobRecord;
  clearPause?: boolean;
}): Promise<GithubAutomationJobRecord> {
  let state = readGithubAutomationRunnerState(input.job.jobId);
  if (state) {
    state = writeGithubAutomationRunnerState({
      ...state,
      pauseRequested: input.clearPause === false ? state.pauseRequested : false,
      reasonCode: "retry_wake",
    });
  }
  const job = await persistJob({
    ...input.job,
    status: "queued",
    phase:
      input.job.phase === "paused" || input.job.phase === "retry_due"
        ? state?.checkpoint === "awaiting_publish"
          ? "final_policy"
          : input.job.phase === "paused"
            ? "implementing"
            : input.job.phase
        : input.job.phase,
    reasonCode: "retry_wake",
    nextRetryAt: null,
    leaseOwner: null,
    leaseExpiresAt: null,
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
