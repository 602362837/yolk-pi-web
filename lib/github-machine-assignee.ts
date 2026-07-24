/**
 * github-machine-assignee — resolve the machine GitHub assignee identity (GHA-01).
 *
 * Product decision:
 * - Successful claim later requires `ypi:claimed` + this login as Issue assignee.
 * - Login comes from the active local credential, not App bot and not git user.name/email.
 *
 * Resolution order:
 * 1. Prefer active `gh` account:
 *    - `gh auth status` to detect logged-out / multi-account without active / wrong host
 *    - `gh api user --jq .login` / user payload for canonical login + id
 * 2. Fallback when `gh` is unavailable:
 *    - fixed `https://github.com` `git credential fill`
 *    - temporary in-memory password → fixed `GET https://api.github.com/user`
 *    - use canonical `/user` login (never credential username alone)
 *
 * Security:
 * - Personal token/password only in memory / controlled stdin+Authorization header.
 * - Never argv for secrets, never logs, never config/task/session persistence.
 * - Safe projection: login / actorId / source / checkedAt / readiness only.
 * - Personal credential is NEVER used for App mutations or publishing.
 */

import { spawn } from "node:child_process";

import { githubGetUserWithBearerToken } from "./github-app-client";
import { GithubAutomationError } from "./github-automation-errors";
import {
  createBlockedAssigneeProjection,
  type GithubMachineAssigneeIdentitySource,
  type GithubMachineAssigneeReadinessCode,
  type GithubMachineAssigneeResolvedIdentity,
  type GithubMachineAssigneeSafeProjection,
} from "./github-automation-types";

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_COMMAND_TIMEOUT_MS = 8_000;
const GH_HOST = "github.com";
const GIT_CREDENTIAL_PROTOCOL = "https";
const GIT_CREDENTIAL_HOST = "github.com";

// ─── Test hooks ──────────────────────────────────────────────────────────────

export interface GithubMachineAssigneeCommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  error?: NodeJS.ErrnoException;
}

export type GithubMachineAssigneeCommandRunner = (input: {
  command: string;
  args: string[];
  stdin?: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
}) => Promise<GithubMachineAssigneeCommandResult>;

export type GithubMachineAssigneeUserLookup = (
  token: string,
  options?: { signal?: AbortSignal },
) => Promise<{ login: string; id: number }>;

let _commandRunner: GithubMachineAssigneeCommandRunner | null = null;
let _userLookup: GithubMachineAssigneeUserLookup | null = null;
let _timeoutMs: number | undefined;

export function _testOverrideMachineAssigneeCommandRunner(
  runner: GithubMachineAssigneeCommandRunner | null,
): void {
  _commandRunner = runner;
}

export function _testOverrideMachineAssigneeUserLookup(
  lookup: GithubMachineAssigneeUserLookup | null,
): void {
  _userLookup = lookup;
}

export function _testOverrideMachineAssigneeTimeoutMs(
  timeoutMs: number | undefined,
): void {
  _timeoutMs =
    typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs >= 0
      ? timeoutMs
      : undefined;
}

function commandTimeoutMs(): number {
  return _timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
}

// ─── Process runner ──────────────────────────────────────────────────────────

function defaultCommandRunner(input: {
  command: string;
  args: string[];
  stdin?: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
}): Promise<GithubMachineAssigneeCommandResult> {
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(input.command, input.args, {
      env: input.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const finish = (result: GithubMachineAssigneeCommandResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      finish({
        code: null,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        error: Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }),
      });
    }, input.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      finish({
        code: null,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        error,
      });
    });

    child.on("close", (code) => {
      finish({
        code,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      });
    });

    if (input.stdin !== undefined) {
      child.stdin?.write(input.stdin);
    }
    child.stdin?.end();
  });
}

async function runCommand(input: {
  command: string;
  args: string[];
  stdin?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<GithubMachineAssigneeCommandResult> {
  const runner = _commandRunner ?? defaultCommandRunner;
  return runner({
    ...input,
    timeoutMs: commandTimeoutMs(),
  });
}

// ─── Parsing helpers ─────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mapCommandFailureToReadiness(
  result: GithubMachineAssigneeCommandResult,
  kind: "gh" | "git",
): GithubMachineAssigneeReadinessCode {
  if (result.error?.code === "ENOENT") {
    return kind === "gh" ? "gh_unavailable" : "git_credential_unavailable";
  }
  if (result.error?.code === "ETIMEDOUT") {
    return "credential_timeout";
  }
  return kind === "gh" ? "gh_unavailable" : "git_credential_unavailable";
}

/**
 * Inspect `gh auth status` text for multi-account / host / login problems.
 * Does not treat stdout as secret; still avoid logging it from callers.
 */
export function interpretGhAuthStatus(
  stdout: string,
  stderr: string,
): GithubMachineAssigneeReadinessCode | "ok" {
  const text = `${stdout}\n${stderr}`;
  const lower = text.toLowerCase();

  if (
    lower.includes("not logged into") ||
    lower.includes("you are not logged") ||
    lower.includes("no accounts") ||
    lower.includes("not logged in")
  ) {
    return "gh_not_logged_in";
  }

  // Non-github.com active host.
  if (
    /logged in to\s+(?:https?:\/\/)?(?!github\.com)[a-z0-9.-]+/i.test(text) &&
    !/logged in to\s+(?:https?:\/\/)?github\.com/i.test(text)
  ) {
    return "gh_host_unsupported";
  }

  // Multiple accounts without a clear active marker is treated as blocked.
  // gh prints "Active account: true/false" per account on recent versions.
  const activeTrue = (text.match(/Active account:\s*true/gi) ?? []).length;
  const activeFalse = (text.match(/Active account:\s*false/gi) ?? []).length;
  if (activeFalse > 0 && activeTrue === 0) {
    return "gh_no_active_account";
  }

  return "ok";
}

function parseGhUserPayload(
  stdout: string,
): { login: string; id: number } | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;

  // `gh api user --jq .login` may return bare login.
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    // Bare login alone is not enough — we also need actor id; caller should use JSON.
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!isRecord(parsed)) return null;
    const login = parsed.login;
    const id = parsed.id;
    if (typeof login !== "string" || !login.trim()) return null;
    if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) return null;
    return { login: login.trim(), id };
  } catch {
    return null;
  }
}

interface GitCredentialMaterial {
  /** Non-canonical helper username — never used as login alone. */
  username: string | null;
  password: string;
}

/**
 * Parse `git credential fill` output.
 * Password is returned for immediate /user use only; callers must clear refs.
 */
export function parseGitCredentialFillOutput(
  stdout: string,
):
  | { ok: true; material: GitCredentialMaterial }
  | { ok: false; readiness: GithubMachineAssigneeReadinessCode } {
  const lines = stdout.split(/\r?\n/);
  let username: string | null = null;
  let password: string | null = null;
  let protocol: string | null = null;
  let host: string | null = null;

  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    const value = line.slice(eq + 1);
    if (key === "username") username = value;
    else if (key === "password") password = value;
    else if (key === "protocol") protocol = value;
    else if (key === "host") host = value;
  }

  if (protocol && protocol !== GIT_CREDENTIAL_PROTOCOL) {
    return { ok: false, readiness: "git_credential_host_unsupported" };
  }
  if (host && host.toLowerCase() !== GIT_CREDENTIAL_HOST) {
    return { ok: false, readiness: "git_credential_host_unsupported" };
  }
  if (!password) {
    return { ok: false, readiness: "git_credential_empty" };
  }

  return {
    ok: true,
    material: {
      username: username && username.trim() ? username.trim() : null,
      password,
    },
  };
}

// ─── Resolution steps ────────────────────────────────────────────────────────

async function resolveViaGh(
  signal?: AbortSignal,
): Promise<
  | { ok: true; identity: GithubMachineAssigneeResolvedIdentity }
  | { ok: false; readiness: GithubMachineAssigneeReadinessCode }
> {
  if (signal?.aborted) {
    return { ok: false, readiness: "credential_timeout" };
  }

  const status = await runCommand({
    command: "gh",
    args: ["auth", "status", "--hostname", GH_HOST],
  });

  if (status.error || status.code === null) {
    return { ok: false, readiness: mapCommandFailureToReadiness(status, "gh") };
  }

  // gh auth status returns non-zero when not logged in.
  const statusInterpretation = interpretGhAuthStatus(status.stdout, status.stderr);
  if (statusInterpretation !== "ok") {
    return { ok: false, readiness: statusInterpretation };
  }
  if (status.code !== 0) {
    // If we could not classify, treat non-zero as not logged in when host matches.
    return { ok: false, readiness: "gh_not_logged_in" };
  }

  const api = await runCommand({
    command: "gh",
    args: ["api", "user", "--hostname", GH_HOST],
  });

  if (api.error || api.code === null) {
    return { ok: false, readiness: mapCommandFailureToReadiness(api, "gh") };
  }
  if (api.code !== 0) {
    const lower = `${api.stdout}\n${api.stderr}`.toLowerCase();
    if (lower.includes("401") || lower.includes("bad credentials")) {
      return { ok: false, readiness: "credential_invalid" };
    }
    if (lower.includes("not logged")) {
      return { ok: false, readiness: "gh_not_logged_in" };
    }
    return { ok: false, readiness: "user_lookup_failed" };
  }

  const user = parseGhUserPayload(api.stdout);
  if (!user) {
    return { ok: false, readiness: "user_lookup_failed" };
  }

  return {
    ok: true,
    identity: {
      login: user.login,
      actorId: user.id,
      identitySource: "gh",
      checkedAt: new Date().toISOString(),
    },
  };
}

async function resolveViaGitCredential(
  signal?: AbortSignal,
): Promise<
  | { ok: true; identity: GithubMachineAssigneeResolvedIdentity }
  | { ok: false; readiness: GithubMachineAssigneeReadinessCode }
> {
  if (signal?.aborted) {
    return { ok: false, readiness: "credential_timeout" };
  }

  // Fixed protocol/host only — Issue text never reaches this input.
  const fillInput = `protocol=${GIT_CREDENTIAL_PROTOCOL}\nhost=${GIT_CREDENTIAL_HOST}\n\n`;
  const fill = await runCommand({
    command: "git",
    args: ["credential", "fill"],
    stdin: fillInput,
  });

  if (fill.error || fill.code === null) {
    return { ok: false, readiness: mapCommandFailureToReadiness(fill, "git") };
  }
  if (fill.code !== 0) {
    return { ok: false, readiness: "git_credential_empty" };
  }

  const parsed = parseGitCredentialFillOutput(fill.stdout);
  // Clear stdout ref from outer scope usage as soon as parsed.
  fill.stdout = "";
  fill.stderr = "";

  if (!parsed.ok) {
    return { ok: false, readiness: parsed.readiness };
  }

  // Copy password then scrub the parsed material so later logs cannot see it.
  let password: string | undefined = parsed.material.password;
  // Intentionally ignore material.username as canonical login.
  parsed.material.password = "";
  parsed.material.username = null;

  const lookup = _userLookup ?? githubGetUserWithBearerToken;
  try {
    if (!password) {
      return { ok: false, readiness: "git_credential_empty" };
    }
    const user = await lookup(password, { signal });
    return {
      ok: true,
      identity: {
        login: user.login,
        actorId: user.id,
        identitySource: "git-credential",
        checkedAt: new Date().toISOString(),
      },
    };
  } catch (err) {
    if (err instanceof GithubAutomationError) {
      if (err.code === "credential_invalid") {
        return { ok: false, readiness: "credential_invalid" };
      }
      if (err.code === "github_timeout" || err.code === "credential_timeout") {
        return { ok: false, readiness: "credential_timeout" };
      }
      if (err.code === "github_rate_limited") {
        return { ok: false, readiness: "user_lookup_failed" };
      }
    }
    return { ok: false, readiness: "user_lookup_failed" };
  } finally {
    password = undefined;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Resolve machine assignee identity.
 * Prefers gh; falls back to git credential fill + canonical /user only when gh is unavailable.
 */
export async function resolveMachineGithubAssigneeIdentity(options?: {
  signal?: AbortSignal;
}): Promise<
  | { ok: true; identity: GithubMachineAssigneeResolvedIdentity }
  | { ok: false; readiness: GithubMachineAssigneeReadinessCode }
> {
  const gh = await resolveViaGh(options?.signal);
  if (gh.ok) return gh;

  // Fallback only when gh binary is missing; other gh failures are explicit.
  if (gh.readiness === "gh_unavailable") {
    return resolveViaGitCredential(options?.signal);
  }

  return gh;
}

/**
 * Safe projection for Settings / status APIs.
 * Never includes tokens or credential fill secrets.
 */
export async function getMachineGithubAssigneeSafeProjection(options?: {
  signal?: AbortSignal;
  /**
   * Optional assignability hint from a prior App check (GHA-03).
   * When omitted, assignable is null (identity-only readiness).
   */
  assignable?: boolean | null;
  assignabilityReadiness?: GithubMachineAssigneeReadinessCode | null;
}): Promise<GithubMachineAssigneeSafeProjection> {
  const resolved = await resolveMachineGithubAssigneeIdentity({
    signal: options?.signal,
  });

  if (!resolved.ok) {
    return createBlockedAssigneeProjection(resolved.readiness);
  }

  let readiness: GithubMachineAssigneeReadinessCode = "ready";
  let assignable: boolean | null =
    options?.assignable === undefined ? null : options.assignable;
  let reasonCode: GithubMachineAssigneeReadinessCode | null = null;

  if (options?.assignabilityReadiness && options.assignabilityReadiness !== "ready") {
    readiness = options.assignabilityReadiness;
    reasonCode = options.assignabilityReadiness;
    if (options.assignabilityReadiness === "unassignable") {
      assignable = false;
    }
  } else if (assignable === false) {
    readiness = "unassignable";
    reasonCode = "unassignable";
  }

  return {
    login: resolved.identity.login,
    actorId: resolved.identity.actorId,
    identitySource: resolved.identity.identitySource,
    checkedAt: resolved.identity.checkedAt,
    readiness,
    assignable,
    reasonCode,
  };
}

/**
 * Throw on blocked readiness (for internal callers that need identity or fail).
 */
export async function requireMachineGithubAssigneeIdentity(options?: {
  signal?: AbortSignal;
}): Promise<GithubMachineAssigneeResolvedIdentity> {
  const resolved = await resolveMachineGithubAssigneeIdentity(options);
  if (!resolved.ok) {
    throw new GithubAutomationError("assignee_unavailable", undefined, {
      status: 404,
      details: { readiness: resolved.readiness },
    });
  }
  return resolved.identity;
}

// ─── Assignability + Issue read-back (GHA-03) ────────────────────────────────

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

export function normalizeGithubLogin(login: string): string {
  return login.trim().toLowerCase();
}

export function issueAssigneesIncludeLogin(
  assignees: unknown,
  login: string,
): boolean {
  const target = normalizeGithubLogin(login);
  if (!target || !Array.isArray(assignees)) return false;
  for (const item of assignees) {
    if (!isRecord(item)) continue;
    if (typeof item.login === "string" && normalizeGithubLogin(item.login) === target) {
      return true;
    }
  }
  return false;
}

export type GithubAssigneeAssignabilityResult =
  | { ok: true; assignable: true }
  | {
      ok: false;
      assignable: false;
      readiness: Extract<
        GithubMachineAssigneeReadinessCode,
        "unassignable" | "readback_failed" | "unknown"
      >;
      httpStatus: number | null;
    };

/**
 * Check whether `login` can be assigned on the repository via App installation.
 * Uses GET /repos/{owner}/{repo}/assignees/{assignee} (204 assignable, 404 not).
 */
export async function checkGithubLoginAssignability(options: {
  installationId: number;
  owner: string;
  repo: string;
  login: string;
  signal?: AbortSignal;
}): Promise<GithubAssigneeAssignabilityResult> {
  const { githubAppInstallationRequest } = await import("./github-app-client");
  const login = options.login.trim();
  if (!login) {
    return {
      ok: false,
      assignable: false,
      readiness: "unassignable",
      httpStatus: null,
    };
  }

  try {
    const result = await githubAppInstallationRequest(
      options.installationId,
      `/repos/${encodePathSegment(options.owner)}/${encodePathSegment(options.repo)}/assignees/${encodePathSegment(login)}`,
      { method: "GET", signal: options.signal },
    );

    // GitHub: 204 = assignable, 404 = not assignable.
    if (result.status === 204 || result.status === 200) {
      return { ok: true, assignable: true };
    }
    if (result.status === 404) {
      return {
        ok: false,
        assignable: false,
        readiness: "unassignable",
        httpStatus: 404,
      };
    }
    if (result.status === 403 || result.status === 401) {
      return {
        ok: false,
        assignable: false,
        readiness: "unassignable",
        httpStatus: result.status,
      };
    }
    return {
      ok: false,
      assignable: false,
      readiness: "readback_failed",
      httpStatus: result.status,
    };
  } catch (err) {
    if (err instanceof GithubAutomationError) {
      if (err.code === "permission_missing" || err.code === "github_auth_failed") {
        return {
          ok: false,
          assignable: false,
          readiness: "unassignable",
          httpStatus: err.status,
        };
      }
    }
    return {
      ok: false,
      assignable: false,
      readiness: "readback_failed",
      httpStatus: null,
    };
  }
}

export type GithubAddAssigneeResult =
  | {
      ok: true;
      /** True when Issue read-back contains the login. */
      readBackConfirmed: true;
      assignees: Array<{ login: string; id: number | null }>;
    }
  | {
      ok: false;
      reason:
        | "permission_missing"
        | "silent_ignore"
        | "readback_failed"
        | "http_error";
      readiness: GithubMachineAssigneeReadinessCode;
      httpStatus: number | null;
      /** Assignees observed on read-back (if any). */
      assignees: Array<{ login: string; id: number | null }>;
    };

function parseAssigneeList(
  body: unknown,
): Array<{ login: string; id: number | null }> {
  // add-assignees returns the Issue object with assignees[].
  if (!isRecord(body)) return [];
  const list = Array.isArray(body.assignees) ? body.assignees : [];
  const out: Array<{ login: string; id: number | null }> = [];
  for (const item of list) {
    if (!isRecord(item) || typeof item.login !== "string") continue;
    const id =
      typeof item.id === "number" && Number.isInteger(item.id) ? item.id : null;
    out.push({ login: item.login, id });
  }
  return out;
}

/**
 * Add assignee via App API, then treat success only when login is present after
 * a dedicated Issue GET read-back. HTTP 2xx alone is never enough (silent ignore).
 */
export async function addGithubIssueAssigneeWithReadback(options: {
  installationId: number;
  owner: string;
  repo: string;
  issueNumber: number;
  login: string;
  signal?: AbortSignal;
}): Promise<GithubAddAssigneeResult> {
  const { githubAppInstallationRequest } = await import("./github-app-client");
  const login = options.login.trim();
  const emptyAssignees: Array<{ login: string; id: number | null }> = [];

  // Fast path: already assigned on a fresh read.
  try {
    const existing = await fetchGithubIssueAssignees({
      installationId: options.installationId,
      owner: options.owner,
      repo: options.repo,
      issueNumber: options.issueNumber,
      signal: options.signal,
    });
    if (existing.ok && issueAssigneesIncludeLogin(existing.assignees, login)) {
      return {
        ok: true,
        readBackConfirmed: true,
        assignees: existing.assignees,
      };
    }
  } catch {
    // continue to assign attempt
  }

  let assignStatus: number | null = null;
  try {
    const assignResult = await githubAppInstallationRequest(
      options.installationId,
      `/repos/${encodePathSegment(options.owner)}/${encodePathSegment(options.repo)}/issues/${options.issueNumber}/assignees`,
      {
        method: "POST",
        signal: options.signal,
        body: { assignees: [login] },
      },
    );
    assignStatus = assignResult.status;

    if (assignResult.status === 403 || assignResult.status === 401) {
      return {
        ok: false,
        reason: "permission_missing",
        readiness: "unassignable",
        httpStatus: assignResult.status,
        assignees: emptyAssignees,
      };
    }

    // Even on 2xx, GitHub may silently ignore unassignable logins.
    // Always re-fetch the Issue.
  } catch (err) {
    if (err instanceof GithubAutomationError) {
      if (err.code === "permission_missing" || err.code === "github_auth_failed") {
        return {
          ok: false,
          reason: "permission_missing",
          readiness: "unassignable",
          httpStatus: err.status,
          assignees: emptyAssignees,
        };
      }
    }
    return {
      ok: false,
      reason: "http_error",
      readiness: "readback_failed",
      httpStatus: null,
      assignees: emptyAssignees,
    };
  }

  const readBack = await fetchGithubIssueAssignees({
    installationId: options.installationId,
    owner: options.owner,
    repo: options.repo,
    issueNumber: options.issueNumber,
    signal: options.signal,
  });

  if (!readBack.ok) {
    return {
      ok: false,
      reason: "readback_failed",
      readiness: "readback_failed",
      httpStatus: readBack.httpStatus,
      assignees: emptyAssignees,
    };
  }

  if (issueAssigneesIncludeLogin(readBack.assignees, login)) {
    return {
      ok: true,
      readBackConfirmed: true,
      assignees: readBack.assignees,
    };
  }

  // 2xx but login missing → silent ignore.
  return {
    ok: false,
    reason:
      assignStatus !== null && assignStatus >= 200 && assignStatus < 300
        ? "silent_ignore"
        : "http_error",
    readiness: "unassignable",
    httpStatus: assignStatus,
    assignees: readBack.assignees,
  };
}

export async function fetchGithubIssueAssignees(options: {
  installationId: number;
  owner: string;
  repo: string;
  issueNumber: number;
  signal?: AbortSignal;
}): Promise<
  | {
      ok: true;
      assignees: Array<{ login: string; id: number | null }>;
      rawAssignees: unknown;
    }
  | { ok: false; httpStatus: number | null }
> {
  const { githubAppInstallationRequest } = await import("./github-app-client");
  try {
    const result = await githubAppInstallationRequest(
      options.installationId,
      `/repos/${encodePathSegment(options.owner)}/${encodePathSegment(options.repo)}/issues/${options.issueNumber}`,
      { method: "GET", signal: options.signal },
    );
    if (result.status < 200 || result.status >= 300 || !isRecord(result.body)) {
      return { ok: false, httpStatus: result.status };
    }
    const rawAssignees = result.body.assignees;
    return {
      ok: true,
      assignees: parseAssigneeList(result.body),
      rawAssignees,
    };
  } catch {
    return { ok: false, httpStatus: null };
  }
}

/** Re-export source type for convenience. */
export type { GithubMachineAssigneeIdentitySource };
