/**
 * github-risk-policy — docs + small-bugfix classification for unattended P1 (GHA-07).
 *
 * Profile: riskProfile = "docs-and-small-bugfix"
 *
 * Allow:
 * - Markdown / pure documentation and corresponding docs indexes
 * - Explicit, local, low-risk bugfixes within operator file/line limits,
 *   with targeted verification and no new product decisions
 *
 * Deny / blocked:
 * - UI / interaction / user-visible structure
 * - workflow / Actions / release / tag / publish
 * - secret / auth / credential / OAuth / provider stores
 * - dependency / lockfile changes
 * - infra / deploy / CI platform
 * - cross-repo
 * - large refactor
 * - binary / symlink / submodule
 * - uncertain classification or over-limit diffs
 *
 * Stages: pre (plan/intent), plan (declared files), final (actual diff).
 * Issue text cannot change this policy or validation commands.
 *
 * Residual risk: classification only gates publish. Full agent may already have
 * run arbitrary commands before a final block — this is not a sandbox.
 */

import type { GithubAutomationRiskProfile } from "./github-automation-types";
import {
  GITHUB_FULL_AGENT_RISK_PROFILE,
  GITHUB_UNATTENDED_POLICY_ID,
  GITHUB_UNATTENDED_POLICY_VERSION,
} from "./github-full-agent-profile";

export const GITHUB_RISK_POLICY_ID = GITHUB_UNATTENDED_POLICY_ID;
export const GITHUB_RISK_POLICY_VERSION = GITHUB_UNATTENDED_POLICY_VERSION;
export const GITHUB_RISK_POLICY_PROFILE: GithubAutomationRiskProfile =
  GITHUB_FULL_AGENT_RISK_PROFILE;

export type GithubRiskPolicyStage = "pre" | "plan" | "final";

export type GithubRiskPolicyDecision = "allow" | "block";

export type GithubRiskPolicyClass =
  | "docs"
  | "small_bugfix"
  | "ui_interaction"
  | "workflow_ci"
  | "release_publish"
  | "secret_auth"
  | "dependency_lockfile"
  | "infra"
  | "cross_repo"
  | "large_refactor"
  | "binary_or_symlink"
  | "submodule"
  | "generated_artifact"
  | "over_limit"
  | "uncertain"
  | "empty";

export type GithubRiskPolicyReasonCode =
  | "allowed_docs"
  | "allowed_small_bugfix"
  | "blocked_ui_interaction"
  | "blocked_workflow_ci"
  | "blocked_release_publish"
  | "blocked_secret_auth"
  | "blocked_dependency_lockfile"
  | "blocked_infra"
  | "blocked_cross_repo"
  | "blocked_large_refactor"
  | "blocked_binary_or_symlink"
  | "blocked_submodule"
  | "blocked_generated_artifact"
  | "blocked_over_limit"
  | "blocked_uncertain"
  | "blocked_empty_diff"
  | "blocked_risk_profile";

export interface GithubRiskPolicyLimits {
  maxFiles: number;
  maxChangedLines: number;
}

export interface GithubRiskPolicyFileChange {
  /** Repo-relative path using `/` separators. */
  path: string;
  /** Optional git status letter: A/M/D/R/C/T/U. */
  status?: string;
  additions?: number;
  deletions?: number;
  /** True when path is a symlink (from git ls-files -s or lstat). */
  isSymlink?: boolean;
  /** True when git reports a submodule / gitlink. */
  isSubmodule?: boolean;
  /** True when file is classified as binary by git diff. */
  isBinary?: boolean;
}

export interface GithubRiskPolicyInput {
  stage: GithubRiskPolicyStage;
  riskProfile?: GithubAutomationRiskProfile | string | null;
  limits: GithubRiskPolicyLimits;
  files: readonly GithubRiskPolicyFileChange[];
  /**
   * Optional free-text plan/title signals (never treated as trusted commands).
   * Used only as fail-closed hints for UI / release / secret keywords.
   */
  planText?: string | null;
  issueTitlePreview?: string | null;
  /**
   * When true, caller asserts the change is an explicit small bugfix with
   * targeted verification already recorded. Without this, non-docs paths that
   * are not obviously blocked still become `uncertain` (fail closed).
   */
  explicitSmallBugfix?: boolean;
}

export interface GithubRiskPolicyResult {
  decision: GithubRiskPolicyDecision;
  classification: GithubRiskPolicyClass;
  reasonCode: GithubRiskPolicyReasonCode;
  stage: GithubRiskPolicyStage;
  riskProfile: GithubAutomationRiskProfile;
  fileCount: number;
  changedLines: number;
  maxFiles: number;
  maxChangedLines: number;
  /** Safe paths that triggered the block (truncated). */
  blockedPaths: string[];
  message: string;
}

const DOC_PATH_RE =
  /(?:^|\/)(?:docs\/|readme(?:\.[^/]+)?$|changelog(?:\.[^/]+)?$|contributing(?:\.[^/]+)?$|license(?:\.[^/]+)?$|agents\.md$|code_of_conduct(?:\.[^/]+)?$)/i;
const DOC_EXT_RE = /\.(?:md|mdx|rst|adoc|txt)$/i;
const DOC_IMAGE_RE = /\.(?:png|jpe?g|gif|svg|webp)$/i;

const WORKFLOW_PATH_RE =
  /(?:^|\/)\.github\/(?:workflows|actions)\//i;
const RELEASE_PATH_RE =
  /(?:^|\/)(?:\.github\/(?:release|ISSUE_TEMPLATE|PULL_REQUEST_TEMPLATE)|scripts\/(?:release|publish)|ecosystem\.config\.[cm]?js$)/i;
const SECRET_AUTH_PATH_RE =
  /(?:^|\/)(?:\.env(?:\..*)?$|.*(?:secret|credential|oauth|auth-api-key|private[_-]?key).*)/i;
const AUTH_CODE_PATH_RE =
  /(?:^|\/)(?:lib\/(?:web-credential-store|web-auth-config-value|oauth-account|github-link-oauth|github-app-credentials|links-)|app\/api\/auth\/)/i;
const DEPENDENCY_PATH_RE =
  /(?:^|\/)(?:package(?:-lock)?\.json$|npm-shrinkwrap\.json$|yarn\.lock$|pnpm-lock\.yaml$|bun\.lockb?$|Cargo\.lock$|go\.sum$|poetry\.lock$|composer\.lock$)$/i;
const PACKAGE_JSON_RE = /(?:^|\/)package\.json$/i;
const INFRA_PATH_RE =
  /(?:^|\/)(?:Dockerfile(?:\..*)?$|docker-compose(?:\..*)?\.ya?ml$|\.dockerignore$|k8s\/|helm\/|terraform\/|\.tf$|cloudflare|wrangler\.toml$|nginx|Procfile$)/i;
const UI_PATH_RE =
  /(?:^|\/)(?:components\/|app\/(?!api\/).*|hooks\/|public\/|styles\/|.*\.(?:css|scss|sass|less|module\.css)$|.*(?:Settings|Panel|Modal|Dialog|Button|Sidebar|ChatWindow|prototype)\.(?:tsx|jsx|html)$)/i;
const GENERATED_PATH_RE =
  /(?:^|\/)(?:\.next\/|dist\/|build\/|coverage\/|node_modules\/|\.turbo\/|out\/)/i;
const BINARY_EXT_RE =
  /\.(?:exe|dll|so|dylib|bin|o|a|zip|tar|gz|tgz|bz2|7z|rar|pdf|woff2?|ttf|eot|ico|mp4|mp3|wav|mov|wasm|class|jar|dmg|pkg|apk)$/i;
const SUBMODULE_PATH_RE = /(?:^|\/)\.gitmodules$/i;

// Note: JS \b is ASCII-word only; CJK keywords must not rely on \b alone.
const PLAN_UI_HINT_RE =
  /(?:\b(?:ui|ux|prototype|visual|layout|css)\b|settings\s*ui|html\s*原型|交互|界面|页面|组件|弹窗|设置页)/i;
const PLAN_RELEASE_HINT_RE =
  /(?:\b(?:release|publish)\b|npm\s+publish|打\s*tag|发版|上线发布)/i;
const PLAN_SECRET_HINT_RE =
  /(?:\b(?:secret|token|oauth)\b|api\s*key|private\s*key|webhook\s*secret|凭据|密钥)/i;
const PLAN_REFACTOR_HINT_RE =
  /(?:\b(?:refactor|rewrite|re-?architect)\b|大重构|迁移|全面重构)/i;

const DEFAULT_LIMITS: GithubRiskPolicyLimits = {
  maxFiles: 12,
  maxChangedLines: 500,
};

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function isDocsPath(path: string): boolean {
  const p = normalizePath(path);
  if (!p) return false;
  if (GENERATED_PATH_RE.test(p)) return false;
  if (DOC_PATH_RE.test(p)) return true;
  if (DOC_EXT_RE.test(p) && !/(?:^|\/)(?:src|lib|app|components|hooks)\//i.test(p)) {
    // Markdown outside app runtime trees counts as docs (README, root AGENTS.md, docs/).
    return true;
  }
  // Docs images under docs/ only.
  if (DOC_IMAGE_RE.test(p) && /(?:^|\/)docs\//i.test(p)) return true;
  // Flat project skill/doc markdown under .pi/skills or docs is docs.
  if (DOC_EXT_RE.test(p) && /(?:^|\/)(?:\.pi\/skills\/|docs\/)/i.test(p)) return true;
  return false;
}

function classifyPath(file: GithubRiskPolicyFileChange): GithubRiskPolicyClass {
  const path = normalizePath(file.path);
  if (!path) return "uncertain";

  if (file.isSubmodule || SUBMODULE_PATH_RE.test(path)) return "submodule";
  if (file.isSymlink) return "binary_or_symlink";
  if (file.isBinary || BINARY_EXT_RE.test(path)) return "binary_or_symlink";
  if (GENERATED_PATH_RE.test(path)) return "generated_artifact";
  if (WORKFLOW_PATH_RE.test(path)) return "workflow_ci";
  if (RELEASE_PATH_RE.test(path)) return "release_publish";
  if (DEPENDENCY_PATH_RE.test(path) || PACKAGE_JSON_RE.test(path)) {
    return "dependency_lockfile";
  }
  if (SECRET_AUTH_PATH_RE.test(path) || AUTH_CODE_PATH_RE.test(path)) {
    return "secret_auth";
  }
  if (INFRA_PATH_RE.test(path)) return "infra";
  if (UI_PATH_RE.test(path)) return "ui_interaction";
  if (isDocsPath(path)) return "docs";

  // Source/test paths may be small bugfix only when caller marks them explicit.
  if (
    /(?:^|\/)(?:lib|app\/api|scripts|bin)\//i.test(path) ||
    /\.(?:ts|tsx|js|jsx|mjs|cjs)$/i.test(path)
  ) {
    return "small_bugfix";
  }

  return "uncertain";
}

function reasonForClass(classification: GithubRiskPolicyClass): GithubRiskPolicyReasonCode {
  switch (classification) {
    case "docs":
      return "allowed_docs";
    case "small_bugfix":
      return "allowed_small_bugfix";
    case "ui_interaction":
      return "blocked_ui_interaction";
    case "workflow_ci":
      return "blocked_workflow_ci";
    case "release_publish":
      return "blocked_release_publish";
    case "secret_auth":
      return "blocked_secret_auth";
    case "dependency_lockfile":
      return "blocked_dependency_lockfile";
    case "infra":
      return "blocked_infra";
    case "cross_repo":
      return "blocked_cross_repo";
    case "large_refactor":
      return "blocked_large_refactor";
    case "binary_or_symlink":
      return "blocked_binary_or_symlink";
    case "submodule":
      return "blocked_submodule";
    case "generated_artifact":
      return "blocked_generated_artifact";
    case "over_limit":
      return "blocked_over_limit";
    case "empty":
      return "blocked_empty_diff";
    case "uncertain":
    default:
      return "blocked_uncertain";
  }
}

function messageFor(
  decision: GithubRiskPolicyDecision,
  classification: GithubRiskPolicyClass,
  stage: GithubRiskPolicyStage,
): string {
  if (decision === "allow") {
    return classification === "docs"
      ? `Stage ${stage}: documentation changes are allowed under docs-and-small-bugfix.`
      : `Stage ${stage}: explicit small bugfix is allowed under docs-and-small-bugfix.`;
  }
  switch (classification) {
    case "ui_interaction":
      return `Stage ${stage}: UI/interaction/user-visible structure changes are blocked (manual HTML approval).`;
    case "workflow_ci":
      return `Stage ${stage}: workflow/CI/Actions changes are blocked.`;
    case "release_publish":
      return `Stage ${stage}: release/publish/tag changes are blocked.`;
    case "secret_auth":
      return `Stage ${stage}: secret/auth/credential changes are blocked.`;
    case "dependency_lockfile":
      return `Stage ${stage}: dependency/lockfile changes are blocked.`;
    case "infra":
      return `Stage ${stage}: infrastructure/deploy changes are blocked.`;
    case "cross_repo":
      return `Stage ${stage}: cross-repository changes are blocked.`;
    case "large_refactor":
      return `Stage ${stage}: large refactor / migration is blocked.`;
    case "binary_or_symlink":
      return `Stage ${stage}: binary or symlink changes are blocked.`;
    case "submodule":
      return `Stage ${stage}: submodule changes are blocked.`;
    case "generated_artifact":
      return `Stage ${stage}: generated build artifacts are blocked.`;
    case "over_limit":
      return `Stage ${stage}: diff exceeds operator maxFiles/maxChangedLines.`;
    case "empty":
      return `Stage ${stage}: empty diff cannot be published.`;
    default:
      return `Stage ${stage}: classification uncertain — fail closed (no publish).`;
  }
}

function planTextHints(
  text: string | null | undefined,
): GithubRiskPolicyClass | null {
  if (!text || !text.trim()) return null;
  if (PLAN_UI_HINT_RE.test(text)) return "ui_interaction";
  if (PLAN_RELEASE_HINT_RE.test(text)) return "release_publish";
  if (PLAN_SECRET_HINT_RE.test(text)) return "secret_auth";
  if (PLAN_REFACTOR_HINT_RE.test(text)) return "large_refactor";
  return null;
}

/**
 * Evaluate docs-and-small-bugfix policy for a stage.
 * Fail closed on uncertain classification.
 */
export function evaluateGithubRiskPolicy(
  input: GithubRiskPolicyInput,
): GithubRiskPolicyResult {
  const stage = input.stage;
  const riskProfile =
    (input.riskProfile as GithubAutomationRiskProfile | undefined) ??
    GITHUB_RISK_POLICY_PROFILE;
  const maxFiles =
    Number.isFinite(input.limits?.maxFiles) && input.limits.maxFiles > 0
      ? Math.floor(input.limits.maxFiles)
      : DEFAULT_LIMITS.maxFiles;
  const maxChangedLines =
    Number.isFinite(input.limits?.maxChangedLines) &&
    input.limits.maxChangedLines > 0
      ? Math.floor(input.limits.maxChangedLines)
      : DEFAULT_LIMITS.maxChangedLines;

  if (riskProfile !== "docs-and-small-bugfix") {
    return {
      decision: "block",
      classification: "uncertain",
      reasonCode: "blocked_risk_profile",
      stage,
      riskProfile: GITHUB_RISK_POLICY_PROFILE,
      fileCount: 0,
      changedLines: 0,
      maxFiles,
      maxChangedLines,
      blockedPaths: [],
      message: "Only riskProfile=docs-and-small-bugfix is allowed for unattended publish.",
    };
  }

  // Plan-text fail-closed hints (do not parse as commands).
  const hint =
    planTextHints(input.planText) ?? planTextHints(input.issueTitlePreview);
  if (hint) {
    return {
      decision: "block",
      classification: hint,
      reasonCode: reasonForClass(hint),
      stage,
      riskProfile,
      fileCount: input.files.length,
      changedLines: 0,
      maxFiles,
      maxChangedLines,
      blockedPaths: [],
      message: messageFor("block", hint, stage),
    };
  }

  const files = (input.files ?? [])
    .map((f) => ({
      ...f,
      path: normalizePath(f.path),
    }))
    .filter((f) => f.path.length > 0);

  if (files.length === 0 && stage === "final") {
    return {
      decision: "block",
      classification: "empty",
      reasonCode: "blocked_empty_diff",
      stage,
      riskProfile,
      fileCount: 0,
      changedLines: 0,
      maxFiles,
      maxChangedLines,
      blockedPaths: [],
      message: messageFor("block", "empty", stage),
    };
  }

  // pre stage with no files yet is allowed only if plan text is not blocked
  // (caller may run pre with intent only).
  if (files.length === 0 && stage === "pre") {
    return {
      decision: "allow",
      classification: "docs",
      reasonCode: "allowed_docs",
      stage,
      riskProfile,
      fileCount: 0,
      changedLines: 0,
      maxFiles,
      maxChangedLines,
      blockedPaths: [],
      message: `Stage pre: no files yet; deferred to plan/final gates under ${riskProfile}.`,
    };
  }

  let changedLines = 0;
  const classes = new Set<GithubRiskPolicyClass>();
  const blockedPaths: string[] = [];

  for (const file of files) {
    const cls = classifyPath(file);
    classes.add(cls);
    const add = Math.max(0, Math.floor(file.additions ?? 0));
    const del = Math.max(0, Math.floor(file.deletions ?? 0));
    changedLines += add + del;
    if (
      cls !== "docs" &&
      !(cls === "small_bugfix" && input.explicitSmallBugfix === true)
    ) {
      if (blockedPaths.length < 12) blockedPaths.push(file.path.slice(0, 200));
    }
    if (
      cls === "ui_interaction" ||
      cls === "workflow_ci" ||
      cls === "release_publish" ||
      cls === "secret_auth" ||
      cls === "dependency_lockfile" ||
      cls === "infra" ||
      cls === "binary_or_symlink" ||
      cls === "submodule" ||
      cls === "generated_artifact"
    ) {
      return {
        decision: "block",
        classification: cls,
        reasonCode: reasonForClass(cls),
        stage,
        riskProfile,
        fileCount: files.length,
        changedLines,
        maxFiles,
        maxChangedLines,
        blockedPaths: [file.path.slice(0, 200)],
        message: messageFor("block", cls, stage),
      };
    }
  }

  if (files.length > maxFiles || changedLines > maxChangedLines) {
    return {
      decision: "block",
      classification: "over_limit",
      reasonCode: "blocked_over_limit",
      stage,
      riskProfile,
      fileCount: files.length,
      changedLines,
      maxFiles,
      maxChangedLines,
      blockedPaths: files.slice(0, 8).map((f) => f.path.slice(0, 200)),
      message: messageFor("block", "over_limit", stage),
    };
  }

  const hasDocs = classes.has("docs");
  const hasBugfix = classes.has("small_bugfix");
  const hasUncertain = classes.has("uncertain");

  if (hasUncertain) {
    return {
      decision: "block",
      classification: "uncertain",
      reasonCode: "blocked_uncertain",
      stage,
      riskProfile,
      fileCount: files.length,
      changedLines,
      maxFiles,
      maxChangedLines,
      blockedPaths,
      message: messageFor("block", "uncertain", stage),
    };
  }

  if (hasBugfix && input.explicitSmallBugfix !== true) {
    // Non-docs source changes require explicit small-bugfix assertion.
    return {
      decision: "block",
      classification: "uncertain",
      reasonCode: "blocked_uncertain",
      stage,
      riskProfile,
      fileCount: files.length,
      changedLines,
      maxFiles,
      maxChangedLines,
      blockedPaths,
      message:
        `Stage ${stage}: non-docs changes require explicitSmallBugfix with targeted verification; fail closed.`,
    };
  }

  if (hasBugfix) {
    return {
      decision: "allow",
      classification: "small_bugfix",
      reasonCode: "allowed_small_bugfix",
      stage,
      riskProfile,
      fileCount: files.length,
      changedLines,
      maxFiles,
      maxChangedLines,
      blockedPaths: [],
      message: messageFor("allow", "small_bugfix", stage),
    };
  }

  if (hasDocs) {
    return {
      decision: "allow",
      classification: "docs",
      reasonCode: "allowed_docs",
      stage,
      riskProfile,
      fileCount: files.length,
      changedLines,
      maxFiles,
      maxChangedLines,
      blockedPaths: [],
      message: messageFor("allow", "docs", stage),
    };
  }

  return {
    decision: "block",
    classification: "uncertain",
    reasonCode: "blocked_uncertain",
    stage,
    riskProfile,
    fileCount: files.length,
    changedLines,
    maxFiles,
    maxChangedLines,
    blockedPaths,
    message: messageFor("block", "uncertain", stage),
  };
}

/**
 * Convenience: final gate must be allow before publisher may push.
 */
export function assertGithubRiskPolicyAllowsPublish(
  result: GithubRiskPolicyResult,
): void {
  if (result.decision !== "allow" || result.stage !== "final") {
    throw new Error(
      `Publish blocked by risk policy (${result.reasonCode}): ${result.message}`,
    );
  }
}

/** Safe projection for Settings / jobs (no paths beyond truncated list). */
export function toGithubRiskPolicySafeProjection(result: GithubRiskPolicyResult): {
  decision: GithubRiskPolicyDecision;
  classification: GithubRiskPolicyClass;
  reasonCode: GithubRiskPolicyReasonCode;
  stage: GithubRiskPolicyStage;
  riskProfile: GithubAutomationRiskProfile;
  fileCount: number;
  changedLines: number;
  maxFiles: number;
  maxChangedLines: number;
  blockedPathCount: number;
} {
  return {
    decision: result.decision,
    classification: result.classification,
    reasonCode: result.reasonCode,
    stage: result.stage,
    riskProfile: result.riskProfile,
    fileCount: result.fileCount,
    changedLines: result.changedLines,
    maxFiles: result.maxFiles,
    maxChangedLines: result.maxChangedLines,
    blockedPathCount: result.blockedPaths.length,
  };
}
