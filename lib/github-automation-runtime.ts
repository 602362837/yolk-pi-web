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

// ─── Disposition policy ──────────────────────────────────────────────────────

function classifyIgnoreReason(
  envelope: GithubWebhookEnvelope,
  config: GithubAutomationConfigV1,
): GithubAutomationDeliveryIgnoreReason | null {
  if (envelope.eventName === "ping") {
    // ping is acknowledged but not enqueued as an issue job.
    return "unknown_event";
  }
  if (!envelope.knownEvent) {
    return "unknown_event";
  }
  // installation lifecycle: record only for now (GHA-03+ may bind installation ids).
  if (
    envelope.eventName === "installation" ||
    envelope.eventName === "installation_repositories"
  ) {
    return "unknown_event";
  }

  if (!config.enabled || config.mode === "off") {
    // pull_request still needs durable delivery for audit when enabled=false? No —
    // keep zero business effects; delivery is still recorded as ignored below.
    return config.enabled ? "mode_off" : "automation_disabled";
  }

  if (envelope.repositoryId === null) {
    return "malformed_envelope";
  }

  if (!isRepositoryAllowlisted(config, envelope.repositoryId)) {
    return "repository_not_allowlisted";
  }

  if (
    envelope.eventName === "issues" ||
    envelope.eventName === "issue_comment"
  ) {
    if (envelope.issueNumber === null) {
      return "missing_issue";
    }
    const repo = findRepositoryConfigById(config, envelope.repositoryId);
    if (
      repo?.installationId !== null &&
      repo?.installationId !== undefined &&
      envelope.installationId !== null &&
      repo.installationId !== envelope.installationId
    ) {
      return "installation_mismatch";
    }
  }

  // pull_request: allowlisted + enabled → not ignored at classify time;
  // reconciliation happens on the non-enqueue path (never creates Issue jobs).
  if (envelope.eventName === "pull_request") {
    return null;
  }

  return null;
}

function shouldEnqueueIssueJob(
  envelope: GithubWebhookEnvelope,
  ignoreReason: GithubAutomationDeliveryIgnoreReason | null,
  config: GithubAutomationConfigV1,
): boolean {
  if (ignoreReason) return false;
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
    const ignoreReason = classifyIgnoreReason(envelope, config);
    const paused = config.paused && !ignoreReason;
    const enqueue = shouldEnqueueIssueJob(envelope, ignoreReason, config);

    // 4) Exclusive delivery + optional job under issue lease when enqueueing
    let job: GithubAutomationJobRecord | null = null;
    let delivery: GithubAutomationDeliveryRecord;
    let created: boolean;

    if (enqueue && envelope.repositoryId !== null && envelope.issueNumber !== null) {
      const repoId = envelope.repositoryId;
      const issueNumber = envelope.issueNumber;
      const fullName = envelope.repositoryFullName ?? `repo-${repoId}`;

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
            };
          }

          const issueState = await readGithubAutomationIssueState(repoId, issueNumber);
          let activeJob: GithubAutomationJobRecord | null = null;
          if (issueState?.activeJobId) {
            activeJob = await readGithubAutomationJob(issueState.activeJobId);
          }

          const terminal =
            activeJob !== null &&
            (activeJob.status === "completed" ||
              activeJob.status === "cancelled" ||
              activeJob.status === "ignored");

          let jobRecord: GithubAutomationJobRecord;
          if (activeJob && !terminal) {
            // Reuse in-flight/queued job; bind latest delivery id.
            // Wake parked awaiting_owner jobs on issue_comment so owner intent can run.
            const wakeAwaitingOwner =
              activeJob.phase === "awaiting_owner" &&
              (activeJob.status === "paused" || activeJob.status === "blocked") &&
              envelope.eventName === "issue_comment";
            const wakeBlockedClaim =
              activeJob.phase === "blocked_claim_assignee" &&
              activeJob.status === "blocked";
            jobRecord = {
              ...activeJob,
              deliveryId: envelope.deliveryId,
              issueTitlePreview:
                envelope.issueTitlePreview ?? activeJob.issueTitlePreview,
              updatedAt: new Date().toISOString(),
              ...(wakeAwaitingOwner || wakeBlockedClaim
                ? {
                    status: "queued" as const,
                    nextRetryAt: null,
                    // Keep phase; clear only parking reason so scheduler can run.
                    reasonCode: wakeAwaitingOwner
                      ? "owner_comment_wake"
                      : "claim_retry_wake",
                  }
                : {}),
            };
            await writeGithubAutomationJob(jobRecord);
          } else {
            // Bump generation when previous job is terminal; otherwise start at 1.
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
          }

          // Patch delivery with jobId (atomic rewrite; exclusive create already won).
          const deliveryWithJob: GithubAutomationDeliveryRecord = {
            ...deliveryResult.record,
            disposition: "enqueued",
            jobId: jobRecord.jobId,
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
          };
        },
      );

      created = leased.deliveryResult.created;
      delivery = leased.deliveryResult.record;
      job = leased.job;
      const recoveredIncomplete = leased.recovered === true;

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
    const isPullRequest =
      envelope.eventName === "pull_request" &&
      !ignoreReason &&
      !paused &&
      config.enabled &&
      config.mode !== "off";

    const disposition = paused
      ? "paused"
      : ignoreReason
        ? "ignored"
        : isPullRequest
          ? "ignored"
          : "ignored";
    const deliveryResult = await createGithubAutomationDelivery({
      envelope,
      disposition,
      ignoreReason: paused ? null : ignoreReason,
      jobId: null,
      bodySha256Prefix,
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

    let prJobId: string | null = null;
    let prReason: string | null = paused
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
        prJobId = prResult.jobId;
        prReason = prResult.reasonCode;
        if (prResult.jobId && delivery.jobId !== prResult.jobId) {
          delivery = await writeGithubAutomationDelivery({
            ...delivery,
            jobId: prResult.jobId,
          });
        }
      } catch (prErr) {
        prReason = isGithubAutomationError(prErr)
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
          reasonCode: prReason,
          traceId: null,
          meta: {
            eventName: "pull_request",
            action: envelope.action,
          },
        });
      }
    }

    await appendGithubAutomationSafeEvent({
      at: new Date().toISOString(),
      kind: paused
        ? "delivery_paused"
        : isPullRequest
          ? "delivery_pull_request"
          : "delivery_ignored",
      repositoryId: envelope.repositoryId,
      issueNumber: envelope.issueNumber,
      jobId: prJobId,
      deliveryId: envelope.deliveryId,
      phase: null,
      reasonCode: prReason,
      traceId: null,
      meta: {
        eventName: String(envelope.eventName),
        action: envelope.action,
      },
    });

    // Invalid signature never reaches here. Non-allowlist / disabled have zero job effects.
    // pull_request reconciliation must not enqueue Issue jobs via scheduler.
    return {
      httpStatus: 202,
      code: paused ? "paused" : "ignored",
      message: paused
        ? "Delivery recorded while automation is paused"
        : isPullRequest
          ? "Pull request delivery reconciled"
          : "Delivery ignored",
      deliveryId: envelope.deliveryId,
      jobId: prJobId,
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
