/**
 * github-git-publisher — server-owned App commit/push/PR (GHA-07).
 *
 * Security contracts:
 * - Fresh installation token via temporary GIT_ASKPASS only (0600 script).
 * - Remote URL is always credential-free HTTPS (`https://github.com/owner/repo.git`).
 * - Fixed allowlisted repositoryId / fullName / baseRef / head branch.
 * - No force push, no hooks (`--no-verify` only where needed for non-interactive),
 *   no direct push to base/main, no merge, no Issue close.
 * - Agent cannot import/call this as a tool capability; runner invokes after
 *   final diff policy allow + checker + operator validation.
 * - Token never written to remote URL, argv (except askpass env path), logs,
 *   job/task/session records, or thrown messages (redacted).
 *
 * Unknown push/PR outcomes: reconcile by listing PRs for head/base before create.
 */

import { execFile } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  getGithubInstallationToken,
  githubAppInstallationRequest,
  GITHUB_API_ORIGIN,
} from "./github-app-client";
import {
  GithubAutomationError,
  redactGithubAutomationSecrets,
  safeGithubAutomationErrorMessage,
} from "./github-automation-errors";
import {
  buildGithubAutomationPrBody,
  checkGithubPrClosingContract,
  selectReusableGithubPr,
  type GithubExistingPrIdentity,
  type GithubPrBodyParts,
} from "./github-pr-contract";
import {
  containsGithubAutomationSecretInjectionMarker,
  scrubGithubAutomationOwnedSecretsFromEnv,
} from "./github-full-agent-profile";
import type { GithubAutomationRepositoryConfig } from "./github-automation-types";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_BUFFER = 4 * 1024 * 1024;
const GITHUB_HTTPS_ORIGIN = "https://github.com";

export interface GithubPublisherFixedTarget {
  repositoryId: number;
  repositoryFullName: string;
  installationId: number;
  baseRef: string;
  headBranch: string;
  issueNumber: number;
  /** WorkTree absolute path (server-only; never projected). */
  worktreePath: string;
}

export interface GithubPublisherCommitInput extends GithubPublisherFixedTarget {
  commitMessage: string;
  authorName?: string;
  authorEmail?: string;
}

export interface GithubPublisherPushResult {
  pushed: boolean;
  headBranch: string;
  baseRef: string;
  remote: string;
  /** Safe — never includes token. */
  remoteUrl: string;
  reasonCode: string | null;
}

export interface GithubPublisherPrResult {
  created: boolean;
  reused: boolean;
  prNumber: number;
  htmlUrl: string;
  headBranch: string;
  baseRef: string;
  closingLine: string;
  reasonCode: string | null;
}

export interface GithubPublisherRunResult {
  commitOid: string | null;
  push: GithubPublisherPushResult;
  pr: GithubPublisherPrResult;
  prBody: GithubPrBodyParts;
}

export interface GithubPublisherHooks {
  /** Override installation token fetch (tests). */
  getInstallationToken?: (installationId: number) => Promise<{ token: string }>;
  /** Override git exec (tests). Receives args without leading "git". */
  runGit?: (
    args: readonly string[],
    options: { cwd: string; env: NodeJS.ProcessEnv },
  ) => Promise<string>;
  /** Override GitHub REST (tests). */
  githubRequest?: (
    installationId: number,
    path: string,
    options?: { method?: string; body?: unknown },
  ) => Promise<{ status: number; body: unknown }>;
}

function assertSafeFullName(fullName: string): { owner: string; repo: string } {
  const trimmed = fullName.trim();
  const m = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(trimmed);
  if (!m) {
    throw new GithubAutomationError(
      "invalid_config",
      "repository fullName is invalid for publisher",
      { status: 400 },
    );
  }
  return { owner: m[1], repo: m[2] };
}

/**
 * Credential-free HTTPS remote for the fixed allowlisted repo.
 * Token must NEVER be embedded in this URL.
 */
export function buildGithubCredentialFreeRemoteUrl(fullName: string): string {
  const { owner, repo } = assertSafeFullName(fullName);
  return `${GITHUB_HTTPS_ORIGIN}/${owner}/${repo}.git`;
}

export function assertPublisherTargetFixed(input: {
  target: GithubPublisherFixedTarget;
  repository: GithubAutomationRepositoryConfig;
}): void {
  const { target, repository } = input;
  if (target.repositoryId !== repository.repositoryId) {
    throw new GithubAutomationError(
      "repository_not_allowlisted",
      "Publisher repositoryId does not match allowlisted config",
      { status: 400 },
    );
  }
  if (target.repositoryFullName.trim() !== repository.fullName.trim()) {
    throw new GithubAutomationError(
      "invalid_config",
      "Publisher fullName must match allowlisted repository display name",
      { status: 400 },
    );
  }
  if (
    repository.installationId == null ||
    target.installationId !== repository.installationId
  ) {
    throw new GithubAutomationError(
      "installation_missing",
      "Publisher installationId must match repository installation",
      { status: 400 },
    );
  }
  const base = (repository.baseRef || "main").trim() || "main";
  if ((target.baseRef || "").trim() !== base) {
    throw new GithubAutomationError(
      "invalid_config",
      "Publisher baseRef must match repository config baseRef",
      { status: 400 },
    );
  }
  if (!target.headBranch || target.headBranch === base || target.headBranch === "main" || target.headBranch === "master") {
    throw new GithubAutomationError(
      "invalid_config",
      "Publisher headBranch must be a non-base automation branch",
      { status: 400 },
    );
  }
  if (!target.headBranch.startsWith("ypi/gha/")) {
    throw new GithubAutomationError(
      "invalid_config",
      "Publisher headBranch must use ypi/gha/ prefix",
      { status: 400 },
    );
  }
  if (!target.worktreePath || containsGithubAutomationSecretInjectionMarker(target.worktreePath)) {
    throw new GithubAutomationError(
      "invalid_config",
      "Publisher worktreePath is invalid",
      { status: 400 },
    );
  }
}

function assertNoForceArgs(args: readonly string[]): void {
  for (const a of args) {
    if (a === "--force" || a === "-f" || a.startsWith("--force=")) {
      throw new Error("Force push is forbidden in github-git-publisher");
    }
    if (a === "--force-with-lease") {
      throw new Error("Force-with-lease is forbidden in github-git-publisher");
    }
  }
}

function assertNotPushingBase(args: readonly string[], baseRef: string): void {
  // Detect `push <remote> <base>` or `push <remote> HEAD:<base>`
  const base = baseRef.trim();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === base || a === `HEAD:${base}` || a.endsWith(`:${base}`)) {
      if (args[0] === "push") {
        throw new Error("Direct push to base/main is forbidden");
      }
    }
  }
}

async function defaultRunGit(
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<string> {
  assertNoForceArgs(args);
  try {
    const { stdout, stderr } = await execFileAsync("git", [...args], {
      cwd: options.cwd,
      env: options.env,
      encoding: "utf8",
      timeout: DEFAULT_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      shell: false,
    });
    void stderr;
    return String(stdout ?? "").trim();
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    const detail = redactGithubAutomationSecrets(
      (e.stderr || e.stdout || e.message || "git failed").toString(),
    ).slice(0, 400);
    // Ensure token fragments never escape.
    if (containsGithubAutomationSecretInjectionMarker(detail)) {
      throw new Error("git command failed (redacted)");
    }
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }
}

/**
 * Write a temporary GIT_ASKPASS helper that prints the username/password.
 * Script mode 0700; deleted in finally. Token only in file contents briefly.
 */
export function createGithubGitAskpassHelper(input: {
  username: string;
  password: string;
  dir?: string;
}): { askpassPath: string; cleanup: () => void } {
  if (!input.password) {
    throw new GithubAutomationError("github_auth_failed", "Missing installation token for askpass");
  }
  // Username is typically "x-access-token"; never log password.
  const dir = input.dir ?? mkdtempSync(join(tmpdir(), "ypi-gha-askpass-"));
  const askpassPath = join(dir, "askpass.sh");
  // Avoid embedding token in process argv; script reads nothing from env for the secret —
  // secret is inlined into the 0700 script which is deleted after use.
  const user = input.username.replace(/'/g, `'\\''`);
  const pass = input.password.replace(/'/g, `'\\''`);
  const script = `#!/bin/sh
case "$1" in
  *Username*) printf '%s\\n' '${user}' ;;
  *Password*) printf '%s\\n' '${pass}' ;;
  *) printf '%s\\n' '${pass}' ;;
esac
`;
  writeFileSync(askpassPath, script, { encoding: "utf8", mode: 0o700 });
  try {
    chmodSync(askpassPath, 0o700);
  } catch {
    // best-effort on platforms without chmod
  }
  const cleanup = (): void => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  };
  return { askpassPath, cleanup };
}

function publisherEnv(askpassPath: string): NodeJS.ProcessEnv {
  const base = scrubGithubAutomationOwnedSecretsFromEnv(process.env);
  const env: NodeJS.ProcessEnv = { ...(base as NodeJS.ProcessEnv) };
  env.GIT_ASKPASS = askpassPath;
  env.GIT_TERMINAL_PROMPT = "0";
  // Prevent credential helpers from overriding / logging.
  env.GIT_CONFIG_COUNT = "1";
  env.GIT_CONFIG_KEY_0 = "credential.helper";
  env.GIT_CONFIG_VALUE_0 = "";
  // Do not set GITHUB_TOKEN / GH_TOKEN — askpass only.
  return env;
}

/**
 * Stage all tracked/untracked (respecting .gitignore), commit if needed.
 * Does not push.
 */
export async function commitGithubAutomationWorktree(
  input: GithubPublisherCommitInput,
  hooks: GithubPublisherHooks = {},
): Promise<{ commitOid: string; created: boolean }> {
  const runGit = hooks.runGit ?? defaultRunGit;
  const cwd = input.worktreePath;
  const env = scrubGithubAutomationOwnedSecretsFromEnv(process.env) as NodeJS.ProcessEnv;

  // Never add secrets via pathspec from Issue.
  await runGit(["add", "-A"], { cwd, env });
  let status = "";
  try {
    status = await runGit(["status", "--porcelain"], { cwd, env });
  } catch {
    status = "unknown";
  }

  if (!status.trim()) {
    const oid = await runGit(["rev-parse", "HEAD"], { cwd, env });
    return { commitOid: oid, created: false };
  }

  const message = redactGithubAutomationSecrets(input.commitMessage || "").trim() ||
    `ypi: automation for #${input.issueNumber}`;
  if (containsGithubAutomationSecretInjectionMarker(message)) {
    throw new Error("Commit message must not contain secret markers");
  }

  const authorName = input.authorName ?? "ypi-github-automation[bot]";
  const authorEmail =
    input.authorEmail ?? "ypi-github-automation[bot]@users.noreply.github.com";

  const commitEnv: NodeJS.ProcessEnv = {
    ...env,
    GIT_AUTHOR_NAME: authorName,
    GIT_AUTHOR_EMAIL: authorEmail,
    GIT_COMMITTER_NAME: authorName,
    GIT_COMMITTER_EMAIL: authorEmail,
  };

  await runGit(["commit", "-m", message, "--no-verify"], { cwd, env: commitEnv });
  const oid = await runGit(["rev-parse", "HEAD"], { cwd, env });
  return { commitOid: oid, created: true };
}

/**
 * Push head branch to credential-free origin using temporary askpass.
 * Rejects force and base-branch push.
 */
export async function pushGithubAutomationBranch(
  input: GithubPublisherFixedTarget,
  hooks: GithubPublisherHooks = {},
): Promise<GithubPublisherPushResult> {
  const runGit = hooks.runGit ?? defaultRunGit;
  const remoteUrl = buildGithubCredentialFreeRemoteUrl(input.repositoryFullName);
  if (remoteUrl.includes("@") || /x-access-token/i.test(remoteUrl)) {
    throw new Error("Refusing remote URL that may embed credentials");
  }

  const getToken =
    hooks.getInstallationToken ??
    (async (installationId: number) => {
      const t = await getGithubInstallationToken(installationId);
      return { token: t.token };
    });

  const { token } = await getToken(input.installationId);
  if (!token) {
    throw new GithubAutomationError("github_auth_failed");
  }

  const { askpassPath, cleanup } = createGithubGitAskpassHelper({
    username: "x-access-token",
    password: token,
  });

  try {
    const env = publisherEnv(askpassPath);
    const cwd = input.worktreePath;

    // Ensure remote "origin" is credential-free URL (set-url or add).
    try {
      await runGit(["remote", "get-url", "origin"], { cwd, env });
      await runGit(["remote", "set-url", "origin", remoteUrl], { cwd, env });
    } catch {
      await runGit(["remote", "add", "origin", remoteUrl], { cwd, env });
    }

    // Verify remote has no embedded credentials.
    const originUrl = await runGit(["remote", "get-url", "origin"], { cwd, env });
    if (
      originUrl.includes("@") ||
      /x-access-token/i.test(originUrl) ||
      containsGithubAutomationSecretInjectionMarker(originUrl)
    ) {
      throw new Error("Origin URL must be credential-free");
    }

    const pushArgs = [
      "push",
      "-u",
      "origin",
      `HEAD:refs/heads/${input.headBranch}`,
    ] as const;
    assertNoForceArgs(pushArgs);
    assertNotPushingBase(pushArgs, input.baseRef);

    await runGit([...pushArgs], { cwd, env });

    return {
      pushed: true,
      headBranch: input.headBranch,
      baseRef: input.baseRef,
      remote: "origin",
      remoteUrl,
      reasonCode: null,
    };
  } catch (err) {
    // Keep reason generic — never surface token-bearing git stderr.
    void safeGithubAutomationErrorMessage(err, "git push failed");
    return {
      pushed: false,
      headBranch: input.headBranch,
      baseRef: input.baseRef,
      remote: "origin",
      remoteUrl,
      reasonCode: "push_failed",
    };
  } finally {
    cleanup();
  }
}

function parsePullListBody(body: unknown): GithubExistingPrIdentity[] {
  if (!Array.isArray(body)) return [];
  const out: GithubExistingPrIdentity[] = [];
  for (const item of body) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const number = rec.number;
    const htmlUrl = rec.html_url;
    const state = rec.state;
    const head = rec.head && typeof rec.head === "object" ? (rec.head as Record<string, unknown>) : null;
    const base = rec.base && typeof rec.base === "object" ? (rec.base as Record<string, unknown>) : null;
    const headRef = head && typeof head.ref === "string" ? head.ref : null;
    const baseRef = base && typeof base.ref === "string" ? base.ref : null;
    const merged = rec.merged === true;
    if (
      typeof number === "number" &&
      Number.isInteger(number) &&
      typeof htmlUrl === "string" &&
      typeof state === "string" &&
      headRef &&
      baseRef
    ) {
      out.push({
        number,
        htmlUrl,
        state,
        headRef,
        baseRef,
        merged,
      });
    }
  }
  return out;
}

/**
 * List PRs for head/base and create one if missing. Never merges.
 */
export async function createOrReuseGithubAutomationPr(
  input: {
    target: GithubPublisherFixedTarget;
    prBody: GithubPrBodyParts;
  },
  hooks: GithubPublisherHooks = {},
): Promise<GithubPublisherPrResult> {
  const { target, prBody } = input;
  const { owner, repo } = assertSafeFullName(target.repositoryFullName);

  // Closing contract hard gate before any network write.
  const contract = checkGithubPrClosingContract(prBody.body, target.issueNumber);
  if (!contract.ok) {
    throw new GithubAutomationError(
      "invalid_config",
      `PR closing contract failed: ${contract.reasonCode}`,
      { status: 400, details: { reasonCode: contract.reasonCode } },
    );
  }

  const request =
    hooks.githubRequest ??
    (async (installationId: number, path: string, options?: { method?: string; body?: unknown }) => {
      const result = await githubAppInstallationRequest(installationId, path, options);
      return { status: result.status, body: result.body };
    });

  // Query existing PRs for this head (all states for reuse of open ones).
  const headParam = `${owner}:${target.headBranch}`;
  const listPath =
    `/repos/${owner}/${repo}/pulls?state=all&head=${encodeURIComponent(headParam)}&base=${encodeURIComponent(target.baseRef)}&per_page=20`;

  let listResult: { status: number; body: unknown };
  try {
    listResult = await request(target.installationId, listPath, { method: "GET" });
  } catch (err) {
    throw new GithubAutomationError(
      "github_network_error",
      safeGithubAutomationErrorMessage(err, "Failed to list pull requests"),
    );
  }

  if (listResult.status === 401 || listResult.status === 403) {
    throw new GithubAutomationError("permission_missing", "Pull requests permission missing", {
      status: 403,
    });
  }

  const candidates = parsePullListBody(listResult.body);
  const existing = selectReusableGithubPr(candidates, {
    headBranch: target.headBranch,
    baseRef: target.baseRef,
  });

  if (existing && existing.state === "open") {
    return {
      created: false,
      reused: true,
      prNumber: existing.number,
      htmlUrl: existing.htmlUrl,
      headBranch: target.headBranch,
      baseRef: target.baseRef,
      closingLine: prBody.closingLine,
      reasonCode: "reused_existing_pr",
    };
  }

  // Create PR
  const createPath = `/repos/${owner}/${repo}/pulls`;
  const createBody = {
    title: prBody.title,
    head: target.headBranch,
    base: target.baseRef,
    body: prBody.body,
    draft: false,
    maintainer_can_modify: true,
  };

  // Ensure body never includes installation token patterns from caller mistakes.
  if (containsGithubAutomationSecretInjectionMarker(createBody)) {
    throw new Error("Refusing to create PR: body/title contains secret markers");
  }

  let createResult: { status: number; body: unknown };
  try {
    createResult = await request(target.installationId, createPath, {
      method: "POST",
      body: createBody,
    });
  } catch (err) {
    // Unknown outcome: re-list and reuse if another worker created it.
    try {
      const retryList = await request(target.installationId, listPath, { method: "GET" });
      const retryExisting = selectReusableGithubPr(parsePullListBody(retryList.body), {
        headBranch: target.headBranch,
        baseRef: target.baseRef,
      });
      if (retryExisting && retryExisting.state === "open") {
        return {
          created: false,
          reused: true,
          prNumber: retryExisting.number,
          htmlUrl: retryExisting.htmlUrl,
          headBranch: target.headBranch,
          baseRef: target.baseRef,
          closingLine: prBody.closingLine,
          reasonCode: "reused_after_unknown_create",
        };
      }
    } catch {
      // fall through
    }
    throw new GithubAutomationError(
      "github_network_error",
      safeGithubAutomationErrorMessage(err, "Failed to create pull request"),
    );
  }

  if (createResult.status === 422) {
    // Likely already exists — reconcile.
    const retryList = await request(target.installationId, listPath, { method: "GET" });
    const retryExisting = selectReusableGithubPr(parsePullListBody(retryList.body), {
      headBranch: target.headBranch,
      baseRef: target.baseRef,
    });
    if (retryExisting) {
      return {
        created: false,
        reused: true,
        prNumber: retryExisting.number,
        htmlUrl: retryExisting.htmlUrl,
        headBranch: target.headBranch,
        baseRef: target.baseRef,
        closingLine: prBody.closingLine,
        reasonCode: "reused_after_422",
      };
    }
  }

  if (createResult.status < 200 || createResult.status >= 300) {
    throw new GithubAutomationError("github_bad_response", "Create pull request failed", {
      status: 502,
      details: { httpStatus: createResult.status },
    });
  }

  const body = createResult.body as Record<string, unknown> | null;
  const number = body && typeof body.number === "number" ? body.number : null;
  const htmlUrl = body && typeof body.html_url === "string" ? body.html_url : null;
  if (number == null || !htmlUrl) {
    throw new GithubAutomationError("github_bad_response", "Create pull request returned incomplete body");
  }

  return {
    created: true,
    reused: false,
    prNumber: number,
    htmlUrl,
    headBranch: target.headBranch,
    baseRef: target.baseRef,
    closingLine: prBody.closingLine,
    reasonCode: null,
  };
}

export interface PublishGithubAutomationChangeInput {
  repository: GithubAutomationRepositoryConfig;
  target: GithubPublisherFixedTarget;
  /** Must already be final-policy allow; publisher does not re-open agent. */
  finalDiffAllowed: boolean;
  checkerPassed: boolean;
  validationPassed: boolean;
  commitMessage: string;
  prTitle: string;
  scopeSummary: string;
  validationSummary: string;
  riskSummary: string;
  traceId: string;
  classification?: string | null;
}

/**
 * Full server publish path: commit → push → create/reuse PR.
 * Throws / returns blocked when gates fail. Never merges.
 */
export async function publishGithubAutomationChange(
  input: PublishGithubAutomationChangeInput,
  hooks: GithubPublisherHooks = {},
): Promise<GithubPublisherRunResult> {
  if (!input.finalDiffAllowed) {
    throw new GithubAutomationError(
      "invalid_config",
      "Publisher refused: final diff policy did not allow",
      { status: 400, details: { reasonCode: "final_diff_not_allowed" } },
    );
  }
  if (!input.checkerPassed) {
    throw new GithubAutomationError(
      "invalid_config",
      "Publisher refused: checker evidence missing",
      { status: 400, details: { reasonCode: "checker_not_passed" } },
    );
  }
  if (!input.validationPassed) {
    throw new GithubAutomationError(
      "invalid_config",
      "Publisher refused: operator validation missing",
      { status: 400, details: { reasonCode: "validation_not_passed" } },
    );
  }

  assertPublisherTargetFixed({
    target: input.target,
    repository: input.repository,
  });

  if (!existsSync(input.target.worktreePath)) {
    throw new GithubAutomationError(
      "invalid_config",
      "Publisher worktreePath does not exist",
      { status: 400 },
    );
  }

  const prBody = buildGithubAutomationPrBody({
    repositoryFullName: input.target.repositoryFullName,
    repositoryId: input.target.repositoryId,
    issueNumber: input.target.issueNumber,
    headBranch: input.target.headBranch,
    baseRef: input.target.baseRef,
    title: input.prTitle,
    scopeSummary: input.scopeSummary,
    validationSummary: input.validationSummary,
    riskSummary: input.riskSummary,
    traceId: input.traceId,
    classification: input.classification,
  });

  const commit = await commitGithubAutomationWorktree(
    {
      ...input.target,
      commitMessage: input.commitMessage,
    },
    hooks,
  );

  const push = await pushGithubAutomationBranch(input.target, hooks);
  if (!push.pushed) {
    // Unknown / failed push: still try PR reconcile in case remote already has branch.
    // But do not claim success without either push or existing PR.
  }

  let pr: GithubPublisherPrResult;
  try {
    pr = await createOrReuseGithubAutomationPr(
      { target: input.target, prBody },
      hooks,
    );
  } catch (err) {
    if (!push.pushed) {
      throw err;
    }
    throw err;
  }

  // If push failed and we could not find/create PR, surface push failure.
  if (!push.pushed && !pr.reused && !pr.created) {
    throw new GithubAutomationError(
      "github_network_error",
      "Push failed and no PR could be created",
      { details: { reasonCode: push.reasonCode } },
    );
  }

  // Redact any accidental secret in returned structures.
  if (
    containsGithubAutomationSecretInjectionMarker(pr) ||
    containsGithubAutomationSecretInjectionMarker(push) ||
    containsGithubAutomationSecretInjectionMarker(prBody)
  ) {
    throw new Error("Publisher result contained secret markers; refusing to return");
  }

  return {
    commitOid: commit.commitOid,
    push,
    pr,
    prBody,
  };
}

/** Test helper: ensure module does not export a force-push API. */
export function _testGithubPublisherForbiddenFlags(): readonly string[] {
  return ["--force", "-f", "--force-with-lease", "main", "master"];
}

// Touch constants used for documentation / future URL builders.
void GITHUB_API_ORIGIN;
