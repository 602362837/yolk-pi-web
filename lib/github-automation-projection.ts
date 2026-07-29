/**
 * github-automation-projection — safe wire types for Settings / ops APIs (GIA-04).
 *
 * Analysis-only projection rules (hard):
 * - Include: enabled/paused, analysis concurrency, allowlist (no baseRef/owner ids),
 *   Metadata+Issues readiness, model readiness, recent issue_analysis jobs,
 *   category/verdict/confidence/comment/close/retry, safe reason codes.
 * - Exclude: credentials/tokens, absolute paths, Issue/comment body, prompt,
 *   transcript, raw webhook, private key material, projectRoot, Session/WorkTree/PR,
 *   assignee/claim, mode/unattended/full-agent residual risk, handler runtime.
 * - Status/verify/config GET must not enqueue work, wake the scheduler, or run a model.
 * - Job POST accepts only `{ action: "retry" }` and resumes the first unconfirmed checkpoint.
 */

import { getGithubAppCredentialSafeProjection } from "./github-app-credentials";
import { getGithubInstallationCapability } from "./github-app-client";
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
  safeGithubAutomationErrorMessage,
} from "./github-automation-errors";
import {
  listGithubAutomationJobs,
  readGithubAutomationJob,
  writeGithubAutomationJob,
  isGithubIssueAnalysisJobSchedulable,
  isLegacyGithubAutomationJob,
  type GithubAutomationEffectMarker,
  type GithubAutomationEffectStatus,
  type GithubAutomationJobPhase,
  type GithubAutomationJobRecord,
  type GithubAutomationJobStatus,
} from "./github-automation-store";
import type {
  GithubAppCapabilitySnapshot,
  GithubAppCredentialSafeProjection,
  GithubAppPermissionLevel,
  GithubAutomationConfig,
  GithubIssueAnalysisCategory,
  GithubIssueAnalysisConfidence,
  GithubIssueAnalysisOutcome,
  GithubIssueAnalysisTruthVerdict,
  GithubAutomationRetryability,
} from "./github-automation-types";
import {
  deriveGithubAppCapability,
  emptyPermissionSnapshot,
} from "./github-automation-types";
import {
  resolveIssueAnalysisModelReadiness,
  type IssueAnalysisModelReadiness,
} from "./github-issue-analysis-model";
import { getGithubAutomationRuntimeProvenance } from "./github-automation-provenance";
import { wakeGithubAutomationScheduler } from "./github-automation-scheduler";

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

/** Analysis-only App permission surface (Metadata read + Issues read/write). */
export interface GithubAutomationAnalysisPermissionProjection {
  /** True when Metadata is readable and Issues is write-capable. */
  analysisReady: boolean;
  missing: Array<"metadata" | "issues">;
  snapshot: {
    metadata: GithubAppPermissionLevel;
    issues: GithubAppPermissionLevel;
  };
}

export interface GithubAutomationAnalysisModelProjection {
  ready: boolean;
  reasonCode: string;
  /** Provider/model ids only — never credentials. */
  provider: string | null;
  modelId: string | null;
}

export interface GithubAutomationReadinessProjection {
  app: GithubAppCredentialSafeProjection;
  installation: {
    present: boolean;
    installationIdCount: number;
    readiness: "ready" | "missing" | "partial";
  };
  permissions: GithubAutomationAnalysisPermissionProjection;
  model: GithubAutomationAnalysisModelProjection;
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
  paused: boolean;
  analysisMaxConcurrency: number;
  counts: {
    queued: number;
    running: number;
    retry: number;
    blocked: number;
    completed: number;
  };
}

export interface GithubAutomationRepositoryStatusProjection
  extends GithubAutomationRepositorySafeProjection {
  installationBound: boolean;
  /**
   * Safe local project label for Settings cards.
   * Never an absolute path — repo short name only.
   */
  projectDisplayName: string | null;
}

export type GithubAutomationJobActionName = "retry";

export interface GithubAutomationJobActionAvailability {
  action: GithubAutomationJobActionName;
  available: boolean;
  reasonCode: string | null;
}

export interface GithubAutomationEffectSafeProjection {
  status: GithubAutomationEffectStatus | null;
  remoteId: string | null;
  reasonCode: string | null;
}

export interface GithubAutomationJobSafeProjection {
  jobId: string;
  kind: "issue_analysis" | "legacy_pipeline" | "unknown";
  repositoryId: number;
  repositoryFullName: string;
  issueNumber: number;
  /** Truncated safe title only — never body. */
  issueTitlePreview: string | null;
  phase: GithubAutomationJobPhase;
  status: GithubAutomationJobStatus;
  /**
   * Scheduler lease run count only.
   * UI must label as "调度尝试", never "第 N 次执行" / Agent runs.
   */
  attempt: number;
  traceId: string;
  reasonCode: string | null;
  nextRetryAt: string | null;
  createdAt: string;
  updatedAt: string;
  checkpoint: string | null;
  category: GithubIssueAnalysisCategory | null;
  verdict: GithubIssueAnalysisTruthVerdict | null;
  confidence: GithubIssueAnalysisConfidence | null;
  completeness: string | null;
  budgetExceeded: boolean | null;
  outcome: GithubIssueAnalysisOutcome;
  retryability: GithubAutomationRetryability | "unknown";
  comment: GithubAutomationEffectSafeProjection;
  close: GithubAutomationEffectSafeProjection;
  actions: GithubAutomationJobActionAvailability[];
}

export interface GithubAutomationStatusProjection {
  revision: string;
  generatedAt: string;
  readiness: GithubAutomationReadinessProjection;
  runtime: GithubAutomationRuntimeProjection;
  repositories: GithubAutomationRepositoryStatusProjection[];
  jobs: GithubAutomationJobSafeProjection[];
  config: GithubAutomationConfigSafeProjection;
  /**
   * Running process package/build provenance (safe scalars only).
   * Never used to imply full-agent residual risk or unattended policy.
   */
  runtimeProvenance: {
    codeRevision: string;
    policyVersion: string;
  };
}

// ─── Permission / model helpers ──────────────────────────────────────────────

export function toGithubAutomationAnalysisPermissionProjection(
  capability: GithubAppCapabilitySnapshot | null | undefined,
): GithubAutomationAnalysisPermissionProjection {
  const permissions = capability?.permissions ?? emptyPermissionSnapshot();
  const missing: Array<"metadata" | "issues"> = [];
  if (permissions.metadata === "none") missing.push("metadata");
  if (permissions.issues !== "write") missing.push("issues");
  return {
    analysisReady: missing.length === 0,
    missing,
    snapshot: {
      metadata: permissions.metadata,
      issues: permissions.issues,
    },
  };
}

export function toGithubAutomationAnalysisModelProjection(
  readiness: IssueAnalysisModelReadiness | null | undefined,
): GithubAutomationAnalysisModelProjection {
  if (!readiness) {
    return {
      ready: false,
      reasonCode: "model_unavailable",
      provider: null,
      modelId: null,
    };
  }
  return {
    ready: readiness.ready === true,
    reasonCode: readiness.reasonCode,
    provider: readiness.model?.provider ?? null,
    modelId: readiness.model?.modelId ?? null,
  };
}

// ─── Effect / outcome helpers ────────────────────────────────────────────────

function findLatestEffect(
  job: GithubAutomationJobRecord,
  name: "issue_analysis_comment" | "issue_analysis_close",
): GithubAutomationEffectMarker | null {
  const effects = Array.isArray(job.effects) ? job.effects : [];
  for (let i = effects.length - 1; i >= 0; i -= 1) {
    const effect = effects[i];
    if (effect?.name === name) return effect;
  }
  return null;
}

function toEffectSafeProjection(
  effect: GithubAutomationEffectMarker | null,
): GithubAutomationEffectSafeProjection {
  if (!effect) {
    return { status: null, remoteId: null, reasonCode: null };
  }
  return {
    status: effect.status ?? null,
    remoteId:
      typeof effect.remoteId === "string" && effect.remoteId.trim()
        ? effect.remoteId.trim().slice(0, 64)
        : null,
    reasonCode:
      typeof effect.reasonCode === "string" && effect.reasonCode.trim()
        ? effect.reasonCode.trim().slice(0, 120)
        : null,
  };
}

export function deriveGithubIssueAnalysisOutcome(
  job: GithubAutomationJobRecord,
): GithubIssueAnalysisOutcome {
  if (job.status === "queued") return "queued";
  if (job.status === "running") return "running";
  if (job.status === "retry_due" || job.phase === "retry_due") return "retry_due";
  if (job.status === "blocked" || job.phase === "blocked") return "blocked";

  if (job.status === "completed" || job.phase === "completed") {
    const close = findLatestEffect(job, "issue_analysis_close");
    if (close?.status === "remote_confirmed") return "completed_closed";
    if (job.verdict === "inconclusive") return "inconclusive";
    return "completed_open";
  }

  // Non-terminal analysis phases stay "running" from the operator's perspective.
  if (
    job.phase === "analyzing" ||
    job.phase === "result_ready" ||
    job.phase === "commenting" ||
    job.phase === "closing" ||
    job.phase === "received"
  ) {
    return "running";
  }

  return "blocked";
}

function normalizeRetryability(
  value: string | null | undefined,
): GithubAutomationRetryability | "unknown" {
  if (
    value === "automatic" ||
    value === "operator" ||
    value === "operator_after_change" ||
    value === "none"
  ) {
    return value;
  }
  return "unknown";
}

function jobKindOf(
  job: GithubAutomationJobRecord,
): GithubAutomationJobSafeProjection["kind"] {
  if (job.kind === "issue_analysis") return "issue_analysis";
  if (job.kind === "legacy_pipeline" || isLegacyGithubAutomationJob(job)) {
    return "legacy_pipeline";
  }
  if (job.schemaVersion === 2) return "issue_analysis";
  if (job.schemaVersion === 1) return "legacy_pipeline";
  return "unknown";
}

// ─── Action policy (retry only) ──────────────────────────────────────────────

const RETRYABLE_STATUSES = new Set<GithubAutomationJobStatus>([
  "blocked",
  "retry_due",
]);

export function evaluateGithubAutomationJobActions(
  job: GithubAutomationJobRecord,
  options?: {
    automationEnabled?: boolean;
    globalPaused?: boolean;
  },
): GithubAutomationJobActionAvailability[] {
  const enabled = options?.automationEnabled !== false;
  const kind = jobKindOf(job);

  const retryBlockedReason = (() => {
    if (!enabled) return "automation_disabled";
    if (kind === "legacy_pipeline") return "legacy_pipeline_retired";
    if (kind !== "issue_analysis" && !isGithubIssueAnalysisJobSchedulable(job)) {
      return "not_analysis_job";
    }
    if (job.phase === "completed" || job.status === "completed") {
      return "job_completed";
    }
    if (job.status === "cancelled" || job.phase === "cancelled") {
      return "job_cancelled";
    }
    if (job.status === "running") {
      return "job_running";
    }
    // Retry only for blocked / retry_due analysis jobs (first unconfirmed checkpoint).
    if (
      !RETRYABLE_STATUSES.has(job.status) &&
      job.phase !== "blocked" &&
      job.phase !== "retry_due"
    ) {
      return "status_not_retryable";
    }
    // Global pause does not disable the action recording; scheduler honors paused.
    void options?.globalPaused;
    return null;
  })();

  return [
    {
      action: "retry",
      available: retryBlockedReason === null,
      reasonCode: retryBlockedReason,
    },
  ];
}

// ─── Job projection ──────────────────────────────────────────────────────────

export function toGithubAutomationJobSafeProjection(
  job: GithubAutomationJobRecord,
  options?: {
    automationEnabled?: boolean;
    globalPaused?: boolean;
  },
): GithubAutomationJobSafeProjection {
  const comment = toEffectSafeProjection(
    findLatestEffect(job, "issue_analysis_comment"),
  );
  const close = toEffectSafeProjection(
    findLatestEffect(job, "issue_analysis_close"),
  );

  return {
    jobId: job.jobId,
    kind: jobKindOf(job),
    repositoryId: job.repositoryId,
    repositoryFullName: job.repositoryFullName,
    issueNumber: job.issueNumber,
    issueTitlePreview: job.issueTitlePreview,
    phase: job.phase,
    status: job.status,
    attempt: job.attempt,
    traceId: job.traceId,
    reasonCode: job.reasonCode,
    nextRetryAt: job.nextRetryAt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    checkpoint: job.checkpoint,
    category: job.category ?? null,
    verdict: job.verdict ?? null,
    confidence: job.confidence ?? null,
    completeness: job.completeness ?? null,
    budgetExceeded:
      typeof job.budgetExceeded === "boolean" ? job.budgetExceeded : null,
    outcome: deriveGithubIssueAnalysisOutcome(job),
    retryability: normalizeRetryability(job.retryability ?? null),
    comment,
    close,
    actions: evaluateGithubAutomationJobActions(job, {
      automationEnabled: options?.automationEnabled,
      globalPaused: options?.globalPaused,
    }),
  };
}

function countJobs(
  jobs: readonly GithubAutomationJobRecord[],
): GithubAutomationRuntimeProjection["counts"] {
  const counts = {
    queued: 0,
    running: 0,
    retry: 0,
    blocked: 0,
    completed: 0,
  };
  for (const job of jobs) {
    if (job.status === "queued") counts.queued += 1;
    if (job.status === "running") counts.running += 1;
    if (job.status === "retry_due" || job.phase === "retry_due") counts.retry += 1;
    if (job.status === "blocked" || job.phase === "blocked") counts.blocked += 1;
    if (job.status === "completed" || job.phase === "completed") counts.completed += 1;
  }
  return counts;
}

// ─── Status builder ──────────────────────────────────────────────────────────

export interface BuildGithubAutomationStatusOptions {
  config?: GithubAutomationConfig;
  /**
   * When true (default), resolve live app/installation/model readiness.
   * Tests may inject projections instead.
   */
  resolveLive?: boolean;
  appProjection?: GithubAppCredentialSafeProjection;
  capability?: GithubAppCapabilitySnapshot | null;
  modelReadiness?: IssueAnalysisModelReadiness | null;
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

  const app =
    options.appProjection ??
    (await getGithubAppCredentialSafeProjection());

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
      } catch {
        // Readiness stays fail-closed without throwing the whole status page.
        capability = deriveGithubAppCapability(emptyPermissionSnapshot());
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

  let modelReadiness: IssueAnalysisModelReadiness | null =
    options.modelReadiness ?? null;
  if (options.modelReadiness === undefined && options.resolveLive !== false) {
    try {
      // Presence-only readiness: no ModelRuntime network refresh on status GET.
      modelReadiness = await resolveIssueAnalysisModelReadiness();
    } catch {
      modelReadiness = {
        ready: false,
        reasonCode: "model_unavailable",
        model: null,
      };
    }
  }

  const jobs =
    options.jobs !== undefined
      ? [...options.jobs]
      : await listGithubAutomationJobs();
  jobs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const limit = Math.max(1, Math.min(options.jobLimit ?? 10, 50));
  const limitedJobs = jobs.slice(0, limit);

  const jobProjections: GithubAutomationJobSafeProjection[] = limitedJobs.map(
    (job) =>
      toGithubAutomationJobSafeProjection(job, {
        automationEnabled: config.enabled,
        globalPaused: config.paused,
      }),
  );

  const repositories: GithubAutomationRepositoryStatusProjection[] =
    config.repositories.map((repo) => {
      const base = toGithubAutomationRepositorySafeProjection(repo);
      const shortName = repo.fullName.includes("/")
        ? repo.fullName.split("/").pop() ?? repo.fullName
        : repo.fullName;
      return {
        ...base,
        installationBound:
          typeof repo.installationId === "number" && repo.installationId > 0,
        projectDisplayName: shortName,
      };
    });

  const configProjection = toGithubAutomationConfigSafeProjection(config);
  const runtimeProvenance = getGithubAutomationRuntimeProvenance();

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
      permissions: toGithubAutomationAnalysisPermissionProjection(capability),
      model: toGithubAutomationAnalysisModelProjection(modelReadiness),
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
      paused: config.paused,
      analysisMaxConcurrency: config.analysis.maxConcurrency,
      counts: countJobs(jobs),
    },
    repositories,
    jobs: jobProjections,
    config: configProjection,
    runtimeProvenance: {
      codeRevision: runtimeProvenance.codeRevision,
      policyVersion: runtimeProvenance.policyVersion,
    },
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
    if (
      value.startsWith("/Users/") ||
      value.startsWith("/home/") ||
      value.startsWith("/var/folders/")
    ) {
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
    value.forEach((item, i) =>
      assertGithubAutomationProjectionSafe(item, `${path}[${i}]`),
    );
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
      if (
        lower === forbidden.toLowerCase() ||
        lower.includes(forbidden.toLowerCase())
      ) {
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
  paused?: boolean;
  /**
   * Full allowlist replacement drafts when provided.
   * Server resolves projectId → projectRoot and cross-checks GitHub identity.
   * Never contains absolute projectRoot.
   */
  repositories?: GithubAutomationRepositoryWireDraft[];
  analysis?: {
    maxConcurrency?: number;
  };
  /** @deprecated Rejected at parse time after GIA-01. */
  mode?: never;
  /** @deprecated Rejected at parse time after GIA-01. */
  unattended?: never;
  /** @deprecated Rejected at parse time after GIA-01. */
  triage?: never;
}

/**
 * Parse a browser/API config patch. Rejects credential source overrides,
 * absolute path injection, closed-loop fields, and unknown secret fields.
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
      lower === "skipnetworklookup" ||
      lower === "mode" ||
      lower === "unattended" ||
      lower === "triage" ||
      lower === "baseref" ||
      lower === "owneractorids"
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

  if (rec.analysis !== undefined) {
    if (!rec.analysis || typeof rec.analysis !== "object" || Array.isArray(rec.analysis)) {
      throw new GithubAutomationError("invalid_config", "analysis must be an object", {
        status: 400,
      });
    }
    const a = rec.analysis as Record<string, unknown>;
    for (const key of Object.keys(a)) {
      if (key !== "maxConcurrency") {
        throw new GithubAutomationError(
          "invalid_config",
          "analysis patch contains disallowed field",
          { status: 400, details: { field: key } },
        );
      }
    }
    if (a.maxConcurrency !== undefined) {
      if (
        typeof a.maxConcurrency !== "number" ||
        !Number.isInteger(a.maxConcurrency) ||
        a.maxConcurrency < 1 ||
        a.maxConcurrency > 8
      ) {
        throw new GithubAutomationError(
          "invalid_config",
          "analysis.maxConcurrency invalid",
          { status: 400 },
        );
      }
      patch.analysis = { maxConcurrency: a.maxConcurrency };
    } else {
      patch.analysis = {};
    }
  }

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
  config: GithubAutomationConfig;
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

  let repositories: GithubAutomationConfig["repositories"] | undefined;
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
    paused: wirePatch.paused,
    repositories,
    analysis: wirePatch.analysis
      ? { maxConcurrency: wirePatch.analysis.maxConcurrency }
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

// ─── Job actions (retry only) ────────────────────────────────────────────────

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

/**
 * Apply a job action. GIA-04: only `retry` is accepted.
 * Retry re-queues at the first unconfirmed checkpoint; the analysis runner
 * never re-runs a validated result sidecar or re-issues remote-confirmed effects.
 */
export async function applyGithubAutomationJobAction(options: {
  jobId: string;
  action: GithubAutomationJobActionName;
  config?: GithubAutomationConfig;
  /** When true (default for retry), wake scheduler after state change. */
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

  if (options.action !== "retry") {
    return {
      ok: false,
      code: "not_allowed",
      message: 'Only action "retry" is supported',
      job: toGithubAutomationJobSafeProjection(job, {
        automationEnabled: config.enabled,
        globalPaused: config.paused,
      }),
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
        globalPaused: config.paused,
      }),
      partial: false,
    };
  }

  const actions = evaluateGithubAutomationJobActions(job, {
    automationEnabled: config.enabled,
    globalPaused: config.paused,
  });
  const gate = actions.find((a) => a.action === options.action);
  if (!gate?.available) {
    return {
      ok: false,
      code: "not_allowed",
      message: gate?.reasonCode
        ? `Action not allowed: ${gate.reasonCode}`
        : "Action not allowed",
      job: toGithubAutomationJobSafeProjection(job, {
        automationEnabled: config.enabled,
        globalPaused: config.paused,
      }),
      partial: false,
    };
  }

  // Preserve phase/checkpoint so the analysis runner resumes the first unconfirmed
  // effect (result_ready / commenting / closing). Never invent a new result.
  const next = await writeGithubAutomationJob({
    ...job,
    status: "queued",
    reasonCode: "retry_wake",
    nextRetryAt: null,
    retryability: "automatic",
    // Preserve generation + attempt audit; scheduler increments attempt on lease.
    attempt: job.attempt,
    generation: job.generation,
    updatedAt: new Date().toISOString(),
  });

  if (options.wakeScheduler !== false) {
    // Job retry may wake; pure status/config GET / verify must not call this.
    wakeGithubAutomationScheduler();
  }

  return {
    ok: true,
    code: "accepted",
    message:
      "Retry accepted; job re-queued at the first unconfirmed analysis checkpoint (does not re-run confirmed comment/close)",
    job: toGithubAutomationJobSafeProjection(next, {
      automationEnabled: config.enabled,
      globalPaused: config.paused,
    }),
    partial: true,
  };
}

export function safeGithubAutomationActionErrorMessage(err: unknown): string {
  return safeGithubAutomationErrorMessage(err, "Internal GitHub automation error");
}
