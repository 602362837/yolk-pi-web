/**
 * github-automation-runtime — webhook accept path orchestration (GHA-02).
 *
 * Flow:
 *   capped raw body → HMAC verify → JSON parse → allowlisted envelope
 *   → config/allowlist/mode checks → exclusive delivery create → enqueue job
 *   → async scheduler wake → 202
 *
 * Never runs LLM/Git/GitHub mutation work on the request thread beyond durable enqueue.
 * Never persists raw body, signature, credentials, or Issue/comment full text.
 */

import {
  findRepositoryConfigById,
  isRepositoryAllowlisted,
  readGithubAutomationConfig,
} from "./github-automation-config";
import {
  isGithubAutomationError,
  safeGithubAutomationErrorMessage,
} from "./github-automation-errors";
import type { GithubAutomationConfigV1 } from "./github-automation-types";
import { loadGithubAppWebhookSecret } from "./github-app-credentials";
import {
  appendGithubAutomationSafeEvent,
  createGithubAutomationDelivery,
  createQueuedGithubAutomationJob,
  ensureGithubAutomationStoreLayout,
  hashWebhookBodyPrefix,
  parseGithubWebhookEnvelope,
  readGithubAutomationIssueState,
  readGithubAutomationJob,
  upsertGithubAutomationIssueState,
  withGithubAutomationIssueLease,
  writeGithubAutomationDelivery,
  writeGithubAutomationJob,
  type GithubAutomationActorSource,
  type GithubAutomationDeliveryIgnoreReason,
  type GithubAutomationDeliveryRecord,
  type GithubAutomationJobRecord,
  type GithubWebhookEnvelope,
} from "./github-automation-store";
import {
  ensureGithubAutomationScheduler,
  wakeGithubAutomationScheduler,
} from "./github-automation-scheduler";
import {
  assertValidGithubWebhookSignature,
  GITHUB_WEBHOOK_MAX_BODY_BYTES,
  readCappedWebhookRawBody,
} from "./github-webhook-verify";
import { loadGithubAppCredentials } from "./github-app-credentials";
import { registerGithubIssueTriageHandler } from "./github-issue-triage-runner";
import { reconcileGithubPullRequestEvent } from "./github-pr-lifecycle";

let _triageHandlerRegistered = false;
let _triageAutoRegisterDisabled = false;

/** Ensure GHA-03 claim/triage handler is bound exactly once per process. */
function ensureGithubIssueTriageHandlerRegistered(): void {
  if (_triageAutoRegisterDisabled) return;
  if (_triageHandlerRegistered) return;
  registerGithubIssueTriageHandler();
  _triageHandlerRegistered = true;
}

/** Test helper: allow re-registration after scheduler handler reset. */
export function _testResetGithubIssueTriageHandlerRegistration(): void {
  _triageHandlerRegistered = false;
}

/**
 * Test helper: disable auto-register so GHA-02 default handler tests stay isolated.
 * Production always auto-registers on webhook accept.
 */
export function _testSetGithubIssueTriageAutoRegisterDisabled(
  disabled: boolean,
): void {
  _triageAutoRegisterDisabled = disabled;
  if (disabled) {
    _triageHandlerRegistered = false;
  }
}

// ─── Response types (safe) ───────────────────────────────────────────────────

export type GithubAutomationWebhookResultCode =
  | "enqueued"
  | "duplicate"
  | "ignored"
  | "paused"
  | "unauthorized"
  | "payload_too_large"
  | "bad_request"
  | "not_configured"
  | "error";

export interface GithubAutomationWebhookResult {
  httpStatus: number;
  code: GithubAutomationWebhookResultCode;
  /** Safe operator-facing message (no secrets). */
  message: string;
  deliveryId: string | null;
  jobId: string | null;
  disposition: GithubAutomationDeliveryRecord["disposition"] | null;
  ignoreReason: GithubAutomationDeliveryIgnoreReason | null;
}

// ─── Header helpers ──────────────────────────────────────────────────────────

export function getGithubWebhookEventName(
  headers: Headers | { get(name: string): string | null },
): string | null {
  const value = headers.get("x-github-event") ?? headers.get("X-GitHub-Event");
  if (typeof value !== "string" || !value.trim()) return null;
  return value.trim();
}

export function getGithubWebhookDeliveryId(
  headers: Headers | { get(name: string): string | null },
): string | null {
  const value =
    headers.get("x-github-delivery") ?? headers.get("X-GitHub-Delivery");
  if (typeof value !== "string" || !value.trim()) return null;
  return value.trim();
}

export function getGithubWebhookSignatureHeader(
  headers: Headers | { get(name: string): string | null },
): string | null {
  return (
    headers.get("x-hub-signature-256") ??
    headers.get("X-Hub-Signature-256") ??
    null
  );
}

// ─── Disposition policy (LOOP-01: actor/source + action matrix + generation) ─

export type GithubAutomationLifecycleKind =
  | "none"
  | "issue_closed"
  | "issue_reopened"
  | "pull_request";

export interface GithubAutomationIngressClassification {
  actorSource: GithubAutomationActorSource;
  ignoreReason: GithubAutomationDeliveryIgnoreReason | null;
  /** True when this delivery may create/bind an Issue job (subject to paused + generation). */
  enqueueEligible: boolean;
  lifecycle: GithubAutomationLifecycleKind;
}

/**
 * Resolve effective App ID for self-event detection without requiring a full
 * credential load when only the id is available. Fail closed to null.
 */
export async function resolveEffectiveGithubAppIdNumber(): Promise<number | null> {
  try {
    const credentials = await loadGithubAppCredentials();
    const n = Number.parseInt(credentials.appId, 10);
    if (Number.isInteger(n) && n > 0) return n;
  } catch {
    // Incomplete credentials are common in tests that only set webhook secret.
  }
  return null;
}

/**
 * Classify delivery actor source.
 * Priority: performedViaAppId === effectiveAppId → self_app;
 * senderType Bot/App → bot_actor; positive human sender id → human_actor; else unknown.
 * Login strings are never used as the sole identity key.
 */
export function classifyGithubWebhookActorSource(
  envelope: Pick<
    GithubWebhookEnvelope,
    "senderId" | "senderType" | "performedViaAppId"
  >,
  effectiveAppId: number | null,
): GithubAutomationActorSource {
  if (
    effectiveAppId !== null &&
    envelope.performedViaAppId !== null &&
    envelope.performedViaAppId === effectiveAppId
  ) {
    return "self_app";
  }

  const senderType =
    typeof envelope.senderType === "string" ? envelope.senderType.trim() : "";
  if (senderType === "Bot" || senderType === "App") {
    return "bot_actor";
  }

  if (envelope.senderId !== null && envelope.senderId > 0) {
    // Non-Bot with a positive id — treat as human unless proven otherwise.
    if (!senderType || senderType === "User") {
      return "human_actor";
    }
    // Unknown non-empty type with id: fail closed.
    return "unknown_actor";
  }

  return "unknown_actor";
}

function isTerminalJobStatus(status: GithubAutomationJobRecord["status"]): boolean {
  return (
    status === "completed" || status === "cancelled" || status === "ignored"
  );
}

/**
 * Events that may open a new Issue automation generation.
 * Comment/label/assign/closed/status must never bump generation alone.
 */
export function isGithubAutomationGenerationEligible(
  envelope: Pick<GithubWebhookEnvelope, "eventName" | "action">,
): boolean {
  if (envelope.eventName === "issues") {
    return envelope.action === "opened" || envelope.action === "reopened";
  }
  return false;
}

/**
 * Human issue/issue_comment actions that may bind or create job work.
 * Self/Bot are filtered before this matrix applies.
 */
function classifyIssueActionMatrix(
  envelope: GithubWebhookEnvelope,
  actorSource: GithubAutomationActorSource,
): Pick<
  GithubAutomationIngressClassification,
  "ignoreReason" | "enqueueEligible" | "lifecycle"
> {
  // Self / Bot / unknown: audit-only, zero job/wake (even for opened).
  if (actorSource === "self_app") {
    return {
      ignoreReason: "self_app_event",
      enqueueEligible: false,
      lifecycle: "none",
    };
  }
  if (actorSource === "bot_actor") {
    return {
      ignoreReason: "bot_actor_event",
      enqueueEligible: false,
      lifecycle: "none",
    };
  }
  if (actorSource === "unknown_actor") {
    return {
      ignoreReason: "unknown_actor",
      enqueueEligible: false,
      lifecycle: "none",
    };
  }

  // human_actor
  if (envelope.eventName === "issues") {
    const action = envelope.action ?? "";
    switch (action) {
      case "opened":
        return {
          ignoreReason: null,
          enqueueEligible: true,
          lifecycle: "none",
        };
      case "reopened":
        return {
          ignoreReason: null,
          enqueueEligible: true,
          lifecycle: "issue_reopened",
        };
      case "edited":
        // Restricted re-triage only against existing non-terminal work (no free gen++).
        return {
          ignoreReason: null,
          enqueueEligible: true,
          lifecycle: "none",
        };
      case "closed":
        return {
          ignoreReason: "lifecycle_only",
          enqueueEligible: false,
          lifecycle: "issue_closed",
        };
      case "assigned":
      case "unassigned":
      case "labeled":
      case "unlabeled":
      case "milestoned":
      case "demilestoned":
      case "pinned":
      case "unpinned":
      case "locked":
      case "unlocked":
      case "transferred":
      case "deleted":
        return {
          ignoreReason: "non_actionable_action",
          enqueueEligible: false,
          lifecycle: "none",
        };
      default:
        return {
          ignoreReason: "non_actionable_action",
          enqueueEligible: false,
          lifecycle: "none",
        };
    }
  }

  if (envelope.eventName === "issue_comment") {
    const action = envelope.action ?? "";
    if (action === "created" || action === "edited") {
      return {
        ignoreReason: null,
        enqueueEligible: true,
        lifecycle: "none",
      };
    }
    if (action === "deleted") {
      return {
        ignoreReason: "comment_deleted",
        enqueueEligible: false,
        lifecycle: "none",
      };
    }
    return {
      ignoreReason: "non_actionable_action",
      enqueueEligible: false,
      lifecycle: "none",
    };
  }

  return {
    ignoreReason: "unknown_event",
    enqueueEligible: false,
    lifecycle: "none",
  };
}

/**
 * Full ingress classification: config allowlist → actor source → action matrix.
 * Global paused is applied after this (delivery disposition paused, still no enqueue).
 */
export function classifyGithubAutomationIngress(
  envelope: GithubWebhookEnvelope,
  config: GithubAutomationConfigV1,
  effectiveAppId: number | null,
): GithubAutomationIngressClassification {
  const actorSource = classifyGithubWebhookActorSource(envelope, effectiveAppId);

  if (envelope.eventName === "ping") {
    return {
      actorSource,
      ignoreReason: "unknown_event",
      enqueueEligible: false,
      lifecycle: "none",
    };
  }
  if (!envelope.knownEvent) {
    return {
      actorSource,
      ignoreReason: "unknown_event",
      enqueueEligible: false,
      lifecycle: "none",
    };
  }
  if (
    envelope.eventName === "installation" ||
    envelope.eventName === "installation_repositories"
  ) {
    return {
      actorSource,
      ignoreReason: "unknown_event",
      enqueueEligible: false,
      lifecycle: "none",
    };
  }

  if (!config.enabled || config.mode === "off") {
    return {
      actorSource,
      ignoreReason: config.enabled ? "mode_off" : "automation_disabled",
      enqueueEligible: false,
      lifecycle: "none",
    };
  }

  if (envelope.repositoryId === null) {
    return {
      actorSource,
      ignoreReason: "malformed_envelope",
      enqueueEligible: false,
      lifecycle: "none",
    };
  }

  if (!isRepositoryAllowlisted(config, envelope.repositoryId)) {
    return {
      actorSource,
      ignoreReason: "repository_not_allowlisted",
      enqueueEligible: false,
      lifecycle: "none",
    };
  }

  if (envelope.eventName === "pull_request") {
    // PR path never creates Issue jobs; reconcile on non-enqueue path.
    return {
      actorSource,
      ignoreReason: null,
      enqueueEligible: false,
      lifecycle: "pull_request",
    };
  }

  if (
    envelope.eventName === "issues" ||
    envelope.eventName === "issue_comment"
  ) {
    if (envelope.issueNumber === null) {
      return {
        actorSource,
        ignoreReason: "missing_issue",
        enqueueEligible: false,
        lifecycle: "none",
      };
    }
    const repo = findRepositoryConfigById(config, envelope.repositoryId);
    if (
      repo?.installationId !== null &&
      repo?.installationId !== undefined &&
      envelope.installationId !== null &&
      repo.installationId !== envelope.installationId
    ) {
      return {
        actorSource,
        ignoreReason: "installation_mismatch",
        enqueueEligible: false,
        lifecycle: "none",
      };
    }

    const matrix = classifyIssueActionMatrix(envelope, actorSource);
    return {
      actorSource,
      ignoreReason: matrix.ignoreReason,
      enqueueEligible: matrix.enqueueEligible,
      lifecycle: matrix.lifecycle,
    };
  }

  return {
    actorSource,
    ignoreReason: "unknown_event",
    enqueueEligible: false,
    lifecycle: "none",
  };
}

function shouldEnqueueIssueJob(
  envelope: GithubWebhookEnvelope,
  classification: GithubAutomationIngressClassification,
  config: GithubAutomationConfigV1,
): boolean {
  if (!classification.enqueueEligible) return false;
  if (classification.ignoreReason) return false;
  if (config.paused) return false;
  if (envelope.eventName !== "issues" && envelope.eventName !== "issue_comment") {
    return false;
  }
  return (
    envelope.repositoryId !== null &&
    envelope.issueNumber !== null &&
    envelope.repositoryFullName !== null
  );
}

/**
 * Fail-closed closed-Issue reconciliation: park active non-terminal work.
 * Does not claim, triage, rewrite comments, bump generation, or delete WorkTree.
 */
async function reconcileIssueClosedLifecycle(options: {
  repositoryId: number;
  issueNumber: number;
  deliveryId: string;
}): Promise<{ jobId: string | null; reasonCode: string }> {
  const issueState = await readGithubAutomationIssueState(
    options.repositoryId,
    options.issueNumber,
  );
  if (!issueState?.activeJobId) {
    return { jobId: null, reasonCode: "issue_closed_no_active_job" };
  }

  const job = await readGithubAutomationJob(issueState.activeJobId);
  if (!job) {
    return { jobId: null, reasonCode: "issue_closed_missing_job" };
  }
  if (isTerminalJobStatus(job.status)) {
    return { jobId: job.jobId, reasonCode: "issue_closed_already_terminal" };
  }

  const now = new Date().toISOString();
  const next: GithubAutomationJobRecord = {
    ...job,
    status: "blocked",
    phase: job.phase === "received" ? "blocked" : job.phase,
    reasonCode: "issue_closed",
    nextRetryAt: null,
    updatedAt: now,
    deliveryId: options.deliveryId,
  };
  await writeGithubAutomationJob(next);
  await upsertGithubAutomationIssueState({
    repositoryId: options.repositoryId,
    issueNumber: options.issueNumber,
    activeJobId: next.jobId,
    lastDeliveryId: options.deliveryId,
    generation: next.generation,
  });
  return { jobId: next.jobId, reasonCode: "issue_closed" };
}

// ─── Core accept ─────────────────────────────────────────────────────────────

export interface AcceptGithubAutomationWebhookOptions {
  request: Request;
  /** Optional max body override (tests). */
  maxBodyBytes?: number;
  /**
   * When false, do not wake the scheduler (tests that only check durable enqueue).
   * Default true.
   */
  wakeScheduler?: boolean;
  /**
   * Inject webhook secret (tests). Production loads from env/key file.
   */
  webhookSecret?: string | null;
  /**
   * Inject config (tests).
   */
  config?: GithubAutomationConfigV1;
}

/**
 * Accept a GitHub webhook request end-to-end.
 * Fast path: verify → durable enqueue → 202. Downstream work is async.
 */
export async function acceptGithubAutomationWebhook(
  options: AcceptGithubAutomationWebhookOptions,
): Promise<GithubAutomationWebhookResult> {
  const wakeScheduler = options.wakeScheduler !== false;

  try {
    await ensureGithubAutomationStoreLayout();
    ensureGithubIssueTriageHandlerRegistered();

    // 1) Capped raw body
    const rawBody = await readCappedWebhookRawBody(
      options.request,
      options.maxBodyBytes ?? GITHUB_WEBHOOK_MAX_BODY_BYTES,
    );

    // 2) Load secret + verify signature BEFORE JSON parse
    const secret =
      options.webhookSecret !== undefined
        ? options.webhookSecret
        : await loadGithubAppWebhookSecret();
    assertValidGithubWebhookSignature({
      rawBody,
      signatureHeader: getGithubWebhookSignatureHeader(options.request.headers),
      secret,
    });

    // 3) Parse JSON only after verification
    let payload: unknown;
    try {
      const text = rawBody.toString("utf8");
      payload = text.length === 0 ? {} : (JSON.parse(text) as unknown);
    } catch {
      return {
        httpStatus: 400,
        code: "bad_request",
        message: "Webhook payload is not valid JSON",
        deliveryId: getGithubWebhookDeliveryId(options.request.headers),
        jobId: null,
        disposition: null,
        ignoreReason: "malformed_envelope",
      };
    }

    const deliveryIdHeader = getGithubWebhookDeliveryId(options.request.headers);
    const eventNameHeader = getGithubWebhookEventName(options.request.headers);

    let envelope: GithubWebhookEnvelope;
    try {
      envelope = parseGithubWebhookEnvelope({
        eventName: eventNameHeader,
        deliveryId: deliveryIdHeader,
        payload,
      });
    } catch (err) {
      if (isGithubAutomationError(err)) {
        return {
          httpStatus: err.status,
          code: "bad_request",
          message: err.message,
          deliveryId: deliveryIdHeader,
          jobId: null,
          disposition: null,
          ignoreReason: "malformed_envelope",
        };
      }
      throw err;
    }

    const bodySha256Prefix = hashWebhookBodyPrefix(rawBody);
    const config = options.config ?? (await readGithubAutomationConfig());
    const effectiveAppId = await resolveEffectiveGithubAppIdNumber();
    const classification = classifyGithubAutomationIngress(
      envelope,
      config,
      effectiveAppId,
    );
    const ignoreReason = classification.ignoreReason;
    // Global paused remains authoritative after action matrix; comments cannot clear it.
    const paused = config.paused && classification.enqueueEligible;
    const enqueue = shouldEnqueueIssueJob(envelope, classification, config);

    // 4) Exclusive delivery + optional job under issue lease when enqueueing
    let job: GithubAutomationJobRecord | null = null;
    let delivery: GithubAutomationDeliveryRecord;
    let created: boolean;

    if (enqueue && envelope.repositoryId !== null && envelope.issueNumber !== null) {
      const repoId = envelope.repositoryId;
      const issueNumber = envelope.issueNumber;
      const fullName = envelope.repositoryFullName ?? `repo-${repoId}`;
      const generationEligible = isGithubAutomationGenerationEligible(envelope);

      const leased = await withGithubAutomationIssueLease(
        repoId,
        issueNumber,
        async () => {
          // Exclusive delivery first so duplicate replays never create a second job.
          const deliveryResult = await createGithubAutomationDelivery({
            envelope,
            disposition: "enqueued",
            ignoreReason: null,
            jobId: null,
            bodySha256Prefix,
            actorSource: classification.actorSource,
          });

          // Crash recovery: delivery exists but jobId was never linked.
          const needsJobLink =
            deliveryResult.created ||
            (deliveryResult.record.disposition === "enqueued" &&
              !deliveryResult.record.jobId);

          if (!needsJobLink) {
            return {
              deliveryResult,
              job: null as GithubAutomationJobRecord | null,
              recovered: false,
              bound: true as boolean,
            };
          }

          const issueState = await readGithubAutomationIssueState(repoId, issueNumber);
          let activeJob: GithubAutomationJobRecord | null = null;
          if (issueState?.activeJobId) {
            activeJob = await readGithubAutomationJob(issueState.activeJobId);
          }

          const terminal =
            activeJob !== null && isTerminalJobStatus(activeJob.status);

          // CMD-03: terminal jobs that still own the Issue may accept exact owner
          // commands (status / re-evaluate / continue) without a new generation.
          const commandableTerminalPhase =
            activeJob !== null &&
            (activeJob.phase === "not_adopted" ||
              activeJob.phase === "accepted_waiting_automation" ||
              activeJob.phase === "completed" ||
              activeJob.phase === "pr_open" ||
              activeJob.phase === "cancelled");
          const reuseForOwnerCommand =
            terminal &&
            commandableTerminalPhase &&
            envelope.eventName === "issue_comment";

          let jobRecord: GithubAutomationJobRecord | null = null;

          if (activeJob && (!terminal || reuseForOwnerCommand)) {
            // Reuse in-flight/queued job; bind latest delivery id.
            // Wake parked jobs on human issue_comment so exact owner commands can run.
            // Includes awaiting_owner and per-job paused/blocked unattended phases (CMD-03).
            const wakeOnComment = envelope.eventName === "issue_comment";
            const wakeAwaitingOwner =
              wakeOnComment && activeJob.phase === "awaiting_owner";
            const wakeBlockedClaim =
              activeJob.phase === "blocked_claim_assignee" &&
              activeJob.status === "blocked";
            const wakeCommandable =
              wakeOnComment &&
              (reuseForOwnerCommand ||
                activeJob.status === "paused" ||
                activeJob.status === "blocked" ||
                activeJob.status === "retry_due" ||
                activeJob.phase === "accepted_waiting_automation" ||
                activeJob.phase === "not_adopted" ||
                activeJob.phase === "implementation_queued" ||
                activeJob.phase === "planning" ||
                activeJob.phase === "policy_check" ||
                activeJob.phase === "implementing" ||
                activeJob.phase === "checking" ||
                activeJob.phase === "final_policy" ||
                activeJob.phase === "publishing" ||
                activeJob.phase === "pr_open" ||
                activeJob.phase === "paused" ||
                activeJob.phase === "retry_due" ||
                activeJob.phase === "blocked");
            jobRecord = {
              ...activeJob,
              deliveryId: envelope.deliveryId,
              issueTitlePreview:
                envelope.issueTitlePreview ?? activeJob.issueTitlePreview,
              updatedAt: new Date().toISOString(),
              ...(wakeAwaitingOwner || wakeBlockedClaim || wakeCommandable
                ? {
                    status: "queued" as const,
                    nextRetryAt: null,
                    // Keep phase; clear only parking reason so scheduler can run.
                    reasonCode: wakeAwaitingOwner
                      ? "owner_comment_wake"
                      : wakeBlockedClaim
                        ? "claim_retry_wake"
                        : "owner_command_wake",
                  }
                : {}),
            };
            await writeGithubAutomationJob(jobRecord);
          } else if (generationEligible) {
            // New generation only for opened/reopened (or explicit operator restart later).
            const nextGeneration = terminal
              ? (issueState?.generation ?? 0) + 1
              : (issueState?.generation ?? 1);
            jobRecord = await createQueuedGithubAutomationJob({
              repositoryId: repoId,
              repositoryFullName: fullName,
              issueNumber,
              installationId: envelope.installationId,
              deliveryId: envelope.deliveryId,
              issueTitlePreview: envelope.issueTitlePreview,
              generation: Math.max(1, nextGeneration),
              phase: "received",
            });
          } else {
            // Terminal / missing job + non-generation event (e.g. edited/comment):
            // durable audit only — do not create a new generation.
            const deliveryIgnored: GithubAutomationDeliveryRecord = {
              ...deliveryResult.record,
              disposition: "ignored",
              ignoreReason: "lifecycle_only",
              jobId: activeJob?.jobId ?? null,
              actorSource: classification.actorSource,
            };
            await writeGithubAutomationDelivery(deliveryIgnored);
            return {
              deliveryResult: {
                created: deliveryResult.created,
                record: deliveryIgnored,
              },
              job: null as GithubAutomationJobRecord | null,
              recovered: false,
              bound: false as boolean,
            };
          }

          // Patch delivery with jobId (atomic rewrite; exclusive create already won).
          const deliveryWithJob: GithubAutomationDeliveryRecord = {
            ...deliveryResult.record,
            disposition: "enqueued",
            jobId: jobRecord.jobId,
            actorSource: classification.actorSource,
          };
          await writeGithubAutomationDelivery(deliveryWithJob);

          await upsertGithubAutomationIssueState({
            repositoryId: repoId,
            issueNumber,
            activeJobId: jobRecord.jobId,
            lastDeliveryId: envelope.deliveryId,
            generation: jobRecord.generation,
          });

          return {
            deliveryResult: {
              created: deliveryResult.created,
              record: deliveryWithJob,
            },
            job: jobRecord,
            recovered: !deliveryResult.created,
            bound: true as boolean,
          };
        },
      );

      created = leased.deliveryResult.created;
      delivery = leased.deliveryResult.record;
      job = leased.job;
      const recoveredIncomplete = leased.recovered === true;
      const bound = leased.bound !== false;

      if (!created && !recoveredIncomplete) {
        // Duplicate delivery with existing job link — zero new business effects.
        await appendGithubAutomationSafeEvent({
          at: new Date().toISOString(),
          kind: "delivery_duplicate",
          repositoryId: envelope.repositoryId,
          issueNumber: envelope.issueNumber,
          jobId: delivery.jobId,
          deliveryId: envelope.deliveryId,
          phase: null,
          reasonCode: "duplicate_delivery",
          traceId: null,
        });
        return {
          httpStatus: 202,
          code: "duplicate",
          message: "Duplicate delivery ignored",
          deliveryId: envelope.deliveryId,
          jobId: delivery.jobId,
          disposition: "duplicate",
          ignoreReason: null,
        };
      }

      if (!bound || !job) {
        await appendGithubAutomationSafeEvent({
          at: new Date().toISOString(),
          kind: "delivery_ignored",
          repositoryId: envelope.repositoryId,
          issueNumber: envelope.issueNumber,
          jobId: delivery.jobId,
          deliveryId: envelope.deliveryId,
          phase: null,
          reasonCode: delivery.ignoreReason ?? "lifecycle_only",
          traceId: null,
          meta: {
            eventName: String(envelope.eventName),
            action: envelope.action,
            actorSource: classification.actorSource,
          },
        });
        return {
          httpStatus: 202,
          code: "ignored",
          message: "Delivery ignored without new generation",
          deliveryId: envelope.deliveryId,
          jobId: delivery.jobId,
          disposition: "ignored",
          ignoreReason: delivery.ignoreReason ?? "lifecycle_only",
        };
      }

      await appendGithubAutomationSafeEvent({
        at: new Date().toISOString(),
        kind: recoveredIncomplete ? "delivery_recovered" : "delivery_enqueued",
        repositoryId: envelope.repositoryId,
        issueNumber: envelope.issueNumber,
        jobId: delivery.jobId,
        deliveryId: envelope.deliveryId,
        phase: "received",
        reasonCode: recoveredIncomplete ? "incomplete_delivery_recovered" : null,
        traceId: job?.traceId ?? null,
        meta: {
          eventName: String(envelope.eventName),
          action: envelope.action,
          actorSource: classification.actorSource,
        },
      });

      if (wakeScheduler) {
        ensureGithubAutomationScheduler();
        wakeGithubAutomationScheduler();
      }

      return {
        httpStatus: 202,
        code: "enqueued",
        message: recoveredIncomplete
          ? "Delivery recovered and enqueued"
          : "Delivery accepted",
        deliveryId: envelope.deliveryId,
        jobId: delivery.jobId,
        disposition: "enqueued",
        ignoreReason: null,
      };
    }

    // Non-enqueue path: still exclusive-create delivery for audit/idempotency.
    // GHA-09: pull_request events reconcile known jobs without enqueueing Issue work.
    // LOOP-01: closed Issue lifecycle parks active jobs without claim/triage/generation.
    const isPullRequest =
      classification.lifecycle === "pull_request" &&
      !ignoreReason &&
      !config.paused &&
      config.enabled &&
      config.mode !== "off";
    const isIssueClosed =
      classification.lifecycle === "issue_closed" &&
      !config.paused &&
      config.enabled &&
      config.mode !== "off" &&
      envelope.repositoryId !== null &&
      envelope.issueNumber !== null;

    // paused disposition only when an otherwise-actionable event is held by kill switch.
    const disposition = paused
      ? "paused"
      : "ignored";
    const deliveryResult = await createGithubAutomationDelivery({
      envelope,
      disposition,
      ignoreReason: paused ? null : ignoreReason,
      jobId: null,
      bodySha256Prefix,
      actorSource: classification.actorSource,
    });
    created = deliveryResult.created;
    delivery = deliveryResult.record;

    if (!created) {
      return {
        httpStatus: 202,
        code: "duplicate",
        message: "Duplicate delivery ignored",
        deliveryId: envelope.deliveryId,
        jobId: null,
        disposition: "duplicate",
        ignoreReason: delivery.ignoreReason,
      };
    }

    let sideJobId: string | null = null;
    let sideReason: string | null = paused
      ? "paused"
      : (ignoreReason ?? "ignored");

    if (isPullRequest) {
      // Reconcile only — never create a new Issue job or wake implementer by default.
      try {
        const prResult = await reconcileGithubPullRequestEvent({
          config,
          payload,
          deliveryId: envelope.deliveryId,
        });
        sideJobId = prResult.jobId;
        sideReason = prResult.reasonCode;
        if (prResult.jobId && delivery.jobId !== prResult.jobId) {
          delivery = await writeGithubAutomationDelivery({
            ...delivery,
            jobId: prResult.jobId,
          });
        }
      } catch (prErr) {
        sideReason = isGithubAutomationError(prErr)
          ? prErr.code
          : "pr_lifecycle_error";
        await appendGithubAutomationSafeEvent({
          at: new Date().toISOString(),
          kind: "pr_lifecycle_error",
          repositoryId: envelope.repositoryId,
          issueNumber: envelope.issueNumber,
          jobId: null,
          deliveryId: envelope.deliveryId,
          phase: null,
          reasonCode: sideReason,
          traceId: null,
          meta: {
            eventName: "pull_request",
            action: envelope.action,
          },
        });
      }
    } else if (isIssueClosed) {
      try {
        const closed = await withGithubAutomationIssueLease(
          envelope.repositoryId!,
          envelope.issueNumber!,
          async () =>
            reconcileIssueClosedLifecycle({
              repositoryId: envelope.repositoryId!,
              issueNumber: envelope.issueNumber!,
              deliveryId: envelope.deliveryId,
            }),
        );
        sideJobId = closed.jobId;
        sideReason = closed.reasonCode;
        if (closed.jobId && delivery.jobId !== closed.jobId) {
          delivery = await writeGithubAutomationDelivery({
            ...delivery,
            jobId: closed.jobId,
          });
        }
      } catch (closedErr) {
        sideReason = isGithubAutomationError(closedErr)
          ? closedErr.code
          : "issue_closed_reconcile_error";
      }
    }

    await appendGithubAutomationSafeEvent({
      at: new Date().toISOString(),
      kind: paused
        ? "delivery_paused"
        : isPullRequest
          ? "delivery_pull_request"
          : isIssueClosed
            ? "delivery_issue_closed"
            : "delivery_ignored",
      repositoryId: envelope.repositoryId,
      issueNumber: envelope.issueNumber,
      jobId: sideJobId,
      deliveryId: envelope.deliveryId,
      phase: null,
      reasonCode: sideReason,
      traceId: null,
      meta: {
        eventName: String(envelope.eventName),
        action: envelope.action,
        actorSource: classification.actorSource,
      },
    });

    // Invalid signature never reaches here. Self/Bot/non-allowlist have zero job effects.
    // pull_request / closed reconciliation must not enqueue Issue jobs via scheduler.
    return {
      httpStatus: 202,
      code: paused ? "paused" : "ignored",
      message: paused
        ? "Delivery recorded while automation is paused"
        : isPullRequest
          ? "Pull request delivery reconciled"
          : isIssueClosed
            ? "Issue closed lifecycle reconciled"
            : "Delivery ignored",
      deliveryId: envelope.deliveryId,
      jobId: sideJobId,
      disposition,
      ignoreReason: paused ? null : ignoreReason,
    };
  } catch (err) {
    if (isGithubAutomationError(err)) {
      if (err.code === "github_oversized_response") {
        return {
          httpStatus: 413,
          code: "payload_too_large",
          message: err.message,
          deliveryId: getGithubWebhookDeliveryId(options.request.headers),
          jobId: null,
          disposition: null,
          ignoreReason: null,
        };
      }
      if (err.code === "github_auth_failed") {
        return {
          httpStatus: 401,
          code: "unauthorized",
          message: "Webhook signature verification failed",
          deliveryId: getGithubWebhookDeliveryId(options.request.headers),
          jobId: null,
          disposition: null,
          ignoreReason: null,
        };
      }
      if (err.code === "not_configured") {
        return {
          httpStatus: 400,
          code: "not_configured",
          message: err.message,
          deliveryId: getGithubWebhookDeliveryId(options.request.headers),
          jobId: null,
          disposition: null,
          ignoreReason: null,
        };
      }
      return {
        httpStatus: err.status >= 400 && err.status < 600 ? err.status : 500,
        code: "error",
        message: err.message,
        deliveryId: getGithubWebhookDeliveryId(options.request.headers),
        jobId: null,
        disposition: null,
        ignoreReason: null,
      };
    }

    return {
      httpStatus: 500,
      code: "error",
      message: safeGithubAutomationErrorMessage(err),
      deliveryId: getGithubWebhookDeliveryId(options.request.headers),
      jobId: null,
      disposition: null,
      ignoreReason: null,
    };
  }
}
