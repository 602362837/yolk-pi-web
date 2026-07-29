/**
 * github-automation-runtime — webhook accept path for Issue Analysis (GIA-03).
 *
 * Flow:
 *   capped raw body → HMAC verify → JSON parse → allowlisted envelope
 *   → config/allowlist checks → exclusive delivery create → enqueue analysis job
 *   → async scheduler wake → 202
 *
 * Only human `issues.opened` may create a business job. All other events/actions/
 * actors are bounded audit-only with zero job / zero scheduler wake / zero mutation.
 *
 * Never runs LLM/Git/GitHub mutation work on the request thread beyond durable enqueue.
 * Never persists raw body, signature, credentials, or Issue/comment full text.
 * Does not load analysis handler, model, or installation tokens before HMAC verify.
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
import type { GithubAutomationConfigV2 as GithubAutomationConfigV1 } from "./github-automation-types";
import { loadGithubAppWebhookSecret } from "./github-app-credentials";
import {
  appendGithubAutomationSafeEvent,
  createGithubAutomationDelivery,
  createQueuedGithubAutomationJob,
  ensureGithubAutomationStoreLayout,
  findActiveGithubIssueAnalysisJob,
  hashWebhookBodyPrefix,
  parseGithubWebhookEnvelope,
  readGithubAutomationIssueState,
  readGithubAutomationJob,
  upsertGithubAutomationIssueState,
  withGithubAutomationIssueLease,
  writeGithubAutomationDelivery,
  type GithubAutomationActorSource,
  type GithubAutomationDeliveryIgnoreReason,
  type GithubAutomationDeliveryRecord,
  type GithubAutomationJobRecord,
  type GithubWebhookEnvelope,
} from "./github-automation-store";
import {
  ensureGithubAutomationScheduler,
  wakeGithubAutomationScheduler,
  _testSetGithubAutomationProductionHandlerReadinessDisabled,
  _testResetGithubAutomationHandlerRegistry,
} from "./github-automation-scheduler";
import {
  assertValidGithubWebhookSignature,
  GITHUB_WEBHOOK_MAX_BODY_BYTES,
  readCappedWebhookRawBody,
} from "./github-webhook-verify";
import { loadGithubAppCredentials } from "./github-app-credentials";

/**
 * Test helper: reset analysis handler registration / readiness isolation flags.
 */
export function _testResetGithubIssueTriageHandlerRegistration(): void {
  _testResetGithubAutomationHandlerRegistry();
}

/**
 * Test helper: disable production analysis handler readiness for isolated ingress tests.
 * When disabled, scheduler ticks refuse business leases (zero attempt / no job_started).
 * Production always statically binds the analysis handler; this flag is test-only.
 */
export function _testSetGithubIssueTriageAutoRegisterDisabled(
  disabled: boolean,
): void {
  _testResetGithubAutomationHandlerRegistry();
  _testSetGithubAutomationProductionHandlerReadinessDisabled(disabled);
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

export type GithubAutomationLifecycleKind = "none" | "audit_only";

export interface GithubAutomationIngressClassification {
  actorSource: GithubAutomationActorSource;
  ignoreReason: GithubAutomationDeliveryIgnoreReason | null;
  /** True only for human issues.opened under allowlist (still subject to paused). */
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

/**
 * @deprecated Generation no longer advances for analysis jobs.
 * Kept for call-site compatibility; only human issues.opened is eligible.
 */
export function isGithubAutomationGenerationEligible(
  envelope: Pick<GithubWebhookEnvelope, "eventName" | "action">,
): boolean {
  return envelope.eventName === "issues" && envelope.action === "opened";
}

/**
 * Opened-only action matrix (GIA-03).
 * Self/Bot/unknown are filtered before this applies.
 */
function classifyIssueActionMatrix(
  envelope: GithubWebhookEnvelope,
  actorSource: GithubAutomationActorSource,
): Pick<
  GithubAutomationIngressClassification,
  "ignoreReason" | "enqueueEligible" | "lifecycle"
> {
  if (actorSource === "self_app") {
    return {
      ignoreReason: "self_app_event",
      enqueueEligible: false,
      lifecycle: "audit_only",
    };
  }
  if (actorSource === "bot_actor") {
    return {
      ignoreReason: "bot_actor_event",
      enqueueEligible: false,
      lifecycle: "audit_only",
    };
  }
  if (actorSource === "unknown_actor") {
    return {
      ignoreReason: "unknown_actor",
      enqueueEligible: false,
      lifecycle: "audit_only",
    };
  }

  if (envelope.eventName === "issues") {
    if (envelope.action === "opened") {
      return {
        ignoreReason: null,
        enqueueEligible: true,
        lifecycle: "none",
      };
    }
    // reopened/edited/closed/labeled/assigned/... — audit only, never enqueue.
    return {
      ignoreReason:
        envelope.action === "closed"
          ? "lifecycle_only"
          : "non_actionable_action",
      enqueueEligible: false,
      lifecycle: "audit_only",
    };
  }

  if (envelope.eventName === "issue_comment") {
    return {
      ignoreReason:
        envelope.action === "deleted"
          ? "comment_deleted"
          : "non_actionable_action",
      enqueueEligible: false,
      lifecycle: "audit_only",
    };
  }

  return {
    ignoreReason: "unknown_event",
    enqueueEligible: false,
    lifecycle: "audit_only",
  };
}

/**
 * Full ingress classification: config allowlist → actor source → opened-only matrix.
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
      lifecycle: "audit_only",
    };
  }
  if (!envelope.knownEvent) {
    return {
      actorSource,
      ignoreReason: "unknown_event",
      enqueueEligible: false,
      lifecycle: "audit_only",
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
      lifecycle: "audit_only",
    };
  }

  if (!config.enabled) {
    return {
      actorSource,
      ignoreReason: "automation_disabled",
      enqueueEligible: false,
      lifecycle: "audit_only",
    };
  }

  if (envelope.repositoryId === null) {
    return {
      actorSource,
      ignoreReason: "malformed_envelope",
      enqueueEligible: false,
      lifecycle: "audit_only",
    };
  }

  if (!isRepositoryAllowlisted(config, envelope.repositoryId)) {
    return {
      actorSource,
      ignoreReason: "repository_not_allowlisted",
      enqueueEligible: false,
      lifecycle: "audit_only",
    };
  }

  if (envelope.eventName === "pull_request") {
    return {
      actorSource,
      ignoreReason: "non_actionable_action",
      enqueueEligible: false,
      lifecycle: "audit_only",
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
        lifecycle: "audit_only",
      };
    }
    const repo = findRepositoryConfigById(config, envelope.repositoryId);
    // v2 requires exact installation match when both sides are present.
    if (
      repo &&
      typeof repo.installationId === "number" &&
      repo.installationId > 0 &&
      envelope.installationId !== null &&
      repo.installationId !== envelope.installationId
    ) {
      return {
        actorSource,
        ignoreReason: "installation_mismatch",
        enqueueEligible: false,
        lifecycle: "audit_only",
      };
    }
    // v2 also requires positive installation on the allowlist entry for enqueue.
    if (
      envelope.eventName === "issues" &&
      envelope.action === "opened" &&
      repo &&
      (!(typeof repo.installationId === "number") || repo.installationId <= 0)
    ) {
      return {
        actorSource,
        ignoreReason: "installation_mismatch",
        enqueueEligible: false,
        lifecycle: "audit_only",
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
    lifecycle: "audit_only",
  };
}

function shouldEnqueueIssueAnalysisJob(
  envelope: GithubWebhookEnvelope,
  classification: GithubAutomationIngressClassification,
  config: GithubAutomationConfigV1,
): boolean {
  if (!classification.enqueueEligible) return false;
  if (classification.ignoreReason) return false;
  if (config.paused) return false;
  if (envelope.eventName !== "issues" || envelope.action !== "opened") {
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
    // GIA-03: do NOT load analysis handler / model / installation tokens before HMAC.

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
    // Global paused remains authoritative after action matrix.
    const paused = config.paused && classification.enqueueEligible;
    const enqueue = shouldEnqueueIssueAnalysisJob(
      envelope,
      classification,
      config,
    );

    // 4) Exclusive delivery + optional analysis job under issue lease
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
              alreadyExists: false as boolean,
            };
          }

          // One opened analysis lifecycle per repositoryId+issueNumber.
          const existing =
            (await findActiveGithubIssueAnalysisJob({
              repositoryId: repoId,
              issueNumber,
            })) ??
            (await (async () => {
              const issueState = await readGithubAutomationIssueState(
                repoId,
                issueNumber,
              );
              if (!issueState?.activeJobId) return null;
              return readGithubAutomationJob(issueState.activeJobId);
            })());

          if (existing) {
            // Distinct opened delivery for the same Issue: audit only, zero second job.
            const deliveryIgnored: GithubAutomationDeliveryRecord = {
              ...deliveryResult.record,
              disposition: "ignored",
              ignoreReason: "analysis_already_exists",
              jobId: existing.jobId,
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
              alreadyExists: true as boolean,
            };
          }

          const jobRecord = await createQueuedGithubAutomationJob({
            repositoryId: repoId,
            repositoryFullName: fullName,
            issueNumber,
            installationId: envelope.installationId,
            deliveryId: envelope.deliveryId,
            issueTitlePreview: envelope.issueTitlePreview,
            phase: "received",
          });

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
            activeJobKind: "issue_analysis",
          });

          return {
            deliveryResult: {
              created: deliveryResult.created,
              record: deliveryWithJob,
            },
            job: jobRecord,
            recovered: !deliveryResult.created,
            bound: true as boolean,
            alreadyExists: false as boolean,
          };
        },
      );

      created = leased.deliveryResult.created;
      delivery = leased.deliveryResult.record;
      job = leased.job;
      const recoveredIncomplete = leased.recovered === true;
      const bound = leased.bound !== false;

      if (!created && !recoveredIncomplete) {
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
          reasonCode: delivery.ignoreReason ?? "analysis_already_exists",
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
          message: "Analysis lifecycle already exists for this issue",
          deliveryId: envelope.deliveryId,
          jobId: delivery.jobId,
          disposition: "ignored",
          ignoreReason: delivery.ignoreReason ?? "analysis_already_exists",
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
          kind: "issue_analysis",
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

    // Non-enqueue path: exclusive audit delivery only. Zero job, zero wake, zero mutation.
    const disposition = paused ? "paused" : "ignored";
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

    const sideReason: string | null = paused
      ? "paused"
      : (ignoreReason ?? "ignored");

    await appendGithubAutomationSafeEvent({
      at: new Date().toISOString(),
      kind: paused ? "delivery_paused" : "delivery_ignored",
      repositoryId: envelope.repositoryId,
      issueNumber: envelope.issueNumber,
      jobId: null,
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

    return {
      httpStatus: 202,
      code: paused ? "paused" : "ignored",
      message: paused
        ? "Delivery recorded while automation is paused"
        : "Delivery ignored",
      deliveryId: envelope.deliveryId,
      jobId: null,
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
