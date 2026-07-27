/**
 * github-automation-comments — canonical Bot comments with durable markers.
 *
 * - Comments are authored by the GitHub App installation (not machine personal credential).
 * - Each canonical comment embeds a machine-readable marker for idempotent upsert.
 * - Marker identity is stable (kind + repository + issue [+ commentId for receipts]);
 *   never includes trace / time / phase (IDEMP-02).
 * - Never logs Issue/comment body beyond the controlled template we generate.
 * - Markers must not include secrets / tokens / absolute paths.
 * - Semantic body equality skips PATCH; unknown POST/PATCH outcomes reconcile via re-list.
 */

import { createHash } from "node:crypto";
import { githubAppInstallationRequest } from "./github-app-client";
import { GithubAutomationError } from "./github-automation-errors";

/** Opaque full SHA-256 of a comment body (never stores/returns the body). */
function hashCommentBodySha256(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

// ─── Markers ─────────────────────────────────────────────────────────────────

export const GITHUB_AUTOMATION_COMMENT_MARKER_PREFIX =
  "<!-- ypi-github-automation:" as const;

/** Canonical marker schema versions we read/write. */
export type GithubAutomationCommentMarkerVersion = 1 | 2;

/**
 * Canonical comment kinds.
 * receipt/status kinds are reserved for CMD-03 builders; marker identity already supports them.
 */
export type GithubAutomationCommentKind =
  | "triage"
  | "claim_blocked"
  | "owner_waiting"
  | "accepted_waiting_automation"
  | "command_receipt"
  | "automation_status";

export interface ParsedGithubAutomationCommentMarker {
  version: GithubAutomationCommentMarkerVersion;
  kind: GithubAutomationCommentKind;
  repositoryId: number;
  issueNumber: number;
  /** Present only on receipt markers (v2). */
  commentId: number | null;
  /** Present only on legacy v1 markers; never used as identity. */
  trace: string | null;
  raw: string;
}

const KNOWN_COMMENT_KINDS = new Set<string>([
  "triage",
  "claim_blocked",
  "owner_waiting",
  "accepted_waiting_automation",
  "command_receipt",
  "automation_status",
]);

function isCommentKind(value: string): value is GithubAutomationCommentKind {
  return KNOWN_COMMENT_KINDS.has(value);
}

/**
 * Stable v2 marker identity: kind + repositoryId + issueNumber.
 * Receipt markers additionally bind commentId.
 * Trace/time/phase must never enter identity (they stay in local safe audit only).
 */
export function buildGithubAutomationCommentMarker(options: {
  kind: GithubAutomationCommentKind;
  repositoryId: number;
  issueNumber: number;
  /**
   * @deprecated Ignored for marker identity (IDEMP-02). Accepted for call-site
   * compatibility only; never written into the marker.
   */
  traceId?: string;
  /** Required for command_receipt markers; ignored for other kinds. */
  commentId?: number | null;
}): string {
  const repo = Math.trunc(options.repositoryId);
  const issue = Math.trunc(options.issueNumber);
  if (!Number.isFinite(repo) || repo <= 0 || !Number.isFinite(issue) || issue <= 0) {
    // Fail closed to a clearly invalid but non-secret marker rather than throw mid-render.
    return `${GITHUB_AUTOMATION_COMMENT_MARKER_PREFIX}v2 kind=${options.kind} repo=0 issue=0 -->`;
  }

  if (options.kind === "command_receipt") {
    const commentId =
      typeof options.commentId === "number" &&
      Number.isInteger(options.commentId) &&
      options.commentId > 0
        ? options.commentId
        : 0;
    return `${GITHUB_AUTOMATION_COMMENT_MARKER_PREFIX}v2 kind=command_receipt repo=${repo} issue=${issue} comment=${commentId} -->`;
  }

  return `${GITHUB_AUTOMATION_COMMENT_MARKER_PREFIX}v2 kind=${options.kind} repo=${repo} issue=${issue} -->`;
}

/**
 * Parse the first automation marker found in a comment body.
 * Supports stable v2 and legacy v1 (`kind repo=… issue=… trace=…`).
 */
export function parseGithubAutomationCommentMarker(
  body: string | null | undefined,
): ParsedGithubAutomationCommentMarker | null {
  if (typeof body !== "string" || !body.includes(GITHUB_AUTOMATION_COMMENT_MARKER_PREFIX)) {
    return null;
  }

  // v2: <!-- ypi-github-automation:v2 kind=triage repo=1 issue=2 -->
  // v2 receipt: ... kind=command_receipt repo=1 issue=2 comment=9 -->
  const v2 = body.match(
    /<!-- ypi-github-automation:v2 kind=([a-z_]+) repo=(\d+) issue=(\d+)(?: comment=(\d+))? -->/,
  );
  if (v2) {
    const kindRaw = v2[1] ?? "";
    if (!isCommentKind(kindRaw)) return null;
    const repositoryId = Number(v2[2]);
    const issueNumber = Number(v2[3]);
    const commentIdRaw = v2[4];
    const commentId =
      typeof commentIdRaw === "string" && commentIdRaw.length > 0
        ? Number(commentIdRaw)
        : null;
    if (!Number.isInteger(repositoryId) || repositoryId <= 0) return null;
    if (!Number.isInteger(issueNumber) || issueNumber <= 0) return null;
    if (commentId !== null && (!Number.isInteger(commentId) || commentId <= 0)) {
      return null;
    }
    return {
      version: 2,
      kind: kindRaw,
      repositoryId,
      issueNumber,
      commentId,
      trace: null,
      raw: v2[0],
    };
  }

  // v1: <!-- ypi-github-automation:triage repo=1 issue=2 trace=abc -->
  const v1 = body.match(
    /<!-- ypi-github-automation:([a-z_]+) repo=(\d+) issue=(\d+) trace=([A-Za-z0-9_-]+) -->/,
  );
  if (v1) {
    const kindRaw = v1[1] ?? "";
    if (!isCommentKind(kindRaw)) return null;
    const repositoryId = Number(v1[2]);
    const issueNumber = Number(v1[3]);
    if (!Number.isInteger(repositoryId) || repositoryId <= 0) return null;
    if (!Number.isInteger(issueNumber) || issueNumber <= 0) return null;
    return {
      version: 1,
      kind: kindRaw,
      repositoryId,
      issueNumber,
      commentId: null,
      trace: v1[4] ?? null,
      raw: v1[0],
    };
  }

  return null;
}

export function commentMarkerMatchesIdentity(
  marker: ParsedGithubAutomationCommentMarker | null | undefined,
  identity: {
    kind: GithubAutomationCommentKind;
    repositoryId: number;
    issueNumber: number;
    commentId?: number | null;
  },
): boolean {
  if (!marker) return false;
  if (marker.kind !== identity.kind) return false;
  if (marker.repositoryId !== identity.repositoryId) return false;
  if (marker.issueNumber !== identity.issueNumber) return false;
  if (identity.kind === "command_receipt") {
    const expected =
      typeof identity.commentId === "number" &&
      Number.isInteger(identity.commentId) &&
      identity.commentId > 0
        ? identity.commentId
        : null;
    // v1 never had receipt markers; require exact comment binding when expected.
    if (expected !== null && marker.commentId !== expected) return false;
  }
  return true;
}

export function commentContainsAutomationMarker(
  body: string | null | undefined,
  kind?: GithubAutomationCommentKind,
  identity?: {
    repositoryId: number;
    issueNumber: number;
    commentId?: number | null;
  },
): boolean {
  const parsed = parseGithubAutomationCommentMarker(body);
  if (!parsed) return false;
  if (kind && parsed.kind !== kind) return false;
  if (identity) {
    return commentMarkerMatchesIdentity(parsed, {
      kind: kind ?? parsed.kind,
      repositoryId: identity.repositoryId,
      issueNumber: identity.issueNumber,
      commentId: identity.commentId,
    });
  }
  return true;
}

/**
 * @deprecated Trace is no longer part of marker identity. Kept for diagnostics of
 * historical v1 comments only.
 */
export function extractAutomationMarkerTrace(
  body: string | null | undefined,
): string | null {
  const parsed = parseGithubAutomationCommentMarker(body);
  return parsed?.trace ?? null;
}

/**
 * Normalize comment body before equality checks so CRLF / trailing whitespace
 * do not force a no-op-breaking PATCH.
 */
export function normalizeGithubAutomationCommentBody(body: string): string {
  return body.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd();
}

export function githubAutomationCommentBodiesEqual(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  if (typeof left !== "string" || typeof right !== "string") return false;
  return (
    normalizeGithubAutomationCommentBody(left) ===
    normalizeGithubAutomationCommentBody(right)
  );
}

// ─── Bodies (Chinese operator-facing) ────────────────────────────────────────

export type GithubTriageRecommendation = "yes" | "no" | "needs_info";

export function buildTriageConclusionCommentBody(input: {
  marker: string;
  appBotLogin: string | null;
  assigneeLogin: string;
  recommendation: GithubTriageRecommendation;
  reasons: string[];
  nextActions: string[];
  issueTitlePreview: string | null;
}): string {
  const recLabel =
    input.recommendation === "yes"
      ? "建议采纳"
      : input.recommendation === "no"
        ? "不建议采纳"
        : "信息不足 / 暂缓";

  const reasons =
    input.reasons.length > 0
      ? input.reasons.map((r) => `- ${sanitizeCommentLine(r)}`).join("\n")
      : "- （无额外依据）";
  const next =
    input.nextActions.length > 0
      ? input.nextActions.map((r) => `- ${sanitizeCommentLine(r)}`).join("\n")
      : "- 等待仓库 owner 明确表态";

  const bot = input.appBotLogin ? `@${input.appBotLogin}` : "GitHub App Bot";
  const title = input.issueTitlePreview
    ? sanitizeCommentLine(input.issueTitlePreview)
    : "（无标题摘要）";

  return `${input.marker}
## 议题处理结论（YPI 自动化）

- 处理 Bot：${bot}
- 认领展示：@${sanitizeLogin(input.assigneeLogin)}（本机 active GitHub 凭据用户）
- 是否建议采纳：**${recLabel}**
- 议题摘要：${title}

### 分析依据
${reasons}

### 后续动作
${next}

### 身份说明
- App Bot 负责 webhook、labels、评论与后续 PR 写操作。
- 本机凭据用户只作为 GitHub Assignees 展示；其 token 不用于 Bot 写操作。
- 成功认领 = \`ypi:claimed\` + Assignees 含 @${sanitizeLogin(input.assigneeLogin)}。

${buildOwnerCommandHelpSection(input.appBotLogin)}
> 本评论由 YPI GitHub 自动化生成；Issue 正文视为不可信数据。
`;
}

export function buildClaimBlockedCommentBody(input: {
  marker: string;
  appBotLogin: string | null;
  assigneeLogin: string | null;
  reasonCode: string;
  operatorHints: string[];
  issueTitlePreview: string | null;
}): string {
  const bot = input.appBotLogin ? `@${input.appBotLogin}` : "GitHub App Bot";
  const loginLine = input.assigneeLogin
    ? `@${sanitizeLogin(input.assigneeLogin)}`
    : "（未能解析本机 login）";
  const hints =
    input.operatorHints.length > 0
      ? input.operatorHints.map((h) => `- ${sanitizeCommentLine(h)}`).join("\n")
      : "- 修复本机 active \`gh\` / github.com git credential 后重试";

  return `${input.marker}
## 认领未完成（YPI 自动化）

- 处理 Bot：${bot}
- 状态：**认领未完成**（\`blocked_claim_assignee\`）
- 原因码：\`${sanitizeCommentLine(input.reasonCode)}\`
- 已解析 login：${loginLine}
- 议题摘要：${input.issueTitlePreview ? sanitizeCommentLine(input.issueTitlePreview) : "（无标题摘要）"}

### 说明
- **不会**宣称认领成功，**不会**进入 owner 采纳后的自动实现。
- Bot 管理的 \`ypi:claimed\` 不会保留；可显示 \`ypi:claim-blocked\`。
- App Bot 不是 Issue assignee；成功认领必须同时有 label + 本机凭据用户 assignee 回读。

### Operator 修复建议
${hints}

修复后可在 Settings 重试同一 durable job，或等待下一次 webhook 重入；系统会先 reconcile 远端事实，不会重复制造结论评论。
`;
}

export function buildAcceptedWaitingAutomationCommentBody(input: {
  marker: string;
  ownerLogin: string | null;
  assigneeLogin: string;
}): string {
  const owner = input.ownerLogin ? `@${sanitizeLogin(input.ownerLogin)}` : "owner";
  return `${input.marker}
## Owner 已采纳（等待自动化）

- Owner：${owner}
- 认领展示：@${sanitizeLogin(input.assigneeLogin)}
- 状态：\`accepted_waiting_automation\`

P1 无人值守当前关闭或未满足能力门禁。本阶段**不会**创建 WorkTree / branch / PR。
开启文档 + 小 bugfix unattended 后，将从同一 durable job 继续。
`;
}

// ─── CMD-03: command receipt + automation status ─────────────────────────────

export type GithubCommandReceiptStatus =
  | "accepted"
  | "rejected"
  | "ignored"
  | "superseded";

export type GithubOwnerCommandDisplay =
  | "status"
  | "re_evaluate"
  | "adopt"
  | "pause"
  | "continue"
  | "unsupported"
  | "none";

const COMMAND_DISPLAY_ZH: Record<GithubOwnerCommandDisplay, string> = {
  status: "状态",
  re_evaluate: "重新评估",
  adopt: "采纳",
  pause: "暂停",
  continue: "继续",
  unsupported: "（未支持指令）",
  none: "（未识别）",
};

const RECEIPT_STATUS_ZH: Record<GithubCommandReceiptStatus, string> = {
  accepted: "已受理 (Accepted)",
  rejected: "已拒绝 (Rejected)",
  ignored: "被忽略 (Ignored)",
  superseded: "已过时 (Superseded)",
};

/** Chinese reason explanations for public receipt (secondary code stays ASCII). */
export function describeGithubCommandReasonCode(reasonCode: string | null): string {
  switch (reasonCode) {
    case "owner_authorized":
    case "command_accepted":
      return "命令已受理。";
    case "not_owner":
    case "non_owner":
      return "此命令仅限仓库 Owner 执行。";
    case "bot_sender":
      return "Bot/App 不能作为 Owner 授权或下达指令。";
    case "missing_sender":
      return "无法确认评论作者，已 fail-closed。";
    case "incomplete_claim":
      return "完整认领（label + assignee）尚未满足，不能推进实现。";
    case "issue_not_open":
    case "issue_closed":
      return "Issue 已关闭；active job 将保持 blocked/paused，需 reopen 后显式继续。";
    case "recommendation_not_yes":
      return "当前 triage 建议不是「采纳」，不能进入实现。";
    case "automation_paused":
    case "global_paused":
      return "YPI 自动化处于全局暂停；Issue 评论无法解除，请在管理面（Settings）恢复后再试。";
    case "comment_superseded_updated_at":
    case "comment_superseded_body":
    case "superseded":
      return "该评论版本已过时，系统将只处理最新版本。";
    case "comment_missing":
    case "comment_id_mismatch":
    case "comment_author_mismatch":
    case "comment_author_bot":
      return "无法校验 exact comment 身份/版本，已 fail-closed。";
    case "unsupported_command":
      return "未识别的指令。支持：状态 / 重新评估 / 采纳 / 暂停 / 继续。";
    case "no_command":
      return "未识别为定向命令（请使用 @AppBot 或 /ypi）。";
    case "status_only":
      return "只读状态查询，不改变 durable 状态。";
    case "re_evaluated":
      return "已基于最新 Issue title/body 重新评估（不注入评论文本）。";
    case "pause_requested":
      return "已请求在下一检查点暂停本 job（不影响全局暂停）。";
    case "continue_requested":
    case "retry_wake":
      return "已请求继续/唤醒本 job；若全局仍暂停则不会真正执行。";
    case "job_not_pausable":
      return "当前阶段无法应用 per-job 暂停。";
    case "job_not_continuable":
      return "当前阶段无法继续；请确认 job 是否处于可恢复状态且全局未暂停。";
    case "phase_not_applicable":
      return "当前阶段不支持该命令。";
    default:
      return reasonCode
        ? `安全门禁未通过（\`${sanitizeCommentLine(reasonCode)}\`）。`
        : "安全门禁未通过。";
  }
}

export function buildCommandReceiptCommentBody(input: {
  marker: string;
  /** Public actor login for quote only — never body hash / free text. */
  actorLogin: string | null;
  command: GithubOwnerCommandDisplay;
  receiptStatus: GithubCommandReceiptStatus;
  reasonCode: string | null;
  currentPhase: string | null;
  nextAction: string;
  /** Optional secondary note (already safe). */
  note?: string | null;
}): string {
  const actor = input.actorLogin
    ? `@${sanitizeLogin(input.actorLogin)}`
    : "（未知作者）";
  const cmdLabel = COMMAND_DISPLAY_ZH[input.command] ?? "（未识别）";
  const statusLabel = RECEIPT_STATUS_ZH[input.receiptStatus];
  const reason = describeGithubCommandReasonCode(input.reasonCode);
  const phase = input.currentPhase
    ? sanitizeCommentLine(input.currentPhase)
    : "（未知）";
  const next = sanitizeCommentLine(input.nextAction);
  const note =
    typeof input.note === "string" && input.note.trim()
      ? sanitizeCommentLine(input.note)
      : null;
  const reasonCodeLine =
    input.reasonCode && input.reasonCode.trim()
      ? sanitizeCommentLine(input.reasonCode)
      : "—";

  return `${input.marker}
## 指令回执（YPI 自动化）

> ${actor}: ${cmdLabel}

| 字段 | 内容 |
| --- | --- |
| 状态 | **${statusLabel}** |
| 识别指令 | ${cmdLabel} |
| 当前阶段 | \`${phase}\` |
| 原因 | ${reason} |
| 原因码 | \`${reasonCodeLine}\` |
| 下一步 | ${next} |
${note ? `\n> 说明：${note}\n` : ""}
- 本回执绑定 exact comment 版本；同一评论编辑会更新同一回执。
- 不回显评论正文、hash、本地路径或凭据。
- Issue 评论**不能**解除全局暂停，也不能修改 validation / branch / remote / publisher。
`;
}

export function buildAutomationStatusCommentBody(input: {
  marker: string;
  phase: string | null;
  checkpoint: string | null;
  reasonCode: string | null;
  blockedSummary: string | null;
  prUrl: string | null;
  nextAction: string;
}): string {
  const phase = input.phase ? sanitizeCommentLine(input.phase) : "（未知）";
  const checkpoint = input.checkpoint
    ? sanitizeCommentLine(input.checkpoint)
    : "—";
  const blocked = input.blockedSummary
    ? sanitizeCommentLine(input.blockedSummary)
    : "无";
  const pr =
    typeof input.prUrl === "string" && /^https:\/\/github\.com\//i.test(input.prUrl)
      ? input.prUrl.slice(0, 200)
      : "—";
  const reason =
    input.reasonCode && input.reasonCode.trim()
      ? sanitizeCommentLine(input.reasonCode)
      : "—";
  const next = sanitizeCommentLine(input.nextAction);

  return `${input.marker}
## 实施状态更新（YPI 自动化）

| 字段 | 内容 |
| --- | --- |
| 阶段 | \`${phase}\` |
| 最近检查点 | ${checkpoint} |
| 阻塞项 | ${blocked} |
| 原因码 | \`${reason}\` |
| PR | ${pr} |
| 下一步 | ${next} |

> 此评论将随进度**语义变化**时更新，避免刷屏。
> App Bot 不是 Issue assignee；本机凭据用户仅作 Assignees 展示。
`;
}

/** Command help block appended to triage conclusions (approved UI copy). */
export function buildOwnerCommandHelpSection(appBotLogin: string | null): string {
  const bot = appBotLogin ? `@${sanitizeLogin(appBotLogin)}` : "@AppBot";
  return `### 开发者指令（Owner Commands）
请作为仓库 Owner，通过评论 \`${bot} <指令>\` 或行首 \`/ypi <指令>\` 管理任务：

- \`${bot} 采纳\`：批准方案并开始自动实现（需 recommendation=yes 且认领完整）
- \`${bot} 状态\`：只读查看当前阶段与下一步
- \`${bot} 重新评估\`：基于最新 Issue title/body 重新 triage（不注入评论文本）
- \`${bot} 暂停\` / \`${bot} 继续\`：仅控制当前 job（**不能**解除全局暂停）

安全边界：非 Owner / Bot 默认不授权；Issue 评论不能修改 global paused、validation、branch、remote 或 publisher。
`;
}

function sanitizeLogin(login: string): string {
  return login.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || "unknown";
}

function sanitizeCommentLine(line: string): string {
  return line.replace(/\r?\n/g, " ").replace(/<!--/g, "< !--").slice(0, 300);
}

// ─── Exact comment version helpers (IDEMP-02) ────────────────────────────────

export interface GithubExactIssueComment {
  id: number;
  body: string;
  bodySha256: string;
  updatedAt: string | null;
  userLogin: string | null;
  userId: number | null;
  userType: string | null;
}

export type GithubCommentVersionMatch =
  | { ok: true; status: "match" }
  | {
      ok: false;
      status:
        | "missing_comment"
        | "id_mismatch"
        | "author_mismatch"
        | "author_type_rejected"
        | "updated_at_mismatch"
        | "body_hash_mismatch";
      reasonCode: string;
    };

/**
 * Durable opaque key for one comment version.
 * Never includes body text — only ids + opaque hash + optional updatedAt.
 */
export function buildGithubCommentVersionKey(parts: {
  repositoryId: number;
  issueNumber: number;
  commentId: number;
  bodySha256: string;
  updatedAt?: string | null;
}): string {
  const updated =
    typeof parts.updatedAt === "string" && parts.updatedAt.trim()
      ? parts.updatedAt.trim()
      : "";
  const material = [
    String(parts.repositoryId),
    String(parts.issueNumber),
    String(parts.commentId),
    parts.bodySha256,
    updated,
  ].join("|");
  return createHash("sha256").update(material, "utf8").digest("hex");
}

/**
 * Verify a freshly GETted comment against the delivery's exact version envelope.
 * Does not authorize owner commands (CMD-03); only version/identity TOCTOU gates.
 */
export function verifyExactGithubCommentVersion(input: {
  expectedCommentId: number;
  expectedSenderId?: number | null;
  expectedSenderType?: string | null;
  expectedUpdatedAt?: string | null;
  expectedBodySha256?: string | null;
  comment: GithubExactIssueComment | null;
}): GithubCommentVersionMatch {
  if (!input.comment) {
    return {
      ok: false,
      status: "missing_comment",
      reasonCode: "comment_missing",
    };
  }
  if (input.comment.id !== input.expectedCommentId) {
    return {
      ok: false,
      status: "id_mismatch",
      reasonCode: "comment_id_mismatch",
    };
  }

  if (
    typeof input.expectedSenderId === "number" &&
    Number.isInteger(input.expectedSenderId) &&
    input.expectedSenderId > 0
  ) {
    if (input.comment.userId !== input.expectedSenderId) {
      return {
        ok: false,
        status: "author_mismatch",
        reasonCode: "comment_author_mismatch",
      };
    }
  }

  if (typeof input.expectedSenderType === "string" && input.expectedSenderType) {
    const expectedType = input.expectedSenderType.toLowerCase();
    const actualType = (input.comment.userType ?? "").toLowerCase();
    if (expectedType === "bot" || expectedType === "app") {
      // Bot/App never authorize owner paths; surface type rejection early.
      return {
        ok: false,
        status: "author_type_rejected",
        reasonCode: "comment_author_bot",
      };
    }
    if (actualType && actualType !== expectedType) {
      return {
        ok: false,
        status: "author_mismatch",
        reasonCode: "comment_author_type_mismatch",
      };
    }
    if (actualType === "bot" || actualType === "app") {
      return {
        ok: false,
        status: "author_type_rejected",
        reasonCode: "comment_author_bot",
      };
    }
  } else if (
    (input.comment.userType ?? "").toLowerCase() === "bot" ||
    (input.comment.userType ?? "").toLowerCase() === "app"
  ) {
    return {
      ok: false,
      status: "author_type_rejected",
      reasonCode: "comment_author_bot",
    };
  }

  if (
    typeof input.expectedUpdatedAt === "string" &&
    input.expectedUpdatedAt.trim()
  ) {
    if ((input.comment.updatedAt ?? "") !== input.expectedUpdatedAt.trim()) {
      return {
        ok: false,
        status: "updated_at_mismatch",
        reasonCode: "comment_superseded_updated_at",
      };
    }
  }

  if (
    typeof input.expectedBodySha256 === "string" &&
    input.expectedBodySha256.length > 0
  ) {
    if (input.comment.bodySha256 !== input.expectedBodySha256) {
      return {
        ok: false,
        status: "body_hash_mismatch",
        reasonCode: "comment_superseded_body",
      };
    }
  }

  return { ok: true, status: "match" };
}

// ─── API helpers ─────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function parseCommentUser(item: Record<string, unknown>): {
  userLogin: string | null;
  userId: number | null;
  userType: string | null;
} {
  let userLogin: string | null = null;
  let userId: number | null = null;
  let userType: string | null = null;
  if (isRecord(item.user)) {
    if (typeof item.user.login === "string") userLogin = item.user.login;
    if (typeof item.user.id === "number" && Number.isInteger(item.user.id)) {
      userId = item.user.id;
    }
    if (typeof item.user.type === "string") userType = item.user.type;
  }
  return { userLogin, userId, userType };
}

export interface GithubIssueCommentSummary {
  id: number;
  body: string;
  userLogin: string | null;
  userId: number | null;
  userType: string | null;
  updatedAt: string | null;
  bodySha256: string;
}

function toCommentSummary(item: Record<string, unknown>): GithubIssueCommentSummary | null {
  const id = item.id;
  const body = item.body;
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) return null;
  if (typeof body !== "string") return null;
  const user = parseCommentUser(item);
  const updatedAt =
    typeof item.updated_at === "string" && item.updated_at.trim()
      ? item.updated_at.trim()
      : typeof item.created_at === "string" && item.created_at.trim()
        ? item.created_at.trim()
        : null;
  const bodySha256 = hashCommentBodySha256(body);
  return {
    id,
    body,
    userLogin: user.userLogin,
    userId: user.userId,
    userType: user.userType,
    updatedAt,
    bodySha256,
  };
}

/**
 * List issue comments (paginated lightly; P0 issues rarely exceed one page).
 * Bodies are retained only in-memory for marker matching.
 */
export async function listGithubIssueComments(options: {
  installationId: number;
  owner: string;
  repo: string;
  issueNumber: number;
  signal?: AbortSignal;
  perPage?: number;
}): Promise<GithubIssueCommentSummary[]> {
  const perPage = Math.min(100, Math.max(1, options.perPage ?? 100));
  const result = await githubAppInstallationRequest(
    options.installationId,
    `/repos/${encodePathSegment(options.owner)}/${encodePathSegment(options.repo)}/issues/${options.issueNumber}/comments?per_page=${perPage}`,
    { method: "GET", signal: options.signal },
  );

  if (result.status === 403 || result.status === 401) {
    throw new GithubAutomationError("permission_missing", undefined, {
      status: 403,
      details: { reason: "issue_comments_read" },
    });
  }
  if (result.status < 200 || result.status >= 300) {
    throw new GithubAutomationError("github_bad_response", undefined, {
      status: 502,
      details: { httpStatus: result.status, reason: "list_comments" },
    });
  }
  if (!Array.isArray(result.body)) return [];

  const out: GithubIssueCommentSummary[] = [];
  for (const item of result.body) {
    if (!isRecord(item)) continue;
    const summary = toCommentSummary(item);
    if (summary) out.push(summary);
  }
  return out;
}

/**
 * Exact GET for one issue comment by id.
 * Used by command workers (CMD-03) and version verification; never scans "recent" comments.
 */
export async function getGithubIssueComment(options: {
  installationId: number;
  owner: string;
  repo: string;
  commentId: number;
  signal?: AbortSignal;
}): Promise<GithubExactIssueComment | null> {
  if (
    !Number.isInteger(options.commentId) ||
    options.commentId <= 0
  ) {
    return null;
  }

  const result = await githubAppInstallationRequest(
    options.installationId,
    `/repos/${encodePathSegment(options.owner)}/${encodePathSegment(options.repo)}/issues/comments/${options.commentId}`,
    { method: "GET", signal: options.signal },
  );

  if (result.status === 404) return null;
  if (result.status === 403 || result.status === 401) {
    throw new GithubAutomationError("permission_missing", undefined, {
      status: 403,
      details: { reason: "issue_comments_read" },
    });
  }
  if (result.status < 200 || result.status >= 300) {
    throw new GithubAutomationError("github_bad_response", undefined, {
      status: 502,
      details: { httpStatus: result.status, reason: "get_comment" },
    });
  }
  if (!isRecord(result.body)) return null;
  const summary = toCommentSummary(result.body);
  if (!summary) return null;
  return {
    id: summary.id,
    body: summary.body,
    bodySha256: summary.bodySha256,
    updatedAt: summary.updatedAt,
    userLogin: summary.userLogin,
    userId: summary.userId,
    userType: summary.userType,
  };
}

export async function findAutomationComment(options: {
  installationId: number;
  owner: string;
  repo: string;
  issueNumber: number;
  kind: GithubAutomationCommentKind;
  repositoryId: number;
  /** Required when kind === command_receipt. */
  commentId?: number | null;
  signal?: AbortSignal;
}): Promise<GithubIssueCommentSummary | null> {
  const comments = await listGithubIssueComments(options);
  const matches: GithubIssueCommentSummary[] = [];
  for (const c of comments) {
    const parsed = parseGithubAutomationCommentMarker(c.body);
    if (
      commentMarkerMatchesIdentity(parsed, {
        kind: options.kind,
        repositoryId: options.repositoryId,
        issueNumber: options.issueNumber,
        commentId: options.commentId,
      })
    ) {
      matches.push(c);
    }
  }
  if (matches.length === 0) return null;
  // Historical duplicates: choose earliest authority (lowest id). Never auto-delete.
  matches.sort((a, b) => a.id - b.id);
  return matches[0] ?? null;
}

export async function createGithubIssueComment(options: {
  installationId: number;
  owner: string;
  repo: string;
  issueNumber: number;
  body: string;
  signal?: AbortSignal;
}): Promise<{ id: number }> {
  const result = await githubAppInstallationRequest(
    options.installationId,
    `/repos/${encodePathSegment(options.owner)}/${encodePathSegment(options.repo)}/issues/${options.issueNumber}/comments`,
    {
      method: "POST",
      signal: options.signal,
      body: { body: options.body },
    },
  );

  if (result.status === 403 || result.status === 401) {
    throw new GithubAutomationError("permission_missing", undefined, {
      status: 403,
      details: { reason: "issue_comments_write" },
    });
  }
  if (result.status < 200 || result.status >= 300) {
    throw new GithubAutomationError("github_bad_response", undefined, {
      status: 502,
      details: { httpStatus: result.status, reason: "create_comment" },
    });
  }
  if (!isRecord(result.body) || typeof result.body.id !== "number") {
    throw new GithubAutomationError("github_bad_response", undefined, {
      status: 502,
      details: { reason: "create_comment_id" },
    });
  }
  return { id: result.body.id };
}

export async function updateGithubIssueComment(options: {
  installationId: number;
  owner: string;
  repo: string;
  commentId: number;
  body: string;
  signal?: AbortSignal;
}): Promise<{ id: number }> {
  const result = await githubAppInstallationRequest(
    options.installationId,
    `/repos/${encodePathSegment(options.owner)}/${encodePathSegment(options.repo)}/issues/comments/${options.commentId}`,
    {
      method: "PATCH",
      signal: options.signal,
      body: { body: options.body },
    },
  );

  if (result.status === 403 || result.status === 401) {
    throw new GithubAutomationError("permission_missing", undefined, {
      status: 403,
      details: { reason: "issue_comments_write" },
    });
  }
  if (result.status < 200 || result.status >= 300) {
    throw new GithubAutomationError("github_bad_response", undefined, {
      status: 502,
      details: { httpStatus: result.status, reason: "update_comment" },
    });
  }
  return { id: options.commentId };
}

export type GithubAutomationCommentWriteOutcome =
  | "created"
  | "updated"
  | "noop"
  | "remote_confirmed"
  | "reconcile_needed";

export interface UpsertGithubAutomationCommentResult {
  id: number;
  created: boolean;
  /** True only when a POST or PATCH was successfully issued. */
  writePerformed: boolean;
  outcome: GithubAutomationCommentWriteOutcome;
  /** True when multiple matching markers were found; earliest was selected. */
  duplicateWarning: boolean;
}

function isRetriableUnknownWriteError(err: unknown): boolean {
  if (!(err instanceof GithubAutomationError)) return false;
  return (
    err.code === "github_timeout" ||
    err.code === "github_network_error" ||
    err.code === "github_bad_response" ||
    err.code === "github_oversized_response"
  );
}

/**
 * Upsert the canonical automation comment for a kind.
 * - Marker identity is strict (kind/repo/issue[/commentId]).
 * - Semantic body equality → zero PATCH (writePerformed=false).
 * - Unknown POST/PATCH outcome → re-list marker/body; never blind-retry write.
 * - Duplicate markers: earliest id is authority; never auto-delete.
 */
export async function upsertGithubAutomationComment(options: {
  installationId: number;
  owner: string;
  repo: string;
  issueNumber: number;
  repositoryId: number;
  kind: GithubAutomationCommentKind;
  body: string;
  /** Required when kind === command_receipt. */
  commentId?: number | null;
  signal?: AbortSignal;
}): Promise<UpsertGithubAutomationCommentResult> {
  const desiredBody = normalizeGithubAutomationCommentBody(options.body);
  const listAndFind = async (): Promise<{
    existing: GithubIssueCommentSummary | null;
    duplicateWarning: boolean;
  }> => {
    const comments = await listGithubIssueComments({
      installationId: options.installationId,
      owner: options.owner,
      repo: options.repo,
      issueNumber: options.issueNumber,
      signal: options.signal,
    });
    const matches: GithubIssueCommentSummary[] = [];
    for (const c of comments) {
      const parsed = parseGithubAutomationCommentMarker(c.body);
      if (
        commentMarkerMatchesIdentity(parsed, {
          kind: options.kind,
          repositoryId: options.repositoryId,
          issueNumber: options.issueNumber,
          commentId: options.commentId,
        })
      ) {
        matches.push(c);
      }
    }
    if (matches.length === 0) {
      return { existing: null, duplicateWarning: false };
    }
    matches.sort((a, b) => a.id - b.id);
    return {
      existing: matches[0] ?? null,
      duplicateWarning: matches.length > 1,
    };
  };

  const initial = await listAndFind();
  if (initial.existing) {
    if (githubAutomationCommentBodiesEqual(initial.existing.body, desiredBody)) {
      return {
        id: initial.existing.id,
        created: false,
        writePerformed: false,
        outcome: "noop",
        duplicateWarning: initial.duplicateWarning,
      };
    }

    try {
      await updateGithubIssueComment({
        installationId: options.installationId,
        owner: options.owner,
        repo: options.repo,
        commentId: initial.existing.id,
        body: desiredBody,
        signal: options.signal,
      });
      return {
        id: initial.existing.id,
        created: false,
        writePerformed: true,
        outcome: "updated",
        duplicateWarning: initial.duplicateWarning,
      };
    } catch (err) {
      if (!isRetriableUnknownWriteError(err)) throw err;
      // Unknown outcome: re-list; if body already matches, remote_confirmed without retry write.
      const after = await listAndFind();
      if (
        after.existing &&
        githubAutomationCommentBodiesEqual(after.existing.body, desiredBody)
      ) {
        return {
          id: after.existing.id,
          created: false,
          writePerformed: false,
          outcome: "remote_confirmed",
          duplicateWarning: after.duplicateWarning || initial.duplicateWarning,
        };
      }
      if (after.existing) {
        throw new GithubAutomationError("github_bad_response", undefined, {
          status: 502,
          details: {
            reason: "comment_patch_reconcile_needed",
            remoteId: after.existing.id,
          },
        });
      }
      throw err;
    }
  }

  try {
    const created = await createGithubIssueComment({
      installationId: options.installationId,
      owner: options.owner,
      repo: options.repo,
      issueNumber: options.issueNumber,
      body: desiredBody,
      signal: options.signal,
    });
    return {
      id: created.id,
      created: true,
      writePerformed: true,
      outcome: "created",
      duplicateWarning: false,
    };
  } catch (err) {
    if (!isRetriableUnknownWriteError(err)) throw err;
    const after = await listAndFind();
    if (
      after.existing &&
      githubAutomationCommentBodiesEqual(after.existing.body, desiredBody)
    ) {
      return {
        id: after.existing.id,
        created: false,
        writePerformed: false,
        outcome: "remote_confirmed",
        duplicateWarning: after.duplicateWarning,
      };
    }
    if (after.existing) {
      // Marker exists with different body after unknown POST — do not blind-create again.
      throw new GithubAutomationError("github_bad_response", undefined, {
        status: 502,
        details: {
          reason: "comment_create_reconcile_needed",
          remoteId: after.existing.id,
        },
      });
    }
    throw err;
  }
}
