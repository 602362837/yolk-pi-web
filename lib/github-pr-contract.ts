/**
 * github-pr-contract — same-repo Development closing link + PR body template (GHA-07).
 *
 * Rules:
 * - Exactly one same-repo `Fixes #N` (or equivalent single closing keyword) for issue N.
 * - No cross-repo closing links.
 * - Issue remains open until merge; closed-unmerged keeps Issue open.
 * - Agent / Issue text cannot rewrite the closing keyword target.
 * - Manual submit-pr skill remains free-form for humans; automation publisher uses this module.
 */

import { redactGithubAutomationSecrets } from "./github-automation-errors";

/** Allowed single closing keywords for automation PRs (GitHub Development). */
export const GITHUB_PR_CLOSING_KEYWORDS = [
  "Fixes",
  "Closes",
  "Resolves",
] as const;

export type GithubPrClosingKeyword = (typeof GITHUB_PR_CLOSING_KEYWORDS)[number];

export const GITHUB_PR_DEFAULT_CLOSING_KEYWORD: GithubPrClosingKeyword = "Fixes";

export interface GithubPrContractInput {
  repositoryFullName: string;
  repositoryId: number;
  issueNumber: number;
  headBranch: string;
  baseRef: string;
  title: string;
  /** Short Chinese/English scope summary (safe; no secrets). */
  scopeSummary: string;
  /** Validation summary lines already run by operator broker. */
  validationSummary: string;
  /** Residual risk / known limits. */
  riskSummary: string;
  /** Safe trace id for audit. */
  traceId: string;
  /** Optional classification label. */
  classification?: string | null;
  closingKeyword?: GithubPrClosingKeyword;
}

export interface GithubPrBodyParts {
  title: string;
  body: string;
  closingLine: string;
  issueNumber: number;
  repositoryFullName: string;
  headBranch: string;
  baseRef: string;
}

export interface GithubPrClosingContractCheck {
  ok: boolean;
  reasonCode: string | null;
  /** All closing references found (issue numbers). */
  issueNumbers: number[];
  /** Cross-repo refs found (owner/repo#n). */
  crossRepoRefs: string[];
  expectedIssueNumber: number | null;
  message: string;
}

const CROSS_REPO_CLOSING_RE =
  /\b(?:fix(?:es)?|Close(?:s)?|Resolve(?:s)?)\s+([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)\b/gi;
const SAME_REPO_CLOSING_RE =
  /\b(?:Fix(?:es)?|Close(?:s)?|Resolve(?:s)?)\s+#(\d+)\b/gi;

function sanitizeBranch(name: string): string {
  return name.replace(/[^a-zA-Z0-9._/-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 200);
}

function sanitizeTitle(title: string): string {
  const t = redactGithubAutomationSecrets(title).replace(/\s+/g, " ").trim();
  return t.slice(0, 120) || "ypi: automated change";
}

function sanitizeBlock(text: string, max = 4000): string {
  return redactGithubAutomationSecrets(text || "")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, max);
}

/**
 * Build the single required closing line for same-repo Development.
 * Always `Fixes #N` by default — never accepts Issue-provided different numbers.
 */
export function buildGithubPrClosingLine(input: {
  issueNumber: number;
  keyword?: GithubPrClosingKeyword;
}): string {
  const n = Math.floor(input.issueNumber);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error("issueNumber must be a positive integer for PR closing contract");
  }
  const keyword = input.keyword ?? GITHUB_PR_DEFAULT_CLOSING_KEYWORD;
  return `${keyword} #${n}`;
}

/**
 * Build automation PR title + body with fixed sections and exactly one Fixes #N.
 */
export function buildGithubAutomationPrBody(
  input: GithubPrContractInput,
): GithubPrBodyParts {
  const issueNumber = Math.floor(input.issueNumber);
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    throw new Error("issueNumber must be a positive integer");
  }
  const fullName = input.repositoryFullName.trim();
  if (!fullName || fullName.includes("..") || /\s/.test(fullName)) {
    throw new Error("repositoryFullName is invalid");
  }

  const closingLine = buildGithubPrClosingLine({
    issueNumber,
    keyword: input.closingKeyword,
  });
  const headBranch = sanitizeBranch(input.headBranch);
  const baseRef = sanitizeBranch(input.baseRef) || "main";
  const title = sanitizeTitle(input.title);

  const scope = sanitizeBlock(input.scopeSummary, 2000) || "见提交 diff。";
  const validation =
    sanitizeBlock(input.validationSummary, 2000) || "见 operator validation broker。";
  const risk =
    sanitizeBlock(input.riskSummary, 2000) ||
    "Full agent 非沙箱：可能已执行任意命令/联网/读取同 OS 用户可见文件；final diff gate 只限制可发布的 Git 变更。";
  const trace = sanitizeBlock(input.traceId, 120) || "unknown";
  const classification = sanitizeBlock(input.classification ?? "", 80) || "docs-and-small-bugfix";

  const body = [
    "## 自动化变更说明",
    "",
    `- **仓库：** \`${fullName}\` (id=${input.repositoryId})`,
    `- **分类：** ${classification}`,
    `- **Head：** \`${headBranch}\``,
    `- **Base：** \`${baseRef}\``,
    `- **Trace：** \`${trace}\``,
    "",
    "## 范围",
    "",
    scope,
    "",
    "## 验证",
    "",
    validation,
    "",
    "## 风险与残留风险",
    "",
    risk,
    "",
    "## Issue Development 契约",
    "",
    `- 合并后按 GitHub 规则关闭关联议题；**合并前议题保持 open**。`,
    `- 若 PR 未合并关闭（closed-unmerged），议题保持 open，需人工接手。`,
    `- 自动化**不会** auto-merge、不会直推 \`${baseRef}\`、不会 force-push。`,
    "",
    "## Closing",
    "",
    closingLine,
    "",
    "<!-- ypi-github-automation:pr-contract v1 -->",
    "",
  ].join("\n");

  // Self-check: body must contain exactly one same-repo closing for this issue.
  const check = checkGithubPrClosingContract(body, issueNumber);
  if (!check.ok) {
    throw new Error(`PR body failed closing contract: ${check.message}`);
  }

  return {
    title,
    body,
    closingLine,
    issueNumber,
    repositoryFullName: fullName,
    headBranch,
    baseRef,
  };
}

/**
 * Validate that a PR body has exactly one same-repo closing keyword for expectedIssue
 * and zero cross-repo closing links.
 */
export function checkGithubPrClosingContract(
  body: string,
  expectedIssueNumber: number,
): GithubPrClosingContractCheck {
  const expected = Math.floor(expectedIssueNumber);
  if (!Number.isInteger(expected) || expected <= 0) {
    return {
      ok: false,
      reasonCode: "invalid_expected_issue",
      issueNumbers: [],
      crossRepoRefs: [],
      expectedIssueNumber: null,
      message: "expectedIssueNumber must be a positive integer",
    };
  }

  const text = body || "";
  const crossRepoRefs: string[] = [];
  for (const m of text.matchAll(CROSS_REPO_CLOSING_RE)) {
    crossRepoRefs.push(`${m[1]}#${m[2]}`);
  }
  if (crossRepoRefs.length > 0) {
    return {
      ok: false,
      reasonCode: "cross_repo_closing",
      issueNumbers: [],
      crossRepoRefs,
      expectedIssueNumber: expected,
      message: "Cross-repo closing links are not allowed in automation PRs",
    };
  }

  const issueNumbers: number[] = [];
  for (const m of text.matchAll(SAME_REPO_CLOSING_RE)) {
    const n = Number.parseInt(m[1] ?? "", 10);
    if (Number.isInteger(n) && n > 0) issueNumbers.push(n);
  }

  if (issueNumbers.length === 0) {
    return {
      ok: false,
      reasonCode: "missing_closing",
      issueNumbers,
      crossRepoRefs: [],
      expectedIssueNumber: expected,
      message: `Missing same-repo Fixes #${expected} (or Closes/Resolves)`,
    };
  }

  const unique = [...new Set(issueNumbers)];
  if (unique.length !== 1 || unique[0] !== expected) {
    return {
      ok: false,
      reasonCode: "closing_mismatch",
      issueNumbers: unique,
      crossRepoRefs: [],
      expectedIssueNumber: expected,
      message: `Expected exactly Fixes #${expected}, found: ${unique.map((n) => `#${n}`).join(", ")}`,
    };
  }

  return {
    ok: true,
    reasonCode: null,
    issueNumbers: unique,
    crossRepoRefs: [],
    expectedIssueNumber: expected,
    message: `Closing contract ok: Fixes #${expected}`,
  };
}

/**
 * Reviewer helper: missing/invalid closing contract is a merge blocker for automation PRs.
 */
export function isGithubAutomationPrClosingBlocking(input: {
  body: string;
  expectedIssueNumber?: number | null;
  hasAutomationMarker?: boolean;
}): { block: boolean; reasonCode: string | null; message: string } {
  const hasMarker =
    input.hasAutomationMarker === true ||
    /ypi-github-automation:pr-contract/i.test(input.body || "");
  // Always enforce when marker present; if expected issue given, enforce even without marker
  // when caller knows this is an automation PR.
  if (!hasMarker && (input.expectedIssueNumber == null || input.expectedIssueNumber <= 0)) {
    return {
      block: false,
      reasonCode: null,
      message: "Not identified as automation PR; closing contract not enforced here.",
    };
  }
  if (input.expectedIssueNumber == null || input.expectedIssueNumber <= 0) {
    // Try to discover sole closing number; if none, block.
    const found: number[] = [];
    for (const m of (input.body || "").matchAll(SAME_REPO_CLOSING_RE)) {
      const n = Number.parseInt(m[1] ?? "", 10);
      if (Number.isInteger(n) && n > 0) found.push(n);
    }
    const unique = [...new Set(found)];
    if (unique.length !== 1) {
      return {
        block: true,
        reasonCode: "missing_or_ambiguous_closing",
        message: "Automation PR must contain exactly one same-repo Fixes #N",
      };
    }
    return {
      block: false,
      reasonCode: null,
      message: `Closing contract present: #${unique[0]}`,
    };
  }
  const check = checkGithubPrClosingContract(input.body, input.expectedIssueNumber);
  return {
    block: !check.ok,
    reasonCode: check.reasonCode,
    message: check.message,
  };
}

/**
 * Safe identity for reconciling existing PRs by head/base (no body).
 */
export interface GithubExistingPrIdentity {
  number: number;
  htmlUrl: string;
  state: "open" | "closed" | string;
  headRef: string;
  baseRef: string;
  merged: boolean;
}

/**
 * Pick the automation PR to reuse: same head + base, prefer open, then lowest number.
 */
export function selectReusableGithubPr(
  candidates: readonly GithubExistingPrIdentity[],
  input: { headBranch: string; baseRef: string },
): GithubExistingPrIdentity | null {
  const head = sanitizeBranch(input.headBranch);
  const base = sanitizeBranch(input.baseRef) || "main";
  const matches = candidates.filter(
    (p) =>
      sanitizeBranch(p.headRef) === head &&
      sanitizeBranch(p.baseRef) === base,
  );
  if (matches.length === 0) return null;
  const open = matches.filter((p) => p.state === "open");
  const pool = open.length > 0 ? open : matches;
  return [...pool].sort((a, b) => a.number - b.number)[0] ?? null;
}
