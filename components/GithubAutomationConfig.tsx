"use client";

/**
 * GitHub 自动化 Settings leaf (GHA-10 / GHCRED-05).
 *
 * Product surface (approved local-credentials prototype):
 * - Local GitHub App credential card (save/rotate/delete) above checklist/status/jobs
 * - Safe projection only: configured/source/readiness; never App ID value / secret / PEM / path
 * - Setup checklist + collapsed advanced env override guidance
 * - Empty default allowlist; operator-managed repositories linked to Project Registry
 * - Independent CAS / immediate credential save; polling never enqueues work
 * - Full-agent residual-risk warning is non-dismissible
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { usePrompt } from "./AppPromptProvider";

// ─── Wire types (mirror server projection; client never invents policy truth) ─

type AutomationMode = "off" | "triage" | "unattended";

interface AssigneeProjection {
  login: string | null;
  actorId: number | null;
  identitySource: "gh" | "git-credential" | null;
  checkedAt: string;
  readiness: string;
  assignable: boolean | null;
  reasonCode: string | null;
}

type CredentialValueSource = "env" | "local" | "missing";

type LocalCredentialReadiness = "ready" | "missing" | "invalid" | "unsupported";

interface LocalCredentialSummary {
  configured: boolean;
  readiness: LocalCredentialReadiness;
  hasAppId: boolean;
  hasKey: boolean;
  hasWebhook: boolean;
  updatedAt: string | null;
}

interface AppCredentialProjection {
  configured: boolean;
  readiness: string;
  appSlug: string | null;
  hasAppId: boolean;
  hasPrivateKeyFile: boolean;
  hasPrivateKey?: boolean;
  hasWebhookSecret: boolean;
  checkedAt: string;
  local?: LocalCredentialSummary;
  sources?: {
    appId: CredentialValueSource;
    key: CredentialValueSource;
    webhook: CredentialValueSource;
    slug: CredentialValueSource;
  };
}

interface JobActionAvailability {
  action: "retry" | "pause" | "resume";
  available: boolean;
  reasonCode: string | null;
}

interface JobSafeProjection {
  jobId: string;
  repositoryId: number;
  repositoryFullName: string;
  issueNumber: number;
  issueTitlePreview: string | null;
  phase: string;
  status: string;
  attempt: number;
  generation: number;
  traceId: string;
  reasonCode: string | null;
  nextRetryAt: string | null;
  createdAt: string;
  updatedAt: string;
  checkpoint: string | null;
  claimStatus: "complete" | "blocked_claim_assignee" | "incomplete" | "unknown";
  prNumber: number | null;
  headBranch: string | null;
  hasPullRequest: boolean;
  actions: JobActionAvailability[];
}

interface RepositorySafeProjection {
  repositoryId: number;
  fullName: string;
  installationId: number | null;
  hasInstallationId: boolean;
  baseRef: string;
  assigneeIdentitySource: "machine-active-credential";
  ownerActorIds: number[];
  ownerActorIdCount: number;
  projectId: string | null;
  projectRootConfigured: boolean;
  legacySeeded: boolean;
}

interface RepositoryStatusProjection extends RepositorySafeProjection {
  installationBound: boolean;
  assignee: AssigneeProjection;
  claimSemantics: "ypi_claimed_plus_machine_login";
  projectDisplayName: string | null;
}

interface ConfigSafeProjection {
  schemaVersion: number;
  enabled: boolean;
  mode: AutomationMode;
  paused: boolean;
  revision: string;
  updatedAt: string;
  repositories: RepositorySafeProjection[];
  triage: { maxConcurrency: number };
  unattended: {
    enabled: boolean;
    executionProfile: "full-agent";
    riskProfile: "docs-and-small-bugfix";
    maxConcurrency: number;
    maxFiles: number;
    maxChangedLines: number;
    validationCommandCount: number;
  };
}

interface ProjectChoice {
  projectId: string;
  displayName: string;
  pathStatus: "ok" | "missing" | "archived";
  archived: boolean;
  missing: boolean;
}

interface StatusProjection {
  revision: string;
  generatedAt: string;
  readiness: {
    app: AppCredentialProjection;
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
    };
    assignee: AssigneeProjection;
    webhook: {
      health: "unknown" | "healthy" | "error";
      lastVerifiedAt: string | null;
    };
    allowlist: {
      repositoryCount: number;
      ready: boolean;
    };
  };
  runtime: {
    enabled: boolean;
    mode: AutomationMode;
    paused: boolean;
    executionProfile: "full-agent";
    riskProfile: "docs-and-small-bugfix";
    residualRiskWarningRequired: true;
    residualRiskCodes: readonly string[];
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
  };
  repositories: RepositoryStatusProjection[];
  policy: {
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
    residualRiskCodes: readonly string[];
    residualRiskSummary: string;
    recommendedDeployment: string;
    sandboxed: false;
    alwaysManual: readonly string[];
    capabilityBlockers: string[];
  };
  jobs: JobSafeProjection[];
  config: ConfigSafeProjection;
}

type SetupItemState = "ready" | "pending" | "needs_fix" | "unknown";

interface SetupChecklistItem {
  code: string;
  order: number;
  state: SetupItemState;
  title: string;
  reasonCode: string | null;
  nextStep: string | null;
  envNames: string[];
}

interface VerifyResult {
  ok: true;
  generatedAt: string;
  revision: string;
  allReady: boolean;
  p0Ready: boolean;
  p1Ready: boolean;
  unattendedEligible: boolean;
  checklist: SetupChecklistItem[];
  summary: {
    app: Pick<
      AppCredentialProjection,
      | "configured"
      | "readiness"
      | "hasAppId"
      | "hasPrivateKeyFile"
      | "hasPrivateKey"
      | "hasWebhookSecret"
      | "appSlug"
      | "checkedAt"
      | "local"
      | "sources"
    >;
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
    };
    assignee: {
      readiness: AssigneeProjection["readiness"];
      login: string | null;
      assignable: boolean | null;
      identitySource: AssigneeProjection["identitySource"];
      checkedAt: string;
    };
    allowlist: {
      repositoryCount: number;
      ready: boolean;
      boundProjectCount: number;
      unboundCount: number;
    };
    webhook: {
      health: "unknown" | "healthy" | "error";
      lastVerifiedAt: string | null;
      recentDeliveryCount: number;
    };
  };
  sideEffects: {
    enqueuedJobs: false;
    schedulerWoken: false;
    githubMutations: false;
  };
}

interface RepositoryDraft {
  repositoryId: string;
  fullName: string;
  installationId: string;
  baseRef: string;
  projectId: string;
  ownerActorIds: string;
}

type InlineNoticeTone = "info" | "warning" | "error" | "success";

interface InlineNotice {
  tone: InlineNoticeTone;
  title: string;
  message: string;
}

type LoadState = "loading" | "ready" | "error";
type FormMode = { kind: "closed" } | { kind: "add" } | { kind: "edit"; repositoryId: number };

const POLL_INTERVAL_MS = 20_000;
const SAVED_FLASH_MS = 2200;

/** Static customer help page (public/); opens in a new tab from Settings. */
const GITHUB_AUTOMATION_HELP_HREF = "/docs/github-app-automation-setup.html";

const ENV_APP_ID = "YPI_GITHUB_APP_ID";
const ENV_PRIVATE_KEY_FILE = "YPI_GITHUB_APP_PRIVATE_KEY_FILE";
const ENV_WEBHOOK_SECRET = "YPI_GITHUB_APP_WEBHOOK_SECRET";
const ENV_APP_SLUG = "YPI_GITHUB_APP_SLUG";

const CREDENTIALS_DELETE_CONFIRM = "remove_local_credentials";
type PrivateKeyInputMode = "paste" | "file";

const ALWAYS_MANUAL_CHIPS = [
  "UI / 交互",
  "大重构",
  "workflow / release",
  "secret / auth",
  "依赖 / lockfile",
] as const;

const ALLOWED_ERROR_CODES = new Set([
  "revision_conflict",
  "stale_revision",
  "invalid_config",
  "not_found",
  "not_allowed",
  "rate_limited",
  "not_configured",
  "installation_missing",
  "permission_denied",
  "permission_missing",
  "method_not_allowed",
  "internal_error",
  "repository_not_allowlisted",
  "github_network_error",
  "github_timeout",
  "github_bad_response",
  "github_auth_failed",
  "github_rate_limited",
  "invalid_credentials_request",
  "invalid_app_id",
  "invalid_webhook_secret",
  "invalid_private_key",
  "private_key_too_large",
  "local_credentials_invalid",
  "local_credentials_unsupported",
  "credentials_lock_timeout",
  "credentials_store_error",
]);

const FALLBACK_CHECKLIST: SetupChecklistItem[] = [
  {
    code: "app_id",
    order: 1,
    state: "pending",
    title: "配置 App ID（本机凭据）",
    reasonCode: "missing_app_id",
    nextStep:
      "在上方「本机 GitHub App 凭据」卡填写 App ID 并「保存到本机」，然后重新验证。高级覆盖可设置 YPI_GITHUB_APP_ID；页面不会回显已保存值。",
    envNames: [ENV_APP_ID],
  },
  {
    code: "private_key_file",
    order: 2,
    state: "pending",
    title: "配置 GitHub App 私钥（本机凭据）",
    reasonCode: "missing_private_key_file",
    nextStep:
      "在上方「本机 GitHub App 凭据」卡粘贴或选择 GitHub App RSA 私钥 PEM 并「保存到本机」。高级覆盖可设置 YPI_GITHUB_APP_PRIVATE_KEY_FILE 指向 0600 PEM（仅服务器）。",
    envNames: [ENV_PRIVATE_KEY_FILE],
  },
  {
    code: "webhook_secret",
    order: 3,
    state: "pending",
    title: "配置 Webhook secret（本机凭据）",
    reasonCode: "missing_webhook_secret",
    nextStep:
      "在上方「本机 GitHub App 凭据」卡填写 Webhook secret 并「保存到本机」，且与 GitHub App webhook secret 一致。高级覆盖可设置 YPI_GITHUB_APP_WEBHOOK_SECRET。",
    envNames: [ENV_WEBHOOK_SECRET],
  },
  {
    code: "installation",
    order: 4,
    state: "pending",
    title: "安装 App 并关联仓库",
    reasonCode: "allowlist_empty",
    nextStep:
      "安装到目标 owner/repo，授予最小权限；在下方添加该仓库并关联已注册的本地项目。默认不会预置 yolk-pi-web。",
    envNames: [],
  },
  {
    code: "assignee",
    order: 5,
    state: "pending",
    title: "验证 readiness",
    reasonCode: "not_verified",
    nextStep: "点击「验证配置」检查 App、安装、权限、webhook 和本机 Assignee；不会提交任何 secret。",
    envNames: [],
  },
];

// ─── helpers ─────────────────────────────────────────────────────────────────

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function allowlistedMessage(code: string | undefined, fallback: string): string {
  if (code && ALLOWED_ERROR_CODES.has(code)) {
    switch (code) {
      case "revision_conflict":
      case "stale_revision":
        return "配置已被其他操作者更新（revision conflict）";
      case "not_found":
        return "目标 job 不存在或已过期";
      case "not_allowed":
        return "当前 phase / 状态不允许该操作";
      case "rate_limited":
      case "github_rate_limited":
        return "操作过于频繁，请稍后再试";
      case "not_configured":
        return "GitHub App 尚未配置";
      case "installation_missing":
        return "App 尚未安装到允许仓库，或缺少 installation id";
      case "invalid_config":
        return "请求参数无效";
      case "permission_denied":
      case "permission_missing":
        return "安装权限不足";
      case "github_network_error":
      case "github_timeout":
        return "无法联系 GitHub 完成仓库核验";
      case "github_auth_failed":
        return "GitHub App 鉴权失败，请检查本机凭据或高级 env 覆盖";
      case "github_bad_response":
        return "GitHub 返回异常，仓库身份未确认";
      case "invalid_credentials_request":
        return "凭据请求无效（字段/格式/大小不符合要求）";
      case "invalid_app_id":
        return "App ID 无效，请填写正整数字符串";
      case "invalid_webhook_secret":
        return "Webhook secret 无效或超出允许长度";
      case "invalid_private_key":
        return "私钥无效：需要完整的 GitHub App RSA PEM";
      case "private_key_too_large":
        return "私钥文件过大";
      case "local_credentials_invalid":
        return "本机凭据损坏或不一致；请移除后重新完整配置";
      case "local_credentials_unsupported":
        return "本机凭据 schema 不受支持；请移除后按当前版本重配";
      case "credentials_lock_timeout":
        return "凭据写入锁超时，请稍后重试";
      case "credentials_store_error":
        return "本机凭据存储失败，服务端配置未更新";
      default:
        return fallback;
    }
  }
  return fallback;
}

function formatSafeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function assigneeLoginLabel(assignee: AssigneeProjection): string {
  return assignee.login ? `@${assignee.login}` : "未解析";
}

function identitySourceLabel(source: AssigneeProjection["identitySource"]): string {
  if (source === "gh") return "active gh";
  if (source === "git-credential") return "git credential";
  return "来源未知";
}

function assigneeValueText(assignee: AssigneeProjection, stale: boolean): string {
  if (stale) {
    return assignee.login
      ? `${assigneeLoginLabel(assignee)} · 状态可能过期`
      : "状态可能过期";
  }
  if (assignee.readiness === "ready" && assignee.login) {
    const assignPart =
      assignee.assignable === true
        ? "可 assign"
        : assignee.assignable === false
          ? "不可 assign"
          : "assign 未验证";
    return `${assigneeLoginLabel(assignee)} · ${identitySourceLabel(assignee.identitySource)} · ${assignPart}`;
  }
  if (
    assignee.readiness === "gh_no_active_account" ||
    assignee.readiness === "gh_not_logged_in" ||
    assignee.readiness === "gh_unavailable"
  ) {
    return `blocked_claim_assignee · 无 active 账号`;
  }
  if (assignee.readiness === "unassignable") {
    return `${assigneeLoginLabel(assignee)} · 不可 assign`;
  }
  if (assignee.readiness === "readback_failed") {
    return `${assigneeLoginLabel(assignee)} · 回读失败`;
  }
  return `blocked_claim_assignee · ${assignee.reasonCode ?? assignee.readiness}`;
}

function assigneePill(
  assignee: AssigneeProjection,
  stale: boolean,
): { tone: "ok" | "warn" | "bad" | "info"; label: string } {
  if (stale) return { tone: "warn", label: "可能过期" };
  if (assignee.readiness === "ready" && assignee.assignable !== false) {
    return { tone: "ok", label: "健康" };
  }
  if (
    assignee.readiness === "unassignable" ||
    assignee.readiness === "readback_failed" ||
    assignee.readiness === "gh_no_active_account" ||
    assignee.readiness === "gh_not_logged_in" ||
    assignee.readiness === "gh_unavailable" ||
    assignee.readiness === "credential_invalid"
  ) {
    return { tone: "bad", label: "需处理" };
  }
  return { tone: "warn", label: "未知" };
}

function appCredentialText(app: AppCredentialProjection): string {
  if (app.configured && app.readiness === "ready") return "已配置";
  if (app.readiness === "missing_app_id") return "缺失 App ID";
  if (app.readiness === "missing_private_key_file") return "缺失 private key";
  if (app.readiness === "private_key_unreadable" || app.readiness === "private_key_invalid") {
    return "private key 不可用";
  }
  if (app.readiness === "missing_webhook_secret") return "缺失 webhook secret";
  return "缺失";
}

function hasEffectivePrivateKey(app: AppCredentialProjection): boolean {
  return app.hasPrivateKey === true || app.hasPrivateKeyFile === true;
}

function credentialSourceOf(
  app: AppCredentialProjection | null | undefined,
  field: "appId" | "key" | "webhook" | "slug",
): CredentialValueSource {
  const sources = app?.sources;
  if (!sources) {
    if (!app) return "missing";
    if (field === "appId") return app.hasAppId ? "local" : "missing";
    if (field === "key") return hasEffectivePrivateKey(app) ? "local" : "missing";
    if (field === "webhook") return app.hasWebhookSecret ? "local" : "missing";
    return app.appSlug ? "local" : "missing";
  }
  return sources[field];
}

function sourceLabel(source: CredentialValueSource): string {
  if (source === "env") return "env";
  if (source === "local") return "本机";
  return "未配置";
}

function sourcePillTone(source: CredentialValueSource): "ok" | "warn" | "bad" | "info" {
  if (source === "env") return "info";
  if (source === "local") return "ok";
  return "warn";
}

function fieldConfiguredLabel(
  configured: boolean,
  options?: { unavailable?: boolean },
): string {
  if (options?.unavailable) return "不可用";
  return configured ? "已配置" : "未配置";
}

function sourceDetailText(source: CredentialValueSource, localInvalid: boolean): string {
  if (source === "env") return "环境变量覆盖";
  if (source === "local") return localInvalid ? "本机 bundle 损坏" : "本机持久凭据";
  return "未配置";
}

function overallCredentialPill(
  app: AppCredentialProjection | null,
  local: LocalCredentialSummary | null,
  saving: boolean,
): { label: string; tone: "ok" | "warn" | "bad" | "info" } {
  if (saving) return { label: "保存中…", tone: "info" };
  if (!app) return { label: "待配置", tone: "warn" };
  if (app.configured && app.readiness === "ready") {
    return { label: "已配置", tone: "ok" };
  }
  if (local?.readiness === "invalid" || local?.readiness === "unsupported") {
    return { label: "需修复", tone: "bad" };
  }
  return { label: "待配置", tone: "warn" };
}

function installationText(status: StatusProjection): string {
  const inst = status.readiness.installation;
  if (inst.readiness === "ready") return "已安装";
  if (inst.readiness === "partial") return "部分安装";
  return "未安装";
}

function permissionsText(status: StatusProjection): string {
  const perms = status.readiness.permissions;
  if (perms.p1Unattended) return "P1 权限满足";
  if (perms.p0Triage) {
    if (perms.missingForP1.length > 0) {
      return `缺少 ${perms.missingForP1.slice(0, 4).join(" / ")}`;
    }
    return "P0 权限满足";
  }
  if (perms.missingForP0.length > 0) {
    return `缺少 ${perms.missingForP0.slice(0, 4).join(" / ")}`;
  }
  return "权限不足";
}

function webhookText(status: StatusProjection, stale: boolean): string {
  if (stale) return "状态可能过期";
  const wh = status.readiness.webhook;
  if (wh.health === "healthy") {
    return wh.lastVerifiedAt
      ? `最近投递验证成功 · ${formatSafeTime(wh.lastVerifiedAt)}`
      : "最近投递验证成功";
  }
  if (wh.health === "error") return "Webhook 校验异常";
  return "未知 / 无近期投递";
}

function readinessPillTone(value: string): "ok" | "warn" | "bad" | "info" {
  if (/已配置|已安装|满足|成功|健康|可 assign|允许/.test(value)) return "ok";
  if (/缺失|不足|blocked|失败|不可/.test(value)) return "bad";
  if (/未知|未检查|尚未|过期/.test(value)) return "warn";
  return "warn";
}

function readinessPillLabel(value: string): string {
  if (/成功|可 assign|健康|满足|已配置|已安装/.test(value) && !/不足|缺失/.test(value)) {
    return "健康";
  }
  if (/未知|未检查|尚未|过期/.test(value)) return "未知";
  if (/缺失|不足|blocked|失败|不可/.test(value)) return "需处理";
  return "状态";
}

function modeLabel(mode: AutomationMode, paused: boolean): string {
  if (paused) return "已暂停新任务";
  if (mode === "off") return "关闭";
  if (mode === "triage") return "仅 Triage";
  return "低风险无人值守";
}

function checklistStateLabel(state: SetupItemState): {
  tone: "ok" | "warn" | "bad" | "info";
  label: string;
} {
  if (state === "ready") return { tone: "ok", label: "已就绪" };
  if (state === "needs_fix") return { tone: "bad", label: "需修复" };
  if (state === "unknown") return { tone: "warn", label: "未知" };
  return { tone: "warn", label: "待配置" };
}

function emptyDraft(): RepositoryDraft {
  return {
    repositoryId: "",
    fullName: "",
    installationId: "",
    baseRef: "main",
    projectId: "",
    ownerActorIds: "",
  };
}

function draftFromRepo(repo: RepositorySafeProjection): RepositoryDraft {
  return {
    repositoryId: String(repo.repositoryId),
    fullName: repo.fullName,
    installationId: repo.installationId != null ? String(repo.installationId) : "",
    baseRef: repo.baseRef || "main",
    projectId: repo.projectId ?? "",
    ownerActorIds: repo.ownerActorIds.join(", "),
  };
}

function parseOwnerActorIds(raw: string): number[] | null {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const parts = trimmed.split(/[,\s]+/).filter(Boolean);
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const n = Number(part);
    if (!Number.isSafeInteger(n) || n <= 0) return null;
    if (seen.has(n)) continue;
    seen.add(n);
    ids.push(n);
  }
  return ids;
}

function repoToWireDraft(repo: RepositorySafeProjection): {
  repositoryId: number;
  fullName: string;
  installationId: number | null;
  projectId: string | null;
  ownerActorIds: number[];
  baseRef: string;
} {
  return {
    repositoryId: repo.repositoryId,
    fullName: repo.fullName,
    installationId: repo.installationId,
    projectId: repo.projectId,
    ownerActorIds: [...repo.ownerActorIds],
    baseRef: repo.baseRef,
  };
}

function jobBlocksRepositoryDelete(job: JobSafeProjection): boolean {
  if (
    job.status === "queued" ||
    job.status === "running" ||
    job.status === "retry_due" ||
    job.status === "paused"
  ) {
    return true;
  }
  return (
    job.phase === "implementing" ||
    job.phase === "checking" ||
    job.phase === "publishing" ||
    job.phase === "planning" ||
    job.phase === "policy_check" ||
    job.phase === "final_policy" ||
    job.phase === "triaging" ||
    job.phase === "claim_readiness" ||
    job.phase === "implementation_queued"
  );
}

function unattendedAvailable(status: StatusProjection): { ok: boolean; reason: string | null } {
  const blockers = status.policy.capabilityBlockers.filter(
    (b) => b !== "mode_not_unattended" && b !== "unattended_disabled",
  );
  if (!status.readiness.app.configured) {
    return { ok: false, reason: "App 尚未配置" };
  }
  if (status.readiness.installation.readiness === "missing") {
    return { ok: false, reason: "App 尚未安装到允许仓库" };
  }
  if (!status.readiness.permissions.p1Unattended) {
    return { ok: false, reason: "P1 权限不足（需要 Pull requests / Contents）" };
  }
  if (status.readiness.assignee.readiness !== "ready") {
    return { ok: false, reason: "本机 Assignee 不可用，认领无法完成" };
  }
  if (!status.readiness.allowlist.ready || status.readiness.allowlist.repositoryCount === 0) {
    return { ok: false, reason: "尚未关联允许仓库" };
  }
  if (blockers.includes("assignee_not_ready")) {
    return { ok: false, reason: "本机 Assignee 不可用，认领无法完成" };
  }
  if (blockers.includes("p1_permissions_missing")) {
    return { ok: false, reason: "P1 权限不足" };
  }
  return { ok: true, reason: null };
}

function primaryBanner(
  status: StatusProjection | null,
  options: {
    loadState: LoadState;
    stale: boolean;
    conflict: boolean;
    saveError: string | null;
    actionNotice: InlineNotice | null;
  },
): InlineNotice | null {
  if (options.actionNotice) return options.actionNotice;
  if (options.conflict) {
    return {
      tone: "warning",
      title: "配置已被其他操作者更新（revision conflict）",
      message: "当前草稿尚未保存；不会覆盖服务端配置。请重新读取后再改。",
    };
  }
  if (options.saveError) {
    return {
      tone: "error",
      title: "更改未保存",
      message: options.saveError,
    };
  }
  if (options.loadState === "error" && status) {
    return {
      tone: "error",
      title: "无法刷新自动化状态",
      message: "保留上次安全摘要并标为可能过期；所有 mutation 已禁用。",
    };
  }
  if (options.loadState === "error") {
    return {
      tone: "error",
      title: "无法读取 GitHub 自动化状态",
      message: "请稍后重试刷新。本页不会请求或显示任何 secret。",
    };
  }
  if (!status) return null;

  if (!status.readiness.app.configured) {
    return {
      tone: "error",
      title: "尚未配置 GitHub App",
      message:
        "在下方「本机 GitHub App 凭据」卡保存 App ID、Webhook secret 与私钥 PEM。无需配置 shell 环境变量。",
    };
  }
  if (status.repositories.length === 0) {
    return {
      tone: "warning",
      title: "尚未关联仓库",
      message:
        "allowlist 默认为空，不会预置 yolk-pi-web。请点击「关联仓库」绑定任意 owner/repo 与 Project Registry 项目。",
    };
  }
  if (status.readiness.installation.readiness === "missing") {
    return {
      tone: "warning",
      title: "App 已配置，但尚未安装",
      message: "请将 GitHub App 安装到 allowlist 仓库后刷新状态。浏览器不能代替 operator 安装或授予权限。",
    };
  }
  if (status.readiness.assignee.readiness !== "ready") {
    return {
      tone: "error",
      title: "认领未完成：本机 Assignee 不可用",
      message:
        "没有 active gh/git credential，或该 login 无法被 assign。不会保留 ypi:claimed，也不会进入 owner 自动实现；请在机器上修复账号后重试。",
    };
  }
  if (!status.readiness.permissions.p0Triage) {
    return {
      tone: "warning",
      title: "安装权限不足",
      message: "P0 需要 Metadata、Issues；启用无人值守还需要 Pull requests、Contents。请由仓库管理员升级 App 安装权限。",
    };
  }
  if (status.runtime.paused) {
    return {
      tone: "warning",
      title: "已暂停新任务",
      message:
        "当前 mode 保持不变；执行中的命令不会被强杀，会在下一个 checkpoint 停住。full agent 已产生的外部副作用不会自动回滚。",
    };
  }
  if (status.runtime.mode === "off" || !status.runtime.enabled) {
    return {
      tone: "info",
      title: "自动化已关闭",
      message: "新 delivery 仍会完成签名验证并记录 paused/ignored；不会创建新 job，也不会删除既有审计记录。",
    };
  }
  if (status.runtime.mode === "triage") {
    const login = status.readiness.assignee.login
      ? `@${status.readiness.assignee.login}`
      : "@machine-login";
    return {
      tone: "info",
      title: "仅 Triage 正在运行",
      message: `成功认领必须同时有 ypi:claimed 与 ${login} Assignee；owner 采纳只记录等待自动化。`,
    };
  }
  if (!status.policy.unattendedEnabled || !status.readiness.permissions.p1Unattended) {
    return {
      tone: "warning",
      title: "无人值守默认关闭",
      message:
        "完整 label + assignee 认领、P1 capability 或文档 + 小 bugfix policy 尚未就绪；不能从本页绕过。",
    };
  }
  if (status.readiness.webhook.health === "unknown") {
    return {
      tone: "warning",
      title: "Webhook 状态未知",
      message:
        "尚未收到可验证的近期投递。该状态不是健康，也不显示 raw delivery；请检查公网 HTTPS ingress 后刷新。",
    };
  }
  if (status.runtime.residualRiskWarningRequired) {
    return {
      tone: "warning",
      title: "Full agent 风险已接受",
      message:
        "文档 + 小 bugfix 会使用完整 agent：可执行任意命令、联网并访问同 OS 用户可见文件。owner gate、WorkTree 和最终 diff gate 不是 sandbox。",
    };
  }
  return null;
}

function jobActionAvailability(
  job: JobSafeProjection,
  action: "retry" | "pause" | "resume",
): JobActionAvailability {
  return (
    job.actions.find((a) => a.action === action) ?? {
      action,
      available: false,
      reasonCode: "unavailable",
    }
  );
}

function claimStatusLabel(claim: JobSafeProjection["claimStatus"]): string {
  if (claim === "complete") return "claim 完整";
  if (claim === "blocked_claim_assignee") return "认领未完成";
  if (claim === "incomplete") return "claim 不完整";
  return "claim 未知";
}

async function copyEnvName(name: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(name);
      return true;
    }
  } catch {
    /* clipboard unavailable */
  }
  return false;
}

// ─── component ───────────────────────────────────────────────────────────────

export function GithubAutomationConfig() {
  const prompt = usePrompt();
  const headingId = useId();
  const modeReasonId = useId();
  const residualRiskId = useId();
  const formHeadingId = useId();
  const fullNameId = useId();
  const repositoryIdFieldId = useId();
  const installationIdFieldId = useId();
  const baseRefId = useId();
  const projectIdFieldId = useId();
  const ownerActorIdsId = useId();
  const formErrorId = useId();
  const credentialAppIdFieldId = useId();
  const credentialWebhookFieldId = useId();
  const credentialPemFieldId = useId();
  const credentialFileFieldId = useId();
  const credentialLiveRegionId = useId();

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [status, setStatus] = useState<StatusProjection | null>(null);
  const [config, setConfig] = useState<ConfigSafeProjection | null>(null);
  const [projectChoices, setProjectChoices] = useState<ProjectChoice[]>([]);
  const [checklist, setChecklist] = useState<SetupChecklistItem[]>(FALLBACK_CHECKLIST);
  const [verifySummary, setVerifySummary] = useState<VerifyResult["summary"] | null>(null);
  const [credentialStatus, setCredentialStatus] = useState<AppCredentialProjection | null>(null);
  const [stale, setStale] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [repoSaving, setRepoSaving] = useState(false);
  const [credentialSaving, setCredentialSaving] = useState(false);
  const [credentialDeleting, setCredentialDeleting] = useState(false);
  const [credentialError, setCredentialError] = useState<string | null>(null);
  const [credentialNotice, setCredentialNotice] = useState<InlineNotice | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<InlineNotice | null>(null);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<FormMode>({ kind: "closed" });
  const [draft, setDraft] = useState<RepositoryDraft>(emptyDraft);
  const [formError, setFormError] = useState<string | null>(null);
  const [envGuideOpen, setEnvGuideOpen] = useState(false);
  const [appIdDraft, setAppIdDraft] = useState("");
  const [webhookSecretDraft, setWebhookSecretDraft] = useState("");
  const [privateKeyPemDraft, setPrivateKeyPemDraft] = useState("");
  const [privateKeyFile, setPrivateKeyFile] = useState<File | null>(null);
  const [privateKeyMode, setPrivateKeyMode] = useState<PrivateKeyInputMode>("paste");

  const fetchGenerationRef = useRef(0);
  const credentialGenerationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const credentialAbortRef = useRef<AbortController | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const formSectionRef = useRef<HTMLFormElement | null>(null);
  const privateKeyFileInputRef = useRef<HTMLInputElement | null>(null);

  const clearPoll = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const applyConfigBundle = useCallback(
    (
      nextConfig: ConfigSafeProjection,
      nextChoices: ProjectChoice[] | undefined,
      generation: number,
    ) => {
      if (!mountedRef.current) return;
      if (generation !== fetchGenerationRef.current) return;
      setConfig(nextConfig);
      if (nextChoices) setProjectChoices(nextChoices);
    },
    [],
  );

  const applyStatus = useCallback((next: StatusProjection, generation: number) => {
    if (!mountedRef.current) return;
    if (generation !== fetchGenerationRef.current) return;
    setStatus(next);
    // Status readiness.app uses the same safe projection (sources/local additive).
    setCredentialStatus(next.readiness.app);
    // Keep config revision aligned when status carries a fresher CAS token.
    setConfig((prev) => {
      if (!prev) return next.config;
      if (prev.revision === next.revision) {
        return {
          ...prev,
          ...next.config,
          repositories: next.config.repositories,
        };
      }
      return next.config;
    });
    setLoadState("ready");
    setStale(false);
    setConflict(false);
  }, []);

  const clearCredentialTransient = useCallback(() => {
    setAppIdDraft("");
    setWebhookSecretDraft("");
    setPrivateKeyPemDraft("");
    setPrivateKeyFile(null);
    if (privateKeyFileInputRef.current) {
      privateKeyFileInputRef.current.value = "";
    }
  }, []);

  const setPrivateKeyInputMode = useCallback(
    (mode: PrivateKeyInputMode) => {
      setPrivateKeyMode(mode);
      // Mutual exclusion: switching input mode clears the other transient value.
      if (mode === "paste") {
        setPrivateKeyFile(null);
        if (privateKeyFileInputRef.current) {
          privateKeyFileInputRef.current.value = "";
        }
      } else {
        setPrivateKeyPemDraft("");
      }
    },
    [],
  );

  const applyCredentialStatus = useCallback(
    (next: AppCredentialProjection, generation: number) => {
      if (!mountedRef.current) return;
      if (generation !== credentialGenerationRef.current) return;
      setCredentialStatus(next);
      setStatus((prev) =>
        prev
          ? {
              ...prev,
              readiness: {
                ...prev.readiness,
                app: next,
              },
            }
          : prev,
      );
    },
    [],
  );

  const fetchCredentials = useCallback(
    async (options?: { silent?: boolean }) => {
      const generation = ++credentialGenerationRef.current;
      credentialAbortRef.current?.abort();
      const controller = new AbortController();
      credentialAbortRef.current = controller;

      try {
        const res = await fetch("/api/github-automation/credentials", {
          method: "GET",
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        const data = (await res.json().catch(() => null)) as {
          ok?: boolean;
          status?: AppCredentialProjection;
          code?: string;
          message?: string;
        } | null;

        if (generation !== credentialGenerationRef.current) return null;

        if (!res.ok || !data?.ok || !data.status) {
          if (!options?.silent) {
            setCredentialError(
              allowlistedMessage(data?.code, "无法读取本机凭据状态"),
            );
          }
          return null;
        }

        applyCredentialStatus(data.status, generation);
        if (!options?.silent) setCredentialError(null);
        return data.status;
      } catch (err) {
        if (isAbortError(err)) return null;
        if (generation !== credentialGenerationRef.current) return null;
        if (!options?.silent) {
          setCredentialError("无法读取本机凭据状态");
        }
        return null;
      }
    },
    [applyCredentialStatus],
  );

  const fetchConfig = useCallback(async (generation: number, signal: AbortSignal) => {
    const res = await fetch("/api/github-automation/config", {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal,
    });
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      config?: ConfigSafeProjection;
      projectChoices?: ProjectChoice[];
      code?: string;
      message?: string;
    } | null;
    if (!res.ok || !data?.ok || !data.config) {
      throw new Error(allowlistedMessage(data?.code, "无法读取配置"));
    }
    applyConfigBundle(data.config, data.projectChoices ?? [], generation);
    return data.config;
  }, [applyConfigBundle]);

  const fetchStatus = useCallback(
    async (options?: { silent?: boolean; reason?: string }) => {
      const generation = ++fetchGenerationRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (!options?.silent) {
        setRefreshing(true);
      }

      try {
        // Parallel safe reads; neither enqueues work.
        const [statusRes] = await Promise.all([
          fetch("/api/github-automation/status", {
            method: "GET",
            cache: "no-store",
            headers: { Accept: "application/json" },
            signal: controller.signal,
          }),
          fetchConfig(generation, controller.signal).catch(() => null),
        ]);

        const data = (await statusRes.json().catch(() => null)) as {
          ok?: boolean;
          status?: StatusProjection;
          code?: string;
          message?: string;
        } | null;

        if (generation !== fetchGenerationRef.current) return;

        if (!statusRes.ok || !data?.ok || !data.status) {
          if (status) {
            setStale(true);
            setLoadState("error");
            setActionNotice({
              tone: "error",
              title: "无法刷新自动化状态",
              message: allowlistedMessage(data?.code, "状态可能已过期；mutation 已暂时禁用。"),
            });
          } else {
            setLoadState("error");
            setStatus(null);
          }
          return;
        }

        applyStatus(data.status, generation);
        if (options?.reason === "manual") {
          setActionNotice({
            tone: "success",
            title: "状态已刷新",
            message: "仅刷新安全 projection；不会启动 scheduler 或 enqueue job。",
          });
        }
      } catch (err) {
        if (isAbortError(err)) return;
        if (generation !== fetchGenerationRef.current) return;
        if (status) {
          setStale(true);
          setLoadState("error");
        } else {
          setLoadState("error");
        }
      } finally {
        if (generation === fetchGenerationRef.current && mountedRef.current) {
          setRefreshing(false);
        }
      }
    },
    [applyStatus, fetchConfig, status],
  );

  useEffect(() => {
    mountedRef.current = true;
    void fetchStatus();
    void fetchCredentials({ silent: true });
    return () => {
      mountedRef.current = false;
      fetchGenerationRef.current += 1;
      credentialGenerationRef.current += 1;
      abortRef.current?.abort();
      credentialAbortRef.current?.abort();
      clearPoll();
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      // Never leave secret/PEM/File objects in component state after unmount.
      clearCredentialTransient();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only bootstrap
  }, []);

  useEffect(() => {
    clearPoll();
    if (loadState !== "ready" || !status || stale || conflict) return;
    if (typeof document !== "undefined" && document.hidden) return;

    const counts = status.runtime.counts;
    const hasLive =
      counts.queued > 0 || counts.running > 0 || counts.retry > 0 || counts.paused > 0;
    if (!hasLive) return;

    pollTimerRef.current = setTimeout(() => {
      void fetchStatus({ silent: true, reason: "poll" });
    }, POLL_INTERVAL_MS);

    return clearPoll;
  }, [clearPoll, conflict, fetchStatus, loadState, stale, status]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        clearPoll();
        abortRef.current?.abort();
        return;
      }
      if (status && !stale) {
        void fetchStatus({ silent: true, reason: "visibility" });
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [clearPoll, fetchStatus, stale, status]);

  const flashSaved = useCallback(() => {
    setSavedFlash(true);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => {
      if (mountedRef.current) setSavedFlash(false);
    }, SAVED_FLASH_MS);
  }, []);

  const revision = config?.revision ?? status?.revision ?? null;

  const patchConfig = useCallback(
    async (patch: {
      mode?: AutomationMode;
      enabled?: boolean;
      paused?: boolean;
      unattended?: { enabled?: boolean };
      repositories?: Array<{
        repositoryId: number;
        fullName: string;
        installationId: number | null;
        projectId: string | null;
        ownerActorIds: number[];
        baseRef: string;
      }>;
    }): Promise<ConfigSafeProjection | null> => {
      if (!revision) return null;
      setSaving(true);
      setSaveError(null);
      setActionNotice(null);

      const body = {
        revision,
        ...patch,
      };

      try {
        const res = await fetch("/api/github-automation/config", {
          method: "PATCH",
          cache: "no-store",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
        const data = (await res.json().catch(() => null)) as {
          ok?: boolean;
          code?: string;
          message?: string;
          config?: ConfigSafeProjection;
          details?: { reason?: string } | null;
        } | null;

        if (
          res.status === 409 ||
          data?.code === "revision_conflict" ||
          data?.code === "stale_revision"
        ) {
          setConflict(true);
          setSaveError(null);
          setActionNotice({
            tone: "warning",
            title: "配置已被其他操作者更新（revision conflict）",
            message: "当前草稿未保存。请重新读取服务端配置后再试。",
          });
          prompt.toast({
            message: "Revision conflict：请重新读取",
            tone: "error",
          });
          return null;
        }

        if (!res.ok || !data?.ok || !data.config) {
          const msg = allowlistedMessage(data?.code, data?.message || "更改未保存");
          setSaveError(msg);
          prompt.toast({ message: msg, tone: "error" });
          return null;
        }

        setConfig(data.config);
        setStatus((prev) =>
          prev
            ? {
                ...prev,
                revision: data.config!.revision,
                config: data.config!,
                runtime: {
                  ...prev.runtime,
                  enabled: data.config!.enabled,
                  mode: data.config!.mode,
                  paused: data.config!.paused,
                },
                policy: {
                  ...prev.policy,
                  unattendedEnabled: data.config!.unattended.enabled,
                },
                readiness: {
                  ...prev.readiness,
                  allowlist: {
                    repositoryCount: data.config!.repositories.length,
                    ready: data.config!.repositories.length > 0,
                  },
                },
              }
            : prev,
        );
        flashSaved();
        setConflict(false);
        setSaveError(null);
        prompt.toast({ message: "已保存", tone: "success" });
        void fetchStatus({ silent: true, reason: "after-patch" });
        return data.config;
      } catch {
        setSaveError("网络错误，更改未保存");
        prompt.toast({ message: "网络错误，更改未保存", tone: "error" });
        return null;
      } finally {
        if (mountedRef.current) setSaving(false);
      }
    },
    [fetchStatus, flashSaved, prompt, revision],
  );

  const onSaveCredentials = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (credentialSaving || credentialDeleting) return;

      const generation = ++credentialGenerationRef.current;
      setCredentialSaving(true);
      setCredentialError(null);
      setCredentialNotice(null);

      const formData = new FormData();
      const appId = appIdDraft.trim();
      const webhookSecret = webhookSecretDraft; // do not trim interior; only skip blank
      if (appId) formData.set("appId", appId);
      if (webhookSecret.trim().length > 0) formData.set("webhookSecret", webhookSecret);

      if (privateKeyMode === "paste") {
        const pem = privateKeyPemDraft;
        if (pem.trim().length > 0) formData.set("privateKeyPem", pem);
      } else if (privateKeyFile) {
        formData.set("privateKeyFile", privateKeyFile, privateKeyFile.name || "app.pem");
      }

      try {
        const res = await fetch("/api/github-automation/credentials", {
          method: "PUT",
          cache: "no-store",
          headers: { Accept: "application/json" },
          body: formData,
        });
        const data = (await res.json().catch(() => null)) as {
          ok?: boolean;
          status?: AppCredentialProjection;
          code?: string;
          message?: string;
        } | null;

        if (generation !== credentialGenerationRef.current || !mountedRef.current) return;

        if (!res.ok || !data?.ok || !data.status) {
          // Keep transient inputs so the user can fix validation errors.
          // Never put submitted secret/PEM content into toast or notice.
          const msg = allowlistedMessage(
            data?.code,
            "保存本机凭据失败，服务端配置未更新",
          );
          setCredentialError(msg);
          setCredentialNotice({
            tone: "error",
            title: "保存失败，服务端配置未更新",
            message: msg,
          });
          prompt.toast({ message: msg, tone: "error" });
          return;
        }

        applyCredentialStatus(data.status, generation);
        clearCredentialTransient();
        setCredentialError(null);
        const envOverride =
          data.status.sources &&
          (data.status.sources.appId === "env" ||
            data.status.sources.key === "env" ||
            data.status.sources.webhook === "env");
        setCredentialNotice({
          tone: "success",
          title: "本机凭据已保存",
          message: envOverride
            ? "本机 fallback 已更新。当前进程仍优先使用环境变量覆盖的字段。"
            : "已写入本机 agent data dir。重启 ypi 后仍可用；临时输入已清空。",
        });
        prompt.toast({ message: "本机凭据已保存", tone: "success" });
        void fetchStatus({ silent: true, reason: "after-credentials" });
        // Refresh checklist from verify without enqueue.
        void (async () => {
          try {
            const verifyRes = await fetch("/api/github-automation/verify", {
              method: "POST",
              cache: "no-store",
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
              },
              body: "{}",
            });
            const verifyData = (await verifyRes.json().catch(() => null)) as
              | VerifyResult
              | null;
            if (
              mountedRef.current &&
              generation === credentialGenerationRef.current &&
              verifyData &&
              verifyData.ok === true &&
              Array.isArray(verifyData.checklist)
            ) {
              setChecklist([...verifyData.checklist].sort((a, b) => a.order - b.order));
              setVerifySummary(verifyData.summary);
            }
          } catch {
            /* verify refresh is best-effort */
          }
        })();
      } catch {
        if (generation !== credentialGenerationRef.current || !mountedRef.current) return;
        const msg = "网络错误，本机凭据未保存";
        setCredentialError(msg);
        setCredentialNotice({
          tone: "error",
          title: "保存失败，服务端配置未更新",
          message: msg,
        });
        prompt.toast({ message: msg, tone: "error" });
      } finally {
        if (generation === credentialGenerationRef.current && mountedRef.current) {
          setCredentialSaving(false);
        }
      }
    },
    [
      applyCredentialStatus,
      appIdDraft,
      clearCredentialTransient,
      credentialDeleting,
      credentialSaving,
      fetchStatus,
      privateKeyFile,
      privateKeyMode,
      privateKeyPemDraft,
      prompt,
      webhookSecretDraft,
    ],
  );

  const onDeleteLocalCredentials = useCallback(async () => {
    if (credentialSaving || credentialDeleting) return;

    const ok = await prompt.confirm({
      title: "移除本机凭据？",
      message:
        "只删除本机保存的 GitHub App 凭据。不会删除 GitHub App、installation、允许仓库、jobs，也不会修改环境变量。若 env 仍存在，当前进程可能继续显示已配置。",
      confirmLabel: "确认移除",
      intent: "danger",
    });
    if (!ok) return;

    const generation = ++credentialGenerationRef.current;
    setCredentialDeleting(true);
    setCredentialError(null);
    setCredentialNotice(null);

    try {
      const res = await fetch("/api/github-automation/credentials", {
        method: "DELETE",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ confirm: CREDENTIALS_DELETE_CONFIRM }),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        status?: AppCredentialProjection;
        code?: string;
        message?: string;
      } | null;

      if (generation !== credentialGenerationRef.current || !mountedRef.current) return;

      if (!res.ok || !data?.ok || !data.status) {
        const msg = allowlistedMessage(data?.code, "移除本机凭据失败");
        setCredentialError(msg);
        setCredentialNotice({
          tone: "error",
          title: "移除失败",
          message: msg,
        });
        prompt.toast({ message: msg, tone: "error" });
        return;
      }

      applyCredentialStatus(data.status, generation);
      clearCredentialTransient();
      setCredentialError(null);

      const stillConfigured = data.status.configured;
      setCredentialNotice({
        tone: stillConfigured ? "info" : "success",
        title: stillConfigured ? "本机凭据已移除（env 仍生效）" : "本机凭据已移除",
        message: stillConfigured
          ? "本机 fallback 已删除。当前进程仍由环境变量提供有效凭据。"
          : "本机 fallback 已删除。在重新配置前 automation 将保持 fail closed。",
      });
      prompt.toast({
        message: stillConfigured ? "本机凭据已移除（env 仍生效）" : "本机凭据已移除",
        tone: "success",
      });
      void fetchStatus({ silent: true, reason: "after-credentials-delete" });
    } catch {
      if (generation !== credentialGenerationRef.current || !mountedRef.current) return;
      const msg = "网络错误，本机凭据未移除";
      setCredentialError(msg);
      setCredentialNotice({
        tone: "error",
        title: "移除失败",
        message: msg,
      });
      prompt.toast({ message: msg, tone: "error" });
    } finally {
      if (generation === credentialGenerationRef.current && mountedRef.current) {
        setCredentialDeleting(false);
      }
    }
  }, [
    applyCredentialStatus,
    clearCredentialTransient,
    credentialDeleting,
    credentialSaving,
    fetchStatus,
    prompt,
  ]);

  const onVerify = useCallback(async () => {
    setVerifying(true);
    setActionNotice(null);
    try {
      const res = await fetch("/api/github-automation/verify", {
        method: "POST",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      const data = (await res.json().catch(() => null)) as
        | (VerifyResult & { ok?: boolean; code?: string; message?: string })
        | { ok?: false; code?: string; message?: string; checklist?: never }
        | null;

      if (!res.ok || !data || data.ok !== true || !Array.isArray((data as VerifyResult).checklist)) {
        const msg = allowlistedMessage(
          data && "code" in data ? data.code : undefined,
          "验证失败，请稍后重试",
        );
        setActionNotice({
          tone: "error",
          title: "验证配置失败",
          message: msg,
        });
        prompt.toast({ message: msg, tone: "error" });
        return;
      }

      const verified = data as VerifyResult;
      setChecklist(
        [...verified.checklist].sort((a, b) => a.order - b.order),
      );
      setVerifySummary(verified.summary);
      if (verified.summary?.app) {
        const generation = ++credentialGenerationRef.current;
        applyCredentialStatus(verified.summary.app, generation);
      }
      setActionNotice({
        tone: verified.allReady ? "success" : "warning",
        title: verified.allReady
          ? "配置验证通过"
          : verified.p0Ready
            ? "Triage 条件基本就绪，仍有待办"
            : "配置尚未就绪",
        message: verified.allReady
          ? "固定 readiness 检查已通过；未启动 scheduler，也未创建 job。"
          : "请按 checklist 中的下一步完成缺失项后再次验证。验证不会写入 secret 或启动任务。",
      });
      // Refresh status projection after verify (still no enqueue).
      void fetchStatus({ silent: true, reason: "after-verify" });
    } catch {
      setActionNotice({
        tone: "error",
        title: "验证配置失败",
        message: "网络错误，请稍后重试",
      });
      prompt.toast({ message: "网络错误", tone: "error" });
    } finally {
      if (mountedRef.current) setVerifying(false);
    }
  }, [applyCredentialStatus, fetchStatus, prompt]);

  const openAddForm = useCallback(() => {
    setFormMode({ kind: "add" });
    setDraft(emptyDraft());
    setFormError(null);
    requestAnimationFrame(() => {
      formSectionRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      formSectionRef.current?.querySelector<HTMLElement>("input,select,button")?.focus();
    });
  }, []);

  const openEditForm = useCallback((repo: RepositorySafeProjection) => {
    setFormMode({ kind: "edit", repositoryId: repo.repositoryId });
    setDraft(draftFromRepo(repo));
    setFormError(null);
    requestAnimationFrame(() => {
      formSectionRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      formSectionRef.current?.querySelector<HTMLElement>("input,select,button")?.focus();
    });
  }, []);

  const closeForm = useCallback(() => {
    setFormMode({ kind: "closed" });
    setDraft(emptyDraft());
    setFormError(null);
  }, []);

  const repositoriesForEdit = useMemo(() => {
    if (config?.repositories) return config.repositories;
    if (status?.config?.repositories) return status.config.repositories;
    return [] as RepositorySafeProjection[];
  }, [config, status]);

  const onSaveRepository = useCallback(async () => {
    if (!revision) return;
    const fullName = draft.fullName.trim();
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) {
      setFormError("请填写合法的 owner/repo，例如 acme/docs-site");
      return;
    }
    if (!/^\d+$/.test(draft.repositoryId.trim())) {
      setFormError("请填写 GitHub immutable repository id（正整数）");
      return;
    }
    const repositoryId = Number(draft.repositoryId.trim());
    if (!Number.isSafeInteger(repositoryId) || repositoryId <= 0) {
      setFormError("repository id 无效");
      return;
    }
    if (!/^\d+$/.test(draft.installationId.trim())) {
      setFormError("请填写 GitHub App installation id（正整数）");
      return;
    }
    const installationId = Number(draft.installationId.trim());
    if (!Number.isSafeInteger(installationId) || installationId <= 0) {
      setFormError("installation id 无效");
      return;
    }
    const baseRef = draft.baseRef.trim() || "main";
    if (!draft.projectId.trim()) {
      setFormError("请选择已注册的 Project Registry 项目");
      return;
    }
    const ownerActorIds = parseOwnerActorIds(draft.ownerActorIds);
    if (ownerActorIds === null) {
      setFormError("owner actor ids 需为逗号分隔的正整数（可留空）");
      return;
    }

    const selected = projectChoices.find((p) => p.projectId === draft.projectId.trim());
    if (!selected) {
      setFormError("未知项目，请从 Project Registry 列表中选择");
      return;
    }
    if (selected.archived || selected.missing || selected.pathStatus !== "ok") {
      setFormError("所选项目不可用（已归档或本机路径缺失）");
      return;
    }

    // Full-list replacement: keep other repos, upsert this one.
    const nextList = repositoriesForEdit
      .filter((repo) => {
        if (formMode.kind === "edit") {
          return repo.repositoryId !== formMode.repositoryId;
        }
        return repo.repositoryId !== repositoryId;
      })
      .map(repoToWireDraft);

    // Reject duplicate fullName against remaining list.
    if (nextList.some((repo) => repo.fullName.toLowerCase() === fullName.toLowerCase())) {
      setFormError("allowlist 中已存在相同 owner/repo");
      return;
    }
    if (nextList.some((repo) => repo.repositoryId === repositoryId)) {
      setFormError("allowlist 中已存在相同 repository id");
      return;
    }

    nextList.push({
      repositoryId,
      fullName,
      installationId,
      projectId: draft.projectId.trim(),
      ownerActorIds,
      baseRef,
    });

    setRepoSaving(true);
    setFormError(null);
    const saved = await patchConfig({ repositories: nextList });
    setRepoSaving(false);
    if (saved) {
      closeForm();
      setActionNotice({
        tone: "success",
        title: formMode.kind === "edit" ? "仓库关联已更新" : "仓库已关联",
        message:
          "服务器已核验 repository id/name，并完成 Project Registry 绑定。浏览器不会收到本地绝对路径。",
      });
    } else if (!conflict) {
      setFormError(saveError ?? "保存失败，请检查 installation / repository id");
    }
  }, [
    closeForm,
    conflict,
    draft,
    formMode,
    patchConfig,
    projectChoices,
    repositoriesForEdit,
    revision,
    saveError,
  ]);

  const onDeleteRepository = useCallback(
    async (repo: RepositorySafeProjection) => {
      if (!revision) return;
      const blocking = (status?.jobs ?? []).filter(
        (job) => job.repositoryId === repo.repositoryId && jobBlocksRepositoryDelete(job),
      );
      if (blocking.length > 0) {
        setActionNotice({
          tone: "warning",
          title: "无法删除该仓库关联",
          message: `仓库 ${repo.fullName} 仍有运行中/排队/暂停的 job（${blocking.length}）。请先完成或暂停处理后再移除 allowlist。`,
        });
        return;
      }

      const ok = await prompt.confirm({
        title: "移除允许仓库？",
        message: `将从 allowlist 移除 ${repo.fullName}（repository id ${repo.repositoryId}）。不会删除 GitHub 仓库或本地 Project Registry 项目。`,
        confirmLabel: "确认移除",
        intent: "danger",
      });
      if (!ok) return;

      const nextList = repositoriesForEdit
        .filter((item) => item.repositoryId !== repo.repositoryId)
        .map(repoToWireDraft);
      const saved = await patchConfig({ repositories: nextList });
      if (saved) {
        if (formMode.kind === "edit" && formMode.repositoryId === repo.repositoryId) {
          closeForm();
        }
        setActionNotice({
          tone: "success",
          title: "已移除仓库关联",
          message: `${repo.fullName} 已从 allowlist 删除。`,
        });
      }
    },
    [
      closeForm,
      formMode,
      patchConfig,
      prompt,
      repositoriesForEdit,
      revision,
      status?.jobs,
    ],
  );

  const onSelectMode = useCallback(
    async (nextMode: AutomationMode) => {
      if (!status || stale || saving || loadState === "loading") return;

      const currentMode: AutomationMode =
        !status.runtime.enabled || status.runtime.mode === "off"
          ? "off"
          : status.runtime.mode;
      if (nextMode === currentMode) return;

      if (nextMode === "unattended") {
        const gate = unattendedAvailable(status);
        if (!gate.ok) {
          setActionNotice({
            tone: "warning",
            title: "无法启用低风险无人值守",
            message: gate.reason ?? "条件未满足",
          });
          return;
        }
      }

      if (nextMode === "off") {
        const ok = await prompt.confirm({
          title: "确认切换运行模式",
          message: "将关闭新 job 创建。",
          confirmLabel: "确认关闭",
          intent: "danger",
        });
        if (!ok) return;
        await patchConfig({ mode: "off", enabled: false });
        setActionNotice({
          tone: "info",
          title: "自动化已关闭",
          message: "Webhook 仍会验签并记录 paused/ignored；不会删除 job 或中断已执行 Git 命令。",
        });
        return;
      }

      if (nextMode === "triage") {
        if (
          !status.readiness.app.configured ||
          status.readiness.installation.readiness === "missing" ||
          status.repositories.length === 0
        ) {
          setActionNotice({
            tone: "warning",
            title: "无法启用仅 Triage",
            message: "需要已配置的 GitHub App、安装，以及至少一个已关联的允许仓库。",
          });
          return;
        }
        const ok = await prompt.confirm({
          title: "确认切换运行模式",
          message:
            "将立即保存「仅 Triage」。owner 采纳只会记录等待自动化，不创建 WorkTree 或 PR。",
          confirmLabel: "确认",
        });
        if (!ok) return;
        await patchConfig({ mode: "triage", enabled: true });
        return;
      }

      const ok = await prompt.confirm({
        title: "确认切换运行模式",
        message:
          "将启用「低风险无人值守」：仅文档 + 小 bugfix 可进入；将启动 full agent，其任意命令、网络、宿主文件访问风险不会被 WorkTree 或 diff gate 消除。",
        confirmLabel: "确认启用",
        intent: "danger",
      });
      if (!ok) return;
      await patchConfig({
        mode: "unattended",
        enabled: true,
        unattended: { enabled: true },
      });
    },
    [loadState, patchConfig, prompt, saving, stale, status],
  );

  const onToggleGlobalPause = useCallback(async () => {
    if (!status || stale || saving) return;
    if (status.runtime.mode === "off" || !status.runtime.enabled) return;

    if (!status.runtime.paused) {
      const ok = await prompt.confirm({
        title: "暂停新任务？",
        message:
          "暂停会保留当前运行模式并阻止新 job 开始。正在执行的 Git 命令不会被强杀，会在下一个安全 checkpoint 停住。",
        confirmLabel: "确认暂停",
      });
      if (!ok) return;
      await patchConfig({ paused: true });
      return;
    }

    const ok = await prompt.confirm({
      title: "恢复接收新任务？",
      message:
        "会恢复按当前模式接收后续已验证 delivery。已暂停的 job 仍需按自身状态和 policy gate 决定是否继续。",
      confirmLabel: "确认恢复",
    });
    if (!ok) return;
    await patchConfig({ paused: false });
  }, [patchConfig, prompt, saving, stale, status]);

  const runJobAction = useCallback(
    async (job: JobSafeProjection, action: "retry" | "pause" | "resume") => {
      if (stale || saving) return;
      const gate = jobActionAvailability(job, action);
      if (!gate.available) {
        setActionNotice({
          tone: "warning",
          title: "操作不可用",
          message: gate.reasonCode
            ? `原因：${gate.reasonCode}`
            : "当前 phase 不允许该操作",
        });
        return;
      }

      const target = `#${job.issueNumber} · ${job.traceId}`;
      let confirmed = false;
      if (action === "retry") {
        confirmed = await prompt.confirm({
          title: "重试此 job？",
          message: `目标：${target}。会重新唤醒同一 durable job。已确认的 label/comment/worktree/PR 会先 reconciliation，不会保证重新创建。`,
          confirmLabel: "确认重试",
        });
      } else if (action === "pause") {
        confirmed = await prompt.confirm({
          title: "暂停此 job？",
          message: `目标：${target}。暂停请求会在安全 checkpoint 生效；不会强杀执行中的 Git 命令。`,
          confirmLabel: "确认暂停",
        });
      } else {
        confirmed = await prompt.confirm({
          title: "恢复此 job？",
          message: `目标：${target}。确认后重新入队到下一个安全 checkpoint。`,
          confirmLabel: "确认恢复",
        });
      }
      if (!confirmed) return;

      setBusyJobId(job.jobId);
      setBusyAction(action);
      setActionNotice(null);

      try {
        const res = await fetch(
          `/api/github-automation/jobs/${encodeURIComponent(job.jobId)}`,
          {
            method: "POST",
            cache: "no-store",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ action }),
          },
        );
        const data = (await res.json().catch(() => null)) as {
          ok?: boolean;
          code?: string;
          message?: string;
          job?: JobSafeProjection;
          partial?: boolean;
        } | null;

        if (!res.ok || !data?.ok) {
          const msg = allowlistedMessage(data?.code, "操作失败");
          setActionNotice({
            tone: "error",
            title: "操作失败",
            message: msg,
          });
          prompt.toast({ message: msg, tone: "error" });
          return;
        }

        if (data.job) {
          setStatus((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              jobs: prev.jobs.map((j) => (j.jobId === data.job!.jobId ? data.job! : j)),
            };
          });
        }

        if (data.partial) {
          setActionNotice({
            tone: "warning",
            title: "操作已受理，状态待刷新",
            message: data.message || "请手动刷新以确认最新 phase。",
          });
          prompt.toast({ message: "操作已受理，状态待刷新", tone: "info" });
        } else {
          setActionNotice({
            tone: "success",
            title: "操作成功",
            message: data.message || "状态已更新",
          });
          prompt.toast({ message: "操作成功", tone: "success" });
        }

        void fetchStatus({ silent: true, reason: "after-action" });
      } catch {
        setActionNotice({
          tone: "error",
          title: "操作失败",
          message: "网络错误，请稍后重试",
        });
        prompt.toast({ message: "网络错误", tone: "error" });
      } finally {
        if (mountedRef.current) {
          setBusyJobId(null);
          setBusyAction(null);
        }
      }
    },
    [fetchStatus, prompt, saving, stale],
  );

  const banner = useMemo(
    () =>
      primaryBanner(status, {
        loadState,
        stale,
        conflict,
        saveError,
        actionNotice,
      }),
    [actionNotice, conflict, loadState, saveError, stale, status],
  );

  const mode: AutomationMode = status
    ? !status.runtime.enabled || status.runtime.mode === "off"
      ? "off"
      : status.runtime.mode
    : "off";
  const paused = status?.runtime.paused ?? false;
  const unattendedGate = status ? unattendedAvailable(status) : { ok: false, reason: "尚未加载" };
  const canMutate = Boolean(status) && !stale && !conflict && !saving && !repoSaving && loadState !== "loading";
  const triageDisabled =
    !status ||
    stale ||
    conflict ||
    saving ||
    !status.readiness.app.configured ||
    status.readiness.installation.readiness === "missing" ||
    status.repositories.length === 0;
  const unattendedDisabled = !canMutate || !unattendedGate.ok;

  const assignee = status?.readiness.assignee;
  const residualSummary =
    status?.policy.residualRiskSummary ||
    status?.runtime.residualRiskSummary ||
    "Full agent 不是沙箱：可任意命令、联网和读取同 OS 用户可见文件；diff gate 只限制发布，无法撤销执行期副作用。";

  const selectableProjects = projectChoices.filter(
    (p) => !p.archived && !p.missing && p.pathStatus === "ok",
  );
  const repoCards = status?.repositories ?? [];
  const configRepos = repositoriesForEdit;

  const displayChecklist = checklist.length > 0 ? checklist : FALLBACK_CHECKLIST;

  const effectiveCredential = credentialStatus ?? status?.readiness.app ?? null;
  const localSummary = effectiveCredential?.local ?? null;
  const localPresent =
    Boolean(localSummary?.configured) ||
    Boolean(localSummary?.hasAppId) ||
    Boolean(localSummary?.hasKey) ||
    Boolean(localSummary?.hasWebhook) ||
    localSummary?.readiness === "invalid" ||
    localSummary?.readiness === "unsupported";
  const localInvalid =
    localSummary?.readiness === "invalid" || localSummary?.readiness === "unsupported";
  const credentialBusy = credentialSaving || credentialDeleting;
  const overallCredPill = overallCredentialPill(
    effectiveCredential,
    localSummary,
    credentialSaving,
  );
  const appIdSource = credentialSourceOf(effectiveCredential, "appId");
  const keySource = credentialSourceOf(effectiveCredential, "key");
  const webhookSource = credentialSourceOf(effectiveCredential, "webhook");
  const appIdConfigured = Boolean(effectiveCredential?.hasAppId);
  const keyConfigured = effectiveCredential ? hasEffectivePrivateKey(effectiveCredential) : false;
  const webhookConfigured = Boolean(effectiveCredential?.hasWebhookSecret);
  const anyEnvOverride =
    appIdSource === "env" || keySource === "env" || webhookSource === "env";
  const firstSaveRequired = !localPresent;

  return (
    <div className="github-automation-page" aria-labelledby={headingId}>
      <header className="github-automation-page-head">
        <div>
          <div className="github-automation-eyebrow">Repository automation</div>
          <h3 id={headingId} className="github-automation-title">
            GitHub 自动化
          </h3>
          <p className="github-automation-lead">
            先在本机安全保存你自己的 GitHub App 凭据，再安装 App、关联仓库并验证。关闭电脑或重启 ypi
            后仍然保留。与 Links 账号连接完全隔离；点右侧「帮助」查看完整配置步骤。
          </p>
        </div>
        <div className="github-automation-page-head-actions">
          <a
            className="github-automation-button github-automation-button--help"
            href={GITHUB_AUTOMATION_HELP_HREF}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="打开 GitHub 自动化配置帮助（新标签页）"
          >
            <span aria-hidden="true">?</span>
            帮助
          </a>
          <span className="github-automation-instant-badge" aria-label="即时保存">
            {savedFlash ? "已保存" : "即时保存 · 独立于全局设置"}
          </span>
        </div>
      </header>

      {banner ? (
        <div
          className={`github-automation-notice github-automation-notice--${banner.tone}`}
          role={banner.tone === "error" ? "alert" : "status"}
        >
          <span className="github-automation-notice__mark" aria-hidden="true">
            {banner.tone === "info" || banner.tone === "success" ? "i" : "!"}
          </span>
          <span>
            <strong>{banner.title}</strong>
            <br />
            {banner.message}
          </span>
        </div>
      ) : null}

      {credentialNotice ? (
        <div
          className={`github-automation-notice github-automation-notice--${credentialNotice.tone}`}
          role={credentialNotice.tone === "error" ? "alert" : "status"}
          id={credentialLiveRegionId}
        >
          <span className="github-automation-notice__mark" aria-hidden="true">
            {credentialNotice.tone === "info" || credentialNotice.tone === "success"
              ? "i"
              : "!"}
          </span>
          <span>
            <strong>{credentialNotice.title}</strong>
            <br />
            {credentialNotice.message}
          </span>
        </div>
      ) : null}

      {/* ── Local GitHub App credentials (primary, above checklist) ── */}
      <section
        className={`github-automation-card${credentialBusy ? " github-automation-card--busy" : ""}`}
        aria-label="本机 GitHub App 凭据"
        aria-busy={credentialBusy}
      >
        <div className="github-automation-card-head">
          <div>
            <h4 className="github-automation-card-title">本机 GitHub App 凭据</h4>
            <p className="github-automation-card-sub">
              只写入运行 ypi 的本机 agent data dir（目录 0700 / 文件 0600）。已保存的 secret 与私钥永不回显。
            </p>
          </div>
          <span
            className={`github-automation-pill github-automation-pill--${overallCredPill.tone}`}
          >
            {overallCredPill.label}
          </span>
        </div>
        <div className="github-automation-card-body">
          <div className="github-automation-cred-status-grid" aria-label="凭据状态">
            <div className="github-automation-cred-status-item">
              <small>App ID</small>
              <div className="github-automation-cred-status-line">
                <strong>
                  {fieldConfiguredLabel(appIdConfigured, {
                    unavailable: localInvalid && appIdSource !== "env" && !appIdConfigured,
                  })}
                </strong>
                <span
                  className={`github-automation-pill github-automation-pill--${sourcePillTone(appIdSource)}`}
                >
                  {sourceLabel(appIdSource)}
                </span>
              </div>
              <div className="github-automation-cred-source">
                来源：<b>{sourceDetailText(appIdSource, localInvalid)}</b>
              </div>
            </div>
            <div className="github-automation-cred-status-item">
              <small>Private key</small>
              <div className="github-automation-cred-status-line">
                <strong>
                  {fieldConfiguredLabel(keyConfigured, {
                    unavailable:
                      !keyConfigured &&
                      (effectiveCredential?.readiness === "private_key_invalid" ||
                        effectiveCredential?.readiness === "private_key_unreadable" ||
                        (localInvalid && keySource !== "env")),
                  })}
                </strong>
                <span
                  className={`github-automation-pill github-automation-pill--${sourcePillTone(keySource)}`}
                >
                  {sourceLabel(keySource)}
                </span>
              </div>
              <div className="github-automation-cred-source">
                来源：<b>{sourceDetailText(keySource, localInvalid)}</b>
              </div>
            </div>
            <div className="github-automation-cred-status-item">
              <small>Webhook secret</small>
              <div className="github-automation-cred-status-line">
                <strong>{fieldConfiguredLabel(webhookConfigured)}</strong>
                <span
                  className={`github-automation-pill github-automation-pill--${sourcePillTone(webhookSource)}`}
                >
                  {sourceLabel(webhookSource)}
                </span>
              </div>
              <div className="github-automation-cred-source">
                来源：<b>{sourceDetailText(webhookSource, localInvalid)}</b>
              </div>
            </div>
          </div>

          {anyEnvOverride ? (
            <div
              className="github-automation-notice github-automation-notice--info"
              role="note"
            >
              <span className="github-automation-notice__mark" aria-hidden="true">
                i
              </span>
              <span>
                当前进程优先使用环境变量覆盖的字段。下方保存只更新本机 fallback；移除 env
                后自动回落。请确保 env 与本机 fallback 属于同一个 GitHub App。
              </span>
            </div>
          ) : null}

          {localInvalid ? (
            <div
              className="github-automation-notice github-automation-notice--error"
              role="alert"
            >
              <span className="github-automation-notice__mark" aria-hidden="true">
                !
              </span>
              <span>
                <strong>本机凭据不可用</strong>
                <br />
                metadata、私钥文件或指纹不一致。系统已 fail closed；请移除损坏的本机凭据后重新提交完整三项。不会显示损坏内容。
              </span>
            </div>
          ) : null}

          <form
            className="github-automation-cred-form"
            onSubmit={(event) => void onSaveCredentials(event)}
            aria-describedby={credentialError ? credentialLiveRegionId : undefined}
          >
            <div className="github-automation-form-grid">
              <label className="github-automation-field" htmlFor={credentialAppIdFieldId}>
                App ID
                <input
                  id={credentialAppIdFieldId}
                  name="appId"
                  inputMode="numeric"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={credentialBusy}
                  value={appIdDraft}
                  onChange={(event) => setAppIdDraft(event.target.value)}
                  placeholder={
                    appIdConfigured || localPresent
                      ? "留空则保留已配置 App ID"
                      : "例如 123456"
                  }
                />
                <span className="github-automation-field-hint">
                  在 GitHub App 设置页查看数字 App ID。已配置时不回显原值。
                </span>
              </label>

              <label className="github-automation-field" htmlFor={credentialWebhookFieldId}>
                Webhook secret
                <input
                  id={credentialWebhookFieldId}
                  name="webhookSecret"
                  type="password"
                  autoComplete="new-password"
                  disabled={credentialBusy}
                  value={webhookSecretDraft}
                  onChange={(event) => setWebhookSecretDraft(event.target.value)}
                  placeholder={
                    webhookConfigured || localPresent
                      ? "留空则保留已配置 secret"
                      : "输入你在 GitHub App 中设置的 secret"
                  }
                />
                <span className="github-automation-field-hint">
                  保存后清空；不会显示历史值或 masked 片段。
                </span>
              </label>

              <div className="github-automation-field github-automation-field--full">
                <span id={`${credentialPemFieldId}-label`}>Private key PEM</span>
                <div
                  className="github-automation-cred-seg"
                  role="group"
                  aria-labelledby={`${credentialPemFieldId}-label`}
                >
                  <button
                    type="button"
                    className={
                      privateKeyMode === "paste"
                        ? "github-automation-cred-seg-btn is-selected"
                        : "github-automation-cred-seg-btn"
                    }
                    aria-pressed={privateKeyMode === "paste"}
                    disabled={credentialBusy}
                    onClick={() => setPrivateKeyInputMode("paste")}
                  >
                    粘贴 PEM
                  </button>
                  <button
                    type="button"
                    className={
                      privateKeyMode === "file"
                        ? "github-automation-cred-seg-btn is-selected"
                        : "github-automation-cred-seg-btn"
                    }
                    aria-pressed={privateKeyMode === "file"}
                    disabled={credentialBusy}
                    onClick={() => setPrivateKeyInputMode("file")}
                  >
                    选择本机文件
                  </button>
                </div>
              </div>

              {privateKeyMode === "paste" ? (
                <label
                  className="github-automation-field github-automation-field--full"
                  htmlFor={credentialPemFieldId}
                >
                  粘贴本次私钥
                  <textarea
                    id={credentialPemFieldId}
                    name="privateKeyPem"
                    className="github-automation-cred-pem"
                    spellCheck={false}
                    autoComplete="off"
                    disabled={credentialBusy}
                    value={privateKeyPemDraft}
                    onChange={(event) => setPrivateKeyPemDraft(event.target.value)}
                    placeholder={
                      keyConfigured || localPresent
                        ? "留空则保留已配置 private key"
                        : "-----BEGIN RSA PRIVATE KEY-----\n…\n-----END RSA PRIVATE KEY-----"
                    }
                    rows={6}
                  />
                  <span className="github-automation-field-hint">
                    仅本次输入；保存成功、离开页面或切换方式后清空。不会下载或回显已保存 PEM。
                  </span>
                </label>
              ) : (
                <label
                  className="github-automation-field github-automation-field--full"
                  htmlFor={credentialFileFieldId}
                >
                  选择 GitHub App .pem 文件
                  <div className="github-automation-cred-filebox">
                    <input
                      id={credentialFileFieldId}
                      ref={privateKeyFileInputRef}
                      name="privateKeyFile"
                      type="file"
                      accept=".pem,text/plain,application/x-pem-file"
                      disabled={credentialBusy}
                      onChange={(event) => {
                        const file = event.target.files?.[0] ?? null;
                        setPrivateKeyFile(file);
                        setPrivateKeyPemDraft("");
                      }}
                    />
                    <p>
                      {privateKeyFile
                        ? "已选择文件（仅本次提交；文件名与原路径不会保存）。"
                        : "文件内容直接提交给本机 ypi 服务端；文件名和原路径不会保存。"}
                    </p>
                  </div>
                  <span className="github-automation-field-hint">
                    不接受服务端绝对路径。已保存私钥不可下载或恢复到输入框。
                  </span>
                </label>
              )}
            </div>

            <div className="github-automation-cred-form-actions">
              <span className="github-automation-field-hint">
                {firstSaveRequired
                  ? "首次保存需要三项完整；以后留空表示保留已配置值。"
                  : "轮换时只填写变更项；空白字段保留已保存本机值，不会从 env 导入。"}
              </span>
              <div className="github-automation-cred-form-actions-right">
                {localPresent ? (
                  <button
                    type="button"
                    className="github-automation-button github-automation-button--danger"
                    disabled={credentialBusy}
                    onClick={() => void onDeleteLocalCredentials()}
                  >
                    {credentialDeleting ? "移除中…" : "移除本机凭据"}
                  </button>
                ) : null}
                <button
                  type="submit"
                  className="github-automation-button github-automation-button--primary"
                  disabled={credentialBusy}
                  aria-busy={credentialSaving}
                >
                  {credentialSaving ? "保存中…" : "保存到本机"}
                </button>
              </div>
            </div>

            {credentialError ? (
              <p className="github-automation-cred-error" role="alert">
                {credentialError}
              </p>
            ) : null}
          </form>
        </div>
      </section>

      {/* ── Setup checklist (above status / jobs) ── */}
      <section className="github-automation-card" aria-label="Setup checklist">
        <div className="github-automation-card-head">
          <div>
            <h4 className="github-automation-card-title">Setup checklist</h4>
            <p className="github-automation-card-sub">
              缺失项提供操作步骤；「验证配置」只读取安全状态，不会启动 job 或 enqueue 任务。
            </p>
          </div>
          <button
            type="button"
            className="github-automation-button github-automation-button--primary"
            disabled={verifying || loadState === "loading"}
            aria-busy={verifying}
            onClick={() => void onVerify()}
          >
            {verifying ? "验证中…" : "验证配置"}
          </button>
        </div>
        <div className="github-automation-card-body">
          <div className="github-automation-check" role="list">
            {displayChecklist.map((item) => {
              const pill = checklistStateLabel(item.state);
              return (
                <div className="github-automation-check-row" role="listitem" key={item.code}>
                  <span
                    className={`github-automation-check-index github-automation-check-index--${pill.tone}`}
                    aria-hidden="true"
                  >
                    {item.order}
                  </span>
                  <div className="github-automation-check-body">
                    <div className="github-automation-check-title-row">
                      <strong>{item.title}</strong>
                      <span className={`github-automation-pill github-automation-pill--${pill.tone}`}>
                        {pill.label}
                      </span>
                    </div>
                    {item.nextStep ? (
                      <p className="github-automation-check-steps">{item.nextStep}</p>
                    ) : (
                      <p className="github-automation-check-steps">已通过固定 readiness 检查。</p>
                    )}
                    {item.envNames.length > 0 ? (
                      <div className="github-automation-env-row">
                        {item.envNames.map((envName) => (
                          <button
                            key={envName}
                            type="button"
                            className="github-automation-env-chip"
                            onClick={() => {
                              void copyEnvName(envName).then((ok) => {
                                prompt.toast({
                                  message: ok ? `已复制 ${envName}` : "无法复制，请手动选择 env 名",
                                  tone: ok ? "success" : "error",
                                });
                              });
                            }}
                            aria-label={`复制环境变量名 ${envName}`}
                            title="只复制 env 名，不复制任何 secret 值"
                          >
                            {envName}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  {item.code === "installation" || item.code === "allowlist" || item.code === "project_binding" ? (
                    <button
                      type="button"
                      className="github-automation-button"
                      onClick={openAddForm}
                      disabled={!canMutate && loadState !== "ready"}
                    >
                      添加仓库
                    </button>
                  ) : item.code === "app_id" ||
                    item.code === "private_key_file" ||
                    item.code === "webhook_secret" ? (
                    <button
                      type="button"
                      className="github-automation-button"
                      onClick={() => {
                        document
                          .getElementById(credentialAppIdFieldId)
                          ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
                        document.getElementById(credentialAppIdFieldId)?.focus();
                      }}
                    >
                      配置本机凭据
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="github-automation-button"
                      disabled={verifying}
                      aria-busy={verifying}
                      onClick={() => void onVerify()}
                    >
                      验证
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {verifySummary ? (
            <p className="github-automation-verify-meta" role="status">
              最近验证 · {formatSafeTime(verifySummary.app.checkedAt)} · allowlist{" "}
              {verifySummary.allowlist.repositoryCount} · 已绑定项目{" "}
              {verifySummary.allowlist.boundProjectCount}
              {" · "}
              无 side effect
            </p>
          ) : null}
        </div>
      </section>

      {/* ── Advanced: env override (collapsed by default) ── */}
      <section className="github-automation-card" aria-label="高级：环境变量覆盖">
        <div className="github-automation-card-head">
          <div>
            <h4 className="github-automation-card-title">高级：环境变量覆盖</h4>
            <p className="github-automation-card-sub">
              仅用于 CI、容器和专业部署。非空 env 按字段覆盖本机值（env &gt; 本机 &gt; 未配置）；普通本机用户无需设置。
            </p>
          </div>
          <div className="github-automation-card-actions">
            <span className="github-automation-pill github-automation-pill--info">env &gt; 本机</span>
            <button
              type="button"
              className="github-automation-button"
              aria-expanded={envGuideOpen}
              onClick={() => setEnvGuideOpen((v) => !v)}
            >
              {envGuideOpen ? "收起" : "展开"}
            </button>
          </div>
        </div>
        {envGuideOpen ? (
          <div className="github-automation-card-body">
            <div className="github-automation-notice github-automation-notice--info" role="note">
              <span className="github-automation-notice__mark" aria-hidden="true">
                i
              </span>
              <span>
                环境变量不会写回本机凭据。若只覆盖部分字段，请确保 env 与本机 fallback 属于同一个 GitHub
                App。页面不显示 env 值。
              </span>
            </div>
            <ul className="github-automation-env-guide">
              <li>
                <code>{ENV_APP_ID}</code>
                <span>覆盖 App ID（数字字符串）。</span>
                <button
                  type="button"
                  className="github-automation-button"
                  onClick={() => {
                    void copyEnvName(ENV_APP_ID).then((ok) => {
                      prompt.toast({
                        message: ok ? `已复制 ${ENV_APP_ID}` : "无法复制",
                        tone: ok ? "success" : "error",
                      });
                    });
                  }}
                >
                  复制 env 名
                </button>
              </li>
              <li>
                <code>{ENV_PRIVATE_KEY_FILE}</code>
                <span>覆盖私钥：值为部署环境中的 0600 PEM 路径（不在页面输入路径）。</span>
                <button
                  type="button"
                  className="github-automation-button"
                  onClick={() => {
                    void copyEnvName(ENV_PRIVATE_KEY_FILE).then((ok) => {
                      prompt.toast({
                        message: ok ? `已复制 ${ENV_PRIVATE_KEY_FILE}` : "无法复制",
                        tone: ok ? "success" : "error",
                      });
                    });
                  }}
                >
                  复制 env 名
                </button>
              </li>
              <li>
                <code>{ENV_WEBHOOK_SECRET}</code>
                <span>
                  覆盖 Webhook HMAC secret；公网 HTTPS 仍指向{" "}
                  <code className="github-automation-inline-code">
                    POST /api/github-automation/webhook
                  </code>
                  。
                </span>
                <button
                  type="button"
                  className="github-automation-button"
                  onClick={() => {
                    void copyEnvName(ENV_WEBHOOK_SECRET).then((ok) => {
                      prompt.toast({
                        message: ok ? `已复制 ${ENV_WEBHOOK_SECRET}` : "无法复制",
                        tone: ok ? "success" : "error",
                      });
                    });
                  }}
                >
                  复制 env 名
                </button>
              </li>
              <li>
                <code>{ENV_APP_SLUG}</code>
                <span>可选展示 slug（非 secret）。</span>
                <button
                  type="button"
                  className="github-automation-button"
                  onClick={() => {
                    void copyEnvName(ENV_APP_SLUG).then((ok) => {
                      prompt.toast({
                        message: ok ? `已复制 ${ENV_APP_SLUG}` : "无法复制",
                        tone: ok ? "success" : "error",
                      });
                    });
                  }}
                >
                  复制 env 名
                </button>
              </li>
            </ul>
          </div>
        ) : null}
      </section>

      {/* ── 允许仓库 ── */}
      <section className="github-automation-card" aria-label="允许仓库">
        <div className="github-automation-card-head">
          <div>
            <h4 className="github-automation-card-title">允许仓库</h4>
            <p className="github-automation-card-sub">
              allowlist 从空开始。每个仓库由 immutable repository id 标识，并绑定一个已注册的本地项目。
            </p>
          </div>
          <div className="github-automation-card-actions">
            <span className="github-automation-pill github-automation-pill--info">
              {configRepos.length} 个
            </span>
            <button
              type="button"
              className="github-automation-button github-automation-button--primary"
              disabled={!canMutate && loadState !== "ready"}
              onClick={openAddForm}
            >
              关联仓库
            </button>
          </div>
        </div>
        <div className="github-automation-card-body">
          {loadState === "loading" && !status ? (
            <>
              <div className="github-automation-skeleton github-automation-skeleton--card" />
              <p className="github-automation-loading-copy">正在读取允许仓库…</p>
            </>
          ) : configRepos.length === 0 ? (
            <div className="github-automation-empty github-automation-empty--action">
              <div className="github-automation-empty-icon" aria-hidden="true">
                ◌
              </div>
              <strong>尚未关联仓库</strong>
              <p>添加任意 GitHub owner/repo；不会默认填入 yolk-pi-web。</p>
              <button
                type="button"
                className="github-automation-button github-automation-button--primary"
                disabled={!canMutate && loadState !== "ready"}
                onClick={openAddForm}
              >
                添加第一个仓库
              </button>
            </div>
          ) : (
            configRepos.map((repo) => {
              const live = repoCards.find((r) => r.repositoryId === repo.repositoryId);
              const projectLabel =
                live?.projectDisplayName ||
                projectChoices.find((p) => p.projectId === repo.projectId)?.displayName ||
                (repo.projectId ? `项目 ${repo.projectId.slice(0, 8)}…` : "未绑定项目");
              const blockingJobs = (status?.jobs ?? []).filter(
                (job) =>
                  job.repositoryId === repo.repositoryId && jobBlocksRepositoryDelete(job),
              );
              const deleteBlocked = blockingJobs.length > 0;
              return (
                <article key={repo.repositoryId} className="github-automation-repo-card">
                  <div className="github-automation-repo-card-main">
                    <div className="github-automation-repo-name" title={repo.fullName}>
                      {repo.fullName}
                      {repo.legacySeeded ? (
                        <span className="github-automation-pill github-automation-pill--warn">
                          历史默认项
                        </span>
                      ) : null}
                    </div>
                    <div className="github-automation-meta">
                      <span>
                        repository id · <code>{repo.repositoryId}</code>
                      </span>
                      <span>
                        installation ·{" "}
                        <code>{repo.installationId ?? "未绑定"}</code>
                      </span>
                      <span>
                        base · <code>{repo.baseRef}</code>
                      </span>
                      <span
                        className={`github-automation-pill github-automation-pill--${
                          repo.hasInstallationId || live?.installationBound ? "ok" : "warn"
                        }`}
                      >
                        {repo.hasInstallationId || live?.installationBound
                          ? "安装已填"
                          : "缺少 installation"}
                      </span>
                    </div>
                    <div className="github-automation-repo-grid">
                      <div className="github-automation-repo-cell">
                        <span>GitHub repository</span>
                        {repo.fullName}
                      </div>
                      <div className="github-automation-repo-cell">
                        <span>关联本地项目</span>
                        {projectLabel}
                        {!repo.projectId ? " · 未绑定" : repo.projectRootConfigured ? "" : " · 待验证"}
                      </div>
                      <div className="github-automation-repo-cell">
                        <span>App installation / base ref</span>
                        <code>{repo.installationId ?? "—"}</code> · <code>{repo.baseRef}</code>
                      </div>
                      <div className="github-automation-repo-cell">
                        <span>Assignee / 认领</span>
                        {live?.assignee ? (
                          <>
                            <code>{assigneeLoginLabel(live.assignee)}</code>
                            {" · "}
                            {identitySourceLabel(live.assignee.identitySource)}
                          </>
                        ) : (
                          "机器 active credential"
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="github-automation-repo-card-actions">
                    <button
                      type="button"
                      className="github-automation-button"
                      disabled={!canMutate}
                      onClick={() => openEditForm(repo)}
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      className="github-automation-button github-automation-button--danger"
                      disabled={!canMutate || deleteBlocked}
                      title={
                        deleteBlocked
                          ? "仍有运行中/排队 job，禁止删除"
                          : `移除 ${repo.fullName}`
                      }
                      onClick={() => void onDeleteRepository(repo)}
                    >
                      删除
                    </button>
                  </div>
                </article>
              );
            })
          )}

          {formMode.kind !== "closed" ? (
            <form
              ref={formSectionRef}
              className="github-automation-repo-form"
              aria-labelledby={formHeadingId}
              onSubmit={(e) => {
                e.preventDefault();
                void onSaveRepository();
              }}
            >
              <h5 id={formHeadingId} className="github-automation-form-title">
                {formMode.kind === "edit" ? "编辑仓库关联" : "关联仓库"}
              </h5>
              <p className="github-automation-card-sub">
                保存时服务器会核验 repository id/name，并在服务器端将项目关联为 canonical root；浏览器不会收到本地绝对路径。
              </p>
              <div className="github-automation-form-grid">
                <label className="github-automation-field" htmlFor={fullNameId}>
                  GitHub 仓库（owner/repo）
                  <input
                    id={fullNameId}
                    name="fullName"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="acme/docs-site"
                    value={draft.fullName}
                    onChange={(e) => setDraft((d) => ({ ...d, fullName: e.target.value }))}
                    disabled={repoSaving}
                    required
                  />
                </label>
                <label className="github-automation-field" htmlFor={projectIdFieldId}>
                  关联本地项目（Project Registry）
                  <select
                    id={projectIdFieldId}
                    name="projectId"
                    value={draft.projectId}
                    onChange={(e) => setDraft((d) => ({ ...d, projectId: e.target.value }))}
                    disabled={repoSaving}
                    required
                  >
                    <option value="">选择已注册项目…</option>
                    {selectableProjects.map((p) => (
                      <option key={p.projectId} value={p.projectId}>
                        {p.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="github-automation-field" htmlFor={repositoryIdFieldId}>
                  Repository id（immutable）
                  <input
                    id={repositoryIdFieldId}
                    name="repositoryId"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="GitHub repository id"
                    value={draft.repositoryId}
                    onChange={(e) => setDraft((d) => ({ ...d, repositoryId: e.target.value }))}
                    disabled={repoSaving || formMode.kind === "edit"}
                    required
                  />
                </label>
                <label className="github-automation-field" htmlFor={installationIdFieldId}>
                  Installation ID
                  <input
                    id={installationIdFieldId}
                    name="installationId"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="GitHub App installation id"
                    value={draft.installationId}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, installationId: e.target.value }))
                    }
                    disabled={repoSaving}
                    required
                  />
                </label>
                <label className="github-automation-field" htmlFor={baseRefId}>
                  Base ref
                  <input
                    id={baseRefId}
                    name="baseRef"
                    autoComplete="off"
                    spellCheck={false}
                    value={draft.baseRef}
                    onChange={(e) => setDraft((d) => ({ ...d, baseRef: e.target.value }))}
                    disabled={repoSaving}
                    required
                  />
                </label>
                <label className="github-automation-field" htmlFor={ownerActorIdsId}>
                  Owner actor ids（组织仓库可选）
                  <input
                    id={ownerActorIdsId}
                    name="ownerActorIds"
                    autoComplete="off"
                    placeholder="逗号分隔的 GitHub user id"
                    value={draft.ownerActorIds}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, ownerActorIds: e.target.value }))
                    }
                    disabled={repoSaving}
                  />
                </label>
              </div>
              {selectableProjects.length === 0 ? (
                <div className="github-automation-notice github-automation-notice--warning" role="status">
                  <span className="github-automation-notice__mark" aria-hidden="true">
                    !
                  </span>
                  <span>
                    没有可用的 Project Registry 项目。请先在侧边栏「添加项目」注册本地仓库，再回到此页关联。
                  </span>
                </div>
              ) : null}
              {formError ? (
                <div
                  id={formErrorId}
                  className="github-automation-notice github-automation-notice--error"
                  role="alert"
                >
                  <span className="github-automation-notice__mark" aria-hidden="true">
                    !
                  </span>
                  <span>{formError}</span>
                </div>
              ) : null}
              <div className="github-automation-form-footer">
                <button
                  type="button"
                  className="github-automation-button"
                  disabled={repoSaving}
                  onClick={closeForm}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="github-automation-button github-automation-button--primary"
                  disabled={repoSaving || !canMutate || selectableProjects.length === 0}
                  aria-busy={repoSaving}
                  aria-describedby={formError ? formErrorId : undefined}
                >
                  {repoSaving ? "保存中…" : "验证并保存关联"}
                </button>
              </div>
            </form>
          ) : null}
        </div>
      </section>

      {/* ── 执行边界 / residual risk (always visible, non-dismissible) ── */}
      <section className="github-automation-card" aria-label="执行边界">
        <div className="github-automation-card-body">
          <div
            id={residualRiskId}
            className="github-automation-notice github-automation-notice--warning github-automation-residual-risk"
            role="status"
            data-residual-risk-required="true"
          >
            <span className="github-automation-notice__mark" aria-hidden="true">
              !
            </span>
            <span>
              <strong>Full agent 不是 sandbox。</strong> {residualSummary} WorkTree
              与最终 diff gate 仅限制发布；它们不能撤销执行期副作用。此警告不可关闭。
            </span>
          </div>
        </div>
      </section>

      {/* ── 运行控制 ── */}
      <section className="github-automation-card" aria-label="运行控制">
        <div className="github-automation-mode">
          <div className="github-automation-mode-top">
            <div>
              <h4 className="github-automation-card-title">运行控制</h4>
              <p className="github-automation-card-sub">
                运行模式是独立即时保存的非敏感策略；暂停不会修改 mode。checklist / 仓库未就绪时 unattended 保持禁用。
              </p>
            </div>
            <span
              className={`github-automation-pill github-automation-pill--${
                paused ? "warn" : mode === "off" ? "info" : "info"
              }`}
            >
              {modeLabel(mode, paused)}
            </span>
          </div>

          <div
            className="github-automation-segmented"
            role="radiogroup"
            aria-label="运行模式"
            aria-describedby={modeReasonId}
          >
            <button
              type="button"
              role="radio"
              className={`github-automation-segment${mode === "off" ? " is-selected" : ""}`}
              aria-checked={mode === "off"}
              disabled={!canMutate && mode !== "off"}
              onClick={() => void onSelectMode("off")}
            >
              关闭
            </button>
            <button
              type="button"
              role="radio"
              className={`github-automation-segment${mode === "triage" ? " is-selected" : ""}`}
              aria-checked={mode === "triage"}
              disabled={triageDisabled && mode !== "triage"}
              onClick={() => void onSelectMode("triage")}
            >
              仅 Triage
            </button>
            <button
              type="button"
              role="radio"
              className={`github-automation-segment${mode === "unattended" ? " is-selected" : ""}`}
              aria-checked={mode === "unattended"}
              disabled={unattendedDisabled && mode !== "unattended"}
              aria-describedby={!unattendedGate.ok ? modeReasonId : undefined}
              title={!unattendedGate.ok ? unattendedGate.reason ?? undefined : undefined}
              onClick={() => void onSelectMode("unattended")}
            >
              低风险无人值守
            </button>
          </div>

          <div className="github-automation-mode-foot">
            <div className="github-automation-mode-copy" id={modeReasonId}>
              {mode === "off"
                ? "关闭：停止新 job；webhook 仍验签并记录。"
                : mode === "triage"
                  ? "仅 Triage：owner 采纳只会进入等待自动化，不创建 WorkTree 或 PR。"
                  : paused
                    ? "已暂停：现有执行将在安全 checkpoint 停住。"
                    : unattendedGate.ok
                      ? "首批允许文档 + 小 bugfix，使用 full agent；UI/高风险仍转人工。full agent 可任意命令、联网和访问同 OS 用户可见文件。"
                      : unattendedGate.reason ??
                        "无人值守条件未满足，不能从本页绕过。"}
            </div>
            <button
              type="button"
              className={`github-automation-button${paused ? " github-automation-button--primary" : ""}`}
              disabled={!canMutate || mode === "off"}
              onClick={() => void onToggleGlobalPause()}
            >
              {paused ? "恢复接收新任务" : "暂停新任务"}
            </button>
          </div>
        </div>
      </section>

      {/* ── Readiness ── */}
      <section className="github-automation-card" aria-label="App、Assignee 与 webhook readiness">
        <div className="github-automation-card-head">
          <div>
            <h4 className="github-automation-card-title">App、Assignee 与 webhook readiness</h4>
            <p className="github-automation-card-sub">
              只显示 safe login/readiness；App secret 与本机 credential 永不进入浏览器。认领必须同时有
              label 和 assignee。
            </p>
          </div>
          <button
            type="button"
            className="github-automation-button"
            disabled={refreshing || loadState === "loading"}
            aria-busy={refreshing}
            onClick={() => void fetchStatus({ reason: "manual" })}
          >
            {refreshing ? "刷新中…" : "↻ 刷新状态"}
          </button>
        </div>

        {loadState === "loading" && !status ? (
          <div className="github-automation-card-body" aria-busy="true">
            <div className="github-automation-skeleton" />
            <div className="github-automation-skeleton github-automation-skeleton--short" />
            <div className="github-automation-skeleton github-automation-skeleton--card" />
            <p className="github-automation-loading-copy">正在读取 GitHub 自动化状态…</p>
          </div>
        ) : status && assignee ? (
          <div className="github-automation-readiness">
            {(
              [
                ["App 凭据", appCredentialText(status.readiness.app)],
                ["安装", installationText(status)],
                ["权限", permissionsText(status)],
                ["本机 Assignee", assigneeValueText(assignee, stale)],
                ["Webhook", webhookText(status, stale)],
                [
                  "Allowlist",
                  status.readiness.allowlist.ready
                    ? `${status.readiness.allowlist.repositoryCount} 个允许仓库`
                    : "尚未关联仓库",
                ],
              ] as const
            ).map(([label, value]) => {
              const pill =
                label === "本机 Assignee"
                  ? assigneePill(assignee, stale)
                  : {
                      tone: readinessPillTone(value),
                      label: readinessPillLabel(value),
                    };
              return (
                <div className="github-automation-readiness-row" key={label}>
                  <span className="github-automation-readiness-label">{label}</span>
                  <span className="github-automation-readiness-value" title={value}>
                    {value}
                  </span>
                  <span className={`github-automation-pill github-automation-pill--${pill.tone}`}>
                    {pill.label}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="github-automation-card-body">
            <div className="github-automation-notice github-automation-notice--error" role="alert">
              <span className="github-automation-notice__mark" aria-hidden="true">
                !
              </span>
              <span>
                <strong>无法读取状态</strong>
                <br />
                请使用「刷新状态」重试。不会显示任何 secret 或本地路径。
              </span>
            </div>
          </div>
        )}
      </section>

      {/* ── Policy ── */}
      {status ? (
        <section className="github-automation-card" aria-label="Policy 与执行模型">
          <div className="github-automation-card-head">
            <div>
              <h4 className="github-automation-card-title">Policy 与执行模型</h4>
              <p className="github-automation-card-sub">
                {status.policy.unattendedEnabled && status.readiness.permissions.p1Unattended
                  ? "文档 + 小 bugfix；发布仍需 checker 与 final diff gate。"
                  : "当前只读：无人值守尚未可用。"}
              </p>
            </div>
            <span
              className={`github-automation-pill github-automation-pill--${
                status.policy.unattendedEnabled && status.readiness.permissions.p1Unattended
                  ? "ok"
                  : "warn"
              }`}
            >
              {status.policy.unattendedEnabled && status.readiness.permissions.p1Unattended
                ? "docs + small bugfix"
                : "默认关闭"}
            </span>
          </div>
          <div className="github-automation-card-body">
            <div className="github-automation-policy-list">
              <div className="github-automation-policy-row">
                <span>Policy</span>
                <strong>
                  {status.policy.policyId}-v{status.policy.policyVersion}
                </strong>
              </div>
              <div className="github-automation-policy-row">
                <span>执行</span>
                <strong>Full agent</strong>
              </div>
              <div className="github-automation-policy-row">
                <span>并发 / Diff</span>
                <strong>
                  {status.policy.maxConcurrency} · {status.policy.maxFiles} 文件 /{" "}
                  {status.policy.maxChangedLines} 行
                </strong>
              </div>
              <div>
                <div className="github-automation-chips-label">一律转人工</div>
                <div className="github-automation-chips">
                  {ALWAYS_MANUAL_CHIPS.map((chip) => (
                    <span className="github-automation-chip" key={chip}>
                      {chip}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* ── Jobs ── */}
      <section className="github-automation-card" aria-label="队列与最近 jobs">
        <div className="github-automation-card-head">
          <div>
            <h4 className="github-automation-card-title">队列与最近 jobs</h4>
            <p className="github-automation-card-sub">
              仅显示安全摘要，默认最近 10 条；刷新不启动 scheduler 或 enqueue job。
            </p>
          </div>
          <button
            type="button"
            className="github-automation-button"
            disabled={refreshing || loadState === "loading" || stale}
            aria-busy={refreshing}
            onClick={() => void fetchStatus({ reason: "manual" })}
          >
            {refreshing ? "刷新中…" : "↻ 刷新状态"}
          </button>
        </div>
        <div className="github-automation-card-body">
          {loadState === "loading" && !status ? (
            <>
              <div className="github-automation-skeleton github-automation-skeleton--card" />
              <div className="github-automation-skeleton github-automation-skeleton--card" />
            </>
          ) : status ? (
            <>
              <div className="github-automation-count-row" aria-label="队列计数">
                {(
                  [
                    ["排队", status.runtime.counts.queued],
                    ["运行中", status.runtime.counts.running],
                    ["重试", status.runtime.counts.retry],
                    ["阻塞", status.runtime.counts.blocked],
                    ["PR open", status.runtime.counts.prOpen],
                  ] as const
                ).map(([label, count]) => (
                  <span className="github-automation-count" key={label}>
                    <b>{count}</b>
                    {label}
                  </span>
                ))}
              </div>

              {status.jobs.length === 0 ? (
                <div className="github-automation-empty">
                  <div className="github-automation-empty-icon" aria-hidden="true">
                    ◌
                  </div>
                  <strong>当前没有 job</strong>
                  <br />
                  启用后只处理新的已验证 delivery；不会自动回扫历史 Issue。
                </div>
              ) : (
                <div className="github-automation-jobs">
                  {status.jobs.map((job) => {
                    const retry = jobActionAvailability(job, "retry");
                    const pause = jobActionAvailability(job, "pause");
                    const resume = jobActionAvailability(job, "resume");
                    const busy = busyJobId === job.jobId;
                    const issueHref = `https://github.com/${job.repositoryFullName}/issues/${job.issueNumber}`;
                    const prHref =
                      job.prNumber != null
                        ? `https://github.com/${job.repositoryFullName}/pull/${job.prNumber}`
                        : null;
                    const title =
                      job.issueTitlePreview?.trim() ||
                      `${job.repositoryFullName}#${job.issueNumber}`;

                    let statusPill: { tone: "ok" | "warn" | "bad" | "info"; label: string } = {
                      tone: "info",
                      label: "状态可刷新",
                    };
                    if (job.status === "completed" || job.phase === "completed") {
                      statusPill = { tone: "ok", label: "已完成" };
                    } else if (job.phase === "pr_open" || job.hasPullRequest) {
                      statusPill = {
                        tone: "info",
                        label: job.prNumber != null ? `PR #${job.prNumber}` : "PR open",
                      };
                    } else if (
                      job.status === "blocked" ||
                      job.phase === "blocked" ||
                      job.phase === "blocked_claim_assignee" ||
                      job.claimStatus === "blocked_claim_assignee"
                    ) {
                      statusPill = { tone: "warn", label: "需人工接手" };
                    } else if (job.status === "paused" || job.phase === "paused") {
                      statusPill = { tone: "warn", label: "已暂停" };
                    }

                    const metaParts = [
                      claimStatusLabel(job.claimStatus),
                      job.reasonCode ? job.reasonCode : null,
                      `trace ${job.traceId}`,
                      job.nextRetryAt ? `下次重试 ${formatSafeTime(job.nextRetryAt)}` : null,
                    ].filter(Boolean);

                    return (
                      <article className="github-automation-job" key={job.jobId}>
                        <div className="github-automation-job-main">
                          <div className="github-automation-job-title">
                            <a
                              href={issueHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`打开 Issue #${job.issueNumber}`}
                            >
                              #{job.issueNumber}
                            </a>
                            <span className="github-automation-truncate" title={title}>
                              {title}
                            </span>
                          </div>
                          <div
                            className="github-automation-job-meta"
                            title={metaParts.join(" · ")}
                          >
                            safe · {metaParts.join(" · ")} · 无正文、评论或本地路径
                          </div>
                        </div>
                        <div className="github-automation-job-phase">
                          {job.phase}
                          <small>
                            {job.status}
                            {job.attempt > 1 ? ` · 第 ${job.attempt} 次` : ""}
                            {prHref ? (
                              <>
                                {" · "}
                                <a href={prHref} target="_blank" rel="noopener noreferrer">
                                  PR #{job.prNumber}
                                </a>
                                {" · Fixes #"}
                                {job.issueNumber}
                              </>
                            ) : null}
                          </small>
                        </div>
                        <div>
                          <span
                            className={`github-automation-pill github-automation-pill--${statusPill.tone}`}
                          >
                            {statusPill.label}
                          </span>
                        </div>
                        <div className="github-automation-job-actions">
                          {resume.available ? (
                            <button
                              type="button"
                              className="github-automation-button github-automation-button--primary"
                              disabled={!canMutate || busy}
                              title={resume.reasonCode ?? undefined}
                              aria-busy={busy && busyAction === "resume"}
                              onClick={() => void runJobAction(job, "resume")}
                            >
                              {busy && busyAction === "resume" ? "处理中…" : "恢复"}
                            </button>
                          ) : null}
                          {pause.available ? (
                            <button
                              type="button"
                              className="github-automation-button"
                              disabled={!canMutate || busy}
                              title={pause.reasonCode ?? undefined}
                              aria-busy={busy && busyAction === "pause"}
                              onClick={() => void runJobAction(job, "pause")}
                            >
                              {busy && busyAction === "pause" ? "处理中…" : "暂停"}
                            </button>
                          ) : null}
                          {retry.available ? (
                            <button
                              type="button"
                              className="github-automation-button github-automation-button--danger"
                              disabled={!canMutate || busy}
                              title={retry.reasonCode ?? undefined}
                              aria-busy={busy && busyAction === "retry"}
                              onClick={() => void runJobAction(job, "retry")}
                            >
                              {busy && busyAction === "retry" ? "处理中…" : "重试"}
                            </button>
                          ) : null}
                          {!retry.available && !pause.available && !resume.available ? (
                            <span className="github-automation-job-no-action">
                              {retry.reasonCode
                                ? `不可用：${retry.reasonCode}`
                                : "无可用操作"}
                            </span>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <div className="github-automation-empty">无法加载 job 列表</div>
          )}
        </div>
      </section>
    </div>
  );
}
