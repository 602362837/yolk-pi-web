/**
 * github-issue-triage-runner — complete label+assignee claim, triage, owner intent (GHA-03).
 *
 * Flow under scheduler job lease:
 *   received|claim_readiness
 *     → resolve machine login
 *     → assignability + App add-assignee + Issue read-back
 *     → ensure ypi:claimed (only when assignee confirmed)
 *     → fresh Issue fetch (untrusted data)
 *     → triage labels + canonical Chinese comment
 *     → awaiting_owner
 *   issue_comment (while awaiting_owner)
 *     → owner actor + affirmative intent
 *     → P0 (unattended off): accepted_waiting_automation (never WorkTree)
 *     → P1 (mode=unattended + enabled): queue durable full-agent runner (GHA-06)
 *
 * Failures:
 *   blocked_claim_assignee — incomplete claim, ypi:claim-blocked, safe comment, retryable
 *
 * Identity:
 *   App installation performs all Issue mutations.
 *   Machine personal credential only resolves/verifies login (never Bot write fallback).
 */

import { findRepositoryConfigById } from "./github-automation-config";
import {
  buildAcceptedWaitingAutomationCommentBody,
  buildClaimBlockedCommentBody,
  buildGithubAutomationCommentMarker,
  buildTriageConclusionCommentBody,
  upsertGithubAutomationComment,
  type GithubTriageRecommendation,
} from "./github-automation-comments";
import {
  GithubAutomationError,
  isGithubAutomationError,
} from "./github-automation-errors";
import {
  ensureClaimBlockedLabels,
  ensureClaimCompleteLabels,
  ensureTriageClassificationLabels,
  extractLabelNames,
  issueHasLabel,
  YPI_LABEL_AWAITING_OWNER,
  YPI_LABEL_CLAIMED,
  YPI_LABEL_DECISION_NEEDS_INFO,
  YPI_LABEL_DECISION_NO,
  YPI_LABEL_DECISION_YES,
  YPI_LABEL_RISK_HIGH,
  YPI_LABEL_RISK_LOW,
  YPI_LABEL_RISK_MEDIUM,
  YPI_LABEL_TRIAGED,
  YPI_LABEL_TYPE_BUG,
  YPI_LABEL_TYPE_DOCS,
  YPI_LABEL_TYPE_FEATURE,
  YPI_LABEL_TYPE_OTHER,
  type YpiTriageDecisionLabel,
  type YpiTriageRiskLabel,
  type YpiTriageTypeLabel,
} from "./github-automation-labels";
import {
  setGithubAutomationJobHandler,
  type GithubAutomationJobHandler,
  type GithubAutomationJobHandlerResult,
} from "./github-automation-scheduler";
import {
  appendGithubAutomationSafeEvent,
  readGithubAutomationDelivery,
  upsertEffectMarker,
  upsertGithubAutomationIssueState,
  writeGithubAutomationJob,
  type GithubAutomationEffectMarker,
  type GithubAutomationJobRecord,
} from "./github-automation-store";
import type {
  GithubAutomationConfigV1,
  GithubIssueClaimStatus,
  GithubMachineAssigneeIdentitySource,
  GithubMachineAssigneeReadinessCode,
  GithubMachineAssigneeResolvedIdentity,
} from "./github-automation-types";
import { githubAppInstallationRequest } from "./github-app-client";
import {
  addGithubIssueAssigneeWithReadback,
  checkGithubLoginAssignability,
  issueAssigneesIncludeLogin,
  resolveMachineGithubAssigneeIdentity,
} from "./github-machine-assignee";
import {
  buildOwnerActorContextFromRepoConfig,
  commentMayExpressOwnerDecision,
  evaluateGithubOwnerAuthorization,
  stripUntrustedCommentDecorations,
  type GithubOwnerAuthorizationResult,
} from "./github-owner-intent";
import {
  continueGithubUnattendedJob,
  handleGithubUnattendedAfterOwnerAdoption,
} from "./github-automation-runner";

// ─── Untrusted Issue snapshot ────────────────────────────────────────────────

export interface UntrustedGithubIssueSnapshot {
  number: number;
  state: string | null;
  title: string | null;
  /** Bounded preview only for local analysis — never written to automation store. */
  bodyPreview: string;
  labels: string[];
  rawLabels: unknown;
  assignees: Array<{ login: string; id: number | null }>;
  rawAssignees: unknown;
  userLogin: string | null;
  userId: number | null;
  repositoryOwnerId: number | null;
  repositoryOwnerLogin: string | null;
  repositoryOwnerType: string | null;
  htmlUrl: string | null;
}

const BODY_PREVIEW_MAX = 4_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function splitRepoFullName(
  fullName: string,
): { owner: string; repo: string } | null {
  const parts = fullName.split("/").filter(Boolean);
  if (parts.length !== 2) return null;
  return { owner: parts[0]!, repo: parts[1]! };
}

function asPositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  return null;
}

export async function fetchUntrustedGithubIssue(options: {
  installationId: number;
  owner: string;
  repo: string;
  issueNumber: number;
  signal?: AbortSignal;
}): Promise<UntrustedGithubIssueSnapshot> {
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
  const title = typeof body.title === "string" ? body.title : null;
  const rawBody = typeof body.body === "string" ? body.body : "";
  const bodyPreview = rawBody.slice(0, BODY_PREVIEW_MAX);
  const state = typeof body.state === "string" ? body.state : null;
  const htmlUrl = typeof body.html_url === "string" ? body.html_url : null;
  const number = asPositiveInt(body.number) ?? options.issueNumber;

  const assignees: Array<{ login: string; id: number | null }> = [];
  if (Array.isArray(body.assignees)) {
    for (const item of body.assignees) {
      if (!isRecord(item) || typeof item.login !== "string") continue;
      assignees.push({
        login: item.login,
        id: asPositiveInt(item.id),
      });
    }
  }

  let userLogin: string | null = null;
  let userId: number | null = null;
  if (isRecord(body.user)) {
    if (typeof body.user.login === "string") userLogin = body.user.login;
    userId = asPositiveInt(body.user.id);
  }

  // repository may be embedded on some payloads; otherwise left null (filled by caller).
  let repositoryOwnerId: number | null = null;
  let repositoryOwnerLogin: string | null = null;
  let repositoryOwnerType: string | null = null;
  if (isRecord(body.repository) && isRecord(body.repository.owner)) {
    repositoryOwnerId = asPositiveInt(body.repository.owner.id);
    if (typeof body.repository.owner.login === "string") {
      repositoryOwnerLogin = body.repository.owner.login;
    }
    if (typeof body.repository.owner.type === "string") {
      repositoryOwnerType = body.repository.owner.type;
    }
  }

  return {
    number,
    state,
    title,
    bodyPreview,
    labels: extractLabelNames(body.labels),
    rawLabels: body.labels,
    assignees,
    rawAssignees: body.assignees,
    userLogin,
    userId,
    repositoryOwnerId,
    repositoryOwnerLogin,
    repositoryOwnerType,
    htmlUrl,
  };
}

export async function fetchRepositoryOwner(options: {
  installationId: number;
  owner: string;
  repo: string;
  signal?: AbortSignal;
}): Promise<{
  id: number | null;
  login: string | null;
  type: string | null;
}> {
  const result = await githubAppInstallationRequest(
    options.installationId,
    `/repos/${encodePathSegment(options.owner)}/${encodePathSegment(options.repo)}`,
    { method: "GET", signal: options.signal },
  );
  if (result.status < 200 || result.status >= 300 || !isRecord(result.body)) {
    return { id: null, login: null, type: null };
  }
  if (!isRecord(result.body.owner)) {
    return { id: null, login: null, type: null };
  }
  return {
    id: asPositiveInt(result.body.owner.id),
    login:
      typeof result.body.owner.login === "string" ? result.body.owner.login : null,
    type: typeof result.body.owner.type === "string" ? result.body.owner.type : null,
  };
}

// ─── Heuristic triage (deterministic; no LLM in GHA-03) ──────────────────────

export interface GithubTriageAnalysis {
  recommendation: GithubTriageRecommendation;
  decisionLabel: YpiTriageDecisionLabel;
  riskLabel: YpiTriageRiskLabel;
  typeLabel: YpiTriageTypeLabel;
  reasons: string[];
  nextActions: string[];
}

/**
 * Deterministic pre-LLM triage classifier for P0.
 * Issue text is untrusted data only — never influences shell/remote/policy.
 */
export function analyzeUntrustedGithubIssue(
  issue: Pick<UntrustedGithubIssueSnapshot, "title" | "bodyPreview" | "labels">,
): GithubTriageAnalysis {
  const text = `${issue.title ?? ""}\n${issue.bodyPreview}`.toLowerCase();
  const labelText = issue.labels.join(" ").toLowerCase();
  const combined = `${text}\n${labelText}`;

  let typeLabel: YpiTriageTypeLabel = YPI_LABEL_TYPE_OTHER;
  if (
    /docs?(?:umentation)?|readme|changelog|指南|文档/.test(combined) ||
    labelText.includes("documentation") ||
    labelText.includes("docs")
  ) {
    typeLabel = YPI_LABEL_TYPE_DOCS;
  } else if (
    /bug|fix|crash|error|exception|失败|崩溃|缺陷/.test(combined) ||
    labelText.includes("bug")
  ) {
    typeLabel = YPI_LABEL_TYPE_BUG;
  } else if (
    /feature|enhancement|feat|新增|功能|支持/.test(combined) ||
    labelText.includes("enhancement") ||
    labelText.includes("feature")
  ) {
    typeLabel = YPI_LABEL_TYPE_FEATURE;
  }

  const highRisk =
    /security|cve|rce|auth|oauth|secret|token|password|credential|workflow|github actions|\.yml|\.yaml|lockfile|package-lock|npm-shrinkwrap|release|publish|deploy|infra|production|main branch|force push|权限|密钥|凭证/.test(
      combined,
    ) ||
    /ui|ux|frontend|react component|css|layout|交互|界面|样式/.test(combined);

  const thin =
    (issue.title ?? "").trim().length < 8 &&
    issue.bodyPreview.trim().length < 40;

  let recommendation: GithubTriageRecommendation;
  let riskLabel: YpiTriageRiskLabel;
  const reasons: string[] = [];
  const nextActions: string[] = [];

  if (highRisk) {
    recommendation = "no";
    riskLabel = YPI_LABEL_RISK_HIGH;
    reasons.push("内容触及 UI/安全/鉴权/workflow/依赖/发布等高风险主题，自动化 fail-closed");
    nextActions.push("请人工评估；本自动化不会在 P0/P1 自动实现该类议题");
  } else if (thin) {
    recommendation = "needs_info";
    riskLabel = YPI_LABEL_RISK_MEDIUM;
    reasons.push("标题/正文信息不足，无法判断范围与验收标准");
    nextActions.push("请补充复现步骤、期望行为或明确需求后再评估");
  } else if (typeLabel === YPI_LABEL_TYPE_DOCS) {
    recommendation = "yes";
    riskLabel = YPI_LABEL_RISK_LOW;
    reasons.push("看起来是文档/说明类变更，符合低风险自动化候选");
    nextActions.push(
      "若仓库 owner 明确采纳，且 P1 开启，可进入文档 + 小 bugfix unattended；P0 仅记录等待",
    );
  } else if (typeLabel === YPI_LABEL_TYPE_BUG) {
    recommendation = "yes";
    riskLabel = YPI_LABEL_RISK_LOW;
    reasons.push("描述像局部缺陷；若范围明确且可验证，可作为小 bugfix 候选");
    nextActions.push(
      "请 owner 确认范围；P1 仍会做 pre/plan/final policy 与 diff gate",
    );
  } else if (typeLabel === YPI_LABEL_TYPE_FEATURE) {
    recommendation = "needs_info";
    riskLabel = YPI_LABEL_RISK_MEDIUM;
    reasons.push("功能请求通常需要产品决策，默认不自动实现");
    nextActions.push("请 owner 明确范围与优先级；高不确定性将转人工");
  } else {
    recommendation = "needs_info";
    riskLabel = YPI_LABEL_RISK_MEDIUM;
    reasons.push("类型不明确，自动化不假设可实现");
    nextActions.push("请补充分类信息或由 owner 明确是否纳入");
  }

  const decisionLabel: YpiTriageDecisionLabel =
    recommendation === "yes"
      ? YPI_LABEL_DECISION_YES
      : recommendation === "no"
        ? YPI_LABEL_DECISION_NO
        : YPI_LABEL_DECISION_NEEDS_INFO;

  if (recommendation === "yes") {
    nextActions.push(
      "Owner 可用自然语言明确肯定（如「采纳」「可以做」「go ahead」）授权后续自动化",
    );
  }

  return {
    recommendation,
    decisionLabel,
    riskLabel,
    typeLabel,
    reasons,
    nextActions,
  };
}

// ─── Claim completeness ──────────────────────────────────────────────────────

export function isCompleteClaimFacts(input: {
  assigneeLogin: string | null;
  assigneeReadBack: boolean;
  labelReadBack: boolean;
  triageCommentPresent: boolean;
}): boolean {
  return (
    Boolean(input.assigneeLogin) &&
    input.assigneeReadBack &&
    input.labelReadBack &&
    input.triageCommentPresent
  );
}

// ─── Job helpers ─────────────────────────────────────────────────────────────

function operatorHintsForReadiness(
  readiness: GithubMachineAssigneeReadinessCode,
  login: string | null,
): string[] {
  switch (readiness) {
    case "gh_unavailable":
      return [
        "安装 GitHub CLI (`gh`) 或配置 github.com 的 git credential helper",
        "确保本机可解析 active 用户 login",
      ];
    case "gh_not_logged_in":
      return ["运行 `gh auth login` 登录 github.com", "然后在 Settings 重试该 job"];
    case "gh_no_active_account":
      return [
        "多账号环境下选择 active 账号：`gh auth switch`",
        "确认 `gh auth status` 显示 Active account: true",
      ];
    case "gh_host_unsupported":
    case "git_credential_host_unsupported":
      return ["仅支持 github.com；切换 active host 到 github.com"];
    case "git_credential_unavailable":
    case "git_credential_empty":
      return [
        "配置 github.com 的 git credential，或安装并登录 `gh`",
        "不要使用 git user.name/email 作为 login",
      ];
    case "credential_invalid":
      return ["刷新/重新登录本机 GitHub 凭据后重试"];
    case "credential_timeout":
      return ["检查本机 gh/git credential helper 是否卡住后重试"];
    case "user_lookup_failed":
      return ["无法通过 canonical `/user` 解析 login；检查网络与凭据后重试"];
    case "unassignable":
      return [
        login
          ? `确认 @${login} 对该仓库具有可被 assign 的协作者权限`
          : "确认本机 login 对该仓库可被 assign",
        "确认 GitHub App 具备 Issues 写权限",
      ];
    case "readback_failed":
      return [
        "Assignee API 调用后回读失败；检查 App Issues 权限与网络后重试",
      ];
    default:
      return ["检查 Settings 中的本机 Assignee readiness 后重试"];
  }
}

async function persistJob(
  job: GithubAutomationJobRecord,
): Promise<GithubAutomationJobRecord> {
  return writeGithubAutomationJob({
    ...job,
    updatedAt: new Date().toISOString(),
  });
}

async function setIssueClaimStatus(
  job: GithubAutomationJobRecord,
  claimStatus: GithubIssueClaimStatus | null,
  effects?: GithubAutomationEffectMarker[],
): Promise<void> {
  await upsertGithubAutomationIssueState({
    repositoryId: job.repositoryId,
    issueNumber: job.issueNumber,
    activeJobId: job.jobId,
    claimStatus,
    generation: job.generation,
    effects: effects ?? job.effects,
  });
}

// ─── Claim + triage pipeline ────────────────────────────────────────────────

interface ClaimContext {
  config: GithubAutomationConfigV1;
  job: GithubAutomationJobRecord;
  installationId: number;
  owner: string;
  repo: string;
}

async function runClaimAndTriage(
  ctx: ClaimContext,
): Promise<GithubAutomationJobHandlerResult> {
  let job = ctx.job;
  const now = () => new Date().toISOString();

  // Checkpoint: claim_readiness
  job = await persistJob({
    ...job,
    phase: "claim_readiness",
    status: "running",
    checkpoint: "claim_readiness",
    reasonCode: null,
  });

  // 1) Resolve machine identity (personal credential — login only)
  const resolved = await resolveMachineGithubAssigneeIdentity();
  if (!resolved.ok) {
    return blockClaimAssignee(ctx, {
      readiness: resolved.readiness,
      identity: null,
      canMutateGithub: Boolean(ctx.installationId),
    });
  }

  const identity = resolved.identity;

  // 2) Assignability check
  const assignable = await checkGithubLoginAssignability({
    installationId: ctx.installationId,
    owner: ctx.owner,
    repo: ctx.repo,
    login: identity.login,
  });
  if (!assignable.ok) {
    return blockClaimAssignee(ctx, {
      readiness: assignable.readiness,
      identity,
      canMutateGithub: assignable.httpStatus !== 401 && assignable.httpStatus !== 403
        ? true
        : assignable.httpStatus === null,
      permissionMissing:
        assignable.httpStatus === 401 || assignable.httpStatus === 403,
    });
  }

  // 3) Add assignee + mandatory read-back
  job = await persistJob({
    ...job,
    checkpoint: "claim_assignee",
    effects: upsertEffectMarker(job.effects, {
      name: "claim_assignee",
      status: "intended",
      remoteId: identity.login,
      generation: job.generation,
      reasonCode: null,
    }),
  });

  const assigned = await addGithubIssueAssigneeWithReadback({
    installationId: ctx.installationId,
    owner: ctx.owner,
    repo: ctx.repo,
    issueNumber: job.issueNumber,
    login: identity.login,
  });

  if (!assigned.ok) {
    const readiness: GithubMachineAssigneeReadinessCode =
      assigned.reason === "permission_missing"
        ? "unassignable"
        : assigned.reason === "silent_ignore"
          ? "unassignable"
          : "readback_failed";
    job = await persistJob({
      ...job,
      effects: upsertEffectMarker(job.effects, {
        name: "claim_assignee",
        status: "failed",
        remoteId: identity.login,
        generation: job.generation,
        reasonCode: assigned.reason,
      }),
    });
    return blockClaimAssignee(ctx, {
      readiness,
      identity,
      canMutateGithub: assigned.reason !== "permission_missing",
      permissionMissing: assigned.reason === "permission_missing",
    });
  }

  job = await persistJob({
    ...job,
    effects: upsertEffectMarker(job.effects, {
      name: "claim_assignee",
      status: "remote_confirmed",
      remoteId: identity.login,
      generation: job.generation,
      reasonCode: null,
    }),
  });

  // 4) Fresh issue for labels
  let issue = await fetchUntrustedGithubIssue({
    installationId: ctx.installationId,
    owner: ctx.owner,
    repo: ctx.repo,
    issueNumber: job.issueNumber,
  });

  // 5) Ensure ypi:claimed (only after assignee confirmed)
  job = await persistJob({
    ...job,
    checkpoint: "claim_label",
    effects: upsertEffectMarker(job.effects, {
      name: "claim_label",
      status: "intended",
      remoteId: YPI_LABEL_CLAIMED,
      generation: job.generation,
      reasonCode: null,
    }),
  });

  try {
    await ensureClaimCompleteLabels({
      installationId: ctx.installationId,
      owner: ctx.owner,
      repo: ctx.repo,
      issueNumber: job.issueNumber,
      currentLabels: issue.rawLabels,
    });
  } catch (err) {
    const permission =
      isGithubAutomationError(err) && err.code === "permission_missing";
    job = await persistJob({
      ...job,
      effects: upsertEffectMarker(job.effects, {
        name: "claim_label",
        status: "failed",
        remoteId: YPI_LABEL_CLAIMED,
        generation: job.generation,
        reasonCode: permission ? "permission_missing" : "label_failed",
      }),
    });
    return blockClaimAssignee(ctx, {
      readiness: "readback_failed",
      identity,
      canMutateGithub: !permission,
      permissionMissing: permission,
    });
  }

  // Re-fetch for label + assignee read-back
  issue = await fetchUntrustedGithubIssue({
    installationId: ctx.installationId,
    owner: ctx.owner,
    repo: ctx.repo,
    issueNumber: job.issueNumber,
  });

  const assigneeOk = issueAssigneesIncludeLogin(issue.rawAssignees, identity.login);
  const labelOk = issueHasLabel(issue.rawLabels, YPI_LABEL_CLAIMED);

  if (!assigneeOk || !labelOk) {
    job = await persistJob({
      ...job,
      effects: upsertEffectMarker(job.effects, {
        name: "claim_label",
        status: "failed",
        remoteId: YPI_LABEL_CLAIMED,
        generation: job.generation,
        reasonCode: !assigneeOk ? "assignee_missing_on_readback" : "label_missing_on_readback",
      }),
    });
    // Reconcile false claimed if assignee missing
    if (!assigneeOk && labelOk) {
      try {
        await ensureClaimBlockedLabels({
          installationId: ctx.installationId,
          owner: ctx.owner,
          repo: ctx.repo,
          issueNumber: job.issueNumber,
          currentLabels: issue.rawLabels,
        });
      } catch {
        // best-effort
      }
    }
    return blockClaimAssignee(ctx, {
      readiness: !assigneeOk ? "readback_failed" : "readback_failed",
      identity,
      canMutateGithub: true,
    });
  }

  job = await persistJob({
    ...job,
    effects: upsertEffectMarker(job.effects, {
      name: "claim_label",
      status: "remote_confirmed",
      remoteId: YPI_LABEL_CLAIMED,
      generation: job.generation,
      reasonCode: null,
    }),
  });

  // 6) Triage analysis + labels + comment
  job = await persistJob({
    ...job,
    phase: "triaging",
    checkpoint: "triaging",
    status: "running",
  });

  const analysis = analyzeUntrustedGithubIssue(issue);

  try {
    await ensureTriageClassificationLabels({
      installationId: ctx.installationId,
      owner: ctx.owner,
      repo: ctx.repo,
      issueNumber: job.issueNumber,
      currentLabels: issue.rawLabels,
      decision: analysis.decisionLabel,
      risk: analysis.riskLabel,
      type: analysis.typeLabel,
      lifecycle:
        analysis.recommendation === "yes"
          ? [YPI_LABEL_TRIAGED, YPI_LABEL_AWAITING_OWNER]
          : [YPI_LABEL_TRIAGED],
    });
  } catch (err) {
    // Labels are best-effort relative to comment; still try comment, but surface reason.
    await appendGithubAutomationSafeEvent({
      at: now(),
      kind: "triage_labels_failed",
      repositoryId: job.repositoryId,
      issueNumber: job.issueNumber,
      jobId: job.jobId,
      deliveryId: job.deliveryId,
      phase: job.phase,
      reasonCode: isGithubAutomationError(err) ? err.code : "label_failed",
      traceId: job.traceId,
    });
  }

  const marker = buildGithubAutomationCommentMarker({
    kind: "triage",
    repositoryId: job.repositoryId,
    issueNumber: job.issueNumber,
    traceId: job.traceId,
  });

  const commentBody = buildTriageConclusionCommentBody({
    marker,
    appBotLogin: null,
    assigneeLogin: identity.login,
    recommendation: analysis.recommendation,
    reasons: analysis.reasons,
    nextActions: analysis.nextActions,
    issueTitlePreview: job.issueTitlePreview ?? issue.title,
  });

  job = await persistJob({
    ...job,
    effects: upsertEffectMarker(job.effects, {
      name: "triage_comment",
      status: "intended",
      remoteId: null,
      generation: job.generation,
      reasonCode: null,
    }),
  });

  let commentId: number | null = null;
  try {
    const upserted = await upsertGithubAutomationComment({
      installationId: ctx.installationId,
      owner: ctx.owner,
      repo: ctx.repo,
      issueNumber: job.issueNumber,
      kind: "triage",
      body: commentBody,
    });
    commentId = upserted.id;
  } catch (err) {
    const permission =
      isGithubAutomationError(err) && err.code === "permission_missing";
    job = await persistJob({
      ...job,
      effects: upsertEffectMarker(job.effects, {
        name: "triage_comment",
        status: "failed",
        remoteId: null,
        generation: job.generation,
        reasonCode: permission ? "permission_missing" : "comment_failed",
      }),
    });
    // Claim without canonical comment is incomplete per design.
    return blockClaimAssignee(ctx, {
      readiness: "readback_failed",
      identity,
      canMutateGithub: !permission,
      permissionMissing: permission,
      extraReason: "triage_comment_missing",
    });
  }

  job = await persistJob({
    ...job,
    effects: upsertEffectMarker(job.effects, {
      name: "triage_comment",
      status: "remote_confirmed",
      remoteId: commentId !== null ? String(commentId) : null,
      generation: job.generation,
      reasonCode: null,
    }),
  });

  // Final claim completeness
  const claimComplete = isCompleteClaimFacts({
    assigneeLogin: identity.login,
    assigneeReadBack: true,
    labelReadBack: true,
    triageCommentPresent: commentId !== null,
  });

  if (!claimComplete) {
    return blockClaimAssignee(ctx, {
      readiness: "readback_failed",
      identity,
      canMutateGithub: true,
    });
  }

  const nextPhase =
    analysis.recommendation === "yes" ? "awaiting_owner" : "not_adopted";
  const nextStatus =
    analysis.recommendation === "yes" ? "completed" : "completed";

  // awaiting_owner is a durable wait state — status completed for scheduler
  // (owner comments re-enqueue via webhook and advance the same job).
  // Use status "completed" only for not_adopted; awaiting_owner stays non-terminal
  // so issue_comment can reuse the active job. Mark as paused-like "queued" with
  // reason awaiting_owner_comment — scheduler will not spin (no runnable unless new delivery bumps).
  // Actually: design uses phase awaiting_owner; keep status non-terminal but not auto-runnable.
  // We use status "paused" is wrong. Use status "completed" for not_adopted and
  // for awaiting_owner use a parked status: "queued" with reasonCode that scheduler
  // won't pick without new work — simplest: status "completed" for both terminal wait
  // is wrong for awaiting_owner because owner comment reuses activeJob.
  // Keep awaiting_owner with status "queued" and reasonCode "awaiting_owner_comment"
  // and teach nothing else — isRunnableNow returns true for queued!
  // So use a non-runnable status. Looking at statuses: "paused" works for parking.
  // Better: use status "completed" for not_adopted; for awaiting_owner use status "blocked"
  // with reason awaiting_owner? No — blocked implies error.
  // Use status "paused" with reasonCode "awaiting_owner_comment".

  if (analysis.recommendation === "yes") {
    job = await persistJob({
      ...job,
      phase: "awaiting_owner",
      status: "paused",
      checkpoint: "awaiting_owner",
      reasonCode: "awaiting_owner_comment",
      leaseOwner: null,
      leaseExpiresAt: null,
      nextRetryAt: null,
    });
  } else {
    job = await persistJob({
      ...job,
      phase: "not_adopted",
      status: "completed",
      checkpoint: "not_adopted",
      reasonCode:
        analysis.recommendation === "no"
          ? "triage_not_recommended"
          : "triage_needs_info",
      leaseOwner: null,
      leaseExpiresAt: null,
    });
  }

  await setIssueClaimStatus(job, "complete", job.effects);

  await appendGithubAutomationSafeEvent({
    at: now(),
    kind: "claim_complete",
    repositoryId: job.repositoryId,
    issueNumber: job.issueNumber,
    jobId: job.jobId,
    deliveryId: job.deliveryId,
    phase: job.phase,
    reasonCode: job.reasonCode,
    traceId: job.traceId,
    meta: {
      assigneeLogin: identity.login,
      identitySource: identity.identitySource,
      recommendation: analysis.recommendation,
      commentId: commentId ?? null,
    },
  });

  // Silence unused
  void nextPhase;
  void nextStatus;

  return { job, wakeAgain: false };
}

async function blockClaimAssignee(
  ctx: ClaimContext,
  options: {
    readiness: GithubMachineAssigneeReadinessCode;
    identity: GithubMachineAssigneeResolvedIdentity | null;
    canMutateGithub: boolean;
    permissionMissing?: boolean;
    extraReason?: string;
  },
): Promise<GithubAutomationJobHandlerResult> {
  let job = ctx.job;
  const reasonCode = options.extraReason ?? options.readiness;

  // Reconcile labels if we can mutate
  if (options.canMutateGithub && ctx.installationId > 0) {
    try {
      const issue = await fetchUntrustedGithubIssue({
        installationId: ctx.installationId,
        owner: ctx.owner,
        repo: ctx.repo,
        issueNumber: job.issueNumber,
      });
      await ensureClaimBlockedLabels({
        installationId: ctx.installationId,
        owner: ctx.owner,
        repo: ctx.repo,
        issueNumber: job.issueNumber,
        currentLabels: issue.rawLabels,
      });
      job = await persistJob({
        ...job,
        effects: upsertEffectMarker(job.effects, {
          name: "claim_label",
          status: "failed",
          remoteId: YPI_LABEL_CLAIMED,
          generation: job.generation,
          reasonCode: "claim_blocked_reconcile",
        }),
      });
    } catch {
      // If even blocked label fails, still record local blocked state.
    }

    // Best-effort blocked comment
    try {
      const marker = buildGithubAutomationCommentMarker({
        kind: "claim_blocked",
        repositoryId: job.repositoryId,
        issueNumber: job.issueNumber,
        traceId: job.traceId,
      });
      const body = buildClaimBlockedCommentBody({
        marker,
        appBotLogin: null,
        assigneeLogin: options.identity?.login ?? null,
        reasonCode,
        operatorHints: operatorHintsForReadiness(
          options.readiness,
          options.identity?.login ?? null,
        ),
        issueTitlePreview: job.issueTitlePreview,
      });
      const upserted = await upsertGithubAutomationComment({
        installationId: ctx.installationId,
        owner: ctx.owner,
        repo: ctx.repo,
        issueNumber: job.issueNumber,
        kind: "claim_blocked",
        body,
      });
      job = await persistJob({
        ...job,
        effects: upsertEffectMarker(job.effects, {
          name: "blocked_comment",
          status: "remote_confirmed",
          remoteId: String(upserted.id),
          generation: job.generation,
          reasonCode,
        }),
      });
    } catch {
      job = await persistJob({
        ...job,
        effects: upsertEffectMarker(job.effects, {
          name: "blocked_comment",
          status: "failed",
          remoteId: null,
          generation: job.generation,
          reasonCode: options.permissionMissing
            ? "permission_missing"
            : "blocked_comment_failed",
        }),
      });
    }
  }

  job = await persistJob({
    ...job,
    phase: "blocked_claim_assignee",
    status: "blocked",
    checkpoint: "blocked_claim_assignee",
    reasonCode,
    leaseOwner: null,
    leaseExpiresAt: null,
    nextRetryAt: null,
  });

  await setIssueClaimStatus(job, "blocked_claim_assignee", job.effects);

  await appendGithubAutomationSafeEvent({
    at: new Date().toISOString(),
    kind: "claim_blocked",
    repositoryId: job.repositoryId,
    issueNumber: job.issueNumber,
    jobId: job.jobId,
    deliveryId: job.deliveryId,
    phase: job.phase,
    reasonCode,
    traceId: job.traceId,
    meta: {
      readiness: options.readiness,
      assigneeLogin: options.identity?.login ?? null,
      identitySource: options.identity?.identitySource ?? null,
    },
  });

  return { job, wakeAgain: false };
}

// ─── Owner adoption (P0 → accepted_waiting_automation) ───────────────────────

async function runOwnerIntentIfPresent(
  ctx: ClaimContext,
): Promise<GithubAutomationJobHandlerResult | null> {
  let job = ctx.job;
  if (job.phase !== "awaiting_owner" && job.phase !== "accepted_waiting_automation") {
    return null;
  }

  // Need delivery to inspect comment sender — load safe delivery metadata only.
  // Comment body is re-fetched via App API when needed; delivery store has no body.
  if (!job.deliveryId) {
    return {
      job: await persistJob({
        ...job,
        status: "paused",
        reasonCode: "awaiting_owner_comment",
        leaseOwner: null,
        leaseExpiresAt: null,
      }),
      wakeAgain: false,
    };
  }

  const delivery = await readGithubAutomationDelivery(job.deliveryId);
  if (!delivery || delivery.eventName !== "issue_comment") {
    // issues event while awaiting owner — keep waiting.
    return {
      job: await persistJob({
        ...job,
        phase: "awaiting_owner",
        status: "paused",
        reasonCode: "awaiting_owner_comment",
        leaseOwner: null,
        leaseExpiresAt: null,
      }),
      wakeAgain: false,
    };
  }

  // Fetch the latest comments and evaluate owner intent on recent human comments.
  // We only authorize when claim is still complete.
  const issue = await fetchUntrustedGithubIssue({
    installationId: ctx.installationId,
    owner: ctx.owner,
    repo: ctx.repo,
    issueNumber: job.issueNumber,
  });

  const repoConfig = findRepositoryConfigById(ctx.config, job.repositoryId);
  if (!repoConfig) {
    return {
      job: await persistJob({
        ...job,
        status: "blocked",
        phase: "blocked",
        reasonCode: "repository_not_allowlisted",
      }),
      wakeAgain: false,
    };
  }

  // Verify claim still complete before any authorization.
  const assigneeLogin = issue.assignees[0]?.login ?? null;
  // Prefer machine identity re-check for login match
  const resolved = await resolveMachineGithubAssigneeIdentity();
  const expectedLogin = resolved.ok ? resolved.identity.login : null;
  const assigneeOk =
    expectedLogin !== null &&
    issueAssigneesIncludeLogin(issue.rawAssignees, expectedLogin);
  const labelOk = issueHasLabel(issue.rawLabels, YPI_LABEL_CLAIMED);

  // Load comments — find non-bot comment matching delivery sender when possible
  const { listGithubIssueComments } = await import("./github-automation-comments");
  const comments = await listGithubIssueComments({
    installationId: ctx.installationId,
    owner: ctx.owner,
    repo: ctx.repo,
    issueNumber: job.issueNumber,
  });

  // Prefer comment from delivery.senderId
  const candidates = comments
    .filter((c) => !commentContainsBotMarker(c.body))
    .slice()
    .reverse(); // newest first

  let chosen = candidates.find(
    (c) =>
      delivery.senderId !== null &&
      c.userId === delivery.senderId &&
      commentMayExpressOwnerDecision(c.body),
  );
  if (!chosen) {
    chosen = candidates.find((c) => commentMayExpressOwnerDecision(c.body));
  }

  if (!chosen) {
    return {
      job: await persistJob({
        ...job,
        phase: "awaiting_owner",
        status: "paused",
        reasonCode: "awaiting_owner_comment",
        leaseOwner: null,
        leaseExpiresAt: null,
      }),
      wakeAgain: false,
    };
  }

  let repositoryOwnerId = issue.repositoryOwnerId;
  let repositoryOwnerLogin = issue.repositoryOwnerLogin;
  let repositoryOwnerType = issue.repositoryOwnerType;
  if (repositoryOwnerId === null) {
    const ownerInfo = await fetchRepositoryOwner({
      installationId: ctx.installationId,
      owner: ctx.owner,
      repo: ctx.repo,
    });
    repositoryOwnerId = ownerInfo.id;
    repositoryOwnerLogin = ownerInfo.login;
    repositoryOwnerType = ownerInfo.type;
  }

  // Re-read triage recommendation from labels
  const recommendation = recommendationFromLabels(issue.labels);

  const actor = buildOwnerActorContextFromRepoConfig(repoConfig, {
    senderId: chosen.userId,
    senderLogin: chosen.userLogin,
    senderType: chosen.userType,
    repositoryOwnerId,
    repositoryOwnerLogin,
    repositoryOwnerType,
  });

  const auth: GithubOwnerAuthorizationResult = evaluateGithubOwnerAuthorization({
    actor,
    commentBody: chosen.body,
    claimComplete: assigneeOk && labelOk,
    issueOpen: (issue.state ?? "").toLowerCase() === "open",
    recommendation,
  });

  await appendGithubAutomationSafeEvent({
    at: new Date().toISOString(),
    kind: "owner_intent_evaluated",
    repositoryId: job.repositoryId,
    issueNumber: job.issueNumber,
    jobId: job.jobId,
    deliveryId: job.deliveryId,
    phase: job.phase,
    reasonCode: auth.reasonCode,
    traceId: job.traceId,
    meta: {
      authorized: auth.authorized,
      decision: auth.decision,
      intent: auth.intent.kind,
      isOwner: auth.isOwner,
      claimComplete: assigneeOk && labelOk,
    },
  });

  if (!auth.authorized) {
    // Non-owner / incomplete claim / unclear — stay awaiting_owner (or keep blocked claim).
    if (auth.decision === "incomplete_claim") {
      return blockClaimAssignee(ctx, {
        readiness: expectedLogin ? "readback_failed" : "gh_unavailable",
        identity: resolved.ok ? resolved.identity : null,
        canMutateGithub: true,
        extraReason: "incomplete_claim_on_owner_intent",
      });
    }

    return {
      job: await persistJob({
        ...job,
        phase: "awaiting_owner",
        status: "paused",
        reasonCode: auth.reasonCode,
        leaseOwner: null,
        leaseExpiresAt: null,
      }),
      wakeAgain: false,
    };
  }

  // P0: unattended off → accepted_waiting_automation only (never WorkTree).
  // P1: mode=unattended + enabled → durable full-agent runner (GHA-06).
  const unattendedEnabled =
    ctx.config.mode === "unattended" && ctx.config.unattended.enabled;

  if (unattendedEnabled) {
    // Best-effort comment before handing off to runner (non-fatal).
    try {
      const marker = buildGithubAutomationCommentMarker({
        kind: "accepted_waiting_automation",
        repositoryId: job.repositoryId,
        issueNumber: job.issueNumber,
        traceId: job.traceId,
      });
      const body = buildAcceptedWaitingAutomationCommentBody({
        marker,
        ownerLogin: chosen.userLogin,
        assigneeLogin: expectedLogin ?? assigneeLogin ?? "unknown",
      });
      await upsertGithubAutomationComment({
        installationId: ctx.installationId,
        owner: ctx.owner,
        repo: ctx.repo,
        issueNumber: job.issueNumber,
        kind: "accepted_waiting_automation",
        body,
      });
    } catch {
      // non-fatal
    }

    await appendGithubAutomationSafeEvent({
      at: new Date().toISOString(),
      kind: "owner_accepted_waiting_automation",
      repositoryId: job.repositoryId,
      issueNumber: job.issueNumber,
      jobId: job.jobId,
      deliveryId: job.deliveryId,
      phase: job.phase,
      reasonCode: "owner_authorized_unattended",
      traceId: job.traceId,
      meta: {
        ownerLogin: chosen.userLogin,
        assigneeLogin: expectedLogin,
        unattended: true,
      },
    });

    // Comment retry / owner adoption wakes durable job — never inject comment text as agent command.
    if (chosen.userId === null) {
      return {
        job: await persistJob({
          ...job,
          phase: "awaiting_owner",
          status: "paused",
          reasonCode: "owner_sender_missing",
          leaseOwner: null,
          leaseExpiresAt: null,
        }),
        wakeAgain: false,
      };
    }

    return handleGithubUnattendedAfterOwnerAdoption({
      job,
      config: ctx.config,
      ownerActorId: chosen.userId,
      ownerCommentId: chosen.id,
      ownerCommentStrippedText: stripUntrustedCommentDecorations(chosen.body),
      matchedPhrase: auth.intent.matchedPhrase,
      claimComplete: assigneeOk && labelOk,
    });
  }

  job = await persistJob({
    ...job,
    phase: "accepted_waiting_automation",
    status: "completed",
    checkpoint: "accepted_waiting_automation",
    reasonCode: "accepted_waiting_automation",
    leaseOwner: null,
    leaseExpiresAt: null,
  });

  // Best-effort owner-waiting comment
  try {
    const marker = buildGithubAutomationCommentMarker({
      kind: "accepted_waiting_automation",
      repositoryId: job.repositoryId,
      issueNumber: job.issueNumber,
      traceId: job.traceId,
    });
    const body = buildAcceptedWaitingAutomationCommentBody({
      marker,
      ownerLogin: chosen.userLogin,
      assigneeLogin: expectedLogin ?? assigneeLogin ?? "unknown",
    });
    await upsertGithubAutomationComment({
      installationId: ctx.installationId,
      owner: ctx.owner,
      repo: ctx.repo,
      issueNumber: job.issueNumber,
      kind: "accepted_waiting_automation",
      body,
    });
  } catch {
    // non-fatal
  }

  await appendGithubAutomationSafeEvent({
    at: new Date().toISOString(),
    kind: "owner_accepted_waiting_automation",
    repositoryId: job.repositoryId,
    issueNumber: job.issueNumber,
    jobId: job.jobId,
    deliveryId: job.deliveryId,
    phase: job.phase,
    reasonCode: job.reasonCode,
    traceId: job.traceId,
    meta: {
      ownerLogin: chosen.userLogin,
      assigneeLogin: expectedLogin,
    },
  });

  return { job, wakeAgain: false };
}

function commentContainsBotMarker(body: string): boolean {
  return body.includes("<!-- ypi-github-automation:");
}

function recommendationFromLabels(
  labels: string[],
): "yes" | "no" | "needs_info" | null {
  const lower = labels.map((l) => l.toLowerCase());
  if (lower.includes(YPI_LABEL_DECISION_YES)) return "yes";
  if (lower.includes(YPI_LABEL_DECISION_NO)) return "no";
  if (lower.includes(YPI_LABEL_DECISION_NEEDS_INFO)) return "needs_info";
  return null;
}

// ─── Public job handler ──────────────────────────────────────────────────────

/**
 * Durable job handler for GHA-03. Register via `registerGithubIssueTriageHandler()`.
 */
export const githubIssueTriageJobHandler: GithubAutomationJobHandler = async (
  job,
  context,
) => {
  const repoConfig = findRepositoryConfigById(
    context.config,
    job.repositoryId,
  );
  const installationId =
    job.installationId ??
    repoConfig?.installationId ??
    null;

  if (installationId === null || installationId <= 0) {
    const blocked: GithubAutomationJobRecord = {
      ...job,
      phase: "blocked",
      status: "blocked",
      reasonCode: "installation_missing",
      checkpoint: "installation_missing",
      updatedAt: new Date().toISOString(),
      leaseOwner: null,
      leaseExpiresAt: null,
    };
    await writeGithubAutomationJob(blocked);
    await appendGithubAutomationSafeEvent({
      at: blocked.updatedAt,
      kind: "job_blocked",
      repositoryId: job.repositoryId,
      issueNumber: job.issueNumber,
      jobId: job.jobId,
      deliveryId: job.deliveryId,
      phase: blocked.phase,
      reasonCode: blocked.reasonCode,
      traceId: job.traceId,
    });
    return { job: blocked, wakeAgain: false };
  }

  const fullName = repoConfig?.fullName || job.repositoryFullName;
  const split = splitRepoFullName(fullName);
  if (!split) {
    const blocked: GithubAutomationJobRecord = {
      ...job,
      phase: "blocked",
      status: "blocked",
      reasonCode: "invalid_repository_full_name",
      updatedAt: new Date().toISOString(),
    };
    await writeGithubAutomationJob(blocked);
    return { job: blocked, wakeAgain: false };
  }

  const ctx: ClaimContext = {
    config: context.config,
    job,
    installationId,
    owner: split.owner,
    repo: split.repo,
  };

  // Owner intent path when already claimed / awaiting
  if (
    job.phase === "awaiting_owner" ||
    job.phase === "accepted_waiting_automation"
  ) {
    const ownerResult = await runOwnerIntentIfPresent(ctx);
    if (ownerResult) return ownerResult;
  }

  // P1 durable runner continuation (WorkTree / full agent checkpoints)
  const unattendedContinue = await continueGithubUnattendedJob({
    job,
    config: context.config,
  });
  if (unattendedContinue) return unattendedContinue;

  // Retry from blocked claim
  if (
    job.phase === "blocked_claim_assignee" ||
    job.phase === "received" ||
    job.phase === "claim_readiness" ||
    job.phase === "triaging" ||
    job.reasonCode === "awaiting_claim_handler"
  ) {
    return runClaimAndTriage(ctx);
  }

  // Default: if still early, claim; else park
  if (job.phase === "not_adopted" || job.phase === "completed") {
    return {
      job: await persistJob({
        ...job,
        status: "completed",
        leaseOwner: null,
        leaseExpiresAt: null,
      }),
      wakeAgain: false,
    };
  }

  return runClaimAndTriage(ctx);
};

/**
 * Register the GHA-03 triage handler on the durable scheduler.
 * Safe to call multiple times.
 */
export function registerGithubIssueTriageHandler(): void {
  setGithubAutomationJobHandler(githubIssueTriageJobHandler);
}

/**
 * Manual Skill gate: when automation has an active complete/blocked claim for
 * the issue, manual github-issue-triage should skip write operations.
 */
export function shouldManualTriageSkipAutomationClaim(input: {
  claimStatus: GithubIssueClaimStatus | null | undefined;
  activeJobPhase?: string | null;
}): { skip: boolean; reason: string } {
  if (input.claimStatus === "complete") {
    return {
      skip: true,
      reason: "active_automation_claim_complete",
    };
  }
  if (input.claimStatus === "blocked_claim_assignee") {
    return {
      skip: true,
      reason: "active_automation_claim_blocked",
    };
  }
  if (
    input.activeJobPhase === "claim_readiness" ||
    input.activeJobPhase === "triaging" ||
    input.activeJobPhase === "awaiting_owner" ||
    input.activeJobPhase === "accepted_waiting_automation" ||
    input.activeJobPhase === "implementation_queued" ||
    input.activeJobPhase === "planning" ||
    input.activeJobPhase === "policy_check" ||
    input.activeJobPhase === "implementing" ||
    input.activeJobPhase === "checking" ||
    input.activeJobPhase === "final_policy" ||
    input.activeJobPhase === "publishing" ||
    input.activeJobPhase === "pr_open"
  ) {
    return {
      skip: true,
      reason: "active_automation_job",
    };
  }
  return { skip: false, reason: "no_active_automation" };
}

/** Test helper types re-export */
export type { GithubMachineAssigneeIdentitySource };
