"use client";

/**
 * GitHub 自动化 Settings leaf — analysis-only (GIA-05).
 *
 * Approved IA (task prototype github-issue-analysis-settings-prototype.html):
 * - 运行控制: single enabled + global paused + auto-close warning
 * - 本机 GitHub App 凭据 / Setup checklist / 允许仓库 (Project Registry 只读证据)
 * - 最近分析: category / verdict / comment / close / retry only
 * - 安全边界说明；无 Assignee / mode / unattended / Session / WorkTree / PR
 *
 * Wire surface mirrors GIA-04 projections only. Immediate-save leaf;
 * global Settings Save/Reset stays disabled.
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

type JobActionName = "retry";

interface JobActionAvailability {
  action: JobActionName;
  available: boolean;
  reasonCode: string | null;
}

type AnalysisCategory = "bug" | "feature" | "docs" | "question" | "other";
type TruthVerdict =
  | "confirmed"
  | "not_exists"
  | "inconclusive"
  | "not_applicable";
type Confidence = "high" | "medium" | "low";
type AnalysisOutcome =
  | "queued"
  | "running"
  | "retry_due"
  | "blocked"
  | "completed_open"
  | "completed_closed"
  | "inconclusive";
type JobPhase =
  | "received"
  | "analyzing"
  | "result_ready"
  | "commenting"
  | "closing"
  | "completed"
  | "blocked"
  | "retry_due"
  | "cancelled"
  | string;
type JobStatus =
  | "queued"
  | "running"
  | "retry_due"
  | "blocked"
  | "completed"
  | "cancelled"
  | string;
type EffectStatus =
  | "pending"
  | "remote_confirmed"
  | "reconcile_needed"
  | "failed"
  | string;

interface EffectSafeProjection {
  status: EffectStatus | null;
  remoteId: string | null;
  reasonCode: string | null;
}

interface JobSafeProjection {
  jobId: string;
  kind: "issue_analysis" | "legacy_pipeline" | "unknown";
  repositoryId: number;
  repositoryFullName: string;
  issueNumber: number;
  issueTitlePreview: string | null;
  phase: JobPhase;
  status: JobStatus;
  attempt: number;
  traceId: string;
  reasonCode: string | null;
  nextRetryAt: string | null;
  createdAt: string;
  updatedAt: string;
  checkpoint: string | null;
  category: AnalysisCategory | null;
  verdict: TruthVerdict | null;
  confidence: Confidence | null;
  completeness: string | null;
  budgetExceeded: boolean | null;
  outcome: AnalysisOutcome | string;
  retryability: string;
  comment: EffectSafeProjection;
  close: EffectSafeProjection;
  actions: JobActionAvailability[];
}

interface RepositorySafeProjection {
  repositoryId: number;
  fullName: string;
  installationId: number;
  hasInstallationId: boolean;
  projectId: string;
  projectRootConfigured: boolean;
  legacySeeded: boolean;
}

interface RepositoryStatusProjection extends RepositorySafeProjection {
  installationBound: boolean;
  projectDisplayName: string | null;
}

interface ConfigSafeProjection {
  schemaVersion: number;
  enabled: boolean;
  paused: boolean;
  revision: string;
  updatedAt: string;
  repositories: RepositorySafeProjection[];
  analysis: {
    maxConcurrency: number;
  };
}

interface ProjectChoice {
  projectId: string;
  displayName: string;
  pathStatus: "ok" | "missing" | "archived";
  archived: boolean;
  missing: boolean;
}

interface AnalysisPermissionProjection {
  analysisReady: boolean;
  missing: Array<"metadata" | "issues">;
  snapshot: {
    metadata: string;
    issues: string;
  };
}

interface AnalysisModelProjection {
  ready: boolean;
  reasonCode: string;
  provider: string | null;
  modelId: string | null;
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
    permissions: AnalysisPermissionProjection;
    model: AnalysisModelProjection;
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
    paused: boolean;
    analysisMaxConcurrency: number;
    counts: {
      queued: number;
      running: number;
      retry: number;
      blocked: number;
      completed: number;
    };
  };
  repositories: RepositoryStatusProjection[];
  jobs: JobSafeProjection[];
  config: ConfigSafeProjection;
  runtimeProvenance?: {
    codeRevision: string;
    policyVersion: string;
  };
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
  analysisReady: boolean;
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
    permissions: AnalysisPermissionProjection;
    model: AnalysisModelProjection;
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
  projectId: string;
}

type InlineNoticeTone = "info" | "warning" | "error" | "success";

interface InlineNotice {
  tone: InlineNoticeTone;
  title: string;
  message: string;
}

type LoadState = "loading" | "ready" | "error";
type FormMode =
  | { kind: "closed" }
  | { kind: "add" }
  | { kind: "edit"; repositoryId: number };
type UiTone = "ok" | "warn" | "bad" | "info" | "muted";
type PrivateKeyInputMode = "paste" | "file";

const POLL_INTERVAL_MS = 20_000;
const SAVED_FLASH_MS = 2200;

/** Static customer help page (public/); opens in a new tab from Settings. */
const GITHUB_AUTOMATION_HELP_HREF = "/docs/github-app-automation-setup.html";

const ENV_APP_ID = "YPI_GITHUB_APP_ID";
const ENV_PRIVATE_KEY_FILE = "YPI_GITHUB_APP_PRIVATE_KEY_FILE";
const ENV_WEBHOOK_SECRET = "YPI_GITHUB_APP_WEBHOOK_SECRET";
const ENV_APP_SLUG = "YPI_GITHUB_APP_SLUG";

const CREDENTIALS_DELETE_CONFIRM = "remove_local_credentials";

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
  "github_network_error",
  "github_timeout",
  "github_auth_failed",
  "github_bad_response",
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
  "project_not_found",
  "project_path_missing",
  "repository_mismatch",
  "active_jobs_block_delete",
]);

const FALLBACK_CHECKLIST: SetupChecklistItem[] = [
  {
    code: "app_id",
    order: 1,
    state: "unknown",
    title: "GitHub App ID",
    reasonCode: null,
    nextStep: "在本机凭据卡填写 App ID 并保存，或配置高级 env 覆盖。",
    envNames: [ENV_APP_ID],
  },
  {
    code: "private_key_file",
    order: 2,
    state: "unknown",
    title: "App 私钥",
    reasonCode: null,
    nextStep: "粘贴或选择 PEM 并保存到本机。",
    envNames: [ENV_PRIVATE_KEY_FILE],
  },
  {
    code: "webhook_secret",
    order: 3,
    state: "unknown",
    title: "Webhook secret",
    reasonCode: null,
    nextStep: "填写与 GitHub App 一致的 Webhook secret。",
    envNames: [ENV_WEBHOOK_SECRET],
  },
  {
    code: "installation",
    order: 4,
    state: "unknown",
    title: "App 安装",
    reasonCode: null,
    nextStep: "将 App 安装到目标仓库并填写 installation id。",
    envNames: [],
  },
  {
    code: "permissions",
    order: 5,
    state: "unknown",
    title: "权限（Metadata + Issues）",
    reasonCode: null,
    nextStep: "App 需要 Metadata read 与 Issues read/write。",
    envNames: [],
  },
  {
    code: "allowlist",
    order: 6,
    state: "unknown",
    title: "允许仓库",
    reasonCode: null,
    nextStep: "至少关联一个允许仓库。",
    envNames: [],
  },
  {
    code: "project_binding",
    order: 7,
    state: "unknown",
    title: "本地项目可读",
    reasonCode: null,
    nextStep: "为每个仓库绑定 Project Registry 项目（只读证据）。",
    envNames: [],
  },
  {
    code: "analysis_model",
    order: 8,
    state: "unknown",
    title: "分析模型可用",
    reasonCode: null,
    nextStep: "确保 pi 主默认模型可用；页面不配置专用 secret。",
    envNames: [],
  },
  {
    code: "webhook_health",
    order: 9,
    state: "unknown",
    title: "Webhook 健康",
    reasonCode: null,
    nextStep: "确认公网 webhook 可达且 secret 一致。",
    envNames: [],
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
        return "安装权限不足（需要 Metadata read + Issues read/write）";
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
      case "project_not_found":
        return "Project Registry 中找不到所选项目";
      case "project_path_missing":
        return "本地项目路径缺失或不可读";
      case "repository_mismatch":
        return "repository id 与 owner/repo 不匹配";
      case "active_jobs_block_delete":
        return "仍有进行中的分析任务，无法移除该仓库";
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
  return sources[field] ?? "missing";
}

function sourceLabel(source: CredentialValueSource): string {
  if (source === "env") return "环境变量";
  if (source === "local") return "本机";
  return "未配置";
}

function sourcePillTone(source: CredentialValueSource): UiTone {
  if (source === "env" || source === "local") return "ok";
  return "bad";
}

function fieldConfiguredLabel(
  configured: boolean,
  source: CredentialValueSource,
): string {
  if (!configured || source === "missing") return "未配置";
  return `已配置 · ${sourceLabel(source)} · 不回显`;
}

function overallCredentialPill(
  app: AppCredentialProjection | null | undefined,
  stale: boolean,
): { tone: UiTone; label: string } {
  if (stale) return { tone: "warn", label: "可能过期" };
  if (!app) return { tone: "info", label: "未知" };
  if (app.configured && app.readiness === "ready") {
    return { tone: "ok", label: "已配置 · 不回显" };
  }
  if (app.local?.readiness === "invalid") {
    return { tone: "bad", label: "本机损坏" };
  }
  if (app.local?.readiness === "unsupported") {
    return { tone: "bad", label: "schema 不支持" };
  }
  if (!app.configured) return { tone: "bad", label: "未配置" };
  return { tone: "warn", label: app.readiness || "不完整" };
}

function permissionsText(status: StatusProjection | null): string {
  if (!status) return "—";
  const p = status.readiness.permissions;
  if (p.analysisReady) return "Metadata read · Issues read/write";
  const missing = p.missing.length > 0 ? p.missing.join(" / ") : "权限不足";
  return `缺少：${missing}`;
}

function modelText(status: StatusProjection | null): string {
  if (!status) return "—";
  const m = status.readiness.model;
  if (m.ready) {
    const id =
      m.provider && m.modelId ? `${m.provider}/${m.modelId}` : "主默认模型";
    return `可用 · ${id}`;
  }
  return `不可用 · ${m.reasonCode || "model_unavailable"}`;
}

function checklistStateMeta(state: SetupItemState): {
  tone: UiTone;
  label: string;
} {
  if (state === "ready") return { tone: "ok", label: "就绪" };
  if (state === "needs_fix") return { tone: "bad", label: "需修复" };
  if (state === "pending") return { tone: "warn", label: "待完成" };
  return { tone: "info", label: "未知" };
}

function emptyDraft(): RepositoryDraft {
  return {
    repositoryId: "",
    fullName: "",
    installationId: "",
    projectId: "",
  };
}

function draftFromRepo(repo: RepositorySafeProjection): RepositoryDraft {
  return {
    repositoryId: String(repo.repositoryId),
    fullName: repo.fullName,
    installationId: repo.installationId > 0 ? String(repo.installationId) : "",
    projectId: repo.projectId || "",
  };
}

function repoToWireDraft(repo: RepositorySafeProjection): {
  repositoryId: number;
  fullName: string;
  installationId: number;
  projectId: string;
} {
  return {
    repositoryId: repo.repositoryId,
    fullName: repo.fullName,
    installationId: repo.installationId,
    projectId: repo.projectId,
  };
}

function jobBlocksRepositoryDelete(job: JobSafeProjection): boolean {
  if (job.kind === "legacy_pipeline") return false;
  if (job.status === "completed" || job.status === "cancelled") return false;
  if (job.phase === "completed" || job.phase === "cancelled") return false;
  return (
    job.status === "queued" ||
    job.status === "running" ||
    job.status === "retry_due" ||
    job.status === "blocked" ||
    job.phase === "analyzing" ||
    job.phase === "commenting" ||
    job.phase === "closing" ||
    job.phase === "result_ready" ||
    job.phase === "received"
  );
}

function outcomePill(job: JobSafeProjection): { tone: UiTone; label: string } {
  const outcome = job.outcome;
  if (outcome === "completed_closed") {
    return { tone: "ok", label: "completed-closed" };
  }
  if (outcome === "completed_open") {
    return { tone: "ok", label: "completed-open" };
  }
  if (outcome === "inconclusive") {
    return { tone: "warn", label: "inconclusive" };
  }
  if (outcome === "retry_due") {
    return { tone: "warn", label: "retry_due" };
  }
  if (outcome === "blocked") {
    return { tone: "bad", label: "blocked" };
  }
  if (outcome === "queued") {
    return { tone: "info", label: "queued" };
  }
  if (
    outcome === "running" ||
    job.phase === "analyzing" ||
    job.phase === "commenting" ||
    job.phase === "closing" ||
    job.phase === "result_ready"
  ) {
    const phase =
      job.phase === "commenting"
        ? "commenting"
        : job.phase === "closing"
          ? "closing"
          : job.phase === "analyzing" || job.phase === "received"
            ? "analyzing"
            : "running";
    return { tone: "info", label: phase };
  }
  return { tone: "muted", label: String(outcome || job.status || "unknown") };
}

function categoryLabel(category: AnalysisCategory | null): string {
  if (!category) return "—";
  return category;
}

function verdictLabel(verdict: TruthVerdict | null): string {
  if (!verdict) return "—";
  return verdict;
}

function effectLabel(
  effect: EffectSafeProjection,
  kind: "comment" | "close",
): string {
  if (!effect.status) {
    return kind === "comment" ? "评论未写入" : "未关闭";
  }
  if (effect.status === "remote_confirmed") {
    return kind === "comment" ? "评论已写入" : "已关闭";
  }
  if (effect.status === "reconcile_needed") {
    return kind === "comment" ? "评论待回读" : "关闭待回读";
  }
  if (effect.status === "failed") {
    return kind === "comment" ? "评论失败" : "关闭失败";
  }
  if (effect.status === "pending") {
    return kind === "comment" ? "评论进行中" : "关闭进行中";
  }
  return effect.status;
}

function dispositionCopy(job: JobSafeProjection): string {
  if (job.outcome === "completed_closed" || job.close.status === "remote_confirmed") {
    return "已关闭";
  }
  if (job.outcome === "inconclusive" || job.verdict === "inconclusive") {
    return "证据不足 · 保持打开";
  }
  if (job.verdict === "not_applicable") {
    return "不适用缺陷真伪 · 保持打开";
  }
  if (job.verdict === "confirmed") {
    return "保持打开";
  }
  if (job.verdict === "not_exists" && job.close.status !== "remote_confirmed") {
    return "未自动关闭";
  }
  if (job.outcome === "completed_open") {
    return "保持打开";
  }
  return "—";
}

function jobSummaryLine(job: JobSafeProjection): string {
  const parts = [
    categoryLabel(job.category),
    verdictLabel(job.verdict),
    effectLabel(job.comment, "comment"),
    dispositionCopy(job),
  ];
  if (job.confidence) parts.splice(2, 0, job.confidence);
  if (job.reasonCode && (job.outcome === "blocked" || job.outcome === "retry_due")) {
    parts.push(job.reasonCode);
  }
  return parts.filter((p) => p && p !== "—").join(" · ");
}

function retryReasonLabel(reasonCode: string | null | undefined): string {
  if (!reasonCode) return "当前不可重试";
  switch (reasonCode) {
    case "automation_disabled":
      return "自动化已关闭";
    case "legacy_pipeline_retired":
      return "旧流水线已退役，不可重试";
    case "not_analysis_job":
      return "非分析任务";
    case "job_completed":
      return "已完成，无需重试";
    case "job_cancelled":
      return "已取消";
    case "job_running":
      return "任务运行中";
    case "status_not_retryable":
      return "当前状态不可重试";
    default:
      return reasonCode;
  }
}

function primaryBanner(
  loadState: LoadState,
  status: StatusProjection | null,
  stale: boolean,
  conflict: boolean,
): InlineNotice | null {
  if (conflict) {
    return {
      tone: "warning",
      title: "配置 revision 冲突",
      message: "其他操作者已更新配置。请重新读取后再保存；mutation 已暂时禁用。",
    };
  }
  if (stale) {
    return {
      tone: "warning",
      title: "状态可能过期",
      message: "最近一次刷新失败。仍可浏览上次安全投影，但启用/暂停/仓库/重试已禁用。",
    };
  }
  if (loadState === "error" && !status) {
    return {
      tone: "error",
      title: "无法加载 GitHub 分析设置",
      message: "请检查本机服务是否可用，然后重试。",
    };
  }
  if (!status) return null;

  if (!status.readiness.app.configured) {
    return {
      tone: "warning",
      title: "GitHub App 凭据未配置",
      message: "请先在下方保存本机 App ID、私钥与 Webhook secret（或配置高级 env 覆盖）。",
    };
  }
  if (status.readiness.allowlist.repositoryCount === 0) {
    return {
      tone: "info",
      title: "允许仓库为空",
      message: "关联至少一个仓库与 Project Registry 本地项目后，才能分析新 Issue。",
    };
  }
  if (!status.readiness.model.ready) {
    return {
      tone: "warning",
      title: "分析模型不可用",
      message: "跟随 pi 主默认模型；模型未就绪时不会关闭 Issue，分析会降级为 inconclusive。",
    };
  }
  if (status.runtime.paused) {
    return {
      tone: "info",
      title: "全局已暂停",
      message: "暂停不改变启用状态；恢复后继续未确认阶段，不会重放已确认评论/关闭。",
    };
  }
  if (!status.runtime.enabled) {
    return {
      tone: "info",
      title: "新议题分析未启用",
      message: "Webhook 仍可验签审计；开启后仅处理人类 issues.opened。",
    };
  }
  return null;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function GithubAutomationConfig() {
  const prompt = usePrompt();
  const headingId = useId();
  const formHeadingId = useId();
  const fullNameId = useId();
  const repositoryIdFieldId = useId();
  const installationIdFieldId = useId();
  const projectIdFieldId = useId();
  const formErrorId = useId();
  const credentialAppIdFieldId = useId();
  const credentialWebhookFieldId = useId();
  const credentialPemFieldId = useId();
  const credentialFileFieldId = useId();
  const credentialLiveRegionId = useId();
  const enableSwitchId = useId();
  const pauseSwitchId = useId();
  const concurrencyId = useId();

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [status, setStatus] = useState<StatusProjection | null>(null);
  const [config, setConfig] = useState<ConfigSafeProjection | null>(null);
  const [projectChoices, setProjectChoices] = useState<ProjectChoice[]>([]);
  const [checklist, setChecklist] = useState<SetupChecklistItem[]>(FALLBACK_CHECKLIST);
  const [verifySummary, setVerifySummary] = useState<VerifyResult["summary"] | null>(
    null,
  );
  const [credentialStatus, setCredentialStatus] =
    useState<AppCredentialProjection | null>(null);
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
  const [expandedJobIds, setExpandedJobIds] = useState<Record<string, boolean>>({});
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
  const statusRef = useRef<StatusProjection | null>(null);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

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
    setCredentialStatus(next.readiness.app);
    setConfig((prev) => {
      if (!prev) return next.config;
      if (prev.revision === next.revision) {
        return {
          ...prev,
          ...next.config,
          repositories: next.config.repositories,
          analysis: next.config.analysis,
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

  const setPrivateKeyInputMode = useCallback((mode: PrivateKeyInputMode) => {
    setPrivateKeyMode(mode);
    if (mode === "paste") {
      setPrivateKeyFile(null);
      if (privateKeyFileInputRef.current) {
        privateKeyFileInputRef.current.value = "";
      }
    } else {
      setPrivateKeyPemDraft("");
    }
  }, []);

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

  const fetchConfig = useCallback(
    async (generation: number, signal: AbortSignal) => {
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
    },
    [applyConfigBundle],
  );

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
          if (statusRef.current) {
            setStale(true);
            setLoadState("error");
            setActionNotice({
              tone: "error",
              title: "无法刷新分析状态",
              message: allowlistedMessage(
                data?.code,
                "状态可能已过期；mutation 已暂时禁用。",
              ),
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
        if (statusRef.current) {
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
    [applyStatus, fetchConfig],
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
      counts.queued > 0 || counts.running > 0 || counts.retry > 0 || counts.blocked > 0;
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
      if (statusRef.current && !stale) {
        void fetchStatus({ silent: true, reason: "visibility" });
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [clearPoll, fetchStatus, stale]);

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
      enabled?: boolean;
      paused?: boolean;
      analysis?: { maxConcurrency?: number };
      repositories?: Array<{
        repositoryId: number;
        fullName: string;
        installationId: number;
        projectId: string;
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
                  paused: data.config!.paused,
                  analysisMaxConcurrency: data.config!.analysis.maxConcurrency,
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
      const webhookSecret = webhookSecretDraft;
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
        "只删除本机保存的 GitHub App 凭据。不会删除 GitHub App、installation、允许仓库、分析任务，也不会修改环境变量。若 env 仍存在，当前进程可能继续显示已配置。",
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
          : "本机 fallback 已删除。在重新配置前分析将保持 fail closed。",
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

      if (
        !res.ok ||
        !data ||
        data.ok !== true ||
        !Array.isArray((data as VerifyResult).checklist)
      ) {
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
      setChecklist([...verified.checklist].sort((a, b) => a.order - b.order));
      setVerifySummary(verified.summary);
      if (verified.summary?.app) {
        const generation = ++credentialGenerationRef.current;
        applyCredentialStatus(verified.summary.app, generation);
      }
      setActionNotice({
        tone: verified.allReady ? "success" : "warning",
        title: verified.allReady
          ? "配置验证通过"
          : verified.analysisReady
            ? "分析前提基本就绪，仍有待办"
            : "配置尚未就绪",
        message: verified.allReady
          ? "固定 readiness 检查已通过；未启动 scheduler，也未创建分析任务。"
          : "请按 checklist 中的下一步完成缺失项后再次验证。验证不会写入 secret 或启动任务。",
      });
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
      formSectionRef.current
        ?.querySelector<HTMLElement>("input,select,button")
        ?.focus();
    });
  }, []);

  const openEditForm = useCallback((repo: RepositorySafeProjection) => {
    setFormMode({ kind: "edit", repositoryId: repo.repositoryId });
    setDraft(draftFromRepo(repo));
    setFormError(null);
    requestAnimationFrame(() => {
      formSectionRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      formSectionRef.current
        ?.querySelector<HTMLElement>("input,select,button")
        ?.focus();
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
    if (!draft.projectId.trim()) {
      setFormError("请选择已注册的 Project Registry 项目");
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

    const nextList = repositoriesForEdit
      .filter((repo) => {
        if (formMode.kind === "edit") {
          return repo.repositoryId !== formMode.repositoryId;
        }
        return repo.repositoryId !== repositoryId;
      })
      .map(repoToWireDraft);

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
          "服务器已核验 repository id/name，并完成 Project Registry 只读证据绑定。浏览器不会收到本地绝对路径。",
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
          message: `仓库 ${repo.fullName} 仍有排队/运行/重试/阻塞的分析任务（${blocking.length}）。请先完成或等待后再移除 allowlist。`,
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

  const onToggleEnabled = useCallback(async () => {
    if (!status || stale || conflict || saving || loadState === "loading") return;
    const next = !status.runtime.enabled;

    if (next) {
      const ok = await prompt.confirm({
        title: "启用新议题分析？",
        message:
          "启用后仅处理人类新建的 issues.opened：分类、只读仓库证据分析、一条规范化评论。自动关闭仅在 bug + 高置信完整反证门禁全部通过时发生；证据不足保持打开。不会改代码、创建分支或 PR。",
        confirmLabel: "确认启用",
        intent: "default",
      });
      if (!ok) return;
      await patchConfig({ enabled: true });
      setActionNotice({
        tone: "success",
        title: "已启用新议题分析",
        message: "只读分析 + 规范化评论；自动关闭门禁保持严格。",
      });
      return;
    }

    const ok = await prompt.confirm({
      title: "关闭新议题分析？",
      message: "将停止创建新的分析任务。已确认的评论/关闭不会回滚。",
      confirmLabel: "确认关闭",
      intent: "danger",
    });
    if (!ok) return;
    await patchConfig({ enabled: false });
    setActionNotice({
      tone: "info",
      title: "新议题分析已关闭",
      message: "Webhook 仍可验签审计；不会删除历史任务或远端评论。",
    });
  }, [conflict, loadState, patchConfig, prompt, saving, stale, status]);

  const onTogglePaused = useCallback(async () => {
    if (!status || stale || conflict || saving || loadState === "loading") return;
    const next = !status.runtime.paused;
    if (next) {
      await patchConfig({ paused: true });
      setActionNotice({
        tone: "info",
        title: "已全局暂停",
        message: "暂停不改变启用状态；新 Issue 仅审计，已确认副作用不会重放。",
      });
      return;
    }
    await patchConfig({ paused: false });
    setActionNotice({
      tone: "success",
      title: "已恢复",
      message: "将继续未确认阶段的分析任务；不会重跑已确认评论/关闭。",
    });
  }, [conflict, loadState, patchConfig, saving, stale, status]);

  const onConcurrencyChange = useCallback(
    async (value: number) => {
      if (!status || stale || conflict || saving) return;
      if (!Number.isInteger(value) || value < 1 || value > 8) return;
      if (value === status.runtime.analysisMaxConcurrency) return;
      await patchConfig({ analysis: { maxConcurrency: value } });
    },
    [conflict, patchConfig, saving, stale, status],
  );

  const onJobRetry = useCallback(
    async (job: JobSafeProjection) => {
      const retry = job.actions.find((a) => a.action === "retry");
      if (!retry?.available || stale || conflict || busyJobId) return;

      const ok = await prompt.confirm({
        title: "重试未确认阶段？",
        message:
          "只续跑第一个未确认的 checkpoint（分析/评论/关闭）。不会重复已 remote-confirmed 的评论或关闭，也不会重写模型结论（除非结果 sidecar 缺失并 fail closed）。",
        confirmLabel: "仅重试未确认阶段",
        intent: "default",
      });
      if (!ok) return;

      setBusyJobId(job.jobId);
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
            body: JSON.stringify({ action: "retry" }),
          },
        );
        const data = (await res.json().catch(() => null)) as {
          ok?: boolean;
          code?: string;
          message?: string;
          job?: JobSafeProjection;
        } | null;

        if (!res.ok || !data?.ok) {
          const msg = allowlistedMessage(data?.code, "重试未接受");
          setActionNotice({
            tone: "error",
            title: "重试失败",
            message: msg,
          });
          prompt.toast({ message: msg, tone: "error" });
          return;
        }

        if (data.job) {
          setStatus((prev) =>
            prev
              ? {
                  ...prev,
                  jobs: prev.jobs.map((j) => (j.jobId === data.job!.jobId ? data.job! : j)),
                }
              : prev,
          );
        }
        setActionNotice({
          tone: "success",
          title: "已接受重试",
          message: "仅续跑未确认阶段；不会重复已确认评论/关闭。",
        });
        void fetchStatus({ silent: true, reason: "after-retry" });
      } catch {
        setActionNotice({
          tone: "error",
          title: "重试失败",
          message: "网络错误，请稍后重试",
        });
      } finally {
        if (mountedRef.current) setBusyJobId(null);
      }
    },
    [busyJobId, conflict, fetchStatus, prompt, stale],
  );

  const toggleJobExpanded = useCallback((jobId: string) => {
    setExpandedJobIds((prev) => ({ ...prev, [jobId]: !prev[jobId] }));
  }, []);

  const mutationsDisabled = stale || conflict || saving || loadState === "loading";
  const app = credentialStatus ?? status?.readiness.app ?? null;
  const credentialPill = overallCredentialPill(app, stale);
  const banner = primaryBanner(loadState, status, stale, conflict);
  const jobs = status?.jobs ?? [];
  const repoStatusList = status?.repositories ?? [];
  const concurrency = status?.runtime.analysisMaxConcurrency ?? config?.analysis.maxConcurrency ?? 2;
  const enabled = status?.runtime.enabled ?? config?.enabled ?? false;
  const paused = status?.runtime.paused ?? config?.paused ?? false;

  const availableProjects = useMemo(
    () =>
      projectChoices.filter(
        (p) => !p.archived && !p.missing && p.pathStatus === "ok",
      ),
    [projectChoices],
  );

  return (
    <div className="github-automation-page" aria-labelledby={headingId}>
      <header className="github-automation-page-head">
        <div>
          <p className="github-automation-eyebrow">设置 / GitHub 自动化</p>
          <h2 className="github-automation-title" id={headingId}>
            新议题规范化分析
          </h2>
          <p className="github-automation-lead">
            只读分析新建 Issue，生成一条规范化 Markdown 评论；不会修改代码、创建分支或提交
            PR。
          </p>
        </div>
        <div className="github-automation-page-head-actions">
          {savedFlash ? (
            <span className="github-automation-instant-badge" role="status">
              已立即保存
            </span>
          ) : null}
          <a
            className="github-automation-button github-automation-button--help"
            href={GITHUB_AUTOMATION_HELP_HREF}
            target="_blank"
            rel="noreferrer"
          >
            <span aria-hidden="true">↗</span>
            安装指南
          </a>
          <button
            type="button"
            className="github-automation-button"
            onClick={() => void fetchStatus({ reason: "manual" })}
            disabled={refreshing}
            aria-busy={refreshing}
          >
            {refreshing ? "刷新中…" : "刷新状态"}
          </button>
        </div>
      </header>

      {banner ? (
        <div
          className={`github-automation-notice github-automation-notice--${banner.tone}`}
          role={banner.tone === "error" ? "alert" : "status"}
        >
          <span className="github-automation-notice__mark" aria-hidden="true">
            !
          </span>
          <div>
            <strong>{banner.title}</strong>
            <div>{banner.message}</div>
          </div>
        </div>
      ) : null}

      {actionNotice ? (
        <div
          className={`github-automation-notice github-automation-notice--${actionNotice.tone}`}
          role={actionNotice.tone === "error" ? "alert" : "status"}
        >
          <span className="github-automation-notice__mark" aria-hidden="true">
            i
          </span>
          <div>
            <strong>{actionNotice.title}</strong>
            <div>{actionNotice.message}</div>
          </div>
        </div>
      ) : null}

      {loadState === "loading" && !status ? (
        <section className="github-automation-card" aria-busy="true">
          <div className="github-automation-card-body">
            <p className="github-automation-empty">正在加载分析设置…</p>
          </div>
        </section>
      ) : null}

      {/* ── Runtime control ── */}
      <section className="github-automation-card">
        <div className="github-automation-card-head">
          <div>
            <h3 className="github-automation-card-title">运行控制</h3>
            <p className="github-automation-card-sub">
              单一启用开关 + 全局暂停；无 triage / unattended 模式分段。
            </p>
          </div>
          <span
            className={`github-automation-pill github-automation-pill--${
              enabled ? (paused ? "warn" : "ok") : "muted"
            }`}
          >
            {enabled ? (paused ? "已启用 · 已暂停" : "已启用") : "未启用"}
          </span>
        </div>
        <div className="github-automation-card-body">
          <div className="github-automation-control-row">
            <div>
              <label className="github-automation-control-label" htmlFor={enableSwitchId}>
                启用新议题分析
              </label>
              <div className="github-automation-control-help">
                仅处理人工创建的 issues.opened 事件
              </div>
            </div>
            <button
              id={enableSwitchId}
              type="button"
              role="switch"
              aria-checked={enabled}
              className={`github-automation-switch${enabled ? " is-on" : ""}`}
              disabled={mutationsDisabled}
              onClick={() => void onToggleEnabled()}
            >
              <span className="github-automation-switch-knob" aria-hidden="true" />
              <span className="sr-only">{enabled ? "已启用" : "已关闭"}</span>
            </button>
          </div>

          <div className="github-automation-control-row">
            <div>
              <label className="github-automation-control-label" htmlFor={pauseSwitchId}>
                全局暂停
              </label>
              <div className="github-automation-control-help">
                暂停不改变启用状态，恢复后继续未完成阶段
              </div>
            </div>
            <div className="github-automation-control-actions">
              <span
                className={`github-automation-pill github-automation-pill--${
                  paused ? "warn" : "info"
                }`}
              >
                {paused ? "已暂停" : "未暂停"}
              </span>
              <button
                id={pauseSwitchId}
                type="button"
                className="github-automation-button"
                disabled={mutationsDisabled || !enabled}
                onClick={() => void onTogglePaused()}
              >
                {paused ? "恢复" : "暂停"}
              </button>
            </div>
          </div>

          <div className="github-automation-control-row">
            <div>
              <label className="github-automation-control-label" htmlFor={concurrencyId}>
                分析并发
              </label>
              <div className="github-automation-control-help">
                同时进行的 issue_analysis 任务数（1–8）
              </div>
            </div>
            <select
              id={concurrencyId}
              className="github-automation-select"
              value={concurrency}
              disabled={mutationsDisabled}
              onChange={(e) => void onConcurrencyChange(Number(e.target.value))}
            >
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>

          <div className="github-automation-warn-banner" role="note">
            自动关闭仅适用于 bug 且有高置信度、完整且相互独立的反证；证据不足时保持开放。结论仅基于当前绑定的本地仓库静态快照，不能证明与远端默认分支完全同步。
          </div>

          {status ? (
            <div className="github-automation-count-row" aria-label="任务计数">
              <span className="github-automation-count">
                排队 <b>{status.runtime.counts.queued}</b>
              </span>
              <span className="github-automation-count">
                运行 <b>{status.runtime.counts.running}</b>
              </span>
              <span className="github-automation-count github-automation-count--retry">
                重试 <b>{status.runtime.counts.retry}</b>
              </span>
              <span className="github-automation-count github-automation-count--blocked">
                阻塞 <b>{status.runtime.counts.blocked}</b>
              </span>
              <span className="github-automation-count">
                完成 <b>{status.runtime.counts.completed}</b>
              </span>
            </div>
          ) : null}
        </div>
      </section>

      {/* ── Local credentials ── */}
      <section className="github-automation-card">
        <div className="github-automation-card-head">
          <div>
            <h3 className="github-automation-card-title">本机 GitHub App 凭据</h3>
            <p className="github-automation-card-sub">
              保存到本机 agent data dir；页面永不回显 App ID 值、secret、PEM、路径或指纹。
            </p>
          </div>
          <span
            className={`github-automation-pill github-automation-pill--${credentialPill.tone}`}
          >
            {credentialPill.label}
          </span>
        </div>
        <div className="github-automation-card-body">
          <div className="github-automation-cred-status-grid">
            <div className="github-automation-cred-status-item">
              <small>App ID</small>
              <div className="github-automation-cred-status-line">
                <strong>
                  {fieldConfiguredLabel(
                    Boolean(app?.hasAppId),
                    credentialSourceOf(app, "appId"),
                  )}
                </strong>
                <span
                  className={`github-automation-pill github-automation-pill--${sourcePillTone(
                    credentialSourceOf(app, "appId"),
                  )}`}
                >
                  {sourceLabel(credentialSourceOf(app, "appId"))}
                </span>
              </div>
            </div>
            <div className="github-automation-cred-status-item">
              <small>私钥</small>
              <div className="github-automation-cred-status-line">
                <strong>
                  {fieldConfiguredLabel(
                    Boolean(app && hasEffectivePrivateKey(app)),
                    credentialSourceOf(app, "key"),
                  )}
                </strong>
                <span
                  className={`github-automation-pill github-automation-pill--${sourcePillTone(
                    credentialSourceOf(app, "key"),
                  )}`}
                >
                  {sourceLabel(credentialSourceOf(app, "key"))}
                </span>
              </div>
            </div>
            <div className="github-automation-cred-status-item">
              <small>Webhook secret</small>
              <div className="github-automation-cred-status-line">
                <strong>
                  {fieldConfiguredLabel(
                    Boolean(app?.hasWebhookSecret),
                    credentialSourceOf(app, "webhook"),
                  )}
                </strong>
                <span
                  className={`github-automation-pill github-automation-pill--${sourcePillTone(
                    credentialSourceOf(app, "webhook"),
                  )}`}
                >
                  {sourceLabel(credentialSourceOf(app, "webhook"))}
                </span>
              </div>
            </div>
            <div className="github-automation-cred-status-item">
              <small>权限（目标）</small>
              <div className="github-automation-cred-status-line">
                <strong>{permissionsText(status)}</strong>
              </div>
            </div>
          </div>

          <form className="github-automation-cred-form" onSubmit={onSaveCredentials}>
            <div className="github-automation-form-grid">
              <label className="github-automation-field" htmlFor={credentialAppIdFieldId}>
                App ID
                <input
                  id={credentialAppIdFieldId}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={app?.hasAppId ? "已配置 · 留空保留" : "例如 123456"}
                  value={appIdDraft}
                  disabled={credentialSaving || credentialDeleting}
                  onChange={(e) => setAppIdDraft(e.target.value)}
                />
              </label>
              <label className="github-automation-field" htmlFor={credentialWebhookFieldId}>
                Webhook secret
                <input
                  id={credentialWebhookFieldId}
                  type="password"
                  autoComplete="new-password"
                  placeholder={
                    app?.hasWebhookSecret ? "已配置 · 留空保留" : "与 GitHub App 一致"
                  }
                  value={webhookSecretDraft}
                  disabled={credentialSaving || credentialDeleting}
                  onChange={(e) => setWebhookSecretDraft(e.target.value)}
                />
              </label>
            </div>

            <div className="github-automation-cred-seg" role="group" aria-label="私钥输入方式">
              <button
                type="button"
                className={`github-automation-cred-seg-btn${
                  privateKeyMode === "paste" ? " is-selected" : ""
                }`}
                disabled={credentialSaving || credentialDeleting}
                onClick={() => setPrivateKeyInputMode("paste")}
              >
                粘贴 PEM
              </button>
              <button
                type="button"
                className={`github-automation-cred-seg-btn${
                  privateKeyMode === "file" ? " is-selected" : ""
                }`}
                disabled={credentialSaving || credentialDeleting}
                onClick={() => setPrivateKeyInputMode("file")}
              >
                选择 .pem 文件
              </button>
            </div>

            {privateKeyMode === "paste" ? (
              <label className="github-automation-field github-automation-field--full" htmlFor={credentialPemFieldId}>
                私钥 PEM
                <textarea
                  id={credentialPemFieldId}
                  className="github-automation-cred-pem"
                  rows={5}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={
                    app && hasEffectivePrivateKey(app)
                      ? "已配置 · 留空保留；粘贴完整 RSA PEM 以轮换"
                      : "-----BEGIN RSA PRIVATE KEY-----"
                  }
                  value={privateKeyPemDraft}
                  disabled={credentialSaving || credentialDeleting}
                  onChange={(e) => setPrivateKeyPemDraft(e.target.value)}
                />
              </label>
            ) : (
              <div className="github-automation-cred-filebox">
                <label htmlFor={credentialFileFieldId}>私钥文件（.pem）</label>
                <input
                  id={credentialFileFieldId}
                  ref={privateKeyFileInputRef}
                  type="file"
                  accept=".pem,application/x-pem-file,application/octet-stream,text/plain"
                  disabled={credentialSaving || credentialDeleting}
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    setPrivateKeyFile(file);
                  }}
                />
                <p>
                  {privateKeyFile
                    ? `已选择：${privateKeyFile.name}（仅本次上传，成功后清空）`
                    : app && hasEffectivePrivateKey(app)
                      ? "已配置私钥 · 不选择则保留"
                      : "未选择文件"}
                </p>
              </div>
            )}

            <div className="github-automation-cred-form-actions">
              <button
                type="button"
                className="github-automation-button github-automation-button--danger"
                disabled={
                  credentialSaving ||
                  credentialDeleting ||
                  !(app?.local?.configured || app?.local?.hasAppId)
                }
                onClick={() => void onDeleteLocalCredentials()}
              >
                {credentialDeleting ? "移除中…" : "移除本机凭据"}
              </button>
              <div className="github-automation-cred-form-actions-right">
                <button
                  type="button"
                  className="github-automation-button"
                  disabled={credentialSaving || credentialDeleting}
                  onClick={() => {
                    clearCredentialTransient();
                    setCredentialError(null);
                  }}
                >
                  清空输入
                </button>
                <button
                  type="submit"
                  className="github-automation-button github-automation-button--primary"
                  disabled={credentialSaving || credentialDeleting}
                  aria-busy={credentialSaving}
                >
                  {credentialSaving ? "保存中…" : "保存到本机"}
                </button>
              </div>
            </div>

            <div id={credentialLiveRegionId} className="sr-only" aria-live="polite">
              {credentialNotice?.title ?? ""}
            </div>
            {credentialError ? (
              <p className="github-automation-cred-error" role="alert">
                {credentialError}
              </p>
            ) : null}
            {credentialNotice ? (
              <div
                className={`github-automation-notice github-automation-notice--${credentialNotice.tone}`}
                role="status"
              >
                <strong>{credentialNotice.title}</strong>
                <div>{credentialNotice.message}</div>
              </div>
            ) : null}
          </form>

          <details
            className="github-automation-env-details"
            open={envGuideOpen}
            onToggle={(e) => setEnvGuideOpen((e.target as HTMLDetailsElement).open)}
          >
            <summary>高级：环境变量覆盖（仅显示名称，不显示值）</summary>
            <ul className="github-automation-env-guide">
              <li>
                <code className="github-automation-inline-code">{ENV_APP_ID}</code>
                <span>App ID · 优先于本机</span>
              </li>
              <li>
                <code className="github-automation-inline-code">{ENV_PRIVATE_KEY_FILE}</code>
                <span>服务器 PEM 路径（0600）· 页面不输入路径</span>
              </li>
              <li>
                <code className="github-automation-inline-code">{ENV_WEBHOOK_SECRET}</code>
                <span>Webhook secret · 优先于本机</span>
              </li>
              <li>
                <code className="github-automation-inline-code">{ENV_APP_SLUG}</code>
                <span>可选 App slug</span>
              </li>
            </ul>
            <p className="github-automation-field-hint">
              生效优先级：env → 本机 fallback → missing。适合 CI/容器；日常请用上方本机保存。
            </p>
          </details>
        </div>
      </section>

      {/* ── Setup checklist ── */}
      <section className="github-automation-card">
        <div className="github-automation-card-head">
          <div>
            <h3 className="github-automation-card-title">Setup checklist</h3>
            <p className="github-automation-card-sub">
              验证不会 enqueue job、唤醒 scheduler 或调用 GitHub mutation。
            </p>
          </div>
          <div className="github-automation-card-actions">
            <button
              type="button"
              className="github-automation-button github-automation-button--primary"
              onClick={() => void onVerify()}
              disabled={verifying || loadState === "loading"}
              aria-busy={verifying}
            >
              {verifying ? "验证中…" : "验证配置"}
            </button>
          </div>
        </div>
        <div className="github-automation-card-body">
          <div className="github-automation-check" role="list">
            {checklist.map((item, index) => {
              const meta = checklistStateMeta(item.state);
              return (
                <div
                  key={item.code}
                  className="github-automation-check-row"
                  role="listitem"
                >
                  <span
                    className={`github-automation-check-index github-automation-check-index--${
                      meta.tone === "ok"
                        ? "ok"
                        : meta.tone === "bad"
                          ? "bad"
                          : "warn"
                    }`}
                    aria-hidden="true"
                  >
                    {index + 1}
                  </span>
                  <div className="github-automation-check-body">
                    <div className="github-automation-check-title-row">
                      <strong>{item.title}</strong>
                      <span
                        className={`github-automation-pill github-automation-pill--${meta.tone}`}
                      >
                        {meta.label}
                      </span>
                    </div>
                    {item.nextStep ? (
                      <p className="github-automation-check-steps">{item.nextStep}</p>
                    ) : (
                      <p className="github-automation-check-steps">就绪</p>
                    )}
                    {item.envNames.length > 0 ? (
                      <div className="github-automation-env-row">
                        {item.envNames.map((name) => (
                          <code key={name} className="github-automation-env-chip">
                            {name}
                          </code>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          {verifySummary ? (
            <p className="github-automation-verify-meta" role="status">
              最近验证 · {formatSafeTime(verifySummary.app.checkedAt)} · allowlist{" "}
              {verifySummary.allowlist.repositoryCount} · 已绑定项目{" "}
              {verifySummary.allowlist.boundProjectCount} · 模型{" "}
              {verifySummary.model.ready ? "可用" : "不可用"}
            </p>
          ) : (
            <p className="github-automation-verify-meta">
              模型 readiness：{modelText(status)} · Installation：
              {status?.readiness.installation.readiness ?? "—"}
            </p>
          )}
        </div>
      </section>

      {/* ── Repositories ── */}
      <section className="github-automation-card">
        <div className="github-automation-card-head">
          <div>
            <h3 className="github-automation-card-title">允许仓库与本地证据</h3>
            <p className="github-automation-card-sub">
              绑定 owner/repo、repository id、installation id 与 Project Registry
              项目。本地项目仅供只读证据分析，不会改代码。
            </p>
          </div>
          <div className="github-automation-card-actions">
            <button
              type="button"
              className="github-automation-button github-automation-button--primary"
              onClick={openAddForm}
              disabled={mutationsDisabled || formMode.kind !== "closed"}
            >
              添加仓库
            </button>
          </div>
        </div>
        <div className="github-automation-card-body">
          {repositoriesForEdit.length === 0 && formMode.kind === "closed" ? (
            <div className="github-automation-empty github-automation-empty--action">
              <p>尚未关联允许仓库。分析只在 allowlist 内、且 installation id 精确匹配时运行。</p>
              <button
                type="button"
                className="github-automation-button github-automation-button--primary"
                onClick={openAddForm}
                disabled={mutationsDisabled}
              >
                关联第一个仓库
              </button>
            </div>
          ) : null}

          {repositoriesForEdit.map((repo) => {
            const live = repoStatusList.find((r) => r.repositoryId === repo.repositoryId);
            const projectLabel =
              live?.projectDisplayName ||
              projectChoices.find((p) => p.projectId === repo.projectId)?.displayName ||
              (repo.projectId ? repo.projectId : "未绑定");
            return (
              <div key={repo.repositoryId} className="github-automation-repo-card">
                <div className="github-automation-repo-card-main">
                  <div className="github-automation-repo-name">{repo.fullName}</div>
                  <div className="github-automation-meta">
                    <span>
                      repo id <code>{repo.repositoryId}</code>
                    </span>
                    <span>
                      installation <code>{repo.installationId || "—"}</code>
                    </span>
                    {repo.legacySeeded ? (
                      <span className="github-automation-pill github-automation-pill--warn">
                        历史 seed
                      </span>
                    ) : null}
                  </div>
                  <div className="github-automation-repo-grid">
                    <div className="github-automation-repo-cell">
                      <span>本地证据项目</span>
                      {projectLabel}
                      {!repo.projectRootConfigured ? (
                        <div className="github-automation-field-hint">未完成绑定</div>
                      ) : null}
                    </div>
                    <div className="github-automation-repo-cell">
                      <span>Installation</span>
                      {live?.installationBound === false
                        ? "未绑定 / 不匹配"
                        : "已配置 installation id"}
                    </div>
                  </div>
                </div>
                <div className="github-automation-repo-card-actions">
                  <button
                    type="button"
                    className="github-automation-button"
                    disabled={mutationsDisabled}
                    onClick={() => openEditForm(repo)}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    className="github-automation-button github-automation-button--danger"
                    disabled={mutationsDisabled}
                    onClick={() => void onDeleteRepository(repo)}
                  >
                    移除
                  </button>
                </div>
              </div>
            );
          })}

          {formMode.kind !== "closed" ? (
            <form
              ref={formSectionRef}
              className="github-automation-repo-form"
              onSubmit={(e) => {
                e.preventDefault();
                void onSaveRepository();
              }}
              aria-labelledby={formHeadingId}
            >
              <h4 className="github-automation-form-title" id={formHeadingId}>
                {formMode.kind === "edit" ? "编辑仓库关联" : "添加允许仓库"}
              </h4>
              <div className="github-automation-form-grid">
                <label className="github-automation-field" htmlFor={fullNameId}>
                  owner/repo
                  <input
                    id={fullNameId}
                    value={draft.fullName}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, fullName: e.target.value }))
                    }
                    placeholder="acme/docs-site"
                    autoComplete="off"
                    spellCheck={false}
                    disabled={repoSaving}
                    required
                  />
                </label>
                <label className="github-automation-field" htmlFor={repositoryIdFieldId}>
                  repository id
                  <input
                    id={repositoryIdFieldId}
                    value={draft.repositoryId}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, repositoryId: e.target.value }))
                    }
                    placeholder="GitHub 数字 id"
                    inputMode="numeric"
                    autoComplete="off"
                    disabled={repoSaving || formMode.kind === "edit"}
                    required
                  />
                </label>
                <label className="github-automation-field" htmlFor={installationIdFieldId}>
                  installation id
                  <input
                    id={installationIdFieldId}
                    value={draft.installationId}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, installationId: e.target.value }))
                    }
                    placeholder="App installation 数字 id"
                    inputMode="numeric"
                    autoComplete="off"
                    disabled={repoSaving}
                    required
                  />
                </label>
                <label className="github-automation-field" htmlFor={projectIdFieldId}>
                  本地证据项目（Project Registry）
                  <select
                    id={projectIdFieldId}
                    value={draft.projectId}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, projectId: e.target.value }))
                    }
                    disabled={repoSaving || availableProjects.length === 0}
                    required
                  >
                    <option value="">选择项目…</option>
                    {availableProjects.map((p) => (
                      <option key={p.projectId} value={p.projectId}>
                        {p.displayName}
                      </option>
                    ))}
                  </select>
                  <span className="github-automation-field-hint">
                    仅只读证据；服务端解析 canonical root，浏览器不传绝对路径。无 base
                    ref / owner actor ids。
                  </span>
                </label>
              </div>
              {formError ? (
                <p className="github-automation-cred-error" id={formErrorId} role="alert">
                  {formError}
                </p>
              ) : null}
              <div className="github-automation-form-footer">
                <button
                  type="button"
                  className="github-automation-button"
                  onClick={closeForm}
                  disabled={repoSaving}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="github-automation-button github-automation-button--primary"
                  disabled={repoSaving || mutationsDisabled}
                  aria-busy={repoSaving}
                >
                  {repoSaving ? "保存中…" : "保存关联"}
                </button>
              </div>
            </form>
          ) : null}
        </div>
      </section>

      {/* ── Recent analyses ── */}
      <section className="github-automation-card">
        <div className="github-automation-card-head">
          <div>
            <h3 className="github-automation-card-title">最近分析</h3>
            <p className="github-automation-card-sub">
              分类、真实性、评论/关闭状态与安全 reason。不显示 Session / Agent / WorkTree /
              PR。
            </p>
          </div>
        </div>
        <div
          className={`github-automation-card-body${stale ? " github-automation-jobs--stale" : ""}`}
        >
          {jobs.length === 0 ? (
            <p className="github-automation-empty">暂无分析任务。启用后，新 Issue 会显示在这里。</p>
          ) : (
            <div className="github-automation-jobs">
              {jobs.map((job) => {
                const pill = outcomePill(job);
                const expanded = Boolean(expandedJobIds[job.jobId]);
                const retry = job.actions.find((a) => a.action === "retry");
                const title =
                  job.issueTitlePreview?.trim() ||
                  `${job.repositoryFullName}#${job.issueNumber}`;
                return (
                  <article
                    key={job.jobId}
                    className={`github-automation-job-card${
                      job.outcome === "blocked"
                        ? " github-automation-job-card--policy"
                        : job.outcome === "retry_due"
                          ? " github-automation-job-card--retry"
                          : ""
                    }`}
                  >
                    {stale ? (
                      <span className="github-automation-job-stale-badge">可能过期</span>
                    ) : null}
                    <div className="github-automation-analysis-row">
                      <div className="github-automation-job-identity">
                        <div className="github-automation-job-title">
                          <span className="github-automation-truncate">
                            #{job.issueNumber} {title}
                          </span>
                        </div>
                        <div className="github-automation-job-meta">
                          {job.repositoryFullName} · {jobSummaryLine(job)}
                        </div>
                      </div>
                      <span
                        className={`github-automation-pill github-automation-pill--${pill.tone}`}
                      >
                        {pill.label}
                      </span>
                      <div className="github-automation-job-summary-actions">
                        <button
                          type="button"
                          className="github-automation-button"
                          onClick={() => toggleJobExpanded(job.jobId)}
                          aria-expanded={expanded}
                        >
                          {expanded ? "收起" : "详情"}
                        </button>
                        <button
                          type="button"
                          className="github-automation-button github-automation-button--primary"
                          disabled={
                            !retry?.available ||
                            mutationsDisabled ||
                            busyJobId === job.jobId ||
                            job.kind === "legacy_pipeline"
                          }
                          title={
                            retry?.available
                              ? "仅重试未确认阶段"
                              : retryReasonLabel(retry?.reasonCode)
                          }
                          onClick={() => void onJobRetry(job)}
                        >
                          {busyJobId === job.jobId
                            ? "提交中…"
                            : "仅重试未确认阶段"}
                        </button>
                      </div>
                    </div>
                    {expanded ? (
                      <div className="github-automation-job-detail">
                        <div className="github-automation-job-facts">
                          <div>
                            <span className="github-automation-status-label">分类</span>
                            <div>{categoryLabel(job.category)}</div>
                          </div>
                          <div>
                            <span className="github-automation-status-label">真实性</span>
                            <div>
                              {verdictLabel(job.verdict)}
                              {job.confidence ? ` · ${job.confidence}` : ""}
                            </div>
                          </div>
                          <div>
                            <span className="github-automation-status-label">评论</span>
                            <div>{effectLabel(job.comment, "comment")}</div>
                          </div>
                          <div>
                            <span className="github-automation-status-label">关闭</span>
                            <div>{effectLabel(job.close, "close")}</div>
                          </div>
                          <div>
                            <span className="github-automation-status-label">阶段</span>
                            <div>
                              {job.phase} / {job.status}
                            </div>
                          </div>
                          <div>
                            <span className="github-automation-status-label">调度尝试</span>
                            <div>{job.attempt}</div>
                          </div>
                          <div>
                            <span className="github-automation-status-label">reason</span>
                            <div>{job.reasonCode || "—"}</div>
                          </div>
                          <div>
                            <span className="github-automation-status-label">更新时间</span>
                            <div>{formatSafeTime(job.updatedAt)}</div>
                          </div>
                        </div>
                        {job.kind === "legacy_pipeline" ? (
                          <p className="github-automation-field-hint">
                            旧闭环任务已退役（只读），不可 lease / 重试执行。
                          </p>
                        ) : null}
                        {job.nextRetryAt ? (
                          <p className="github-automation-field-hint">
                            下次自动重试：{formatSafeTime(job.nextRetryAt)}
                          </p>
                        ) : null}
                        <p className="github-automation-field-hint">
                          展开内容不含 Issue body、证据原文、prompt、绝对路径或模型原始输出。
                        </p>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ── Safety boundary ── */}
      <section className="github-automation-card">
        <div className="github-automation-card-head">
          <div>
            <h3 className="github-automation-card-title">安全边界</h3>
          </div>
        </div>
        <div className="github-automation-card-body">
          <p className="github-automation-boundary-copy">
            分析只读取绑定项目中的受限文件证据，不执行代码、不访问网络、不读取凭据，不保存
            Issue 原文或模型原始输出。结果分为{" "}
            <code>confirmed</code>、<code>not_exists</code>、<code>inconclusive</code>、
            <code>not_applicable</code>。不会创建 Assignee / WorkTree / Studio Task / Session /
            PR。
          </p>
          {status?.runtimeProvenance ? (
            <p className="github-automation-runtime-provenance">
              runtime · code {status.runtimeProvenance.codeRevision} · policy{" "}
              {status.runtimeProvenance.policyVersion}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
