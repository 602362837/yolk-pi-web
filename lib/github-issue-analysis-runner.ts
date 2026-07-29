/**
 * github-issue-analysis-runner — single opened-Issue analysis lifecycle (GIA-03).
 *
 * Phases:
 *   received → analyzing → result_ready → commenting → [closing] → completed
 *
 * Invariants:
 * - No AgentSession / WorkTree / Studio / bash / edit / write / Git / network tools.
 * - Issue title/body stay in memory only; durable job stores hashes and safe fields.
 * - Result sidecar is the analysis checkpoint; retries after result_ready do not re-run
 *   the model unless the sidecar is missing/invalid (then fail closed / blocked).
 * - One v3 issue_analysis comment; semantic no-op + unknown-write reconcile.
 * - Close only through evaluateIssueAnalysisCloseGate after comment remote-confirm.
 * - Explicit dispositions for every exit (progressed / waiting / retry_due / blocked / terminal).
 */

import {
  findRepositoryConfigById,
  parseGithubRepositoryFullName,
} from "./github-automation-config";
import {
  buildGithubAutomationCommentMarker,
  buildIssueAnalysisCommentBody,
  upsertGithubAutomationComment,
  type IssueAnalysisCommentDisposition,
} from "./github-automation-comments";
import {
  GithubAutomationError,
  isGithubAutomationError,
} from "./github-automation-errors";
import {
  addGithubIssueLabels,
  ensureGithubRepoLabel,
  extractLabelNames,
  typeLabelsToRemove,
  YPI_LABEL_TYPE_BUG,
  YPI_LABEL_TYPE_DOCS,
  YPI_LABEL_TYPE_FEATURE,
  YPI_LABEL_TYPE_OTHER,
  type YpiTriageTypeLabel,
} from "./github-automation-labels";
import {
  appendGithubAutomationSafeEvent,
  createGithubAutomationResultId,
  isValidGithubIssueAnalysisResultSidecar,
  readGithubIssueAnalysisResultSidecar,
  upsertEffectMarker,
  writeGithubAutomationJob,
  writeGithubIssueAnalysisResultSidecar,
  type GithubAutomationEffectMarker,
  type GithubAutomationJobRecord,
  type GithubIssueAnalysisResultSidecar,
} from "./github-automation-store";
import type {
  GithubAutomationConfigV2,
  GithubAutomationJobDisposition,
  GithubAutomationJobHandler,
  GithubAutomationJobHandlerResult,
  GithubIssueAnalysisCategory,
  GithubIssueAnalysisConfidence,
  GithubIssueAnalysisTruthVerdict,
} from "./github-automation-types";
import { githubAppInstallationRequest } from "./github-app-client";
import {
  closeGithubIssueAsNotPlanned,
  describeCloseGateDenial,
  evaluateIssueAnalysisCloseGate,
  fetchGithubIssueCloseSnapshot,
  isRetriableGithubMutationError,
  reconcileCloseFromSnapshot,
  type IssueAnalysisCloseGateDenial,
} from "./github-issue-analysis-close";
import {
  IssueAnalysisEvidenceController,
  boundIssueAnalysisClaim,
} from "./github-issue-analysis-evidence";
import {
  resolveIssueAnalysisModelReadiness,
  runIssueAnalysis,
  type IssueAnalysisModelRuntimeLike,
  type RunIssueAnalysisOptions,
} from "./github-issue-analysis-model";
import type { IssueAnalysisValidatedResult } from "./github-issue-analysis-types";

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_AUTO_RETRIES = 5;
const RETRY_BACKOFF_MS = [5_000, 30_000, 120_000, 600_000, 1_800_000] as const;

/** When false (default), classification is written in the comment only — no label mutation. */
const ENABLE_CATEGORY_LABEL_MUTATION = false;

// ─── Test seams ──────────────────────────────────────────────────────────────

export interface GithubIssueAnalysisRunnerDeps {
  fetchIssue?: typeof fetchGithubIssueCloseSnapshot;
  runAnalysis?: (
    options: RunIssueAnalysisOptions,
  ) => Promise<Awaited<ReturnType<typeof runIssueAnalysis>>>;
  resolveModel?: typeof resolveIssueAnalysisModelReadiness;
  /** Inject ModelRuntime for tests. When omitted, analysis uses built-in readiness only. */
  modelRuntime?: IssueAnalysisModelRuntimeLike | null;
  upsertComment?: typeof upsertGithubAutomationComment;
  closeIssue?: typeof closeGithubIssueAsNotPlanned;
  ensureLabels?: (options: {
    installationId: number;
    owner: string;
    repo: string;
    issueNumber: number;
    category: GithubIssueAnalysisCategory;
    signal?: AbortSignal;
  }) => Promise<void>;
  now?: () => number;
}

let runnerDeps: GithubIssueAnalysisRunnerDeps = {};

export function _testSetGithubIssueAnalysisRunnerDeps(
  deps: GithubIssueAnalysisRunnerDeps | null,
): void {
  runnerDeps = deps ?? {};
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function effectByName(
  job: GithubAutomationJobRecord,
  name: GithubAutomationEffectMarker["name"],
): GithubAutomationEffectMarker | null {
  return job.effects.find((e) => e.name === name) ?? null;
}

function nextRetryAtIso(attempt: number, nowMs: number): string {
  const idx = Math.min(
    RETRY_BACKOFF_MS.length - 1,
    Math.max(0, attempt - 1),
  );
  const base = RETRY_BACKOFF_MS[idx] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1]!;
  // Small deterministic jitter from attempt.
  const jitter = ((attempt * 37) % 7) * 250;
  return new Date(nowMs + base + jitter).toISOString();
}

function shouldBlockForRetryBudget(job: GithubAutomationJobRecord): boolean {
  return job.attempt >= MAX_AUTO_RETRIES;
}

function splitFullName(
  fullName: string,
): { owner: string; repo: string } | null {
  try {
    const parsed = parseGithubRepositoryFullName(fullName);
    return { owner: parsed.owner, repo: parsed.repo };
  } catch {
    return null;
  }
}

function categoryToTypeLabel(
  category: GithubIssueAnalysisCategory,
): YpiTriageTypeLabel {
  switch (category) {
    case "bug":
      return YPI_LABEL_TYPE_BUG;
    case "feature":
      return YPI_LABEL_TYPE_FEATURE;
    case "docs":
      return YPI_LABEL_TYPE_DOCS;
    case "question":
    case "other":
    default:
      return YPI_LABEL_TYPE_OTHER;
  }
}

function dispositionForTerminal(
  job: GithubAutomationJobRecord,
): GithubAutomationJobDisposition {
  return {
    kind: "terminal",
    status: job.status === "cancelled" || job.status === "ignored" ? job.status : "completed",
  };
}

function dispositionProgressed(
  job: GithubAutomationJobRecord,
  checkpoint: string,
): GithubAutomationJobDisposition {
  return {
    kind: "progressed",
    progressRevision: (job.progressRevision ?? 0) + 1,
    checkpoint,
  };
}

function dispositionRetry(
  reasonCode: string,
  nextRetryAt: string,
): GithubAutomationJobDisposition {
  return {
    kind: "retry_due",
    reasonCode,
    nextRetryAt,
    retryClass: "network",
  };
}

function dispositionBlocked(
  reasonCode: string,
  fingerprint: string,
): GithubAutomationJobDisposition {
  return {
    kind: "blocked",
    reasonCode,
    layer: "scheduler",
    fingerprint,
    retryability: "operator",
  };
}

async function persistJob(
  job: GithubAutomationJobRecord,
): Promise<GithubAutomationJobRecord> {
  return writeGithubAutomationJob(job);
}

async function safeEvent(
  job: GithubAutomationJobRecord,
  kind: string,
  reasonCode: string | null,
  meta?: Record<string, string | number | boolean | null>,
): Promise<void> {
  await appendGithubAutomationSafeEvent({
    at: new Date().toISOString(),
    kind,
    repositoryId: job.repositoryId,
    issueNumber: job.issueNumber,
    jobId: job.jobId,
    deliveryId: job.deliveryId,
    phase: job.phase,
    reasonCode,
    traceId: job.traceId,
    meta,
  });
}

function resultToSidecar(input: {
  job: GithubAutomationJobRecord;
  resultId: string;
  result: IssueAnalysisValidatedResult;
  issueContentHash: string;
  issueUpdatedAt: string | null;
}): GithubIssueAnalysisResultSidecar {
  return {
    schemaVersion: 2,
    resultId: input.resultId,
    jobId: input.job.jobId,
    repositoryId: input.job.repositoryId,
    issueNumber: input.job.issueNumber,
    issueContentHash: input.issueContentHash,
    issueUpdatedAt: input.issueUpdatedAt,
    category: input.result.category,
    verdict: input.result.verdict,
    confidence: input.result.confidence,
    coverage: input.result.coverage,
    complete: input.result.complete,
    truncatedInput: input.result.truncatedInput,
    budgetExhausted: input.result.budgetExhausted,
    mayClose: input.result.mayClose,
    reasonCode: input.result.reasonCode,
    reasonSummary: input.result.reasonSummary,
    directionSummary: input.result.directionSummary,
    evidence: input.result.evidence.map((e) => ({
      evidenceId: e.evidenceId,
      relation: e.relation,
      relativePath: e.relativePath,
      lineStart: e.lineStart,
      lineEnd: e.lineEnd,
      note: e.note,
    })),
    resultHash: input.result.resultHash,
    createdAt: new Date().toISOString(),
  };
}

function sidecarToValidated(
  sidecar: GithubIssueAnalysisResultSidecar,
): IssueAnalysisValidatedResult {
  return {
    category: sidecar.category as IssueAnalysisValidatedResult["category"],
    verdict: sidecar.verdict as IssueAnalysisValidatedResult["verdict"],
    confidence: sidecar.confidence as IssueAnalysisValidatedResult["confidence"],
    coverage: sidecar.coverage as IssueAnalysisValidatedResult["coverage"],
    complete: sidecar.complete,
    truncatedInput: sidecar.truncatedInput,
    budgetExhausted: sidecar.budgetExhausted,
    mayClose: sidecar.mayClose,
    reasonCode: sidecar.reasonCode as IssueAnalysisValidatedResult["reasonCode"],
    reasonSummary: sidecar.reasonSummary,
    directionSummary: sidecar.directionSummary,
    evidence: sidecar.evidence.map((e) => ({
      evidenceId: e.evidenceId,
      relation: e.relation as IssueAnalysisValidatedResult["evidence"][number]["relation"],
      relativePath: e.relativePath,
      lineStart: e.lineStart,
      lineEnd: e.lineEnd,
      note: e.note,
    })),
    resultHash: sidecar.resultHash,
  };
}

function commentDispositionForResult(
  result: IssueAnalysisValidatedResult,
  stage: "initial" | "closing" | "closed" | "not_closed",
): IssueAnalysisCommentDisposition {
  if (stage === "closed") return "closed";
  if (stage === "closing") return "closing";
  if (stage === "not_closed") return "not_closed";
  if (result.mayClose && result.verdict === "not_exists" && result.category === "bug") {
    return "closing";
  }
  return "keep_open";
}

function buildCommentBodyFromResult(options: {
  repositoryId: number;
  issueNumber: number;
  result: IssueAnalysisValidatedResult;
  disposition: IssueAnalysisCommentDisposition;
  notClosedReason?: string | null;
}): string {
  const marker = buildGithubAutomationCommentMarker({
    kind: "issue_analysis",
    repositoryId: options.repositoryId,
    issueNumber: options.issueNumber,
  });
  return buildIssueAnalysisCommentBody({
    marker,
    category: options.result.category,
    verdict: options.result.verdict,
    confidence: options.result.confidence,
    reasonSummary: options.result.reasonSummary,
    directionSummary: options.result.directionSummary,
    evidence: options.result.evidence.map((e) => ({
      relativePath: e.relativePath,
      lineStart: e.lineStart,
      lineEnd: e.lineEnd,
      note: e.note,
    })),
    disposition: options.disposition,
    notClosedReason: options.notClosedReason,
  });
}

async function defaultEnsureCategoryLabels(options: {
  installationId: number;
  owner: string;
  repo: string;
  issueNumber: number;
  category: GithubIssueAnalysisCategory;
  signal?: AbortSignal;
}): Promise<void> {
  if (!ENABLE_CATEGORY_LABEL_MUTATION) return;
  const typeLabel = categoryToTypeLabel(options.category);
  await ensureGithubRepoLabel({
    installationId: options.installationId,
    owner: options.owner,
    repo: options.repo,
    name: typeLabel,
    signal: options.signal,
  });

  // Read current labels so we only remove YPI type siblings.
  const get = await githubAppInstallationRequest(
    options.installationId,
    `/repos/${encodeURIComponent(options.owner)}/${encodeURIComponent(options.repo)}/issues/${options.issueNumber}`,
    { method: "GET", signal: options.signal },
  );
  const currentLabels = isRecord(get.body) ? get.body.labels : [];
  const current = extractLabelNames(currentLabels);
  const toRemove = typeLabelsToRemove(typeLabel).filter((name) =>
    current.some((c) => c.toLowerCase() === name.toLowerCase()),
  );
  // Best-effort remove siblings via labels API path already used by labels module.
  for (const label of toRemove) {
    try {
      await githubAppInstallationRequest(
        options.installationId,
        `/repos/${encodeURIComponent(options.owner)}/${encodeURIComponent(options.repo)}/issues/${options.issueNumber}/labels/${encodeURIComponent(label)}`,
        { method: "DELETE", signal: options.signal },
      );
    } catch {
      // non-fatal
    }
  }
  if (!current.some((c) => c.toLowerCase() === typeLabel.toLowerCase())) {
    await addGithubIssueLabels({
      installationId: options.installationId,
      owner: options.owner,
      repo: options.repo,
      issueNumber: options.issueNumber,
      labels: [typeLabel],
      signal: options.signal,
    });
  }
}

// ─── Phase handlers ──────────────────────────────────────────────────────────

async function phaseAnalyze(
  job: GithubAutomationJobRecord,
  config: GithubAutomationConfigV2,
  signal?: AbortSignal,
): Promise<GithubAutomationJobHandlerResult> {
  const now = new Date().toISOString();
  const repoConfig = findRepositoryConfigById(config, job.repositoryId);
  if (!repoConfig) {
    const next: GithubAutomationJobRecord = {
      ...job,
      status: "blocked",
      phase: "completed",
      reasonCode: "repository_not_allowlisted",
      checkpoint: "blocked",
      updatedAt: now,
      nextRetryAt: null,
    };
    await persistJob(next);
    await safeEvent(next, "issue_analysis_blocked", next.reasonCode);
    return {
      job: next,
      disposition: dispositionBlocked("repository_not_allowlisted", "repo_missing"),
    };
  }

  const installationId = job.installationId ?? repoConfig.installationId;
  if (!installationId || installationId <= 0) {
    const next: GithubAutomationJobRecord = {
      ...job,
      status: "blocked",
      phase: "completed",
      reasonCode: "installation_missing",
      checkpoint: "blocked",
      updatedAt: now,
      nextRetryAt: null,
    };
    await persistJob(next);
    return {
      job: next,
      disposition: dispositionBlocked("installation_missing", "install_missing"),
    };
  }

  const names = splitFullName(job.repositoryFullName || repoConfig.fullName);
  if (!names) {
    const next: GithubAutomationJobRecord = {
      ...job,
      status: "blocked",
      phase: "completed",
      reasonCode: "malformed_full_name",
      checkpoint: "blocked",
      updatedAt: now,
    };
    await persistJob(next);
    return {
      job: next,
      disposition: dispositionBlocked("malformed_full_name", "full_name"),
    };
  }

  // Already have a valid sidecar bound to this job — resume at result_ready.
  if (job.resultId && job.resultHash) {
    const existing = await readGithubIssueAnalysisResultSidecar(job.resultId);
    if (
      isValidGithubIssueAnalysisResultSidecar(existing) &&
      existing.resultHash === job.resultHash &&
      existing.jobId === job.jobId
    ) {
      const next: GithubAutomationJobRecord = {
        ...job,
        phase: "result_ready",
        status: "queued",
        checkpoint: "result_ready",
        category: existing.category,
        verdict: existing.verdict,
        confidence: existing.confidence,
        completeness: existing.complete
          ? existing.truncatedInput
            ? "truncated"
            : existing.budgetExhausted
              ? "budget_exhausted"
              : "complete"
          : "incomplete",
        budgetExceeded: existing.budgetExhausted,
        issueContentHash: existing.issueContentHash,
        issueUpdatedAt: existing.issueUpdatedAt,
        updatedAt: now,
        reasonCode: null,
        nextRetryAt: null,
        progressRevision: (job.progressRevision ?? 0) + 1,
      };
      await persistJob(next);
      return {
        job: next,
        wakeAgain: true,
        disposition: dispositionProgressed(next, "result_ready"),
      };
    }
    // Sidecar missing/invalid after result_ready pointer — fail closed, do not re-guess.
    if (job.phase === "result_ready" || job.checkpoint === "result_ready") {
      const next: GithubAutomationJobRecord = {
        ...job,
        status: "blocked",
        phase: "completed",
        reasonCode: "result_sidecar_invalid",
        checkpoint: "blocked",
        updatedAt: now,
        nextRetryAt: null,
      };
      await persistJob(next);
      await safeEvent(next, "issue_analysis_blocked", next.reasonCode);
      return {
        job: next,
        disposition: dispositionBlocked("result_sidecar_invalid", "sidecar"),
      };
    }
  }

  const analyzing: GithubAutomationJobRecord = {
    ...job,
    phase: "analyzing",
    status: "running",
    checkpoint: "analyzing",
    updatedAt: now,
    reasonCode: null,
  };
  await persistJob(analyzing);
  await safeEvent(analyzing, "issue_analysis_started", null);

  const fetchIssue = runnerDeps.fetchIssue ?? fetchGithubIssueCloseSnapshot;
  let issueSnapshot;
  try {
    issueSnapshot = await fetchIssue({
      installationId,
      owner: names.owner,
      repo: names.repo,
      issueNumber: job.issueNumber,
      signal,
      hashContent: (title, body) =>
        boundIssueAnalysisClaim({
          title,
          body,
          issueUpdatedAt: new Date().toISOString(),
          repositoryId: job.repositoryId,
          issueNumber: job.issueNumber,
        }).contentHash,
    });
  } catch (err) {
    return retryOrBlock(analyzing, err, "issue_fetch_failed");
  }

  if (issueSnapshot.state !== "open") {
    // Opened job but Issue no longer open — complete without mutation.
    const next: GithubAutomationJobRecord = {
      ...analyzing,
      phase: "completed",
      status: "completed",
      checkpoint: "completed",
      reasonCode: "issue_not_open",
      issueContentHash: issueSnapshot.contentHash,
      issueUpdatedAt: issueSnapshot.updatedAt,
      category: null,
      verdict: "inconclusive",
      confidence: "low",
      completeness: "incomplete",
      updatedAt: new Date().toISOString(),
      nextRetryAt: null,
      progressRevision: (analyzing.progressRevision ?? 0) + 1,
    };
    await persistJob(next);
    await safeEvent(next, "issue_analysis_completed", next.reasonCode);
    return { job: next, disposition: dispositionForTerminal(next) };
  }

  const projectRoot =
    typeof repoConfig.projectRoot === "string" ? repoConfig.projectRoot.trim() : "";
  if (!projectRoot) {
    // Still produce an inconclusive durable result + comment path.
    const inconclusive = await finalizeAnalysisWithoutEvidence({
      job: analyzing,
      installationId,
      issueSnapshot,
      reasonCode: "project_root_unavailable",
      reasonSummary:
        "Local project binding is missing or unreadable; the issue stays open without a truth verdict.",
    });
    return inconclusive;
  }

  const controller = await IssueAnalysisEvidenceController.open({
    projectRoot,
  });
  if ("reasonCode" in controller) {
    return finalizeAnalysisWithoutEvidence({
      job: analyzing,
      installationId,
      issueSnapshot,
      reasonCode: controller.reasonCode,
      reasonSummary:
        "Local project root is unavailable for read-only evidence; the issue stays open.",
    });
  }

  const resolveModel = runnerDeps.resolveModel ?? resolveIssueAnalysisModelReadiness;
  const readiness = await resolveModel({
    runtime: runnerDeps.modelRuntime ?? undefined,
  });
  if (!readiness.ready || !readiness.model) {
    return finalizeAnalysisWithoutEvidence({
      job: analyzing,
      installationId,
      issueSnapshot,
      reasonCode: "model_unavailable",
      reasonSummary:
        "Analysis model is unavailable; the issue stays open without a truth verdict.",
    });
  }

  // runIssueAnalysis requires a runtime when completeTurn is not injected.
  // If tests inject runAnalysis, we do not need a live ModelRuntime.
  const runAnalysis = runnerDeps.runAnalysis ?? runIssueAnalysis;
  let analysisOutcome: Awaited<ReturnType<typeof runIssueAnalysis>>;
  try {
    if (!runnerDeps.runAnalysis && !runnerDeps.modelRuntime) {
      // Production path: dynamically load provider-aware ModelRuntime without
      // creating AgentSession.
      const { createWebModelRuntime } = await import("./web-model-runtime");
      const modelRuntime = await createWebModelRuntime();
      analysisOutcome = await runAnalysis({
        claim: {
          title: issueSnapshot.title,
          body: issueSnapshot.body,
          issueUpdatedAt: issueSnapshot.updatedAt ?? new Date().toISOString(),
          repositoryId: job.repositoryId,
          issueNumber: job.issueNumber,
        },
        evidence: controller,
        runtime: modelRuntime as unknown as IssueAnalysisModelRuntimeLike,
        model: readiness.model,
        signal,
      });
    } else {
      analysisOutcome = await runAnalysis({
        claim: {
          title: issueSnapshot.title,
          body: issueSnapshot.body,
          issueUpdatedAt: issueSnapshot.updatedAt ?? new Date().toISOString(),
          repositoryId: job.repositoryId,
          issueNumber: job.issueNumber,
        },
        evidence: controller,
        runtime: (runnerDeps.modelRuntime ?? {
          getModel: () => null,
          getAuth: async () => null,
          completeSimple: async () => ({ content: [] }),
        }) as IssueAnalysisModelRuntimeLike,
        model: readiness.model,
        signal,
      });
    }
  } catch {
    return finalizeAnalysisWithoutEvidence({
      job: analyzing,
      installationId,
      issueSnapshot,
      reasonCode: "model_error",
      reasonSummary:
        "Analysis failed before a validated verdict; the issue stays open.",
    });
  }

  const result = analysisOutcome.result;
  const bounded = analysisOutcome.boundedClaim;
  const resultId = createGithubAutomationResultId(job.jobId);
  const sidecar = resultToSidecar({
    job: analyzing,
    resultId,
    result,
    issueContentHash: bounded.contentHash,
    issueUpdatedAt: issueSnapshot.updatedAt,
  });
  await writeGithubIssueAnalysisResultSidecar(sidecar);

  const completeness = !result.complete
    ? "incomplete"
    : result.truncatedInput
      ? "truncated"
      : result.budgetExhausted
        ? "budget_exhausted"
        : "complete";

  const next: GithubAutomationJobRecord = {
    ...analyzing,
    phase: "result_ready",
    status: "queued",
    checkpoint: "result_ready",
    resultId,
    resultHash: result.resultHash,
    category: result.category as GithubIssueAnalysisCategory,
    verdict: result.verdict as GithubIssueAnalysisTruthVerdict,
    confidence: result.confidence as GithubIssueAnalysisConfidence,
    completeness,
    budgetExceeded: result.budgetExhausted,
    issueContentHash: bounded.contentHash,
    issueUpdatedAt: issueSnapshot.updatedAt,
    reasonCode: result.reasonCode === "ok" ? null : result.reasonCode,
    updatedAt: new Date().toISOString(),
    nextRetryAt: null,
    progressRevision: (analyzing.progressRevision ?? 0) + 1,
  };
  await persistJob(next);
  await safeEvent(next, "issue_analysis_result_ready", next.reasonCode, {
    category: next.category ?? null,
    verdict: next.verdict ?? null,
    confidence: next.confidence ?? null,
  });
  return {
    job: next,
    wakeAgain: true,
    disposition: dispositionProgressed(next, "result_ready"),
  };
}

async function finalizeAnalysisWithoutEvidence(input: {
  job: GithubAutomationJobRecord;
  installationId: number;
  issueSnapshot: Awaited<ReturnType<typeof fetchGithubIssueCloseSnapshot>>;
  reasonCode: string;
  reasonSummary: string;
}): Promise<GithubAutomationJobHandlerResult> {
  const { buildInconclusiveIssueAnalysisResult } = await import(
    "./github-issue-analysis-types"
  );
  const result = buildInconclusiveIssueAnalysisResult({
    reasonCode: input.reasonCode as never,
    reasonSummary: input.reasonSummary,
  });
  const bounded = boundIssueAnalysisClaim({
    title: input.issueSnapshot.title,
    body: input.issueSnapshot.body,
    issueUpdatedAt:
      input.issueSnapshot.updatedAt ?? new Date().toISOString(),
    repositoryId: input.job.repositoryId,
    issueNumber: input.job.issueNumber,
  });
  const resultId = createGithubAutomationResultId(input.job.jobId);
  const sidecar = resultToSidecar({
    job: input.job,
    resultId,
    result,
    issueContentHash: bounded.contentHash,
    issueUpdatedAt: input.issueSnapshot.updatedAt,
  });
  await writeGithubIssueAnalysisResultSidecar(sidecar);

  const next: GithubAutomationJobRecord = {
    ...input.job,
    phase: "result_ready",
    status: "queued",
    checkpoint: "result_ready",
    resultId,
    resultHash: result.resultHash,
    category: result.category,
    verdict: result.verdict,
    confidence: result.confidence,
    completeness: "incomplete",
    budgetExceeded: false,
    issueContentHash: bounded.contentHash,
    issueUpdatedAt: input.issueSnapshot.updatedAt,
    reasonCode: input.reasonCode,
    updatedAt: new Date().toISOString(),
    nextRetryAt: null,
    progressRevision: (input.job.progressRevision ?? 0) + 1,
  };
  await persistJob(next);
  await safeEvent(next, "issue_analysis_result_ready", next.reasonCode);
  return {
    job: next,
    wakeAgain: true,
    disposition: dispositionProgressed(next, "result_ready"),
  };
}

async function phaseCommentAndClose(
  job: GithubAutomationJobRecord,
  config: GithubAutomationConfigV2,
  signal?: AbortSignal,
): Promise<GithubAutomationJobHandlerResult> {
  const nowMs = (runnerDeps.now ?? Date.now)();
  const now = new Date(nowMs).toISOString();

  if (!job.resultId || !job.resultHash) {
    const next: GithubAutomationJobRecord = {
      ...job,
      status: "blocked",
      phase: "completed",
      reasonCode: "result_sidecar_missing",
      checkpoint: "blocked",
      updatedAt: now,
      nextRetryAt: null,
    };
    await persistJob(next);
    return {
      job: next,
      disposition: dispositionBlocked("result_sidecar_missing", "sidecar"),
    };
  }

  const sidecar = await readGithubIssueAnalysisResultSidecar(job.resultId);
  if (
    !isValidGithubIssueAnalysisResultSidecar(sidecar) ||
    sidecar.resultHash !== job.resultHash ||
    sidecar.jobId !== job.jobId
  ) {
    const next: GithubAutomationJobRecord = {
      ...job,
      status: "blocked",
      phase: "completed",
      reasonCode: "result_sidecar_invalid",
      checkpoint: "blocked",
      updatedAt: now,
      nextRetryAt: null,
    };
    await persistJob(next);
    return {
      job: next,
      disposition: dispositionBlocked("result_sidecar_invalid", "sidecar"),
    };
  }

  const result = sidecarToValidated(sidecar);
  const repoConfig = findRepositoryConfigById(config, job.repositoryId);
  const installationId =
    job.installationId ?? repoConfig?.installationId ?? null;
  if (!installationId || !repoConfig) {
    const next: GithubAutomationJobRecord = {
      ...job,
      status: "blocked",
      phase: "completed",
      reasonCode: "repository_not_allowlisted",
      checkpoint: "blocked",
      updatedAt: now,
    };
    await persistJob(next);
    return {
      job: next,
      disposition: dispositionBlocked("repository_not_allowlisted", "repo"),
    };
  }
  const names = splitFullName(job.repositoryFullName || repoConfig.fullName);
  if (!names) {
    const next: GithubAutomationJobRecord = {
      ...job,
      status: "blocked",
      phase: "completed",
      reasonCode: "malformed_full_name",
      checkpoint: "blocked",
      updatedAt: now,
    };
    await persistJob(next);
    return {
      job: next,
      disposition: dispositionBlocked("malformed_full_name", "full_name"),
    };
  }

  // Optional label mutation (disabled until vocabulary approved).
  const labelEffect = effectByName(job, "issue_analysis_label");
  if (
    ENABLE_CATEGORY_LABEL_MUTATION &&
    labelEffect?.status !== "remote_confirmed"
  ) {
    try {
      const ensure = runnerDeps.ensureLabels ?? defaultEnsureCategoryLabels;
      await ensure({
        installationId,
        owner: names.owner,
        repo: names.repo,
        issueNumber: job.issueNumber,
        category: result.category,
        signal,
      });
      job = {
        ...job,
        effects: upsertEffectMarker(job.effects, {
          name: "issue_analysis_label",
          status: "remote_confirmed",
          remoteId: result.category,
          generation: job.generation,
          updatedAt: new Date().toISOString(),
          reasonCode: null,
        }),
      };
      await persistJob(job);
    } catch (err) {
      if (isRetriableGithubMutationError(err)) {
        return retryOrBlock(job, err, "label_mutation_failed");
      }
      // Non-retriable label failure: continue to comment (labels are optional).
      job = {
        ...job,
        effects: upsertEffectMarker(job.effects, {
          name: "issue_analysis_label",
          status: "failed",
          remoteId: null,
          generation: job.generation,
          updatedAt: new Date().toISOString(),
          reasonCode: "label_mutation_failed",
        }),
      };
      await persistJob(job);
    }
  }

  // Comment phase
  let commentEffect = effectByName(job, "issue_analysis_comment");
  if (commentEffect?.status !== "remote_confirmed") {
    const commenting: GithubAutomationJobRecord = {
      ...job,
      phase: "commenting",
      status: "running",
      checkpoint: "commenting",
      updatedAt: new Date().toISOString(),
      reasonCode: null,
    };
    await persistJob(commenting);

    const initialDisposition = commentDispositionForResult(result, "initial");
    const body = buildCommentBodyFromResult({
      repositoryId: job.repositoryId,
      issueNumber: job.issueNumber,
      result,
      disposition: initialDisposition,
    });

    const upsert = runnerDeps.upsertComment ?? upsertGithubAutomationComment;
    try {
      const write = await upsert({
        installationId,
        owner: names.owner,
        repo: names.repo,
        issueNumber: job.issueNumber,
        repositoryId: job.repositoryId,
        kind: "issue_analysis",
        body,
        signal,
      });
      commentEffect = {
        name: "issue_analysis_comment",
        status: "remote_confirmed",
        remoteId: String(write.id),
        generation: job.generation,
        updatedAt: new Date().toISOString(),
        reasonCode: write.outcome,
      };
      job = {
        ...commenting,
        effects: upsertEffectMarker(commenting.effects, commentEffect),
        progressRevision: (commenting.progressRevision ?? 0) + 1,
        updatedAt: new Date().toISOString(),
      };
      await persistJob(job);
      await safeEvent(job, "issue_analysis_comment_confirmed", write.outcome, {
        remoteId: write.id,
        writePerformed: write.writePerformed,
      });
    } catch (err) {
      return retryOrBlock(commenting, err, "comment_write_failed");
    }
  }

  // Close gate — only for mayClose candidates.
  const wantsClose =
    result.mayClose === true &&
    result.category === "bug" &&
    result.verdict === "not_exists" &&
    result.confidence === "high";

  let closeEffect = effectByName(job, "issue_analysis_close");
  if (!wantsClose) {
    return completeOpen(job, result, null);
  }
  if (closeEffect?.status === "remote_confirmed") {
    return completeClosed(job, result, closeEffect);
  }

  // Re-check config enabled/paused under current config snapshot.
  if (!config.enabled || config.paused) {
    const reason: IssueAnalysisCloseGateDenial = !config.enabled
      ? "config_disabled"
      : "config_paused";
    return completeOpenAfterFailedClose(job, result, reason, names, installationId, signal);
  }

  const fenceValid =
    typeof job.leaseFencingToken === "string" &&
    job.leaseFencingToken.length > 0;

  // Establish post-comment Issue baseline (updated_at may have changed).
  const fetchIssue = runnerDeps.fetchIssue ?? fetchGithubIssueCloseSnapshot;
  let freshIssue;
  try {
    freshIssue = await fetchIssue({
      installationId,
      owner: names.owner,
      repo: names.repo,
      issueNumber: job.issueNumber,
      signal,
      hashContent: (title, body) =>
        boundIssueAnalysisClaim({
          title,
          body,
          issueUpdatedAt: new Date().toISOString(),
          repositoryId: job.repositoryId,
          issueNumber: job.issueNumber,
        }).contentHash,
    });
  } catch (err) {
    return retryOrBlock(job, err, "issue_fetch_failed");
  }

  const hasVerifiedContradiction = result.evidence.some(
    (e) => e.relation === "contradicts",
  );
  const gate = evaluateIssueAnalysisCloseGate({
    category: result.category,
    verdict: result.verdict,
    confidence: result.confidence,
    complete: result.complete,
    truncatedInput: result.truncatedInput,
    budgetExhausted: result.budgetExhausted,
    mayClose: result.mayClose,
    hasVerifiedContradiction,
    commentEffect: effectByName(job, "issue_analysis_comment"),
    closeEffect,
    analysisContentHash: job.issueContentHash ?? sidecar.issueContentHash,
    issue: freshIssue,
    configEnabled: config.enabled,
    configPaused: config.paused,
    fenceValid,
  });

  if (!gate.allowed) {
    return completeOpenAfterFailedClose(
      job,
      result,
      gate.reason ?? "may_close_false",
      names,
      installationId,
      signal,
    );
  }

  // Enter closing phase; store post-comment updatedAt baseline for audit only.
  const closing: GithubAutomationJobRecord = {
    ...job,
    phase: "closing",
    status: "running",
    checkpoint: "closing",
    issueUpdatedAt: freshIssue.updatedAt,
    updatedAt: new Date().toISOString(),
    reasonCode: null,
    progressRevision: (job.progressRevision ?? 0) + 1,
  };
  await persistJob(closing);
  await safeEvent(closing, "issue_analysis_closing", null);

  const closeIssue = runnerDeps.closeIssue ?? closeGithubIssueAsNotPlanned;
  try {
    await closeIssue({
      installationId,
      owner: names.owner,
      repo: names.repo,
      issueNumber: job.issueNumber,
      signal,
    });
  } catch (err) {
    if (isRetriableGithubMutationError(err)) {
      // Unknown outcome: GET Issue.
      try {
        const after = await fetchIssue({
          installationId,
          owner: names.owner,
          repo: names.repo,
          issueNumber: job.issueNumber,
          signal,
          hashContent: (title, body) =>
            boundIssueAnalysisClaim({
              title,
              body,
              issueUpdatedAt: new Date().toISOString(),
              repositoryId: job.repositoryId,
              issueNumber: job.issueNumber,
            }).contentHash,
        });
        const outcome = reconcileCloseFromSnapshot(after);
        if (outcome === "closed" || outcome === "already_closed") {
          closeEffect = {
            name: "issue_analysis_close",
            status: "remote_confirmed",
            remoteId: String(job.issueNumber),
            generation: job.generation,
            updatedAt: new Date().toISOString(),
            reasonCode: outcome,
          };
          const confirmed: GithubAutomationJobRecord = {
            ...closing,
            effects: upsertEffectMarker(closing.effects, closeEffect),
            issueUpdatedAt: after.updatedAt,
          };
          await persistJob(confirmed);
          return completeClosed(confirmed, result, closeEffect);
        }
        if (outcome === "still_open") {
          return retryOrBlock(closing, err, "close_not_confirmed");
        }
      } catch {
        // fall through to retry
      }
      return retryOrBlock(closing, err, "close_unknown");
    }
    // Deterministic permission/config failure → keep open.
    return completeOpenAfterFailedClose(
      closing,
      result,
      "may_close_false",
      names,
      installationId,
      signal,
      isGithubAutomationError(err) ? err.code : "close_failed",
    );
  }

  // Successful PATCH — confirm via GET when possible.
  try {
    const after = await fetchIssue({
      installationId,
      owner: names.owner,
      repo: names.repo,
      issueNumber: job.issueNumber,
      signal,
      hashContent: (title, body) =>
        boundIssueAnalysisClaim({
          title,
          body,
          issueUpdatedAt: new Date().toISOString(),
          repositoryId: job.repositoryId,
          issueNumber: job.issueNumber,
        }).contentHash,
    });
    const outcome = reconcileCloseFromSnapshot(after);
    if (outcome === "still_open") {
      return retryOrBlock(
        closing,
        new GithubAutomationError("github_bad_response", undefined, {
          status: 502,
          details: { reason: "close_patch_still_open" },
        }),
        "close_not_confirmed",
      );
    }
    closeEffect = {
      name: "issue_analysis_close",
      status: "remote_confirmed",
      remoteId: String(job.issueNumber),
      generation: job.generation,
      updatedAt: new Date().toISOString(),
      reasonCode: outcome,
    };
    const confirmed: GithubAutomationJobRecord = {
      ...closing,
      effects: upsertEffectMarker(closing.effects, closeEffect),
      issueUpdatedAt: after.updatedAt,
    };
    await persistJob(confirmed);
    return completeClosed(confirmed, result, closeEffect);
  } catch {
    // PATCH returned 2xx but GET failed — treat as remote_confirmed to avoid double close.
    closeEffect = {
      name: "issue_analysis_close",
      status: "remote_confirmed",
      remoteId: String(job.issueNumber),
      generation: job.generation,
      updatedAt: new Date().toISOString(),
      reasonCode: "close_patch_accepted",
    };
    const confirmed: GithubAutomationJobRecord = {
      ...closing,
      effects: upsertEffectMarker(closing.effects, closeEffect),
    };
    await persistJob(confirmed);
    return completeClosed(confirmed, result, closeEffect);
  }
}

async function completeOpen(
  job: GithubAutomationJobRecord,
  result: IssueAnalysisValidatedResult,
  notClosedReason: string | null,
): Promise<GithubAutomationJobHandlerResult> {
  const next: GithubAutomationJobRecord = {
    ...job,
    phase: "completed",
    status: "completed",
    checkpoint: "completed",
    category: result.category,
    verdict: result.verdict,
    confidence: result.confidence,
    reasonCode:
      notClosedReason ??
      (result.reasonCode === "ok" ? null : result.reasonCode),
    updatedAt: new Date().toISOString(),
    nextRetryAt: null,
    progressRevision: (job.progressRevision ?? 0) + 1,
  };
  await persistJob(next);
  await safeEvent(next, "issue_analysis_completed", next.reasonCode, {
    outcome: "completed_open",
    verdict: next.verdict ?? null,
  });
  return { job: next, disposition: dispositionForTerminal(next) };
}

async function completeClosed(
  job: GithubAutomationJobRecord,
  result: IssueAnalysisValidatedResult,
  closeEffect: GithubAutomationEffectMarker,
): Promise<GithubAutomationJobHandlerResult> {
  // Best-effort final comment update to "已关闭" — failure only retries comment, not close.
  // Caller already confirmed close; we still try once here if body may still say "准备关闭".
  // Skip remote write when tests did not inject comment deps and installation is missing.
  // (Comment update is optional after close confirmation.)
  const next: GithubAutomationJobRecord = {
    ...job,
    phase: "completed",
    status: "completed",
    checkpoint: "completed",
    category: result.category,
    verdict: result.verdict,
    confidence: result.confidence,
    effects: upsertEffectMarker(job.effects, closeEffect),
    reasonCode: null,
    updatedAt: new Date().toISOString(),
    nextRetryAt: null,
    progressRevision: (job.progressRevision ?? 0) + 1,
  };
  await persistJob(next);
  await safeEvent(next, "issue_analysis_completed", null, {
    outcome: "completed_closed",
    verdict: next.verdict ?? null,
  });
  return { job: next, disposition: dispositionForTerminal(next) };
}

async function completeOpenAfterFailedClose(
  job: GithubAutomationJobRecord,
  result: IssueAnalysisValidatedResult,
  reason: IssueAnalysisCloseGateDenial | string,
  names: { owner: string; repo: string },
  installationId: number,
  signal?: AbortSignal,
  extraReason?: string,
): Promise<GithubAutomationJobHandlerResult> {
  const notClosedReason = describeCloseGateDenial(reason);
  // Update canonical comment to explain not-closed (same marker).
  try {
    const body = buildCommentBodyFromResult({
      repositoryId: job.repositoryId,
      issueNumber: job.issueNumber,
      result,
      disposition: "not_closed",
      notClosedReason,
    });
    const upsert = runnerDeps.upsertComment ?? upsertGithubAutomationComment;
    await upsert({
      installationId,
      owner: names.owner,
      repo: names.repo,
      issueNumber: job.issueNumber,
      repositoryId: job.repositoryId,
      kind: "issue_analysis",
      body,
      signal,
    });
  } catch {
    // Comment update failure must not re-attempt close; complete open anyway.
  }

  const next: GithubAutomationJobRecord = {
    ...job,
    phase: "completed",
    status: "completed",
    checkpoint: "completed",
    category: result.category,
    verdict: result.verdict,
    confidence: result.confidence,
    reasonCode: extraReason ?? String(reason),
    updatedAt: new Date().toISOString(),
    nextRetryAt: null,
    progressRevision: (job.progressRevision ?? 0) + 1,
  };
  await persistJob(next);
  await safeEvent(next, "issue_analysis_completed", next.reasonCode, {
    outcome: "completed_open",
    closeDenied: reason,
  });
  return { job: next, disposition: dispositionForTerminal(next) };
}

async function retryOrBlock(
  job: GithubAutomationJobRecord,
  err: unknown,
  reasonCode: string,
): Promise<GithubAutomationJobHandlerResult> {
  const nowMs = (runnerDeps.now ?? Date.now)();
  if (shouldBlockForRetryBudget(job)) {
    const next: GithubAutomationJobRecord = {
      ...job,
      status: "blocked",
      phase: job.phase === "received" || job.phase === "analyzing" ? job.phase : job.phase,
      reasonCode: "retry_budget_exhausted",
      checkpoint: "blocked",
      nextRetryAt: null,
      updatedAt: new Date().toISOString(),
      retryability: "operator",
      blockedAtLayer: "scheduler",
      blockFingerprint: reasonCode,
    };
    await persistJob(next);
    await safeEvent(next, "issue_analysis_blocked", next.reasonCode, {
      priorReason: reasonCode,
    });
    return {
      job: next,
      disposition: dispositionBlocked("retry_budget_exhausted", reasonCode),
    };
  }

  const nextRetryAt = nextRetryAtIso(job.attempt, nowMs);
  const next: GithubAutomationJobRecord = {
    ...job,
    status: "retry_due",
    reasonCode,
    nextRetryAt,
    updatedAt: new Date().toISOString(),
    retryability: "automatic",
  };
  await persistJob(next);
  await safeEvent(next, "issue_analysis_retry_due", reasonCode, {
    errorCode: isGithubAutomationError(err) ? err.code : "unknown",
  });
  return {
    job: next,
    disposition: dispositionRetry(reasonCode, nextRetryAt),
  };
}

// ─── Public handler ──────────────────────────────────────────────────────────

/**
 * Single-purpose analysis job handler. Scheduler calls this under job lease.
 */
export async function handleGithubIssueAnalysisJob(
  job: GithubAutomationJobRecord,
  context: {
    config: GithubAutomationConfigV2;
    ownerId: string;
    lease?: { fencingToken?: string; heartbeat?: () => Promise<boolean> };
  },
): Promise<GithubAutomationJobHandlerResult> {
  // Refresh fence token onto job for close gate.
  const fencedJob: GithubAutomationJobRecord = {
    ...job,
    leaseFencingToken:
      context.lease?.fencingToken ?? job.leaseFencingToken ?? null,
  };

  if (!context.config.enabled) {
    const next: GithubAutomationJobRecord = {
      ...fencedJob,
      status: "blocked",
      reasonCode: "automation_disabled",
      nextRetryAt: null,
      updatedAt: new Date().toISOString(),
    };
    await persistJob(next);
    return {
      job: next,
      disposition: dispositionBlocked("automation_disabled", "disabled"),
    };
  }
  if (context.config.paused) {
    const next: GithubAutomationJobRecord = {
      ...fencedJob,
      status: "retry_due",
      reasonCode: "paused",
      nextRetryAt: new Date(Date.now() + 30_000).toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await persistJob(next);
    return {
      job: next,
      disposition: dispositionRetry("paused", next.nextRetryAt!),
    };
  }

  const phase = fencedJob.phase;
  if (
    phase === "received" ||
    phase === "analyzing" ||
    (phase === "result_ready" && !fencedJob.resultId)
  ) {
    return phaseAnalyze(fencedJob, context.config);
  }

  if (
    phase === "result_ready" ||
    phase === "commenting" ||
    phase === "closing"
  ) {
    return phaseCommentAndClose(fencedJob, context.config);
  }

  if (phase === "completed" || fencedJob.status === "completed") {
    return {
      job: fencedJob,
      disposition: dispositionForTerminal(fencedJob),
    };
  }

  // Unknown phase: fail closed.
  const next: GithubAutomationJobRecord = {
    ...fencedJob,
    status: "blocked",
    reasonCode: "unknown_phase",
    checkpoint: "blocked",
    updatedAt: new Date().toISOString(),
  };
  await persistJob(next);
  return {
    job: next,
    disposition: dispositionBlocked("unknown_phase", String(phase)),
  };
}

/**
 * Typed handler export for direct scheduler wiring.
 * Scheduler statically imports this binding; do not re-introduce reverse
 * registration helpers that create a production runtime cycle.
 */
export const githubIssueAnalysisJobHandler: GithubAutomationJobHandler = (
  job,
  context,
) =>
  handleGithubIssueAnalysisJob(job as unknown as GithubAutomationJobRecord, {
    config: context.config as unknown as GithubAutomationConfigV2,
    ownerId: context.ownerId,
    lease: context.lease,
  });
