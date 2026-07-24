/**
 * github-automation-comments — canonical Bot comments with durable markers (GHA-03).
 *
 * - Comments are authored by the GitHub App installation (not machine personal credential).
 * - Each canonical comment embeds a machine-readable marker for idempotent upsert.
 * - Never logs Issue/comment body beyond the controlled template we generate.
 * - Markers must not include secrets / tokens / absolute paths.
 */

import { githubAppInstallationRequest } from "./github-app-client";
import { GithubAutomationError } from "./github-automation-errors";

// ─── Markers ─────────────────────────────────────────────────────────────────

export const GITHUB_AUTOMATION_COMMENT_MARKER_PREFIX =
  "<!-- ypi-github-automation:" as const;

export type GithubAutomationCommentKind =
  | "triage"
  | "claim_blocked"
  | "owner_waiting"
  | "accepted_waiting_automation";

export function buildGithubAutomationCommentMarker(options: {
  kind: GithubAutomationCommentKind;
  repositoryId: number;
  issueNumber: number;
  traceId: string;
}): string {
  const safeTrace = options.traceId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || "none";
  return `${GITHUB_AUTOMATION_COMMENT_MARKER_PREFIX}${options.kind} repo=${options.repositoryId} issue=${options.issueNumber} trace=${safeTrace} -->`;
}

export function commentContainsAutomationMarker(
  body: string | null | undefined,
  kind?: GithubAutomationCommentKind,
): boolean {
  if (typeof body !== "string" || !body.includes(GITHUB_AUTOMATION_COMMENT_MARKER_PREFIX)) {
    return false;
  }
  if (!kind) return true;
  return body.includes(`${GITHUB_AUTOMATION_COMMENT_MARKER_PREFIX}${kind} `);
}

export function extractAutomationMarkerTrace(
  body: string | null | undefined,
): string | null {
  if (typeof body !== "string") return null;
  const m = body.match(
    /<!-- ypi-github-automation:[a-z_]+ repo=\d+ issue=\d+ trace=([A-Za-z0-9_-]+) -->/,
  );
  return m?.[1] ?? null;
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

function sanitizeLogin(login: string): string {
  return login.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || "unknown";
}

function sanitizeCommentLine(line: string): string {
  return line.replace(/\r?\n/g, " ").replace(/<!--/g, "< !--").slice(0, 300);
}

// ─── API helpers ─────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

export interface GithubIssueCommentSummary {
  id: number;
  body: string;
  userLogin: string | null;
  userId: number | null;
  userType: string | null;
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
    const id = item.id;
    const body = item.body;
    if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) continue;
    if (typeof body !== "string") continue;
    let userLogin: string | null = null;
    let userId: number | null = null;
    let userType: string | null = null;
    if (isRecord(item.user)) {
      if (typeof item.user.login === "string") userLogin = item.user.login;
      if (typeof item.user.id === "number") userId = item.user.id;
      if (typeof item.user.type === "string") userType = item.user.type;
    }
    out.push({ id, body, userLogin, userId, userType });
  }
  return out;
}

export async function findAutomationComment(options: {
  installationId: number;
  owner: string;
  repo: string;
  issueNumber: number;
  kind: GithubAutomationCommentKind;
  signal?: AbortSignal;
}): Promise<GithubIssueCommentSummary | null> {
  const comments = await listGithubIssueComments(options);
  for (const c of comments) {
    if (commentContainsAutomationMarker(c.body, options.kind)) {
      return c;
    }
  }
  return null;
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

/**
 * Upsert the canonical automation comment for a kind.
 * Prefer update when marker already exists so retries do not spam.
 */
export async function upsertGithubAutomationComment(options: {
  installationId: number;
  owner: string;
  repo: string;
  issueNumber: number;
  kind: GithubAutomationCommentKind;
  body: string;
  signal?: AbortSignal;
}): Promise<{ id: number; created: boolean }> {
  const existing = await findAutomationComment({
    installationId: options.installationId,
    owner: options.owner,
    repo: options.repo,
    issueNumber: options.issueNumber,
    kind: options.kind,
    signal: options.signal,
  });

  if (existing) {
    // If body is identical, skip write (idempotent).
    if (existing.body === options.body) {
      return { id: existing.id, created: false };
    }
    await updateGithubIssueComment({
      installationId: options.installationId,
      owner: options.owner,
      repo: options.repo,
      commentId: existing.id,
      body: options.body,
      signal: options.signal,
    });
    return { id: existing.id, created: false };
  }

  const created = await createGithubIssueComment({
    installationId: options.installationId,
    owner: options.owner,
    repo: options.repo,
    issueNumber: options.issueNumber,
    body: options.body,
    signal: options.signal,
  });
  return { id: created.id, created: true };
}
