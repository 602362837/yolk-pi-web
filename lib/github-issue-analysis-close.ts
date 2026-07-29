/**
 * github-issue-analysis-close — strict close gate + Issue read-back (GIA-03).
 *
 * Close is allowed only when every gate in design.md passes. Unknown PATCH
 * outcomes must GET the Issue; never blind-repeat close. Comment/label writes
 * can change Issue `updated_at`, so the pre-close baseline is established after
 * comment remote-confirm, not from the original opened timestamp alone.
 */

import { createHash } from "node:crypto";

import { githubAppInstallationRequest } from "./github-app-client";
import { GithubAutomationError } from "./github-automation-errors";
import type { GithubAutomationEffectMarker } from "./github-automation-store";
import type {
  GithubIssueAnalysisCategory,
  GithubIssueAnalysisConfidence,
  GithubIssueAnalysisTruthVerdict,
} from "./github-automation-types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

export interface GithubIssueCloseSnapshot {
  number: number;
  state: "open" | "closed" | "unknown";
  title: string;
  body: string;
  updatedAt: string | null;
  contentHash: string;
}

export interface EvaluateIssueAnalysisCloseGateInput {
  category: GithubIssueAnalysisCategory | string | null | undefined;
  verdict: GithubIssueAnalysisTruthVerdict | string | null | undefined;
  confidence: GithubIssueAnalysisConfidence | string | null | undefined;
  complete: boolean;
  truncatedInput: boolean;
  budgetExhausted: boolean;
  mayClose: boolean;
  /** At least one controller-verified contradicts evidence is required. */
  hasVerifiedContradiction: boolean;
  commentEffect: GithubAutomationEffectMarker | null | undefined;
  closeEffect: GithubAutomationEffectMarker | null | undefined;
  /** Analysis input content hash. */
  analysisContentHash: string | null | undefined;
  /** Fresh Issue snapshot after comment confirmed. */
  issue: GithubIssueCloseSnapshot | null;
  configEnabled: boolean;
  configPaused: boolean;
  /** Lease fencing still owned by this runner. */
  fenceValid: boolean;
}

export type IssueAnalysisCloseGateDenial =
  | "category_not_bug"
  | "verdict_not_not_exists"
  | "confidence_not_high"
  | "analysis_incomplete"
  | "input_truncated"
  | "budget_exhausted"
  | "may_close_false"
  | "missing_contradiction"
  | "comment_not_confirmed"
  | "close_already_confirmed"
  | "issue_missing"
  | "issue_not_open"
  | "content_hash_mismatch"
  | "config_disabled"
  | "config_paused"
  | "fence_invalid";

export interface IssueAnalysisCloseGateResult {
  allowed: boolean;
  reason: IssueAnalysisCloseGateDenial | null;
}

/**
 * Pure close gate. Callers must pass a post-comment Issue snapshot whose
 * title/body contentHash matches the analysis input.
 */
export function evaluateIssueAnalysisCloseGate(
  input: EvaluateIssueAnalysisCloseGateInput,
): IssueAnalysisCloseGateResult {
  if (!input.configEnabled) {
    return { allowed: false, reason: "config_disabled" };
  }
  if (input.configPaused) {
    return { allowed: false, reason: "config_paused" };
  }
  if (!input.fenceValid) {
    return { allowed: false, reason: "fence_invalid" };
  }
  if (input.category !== "bug") {
    return { allowed: false, reason: "category_not_bug" };
  }
  if (input.verdict !== "not_exists") {
    return { allowed: false, reason: "verdict_not_not_exists" };
  }
  if (input.confidence !== "high") {
    return { allowed: false, reason: "confidence_not_high" };
  }
  if (!input.complete) {
    return { allowed: false, reason: "analysis_incomplete" };
  }
  if (input.truncatedInput) {
    return { allowed: false, reason: "input_truncated" };
  }
  if (input.budgetExhausted) {
    return { allowed: false, reason: "budget_exhausted" };
  }
  if (!input.mayClose) {
    return { allowed: false, reason: "may_close_false" };
  }
  if (!input.hasVerifiedContradiction) {
    return { allowed: false, reason: "missing_contradiction" };
  }
  if (!input.commentEffect || input.commentEffect.status !== "remote_confirmed") {
    return { allowed: false, reason: "comment_not_confirmed" };
  }
  if (input.closeEffect?.status === "remote_confirmed") {
    return { allowed: false, reason: "close_already_confirmed" };
  }
  if (!input.issue) {
    return { allowed: false, reason: "issue_missing" };
  }
  if (input.issue.state !== "open") {
    return { allowed: false, reason: "issue_not_open" };
  }
  if (
    !input.analysisContentHash ||
    input.issue.contentHash !== input.analysisContentHash
  ) {
    return { allowed: false, reason: "content_hash_mismatch" };
  }
  return { allowed: true, reason: null };
}

/**
 * Hash helper for close re-check. Prefer boundIssueAnalysisClaim for analysis
 * input so content hashes stay consistent with the evidence controller.
 */
export function hashIssueTitleBodyContent(
  title: string,
  body: string,
): string {
  return createHash("sha256")
    .update(`${title}\n\n${body}`, "utf8")
    .digest("hex");
}

/**
 * Fetch a minimal Issue snapshot for close gates / unknown-effect reconcile.
 * Title/body stay in memory only.
 */
export async function fetchGithubIssueCloseSnapshot(options: {
  installationId: number;
  owner: string;
  repo: string;
  issueNumber: number;
  signal?: AbortSignal;
  /** Optional hash function override (tests). */
  hashContent?: (title: string, body: string) => string;
}): Promise<GithubIssueCloseSnapshot> {
  const result = await githubAppInstallationRequest(
    options.installationId,
    `/repos/${encodePathSegment(options.owner)}/${encodePathSegment(options.repo)}/issues/${options.issueNumber}`,
    { method: "GET", signal: options.signal },
  );

  if (result.status === 403 || result.status === 401) {
    throw new GithubAutomationError("permission_missing", undefined, {
      status: 403,
      details: { reason: "issues_read" },
    });
  }
  if (result.status === 404) {
    throw new GithubAutomationError("github_bad_response", undefined, {
      status: 404,
      details: { reason: "issue_not_found" },
    });
  }
  if (result.status < 200 || result.status >= 300 || !isRecord(result.body)) {
    throw new GithubAutomationError("github_bad_response", undefined, {
      status: 502,
      details: { httpStatus: result.status, reason: "issue_fetch" },
    });
  }

  const body = result.body;
  const title = typeof body.title === "string" ? body.title : "";
  const issueBody = typeof body.body === "string" ? body.body : "";
  const stateRaw = typeof body.state === "string" ? body.state : "";
  const state: GithubIssueCloseSnapshot["state"] =
    stateRaw === "open" || stateRaw === "closed" ? stateRaw : "unknown";
  const updatedAt =
    typeof body.updated_at === "string" && body.updated_at.trim()
      ? body.updated_at
      : null;
  const number =
    typeof body.number === "number" && Number.isInteger(body.number)
      ? body.number
      : options.issueNumber;
  const hashContent = options.hashContent ?? hashIssueTitleBodyContent;

  return {
    number,
    state,
    title,
    body: issueBody,
    updatedAt,
    contentHash: hashContent(title, issueBody),
  };
}

export type IssueAnalysisCloseWriteOutcome =
  | "closed"
  | "already_closed"
  | "still_open"
  | "unknown_needs_reconcile";

export interface CloseGithubIssueResult {
  outcome: IssueAnalysisCloseWriteOutcome;
  state: "open" | "closed" | "unknown";
  updatedAt: string | null;
}

/**
 * PATCH Issue closed with state_reason=not_planned when supported.
 * On unknown network/timeout outcomes, caller must GET and pass through reconcileCloseFromSnapshot.
 */
export async function closeGithubIssueAsNotPlanned(options: {
  installationId: number;
  owner: string;
  repo: string;
  issueNumber: number;
  signal?: AbortSignal;
}): Promise<{ status: number; body: unknown }> {
  const result = await githubAppInstallationRequest(
    options.installationId,
    `/repos/${encodePathSegment(options.owner)}/${encodePathSegment(options.repo)}/issues/${options.issueNumber}`,
    {
      method: "PATCH",
      signal: options.signal,
      body: {
        state: "closed",
        state_reason: "not_planned",
      },
    },
  );

  if (result.status === 403 || result.status === 401) {
    throw new GithubAutomationError("permission_missing", undefined, {
      status: 403,
      details: { reason: "issues_write" },
    });
  }
  if (result.status < 200 || result.status >= 300) {
    throw new GithubAutomationError("github_bad_response", undefined, {
      status: 502,
      details: { httpStatus: result.status, reason: "issue_close" },
    });
  }
  return { status: result.status, body: result.body };
}

export function reconcileCloseFromSnapshot(
  snapshot: GithubIssueCloseSnapshot,
): IssueAnalysisCloseWriteOutcome {
  if (snapshot.state === "closed") return "closed";
  if (snapshot.state === "open") return "still_open";
  return "unknown_needs_reconcile";
}

export function isRetriableGithubMutationError(err: unknown): boolean {
  if (!(err instanceof GithubAutomationError)) return false;
  return (
    err.code === "github_timeout" ||
    err.code === "github_network_error" ||
    err.code === "github_bad_response" ||
    err.code === "github_oversized_response" ||
    err.code === "github_rate_limited"
  );
}

/** Operator-safe Chinese reason for comment "未自动关闭". */
export function describeCloseGateDenial(
  reason: IssueAnalysisCloseGateDenial | string | null | undefined,
): string {
  switch (reason) {
    case "category_not_bug":
      return "分类不是 bug";
    case "verdict_not_not_exists":
      return "真实性结论不允许关闭";
    case "confidence_not_high":
      return "置信度不足";
    case "analysis_incomplete":
      return "分析未完成";
    case "input_truncated":
      return "议题正文被截断";
    case "budget_exhausted":
      return "证据预算耗尽";
    case "may_close_false":
      return "控制器未授权关闭";
    case "missing_contradiction":
      return "缺少明确反证";
    case "comment_not_confirmed":
      return "规范评论尚未远端确认";
    case "close_already_confirmed":
      return "关闭效果已确认";
    case "issue_missing":
      return "无法读取议题";
    case "issue_not_open":
      return "议题已不在 open 状态";
    case "content_hash_mismatch":
      return "议题内容在分析后发生变化";
    case "config_disabled":
      return "自动化已禁用";
    case "config_paused":
      return "自动化已暂停";
    case "fence_invalid":
      return "任务租约失效";
    default:
      return "未满足关闭门禁";
  }
}
