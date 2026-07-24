/**
 * github-automation-setup-verify — fixed readiness checklist for Settings (IMP-001 / IMP-03 / GHCRED-04).
 *
 * ## Contract
 *
 * - Read-only: never enqueues jobs, never wakes the scheduler/runner, never mutates GitHub
 *   beyond App JWT read calls (installation capability lookup), never writes credential store.
 * - Safe projection only: no private key material, webhook secret, absolute projectRoot,
 *   raw webhook bodies, tokens, PEM contents, key paths, or fingerprints.
 * - First three checklist items default to Settings local credential card guidance;
 *   env names remain advanced override hints only (never values).
 * - Invalid/unsupported local fallback is actionable without blocking full env-configured deploys.
 * - Every non-ready item includes an actionable Chinese next-step (not only an error code).
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  ENV_GITHUB_APP_ID,
  ENV_GITHUB_APP_PRIVATE_KEY_FILE,
  ENV_GITHUB_APP_WEBHOOK_SECRET,
  getGithubAppCredentialSafeProjection,
} from "./github-app-credentials";
// Credential store mutations are intentionally not imported: verify is read-only.
import { getGithubInstallationCapability } from "./github-app-client";
import {
  readGithubAutomationConfig,
  resolveGithubAutomationProjectBinding,
} from "./github-automation-config";
import {
  isGithubAutomationError,
  safeGithubAutomationErrorMessage,
} from "./github-automation-errors";
import { assertGithubAutomationProjectionSafe } from "./github-automation-projection";
import {
  getGithubAutomationDeliveriesDir,
  type GithubAutomationDeliveryRecord,
} from "./github-automation-store";
import { getMachineGithubAssigneeSafeProjection } from "./github-machine-assignee";
import {
  deriveGithubAppCapability,
  emptyPermissionSnapshot,
  type GithubAppCapabilitySnapshot,
  type GithubAppCredentialReadinessCode,
  type GithubAppCredentialSafeProjection,
  type GithubAutomationConfigV1,
  type GithubMachineAssigneeSafeProjection,
} from "./github-automation-types";

// ─── Checklist codes / states ────────────────────────────────────────────────

/**
 * Stable checklist item codes for UI / tests.
 * Ordered roughly as the Settings Setup checklist.
 */
export type GithubAutomationSetupChecklistCode =
  | "app_id"
  | "private_key_file"
  | "webhook_secret"
  | "installation"
  | "permissions"
  | "assignee"
  | "allowlist"
  | "project_binding"
  | "webhook_health";

export type GithubAutomationSetupItemState =
  | "ready"
  | "pending"
  | "needs_fix"
  | "unknown";

export type GithubAutomationWebhookHealthCode =
  | "unknown"
  | "healthy"
  | "error";

export interface GithubAutomationSetupChecklistItem {
  code: GithubAutomationSetupChecklistCode;
  /** 1-based display order for the Settings checklist. */
  order: number;
  state: GithubAutomationSetupItemState;
  /** Short Chinese title (UI). */
  title: string;
  /** Allowlisted reason code; never free-form upstream text. */
  reasonCode: string | null;
  /** Actionable Chinese next step when not ready; null when ready. */
  nextStep: string | null;
  /** Safe copyable env names only (never values). */
  envNames: string[];
}

export interface GithubAutomationSetupVerifyResult {
  ok: true;
  generatedAt: string;
  revision: string;
  /** True when every required checklist item is ready. */
  allReady: boolean;
  /** True when P0 triage prerequisites are ready (App + install + issues perms + assignee + allowlist + project). */
  p0Ready: boolean;
  /** True when P0 ready and Contents/PR write permissions are present. */
  p1Ready: boolean;
  /** Unattended remains fail-closed until allReady && p1Ready (UI still requires mode/policy). */
  unattendedEligible: boolean;
  checklist: GithubAutomationSetupChecklistItem[];
  summary: {
    app: Pick<
      GithubAppCredentialSafeProjection,
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
      readiness: GithubMachineAssigneeSafeProjection["readiness"];
      login: string | null;
      assignable: boolean | null;
      identitySource: GithubMachineAssigneeSafeProjection["identitySource"];
      checkedAt: string;
    };
    allowlist: {
      repositoryCount: number;
      ready: boolean;
      boundProjectCount: number;
      unboundCount: number;
    };
    webhook: {
      health: GithubAutomationWebhookHealthCode;
      lastVerifiedAt: string | null;
      recentDeliveryCount: number;
    };
  };
  /** Fixed statement for clients: verify never starts work. */
  sideEffects: {
    enqueuedJobs: false;
    schedulerWoken: false;
    githubMutations: false;
  };
}

// ─── Fixed next-step copy (Chinese; no secrets / absolute paths) ─────────────

const LOCAL_CREDENTIAL_CARD =
  "上方「本机 GitHub App 凭据」卡" as const;

const NEXT_STEPS = {
  missing_app_id:
    `在${LOCAL_CREDENTIAL_CARD}填写 App ID 并「保存到本机」，然后重新验证。高级覆盖可设置 ${ENV_GITHUB_APP_ID}（CI/容器/专业部署）；页面不会回显已保存值。`,
  missing_private_key_file:
    `在${LOCAL_CREDENTIAL_CARD}粘贴或选择 GitHub App RSA 私钥 PEM 并「保存到本机」。高级覆盖可设置 ${ENV_GITHUB_APP_PRIVATE_KEY_FILE} 指向 0600 PEM（仅服务器，不在页面输入路径）。`,
  private_key_unreadable:
    `当前生效私钥不可读。若使用环境变量覆盖，确认 ${ENV_GITHUB_APP_PRIVATE_KEY_FILE} 指向存在且权限为 0600 的 PEM；若使用本机凭据，请在${LOCAL_CREDENTIAL_CARD}重新粘贴/选择私钥并保存。页面不会显示路径或内容。`,
  private_key_invalid:
    `当前生效私钥无效。请确认是完整的 GitHub App RSA PEM（非证书/公钥）。本机配置请在${LOCAL_CREDENTIAL_CARD}重新提交；高级覆盖请更新 ${ENV_GITHUB_APP_PRIVATE_KEY_FILE}。页面不会显示文件内容。`,
  local_credentials_invalid:
    `本机凭据 fallback 损坏或不一致。请在${LOCAL_CREDENTIAL_CARD}移除本机凭据后重新提交完整 App ID、私钥与 Webhook secret。当前若由环境变量完整覆盖仍可继续运行；不会显示损坏内容、路径或指纹。`,
  local_credentials_unsupported:
    `本机凭据 schema 不受支持。请在${LOCAL_CREDENTIAL_CARD}移除本机凭据后按当前版本重新配置完整 bundle。不会自动覆盖未知 schema，也不会显示文件内容。`,
  missing_webhook_secret:
    `在${LOCAL_CREDENTIAL_CARD}填写 Webhook secret 并「保存到本机」，且与 GitHub App webhook secret 一致。高级覆盖可设置 ${ENV_GITHUB_APP_WEBHOOK_SECRET}；页面不会回显 secret。`,
  installation_missing:
    "在 GitHub 上将 App 安装到目标 owner/repo，并在「允许仓库」中填写对应 installation id 后保存，再验证。",
  installation_partial:
    "部分允许仓库尚未绑定 installation id。编辑每个仓库卡片，填写该仓库上的 GitHub App installation id 后保存。",
  permissions_p0:
    "在 GitHub App 安装设置中授予至少：Metadata (read) 与 Issues (read & write)。保存后重新验证。",
  permissions_p1:
    "Triage 权限已就绪；若要启用 unattended，还需 Pull requests (write) 与 Contents (write)。缺失权限时 unattended 保持关闭。",
  assignee_not_ready:
    "在运行 ypi 的服务器上用 gh auth login（github.com）登录可被 assign 的机器账号，或配置可用的 git-credential。验证只解析 login，不会把 token 返回浏览器。",
  allowlist_empty:
    "允许仓库列表为空。点击「关联仓库」，选择 Project Registry 项目并填写 owner/repo 与 installation id。默认不会预置 yolk-pi-web。",
  project_unbound:
    "至少一个允许仓库未绑定可用的 Project Registry 项目。编辑仓库，选择未归档且路径存在的本地项目后保存（浏览器不会看到绝对路径）。",
  project_invalid:
    "已绑定的 Project Registry 项目不可用（未知、已归档或本机路径缺失）。请重新选择有效项目或先在项目注册表中修复该项目。",
  webhook_unknown:
    "尚无已验证的 webhook 投递记录。确认公网 HTTPS 已指向 POST /api/github-automation/webhook，并在 GitHub App 中配置同一 webhook secret 后发送 ping。",
  webhook_error:
    "最近 webhook 投递多为 ignored/error。检查签名 secret、allowlist repository id 与 HTTPS 入口；验证不会重放或展示原始 body。",
  ready: null as string | null,
} as const;

function hasEffectivePrivateKey(app: GithubAppCredentialSafeProjection): boolean {
  return app.hasPrivateKey === true || app.hasPrivateKeyFile === true;
}

function appCredentialItemStates(
  app: GithubAppCredentialSafeProjection,
): {
  appId: GithubAutomationSetupChecklistItem;
  privateKey: GithubAutomationSetupChecklistItem;
  webhookSecret: GithubAutomationSetupChecklistItem;
} {
  const readiness = app.readiness as GithubAppCredentialReadinessCode;
  const sources = app.sources;
  const local = app.local;
  const hasKey = hasEffectivePrivateKey(app);

  // App ID — missing points to Settings local card; env is advanced override only.
  const appIdState: GithubAutomationSetupItemState = app.hasAppId
    ? "ready"
    : "pending";
  const appId: GithubAutomationSetupChecklistItem = {
    code: "app_id",
    order: 1,
    state: appIdState,
    title: "配置 App ID（本机凭据）",
    reasonCode: app.hasAppId ? null : "missing_app_id",
    nextStep: app.hasAppId ? null : NEXT_STEPS.missing_app_id,
    // Keep env name copyable as advanced override; never values.
    envNames: [ENV_GITHUB_APP_ID],
  };

  let privateKeyState: GithubAutomationSetupItemState = "ready";
  let privateKeyReason: string | null = null;
  let privateKeyStep: string | null = null;
  // Diagnose invalid/unreadable before plain missing so damaged local bundles are actionable.
  if (readiness === "private_key_unreadable") {
    privateKeyState = "needs_fix";
    privateKeyReason = "private_key_unreadable";
    privateKeyStep = NEXT_STEPS.private_key_unreadable;
  } else if (readiness === "private_key_invalid") {
    privateKeyState = "needs_fix";
    // Prefer local-bundle diagnostics when the effective key depends on local.
    if (local?.readiness === "unsupported") {
      privateKeyReason = "local_credentials_unsupported";
      privateKeyStep = NEXT_STEPS.local_credentials_unsupported;
    } else if (local?.readiness === "invalid" && sources?.key !== "env") {
      privateKeyReason = "local_credentials_invalid";
      privateKeyStep = NEXT_STEPS.local_credentials_invalid;
    } else {
      privateKeyReason = "private_key_invalid";
      privateKeyStep = NEXT_STEPS.private_key_invalid;
    }
  } else if (!hasKey || readiness === "missing_private_key_file") {
    privateKeyState = "pending";
    privateKeyReason = "missing_private_key_file";
    privateKeyStep = NEXT_STEPS.missing_private_key_file;
  } else if (
    // Effective key ready (e.g. full env overlay) but local fallback is damaged:
    // surface an actionable, non-blocking notice so env deployments stay ready.
    (local?.readiness === "invalid" || local?.readiness === "unsupported") &&
    hasKey
  ) {
    privateKeyState = "ready";
    privateKeyReason =
      local.readiness === "unsupported"
        ? "local_credentials_unsupported"
        : "local_credentials_invalid";
    privateKeyStep =
      local.readiness === "unsupported"
        ? NEXT_STEPS.local_credentials_unsupported
        : NEXT_STEPS.local_credentials_invalid;
  }

  const privateKey: GithubAutomationSetupChecklistItem = {
    code: "private_key_file",
    order: 2,
    state: privateKeyState,
    title: "配置 GitHub App 私钥（本机凭据）",
    reasonCode: privateKeyReason,
    nextStep: privateKeyStep,
    envNames: [ENV_GITHUB_APP_PRIVATE_KEY_FILE],
  };

  const webhookState: GithubAutomationSetupItemState = app.hasWebhookSecret
    ? "ready"
    : "pending";
  const webhookSecret: GithubAutomationSetupChecklistItem = {
    code: "webhook_secret",
    order: 3,
    state: webhookState,
    title: "配置 Webhook secret（本机凭据）",
    reasonCode: app.hasWebhookSecret ? null : "missing_webhook_secret",
    nextStep: app.hasWebhookSecret ? null : NEXT_STEPS.missing_webhook_secret,
    envNames: [ENV_GITHUB_APP_WEBHOOK_SECRET],
  };

  return { appId, privateKey, webhookSecret };
}

function installationSummary(config: GithubAutomationConfigV1): {
  present: boolean;
  installationIdCount: number;
  readiness: "ready" | "missing" | "partial";
  uniqueIds: number[];
} {
  const ids = config.repositories
    .map((r) => r.installationId)
    .filter((id): id is number => typeof id === "number" && Number.isInteger(id) && id > 0);
  const uniqueIds = [...new Set(ids)];
  const present = uniqueIds.length > 0;
  if (config.repositories.length === 0 || !present) {
    return {
      present: false,
      installationIdCount: 0,
      readiness: "missing",
      uniqueIds,
    };
  }
  const allBound = config.repositories.every(
    (r) => typeof r.installationId === "number" && r.installationId > 0,
  );
  return {
    present: true,
    installationIdCount: uniqueIds.length,
    readiness: allBound ? "ready" : "partial",
    uniqueIds,
  };
}

async function resolveCapability(
  appConfigured: boolean,
  uniqueInstallationIds: number[],
  options?: {
    capability?: GithubAppCapabilitySnapshot | null;
    resolveLive?: boolean;
  },
): Promise<GithubAppCapabilitySnapshot> {
  if (options?.capability) {
    return options.capability;
  }
  if (options?.resolveLive === false) {
    return deriveGithubAppCapability(emptyPermissionSnapshot());
  }
  if (!appConfigured || uniqueInstallationIds.length === 0) {
    return deriveGithubAppCapability(emptyPermissionSnapshot());
  }
  // Prefer a single installation when all repos share one; otherwise probe the first.
  const installationId = uniqueInstallationIds[0]!;
  try {
    return await getGithubInstallationCapability(installationId);
  } catch (err) {
    // Fail-closed without throwing the whole verify response.
    if (isGithubAutomationError(err)) {
      return deriveGithubAppCapability(emptyPermissionSnapshot());
    }
    return deriveGithubAppCapability(emptyPermissionSnapshot());
  }
}

async function inspectProjectBindings(
  config: GithubAutomationConfigV1,
  options?: { resolveLive?: boolean },
): Promise<{
  boundProjectCount: number;
  unboundCount: number;
  invalidCount: number;
  ready: boolean;
  reasonCode: string | null;
  nextStep: string | null;
  state: GithubAutomationSetupItemState;
}> {
  if (config.repositories.length === 0) {
    // Project binding is N/A until allowlist has entries; mark pending with allowlist guidance.
    return {
      boundProjectCount: 0,
      unboundCount: 0,
      invalidCount: 0,
      ready: false,
      reasonCode: "allowlist_empty",
      nextStep: NEXT_STEPS.allowlist_empty,
      state: "pending",
    };
  }

  let boundProjectCount = 0;
  let unboundCount = 0;
  let invalidCount = 0;

  for (const repo of config.repositories) {
    const projectId =
      typeof repo.projectId === "string" && repo.projectId.trim()
        ? repo.projectId.trim()
        : null;
    const hasLegacyRoot =
      typeof repo.projectRoot === "string" && repo.projectRoot.trim().length > 0;

    if (!projectId) {
      if (hasLegacyRoot) {
        // Legacy absolute root without projectId: treat as bound for server ops but UI should re-bind.
        boundProjectCount += 1;
      } else {
        unboundCount += 1;
      }
      continue;
    }

    if (options?.resolveLive === false) {
      boundProjectCount += 1;
      continue;
    }

    try {
      await resolveGithubAutomationProjectBinding(projectId);
      boundProjectCount += 1;
    } catch {
      invalidCount += 1;
    }
  }

  if (invalidCount > 0) {
    return {
      boundProjectCount,
      unboundCount,
      invalidCount,
      ready: false,
      reasonCode: "project_invalid",
      nextStep: NEXT_STEPS.project_invalid,
      state: "needs_fix",
    };
  }
  if (unboundCount > 0) {
    return {
      boundProjectCount,
      unboundCount,
      invalidCount,
      ready: false,
      reasonCode: "project_unbound",
      nextStep: NEXT_STEPS.project_unbound,
      state: "pending",
    };
  }
  return {
    boundProjectCount,
    unboundCount,
    invalidCount,
    ready: true,
    reasonCode: null,
    nextStep: null,
    state: "ready",
  };
}

/**
 * Best-effort webhook health from recent exclusive delivery records.
 * Never returns delivery bodies, signatures, or raw envelopes.
 */
export async function inspectGithubAutomationWebhookHealth(options?: {
  maxDays?: number;
  maxFilesPerDay?: number;
}): Promise<{
  health: GithubAutomationWebhookHealthCode;
  lastVerifiedAt: string | null;
  recentDeliveryCount: number;
}> {
  const maxDays = Math.max(1, Math.min(options?.maxDays ?? 3, 7));
  const maxFilesPerDay = Math.max(1, Math.min(options?.maxFilesPerDay ?? 40, 100));
  const now = Date.now();
  let recentDeliveryCount = 0;
  let lastVerifiedAt: string | null = null;
  let sawHealthy = false;
  let sawErrorish = false;

  for (let offset = 0; offset < maxDays; offset += 1) {
    const day = new Date(now - offset * 86_400_000).toISOString().slice(0, 10);
    const dir = getGithubAutomationDeliveriesDir(day);
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      continue;
    }
    const jsonNames = names
      .filter((n) => n.endsWith(".json") && !n.startsWith("."))
      .slice(0, maxFilesPerDay);

    for (const name of jsonNames) {
      try {
        const raw = await readFile(join(dir, name), "utf8");
        const record = JSON.parse(raw) as GithubAutomationDeliveryRecord;
        if (!record || typeof record !== "object") continue;
        if (typeof record.receivedAt !== "string") continue;
        recentDeliveryCount += 1;
        if (!lastVerifiedAt || record.receivedAt > lastVerifiedAt) {
          lastVerifiedAt = record.receivedAt;
        }
        // Healthy: HMAC-accepted delivery (enqueued / duplicate / paused).
        // Signature failures never create delivery records.
        if (
          record.disposition === "enqueued" ||
          record.disposition === "duplicate" ||
          record.disposition === "paused"
        ) {
          sawHealthy = true;
        } else if (record.disposition === "ignored") {
          // Ignored after signature verify still proves webhook ingress + secret.
          if (record.ignoreReason === "malformed_envelope") {
            sawErrorish = true;
          } else {
            sawHealthy = true;
          }
        }
      } catch {
        // Skip unreadable/partial files; do not surface paths or contents.
        continue;
      }
    }
  }

  if (recentDeliveryCount === 0) {
    return { health: "unknown", lastVerifiedAt: null, recentDeliveryCount: 0 };
  }
  if (sawHealthy) {
    return { health: "healthy", lastVerifiedAt, recentDeliveryCount };
  }
  if (sawErrorish) {
    return { health: "error", lastVerifiedAt, recentDeliveryCount };
  }
  return { health: "unknown", lastVerifiedAt, recentDeliveryCount };
}

function assigneeItem(
  assignee: GithubMachineAssigneeSafeProjection,
): GithubAutomationSetupChecklistItem {
  const ready = assignee.readiness === "ready";
  return {
    code: "assignee",
    order: 6,
    state: ready ? "ready" : "needs_fix",
    title: "机器 Assignee 就绪",
    reasonCode: ready ? null : assignee.readiness,
    nextStep: ready ? null : NEXT_STEPS.assignee_not_ready,
    envNames: [],
  };
}

export interface RunGithubAutomationSetupVerifyOptions {
  config?: GithubAutomationConfigV1;
  /** Default true. Tests may inject projections and set false to skip live I/O. */
  resolveLive?: boolean;
  appProjection?: GithubAppCredentialSafeProjection;
  assigneeProjection?: GithubMachineAssigneeSafeProjection;
  capability?: GithubAppCapabilitySnapshot | null;
  webhookHealth?: GithubAutomationWebhookHealthCode;
  webhookLastVerifiedAt?: string | null;
  webhookRecentDeliveryCount?: number;
}

/**
 * Run the fixed setup readiness checklist.
 * Side-effect free w.r.t. jobs/scheduler; may perform read-only App API calls.
 */
export async function runGithubAutomationSetupVerify(
  options: RunGithubAutomationSetupVerifyOptions = {},
): Promise<GithubAutomationSetupVerifyResult> {
  const generatedAt = new Date().toISOString();
  const config = options.config ?? (await readGithubAutomationConfig());
  const resolveLive = options.resolveLive !== false;

  const app =
    options.appProjection ?? (await getGithubAppCredentialSafeProjection(generatedAt));

  const assignee =
    options.assigneeProjection ??
    (await getMachineGithubAssigneeSafeProjection());

  const install = installationSummary(config);
  const capability = await resolveCapability(app.configured, install.uniqueIds, {
    capability: options.capability ?? undefined,
    resolveLive,
  });

  const projects = await inspectProjectBindings(config, { resolveLive });

  let webhookHealth: GithubAutomationWebhookHealthCode =
    options.webhookHealth ?? "unknown";
  let webhookLastVerifiedAt: string | null =
    options.webhookLastVerifiedAt ?? null;
  let webhookRecentDeliveryCount =
    options.webhookRecentDeliveryCount ?? 0;

  if (options.webhookHealth === undefined && resolveLive) {
    const inspected = await inspectGithubAutomationWebhookHealth();
    webhookHealth = inspected.health;
    webhookLastVerifiedAt = inspected.lastVerifiedAt;
    webhookRecentDeliveryCount = inspected.recentDeliveryCount;
  }

  const credItems = appCredentialItemStates(app);

  const installationItem: GithubAutomationSetupChecklistItem = {
    code: "installation",
    order: 4,
    state:
      install.readiness === "ready"
        ? "ready"
        : install.readiness === "partial"
          ? "needs_fix"
          : "pending",
    title: "安装 App 并绑定 installation",
    reasonCode:
      install.readiness === "ready"
        ? null
        : install.readiness === "partial"
          ? "installation_partial"
          : "installation_missing",
    nextStep:
      install.readiness === "ready"
        ? null
        : install.readiness === "partial"
          ? NEXT_STEPS.installation_partial
          : NEXT_STEPS.installation_missing,
    envNames: [],
  };

  let permissionsState: GithubAutomationSetupItemState = "ready";
  let permissionsReason: string | null = null;
  let permissionsStep: string | null = null;
  if (!install.present || !app.configured) {
    permissionsState = "pending";
    permissionsReason = "installation_missing";
    permissionsStep = NEXT_STEPS.installation_missing;
  } else if (!capability.p0Triage) {
    permissionsState = "needs_fix";
    permissionsReason = "permissions_p0";
    permissionsStep = NEXT_STEPS.permissions_p0;
  } else if (!capability.p1Unattended) {
    // P0 ok, P1 missing — still "ready" for triage setup but surface next step for unattended.
    permissionsState = "ready";
    permissionsReason = "permissions_p1_optional";
    permissionsStep = NEXT_STEPS.permissions_p1;
  }

  const permissionsItem: GithubAutomationSetupChecklistItem = {
    code: "permissions",
    order: 5,
    state: permissionsState,
    title: "App 权限（P0 / P1）",
    reasonCode: permissionsReason,
    nextStep: permissionsStep,
    envNames: [],
  };

  const allowlistReady = config.repositories.length > 0;
  const allowlistItem: GithubAutomationSetupChecklistItem = {
    code: "allowlist",
    order: 7,
    state: allowlistReady ? "ready" : "pending",
    title: "允许仓库非空",
    reasonCode: allowlistReady ? null : "allowlist_empty",
    nextStep: allowlistReady ? null : NEXT_STEPS.allowlist_empty,
    envNames: [],
  };

  const projectItem: GithubAutomationSetupChecklistItem = {
    code: "project_binding",
    order: 8,
    state: projects.state,
    title: "本地项目关联",
    reasonCode: projects.reasonCode,
    nextStep: projects.nextStep,
    envNames: [],
  };

  let webhookState: GithubAutomationSetupItemState = "unknown";
  let webhookReason: string | null = "webhook_unknown";
  let webhookStep: string | null = NEXT_STEPS.webhook_unknown;
  if (webhookHealth === "healthy") {
    webhookState = "ready";
    webhookReason = null;
    webhookStep = null;
  } else if (webhookHealth === "error") {
    webhookState = "needs_fix";
    webhookReason = "webhook_error";
    webhookStep = NEXT_STEPS.webhook_error;
  } else {
    webhookState = "unknown";
    webhookReason = "webhook_unknown";
    webhookStep = NEXT_STEPS.webhook_unknown;
  }

  const webhookItem: GithubAutomationSetupChecklistItem = {
    code: "webhook_health",
    order: 9,
    state: webhookState,
    title: "Webhook 入口健康",
    reasonCode: webhookReason,
    nextStep: webhookStep,
    envNames: [ENV_GITHUB_APP_WEBHOOK_SECRET],
  };

  const checklist: GithubAutomationSetupChecklistItem[] = [
    credItems.appId,
    credItems.privateKey,
    credItems.webhookSecret,
    installationItem,
    permissionsItem,
    assigneeItem(assignee),
    allowlistItem,
    projectItem,
    webhookItem,
  ].sort((a, b) => a.order - b.order);

  // Required for "allReady": exclude optional P1-only notice and treat webhook unknown as not blocking triage setup?
  // PRD: checklist includes webhook health if known. Unattended/publish gate should fail closed on missing items.
  // allReady = every item ready OR (webhook unknown is soft? Design says unattended blocked by any checklist blocker).
  // Treat webhook "unknown" as blocker for allReady so operator is pushed to send a ping; p0Ready can still be true without webhook.
  const requiredCodes = new Set<GithubAutomationSetupChecklistCode>([
    "app_id",
    "private_key_file",
    "webhook_secret",
    "installation",
    "permissions",
    "assignee",
    "allowlist",
    "project_binding",
  ]);

  const p0Ready =
    app.configured &&
    install.readiness === "ready" &&
    capability.p0Triage &&
    assignee.readiness === "ready" &&
    allowlistReady &&
    projects.ready;

  const p1Ready = p0Ready && capability.p1Unattended;

  const requiredReady = checklist
    .filter((item) => requiredCodes.has(item.code))
    .every((item) => item.state === "ready");
  // Webhook unknown/error blocks full readiness so operators complete HTTPS ping.
  const allReady = requiredReady && webhookItem.state === "ready";

  const result: GithubAutomationSetupVerifyResult = {
    ok: true,
    generatedAt,
    revision: config.revision,
    allReady,
    p0Ready,
    p1Ready,
    unattendedEligible: p1Ready && allReady,
    checklist,
    summary: {
      app: {
        configured: app.configured,
        readiness: app.readiness,
        hasAppId: app.hasAppId,
        hasPrivateKeyFile: app.hasPrivateKeyFile,
        hasPrivateKey: app.hasPrivateKey ?? app.hasPrivateKeyFile,
        hasWebhookSecret: app.hasWebhookSecret,
        appSlug: app.appSlug,
        checkedAt: app.checkedAt,
        // Additive local/source projection for Settings; never values/paths/fingerprints.
        ...(app.local ? { local: app.local } : {}),
        ...(app.sources ? { sources: app.sources } : {}),
      },
      installation: {
        present: install.present,
        installationIdCount: install.installationIdCount,
        readiness: install.readiness,
      },
      permissions: {
        p0Triage: capability.p0Triage,
        p1Unattended: capability.p1Unattended,
        missingForP0: [...capability.missingForP0],
        missingForP1: [...capability.missingForP1],
      },
      assignee: {
        readiness: assignee.readiness,
        login: assignee.login,
        assignable: assignee.assignable,
        identitySource: assignee.identitySource,
        checkedAt: assignee.checkedAt,
      },
      allowlist: {
        repositoryCount: config.repositories.length,
        ready: allowlistReady,
        boundProjectCount: projects.boundProjectCount,
        unboundCount: projects.unboundCount,
      },
      webhook: {
        health: webhookHealth,
        lastVerifiedAt: webhookLastVerifiedAt,
        recentDeliveryCount: webhookRecentDeliveryCount,
      },
    },
    sideEffects: {
      enqueuedJobs: false,
      schedulerWoken: false,
      githubMutations: false,
    },
  };

  assertGithubAutomationProjectionSafe(result);
  return result;
}

/**
 * Source-level guard helpers for tests: ensure this module never imports scheduler wake.
 * Runtime verify always returns sideEffects all false.
 */
export function githubAutomationSetupVerifySideEffectContract(): {
  enqueuesJobs: false;
  wakesScheduler: false;
  mutatesGithub: false;
} {
  return {
    enqueuesJobs: false,
    wakesScheduler: false,
    mutatesGithub: false,
  };
}

/** Map unexpected verify failures to a safe API body fragment. */
export function safeGithubAutomationSetupVerifyFailure(err: unknown): {
  code: string;
  message: string;
} {
  if (isGithubAutomationError(err)) {
    return { code: err.code, message: err.message };
  }
  return {
    code: "internal_error",
    message: safeGithubAutomationErrorMessage(err),
  };
}
