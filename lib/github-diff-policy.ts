/**
 * github-diff-policy — collect WorkTree diffs and apply pre/plan/final gates (GHA-07).
 *
 * Responsibilities:
 * - Run fixed git argv (no shell, no Issue-controlled args) to list name-status + numstat.
 * - Detect binary / submodule / symlink signals from git metadata.
 * - Feed file list into github-risk-policy for allow/block.
 * - Final allow is required before server publisher may push.
 *
 * Not a sandbox: this only decides publish eligibility for the Git diff.
 */

import { execFile } from "node:child_process";
import { lstatSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  evaluateGithubRiskPolicy,
  type GithubRiskPolicyFileChange,
  type GithubRiskPolicyLimits,
  type GithubRiskPolicyResult,
  type GithubRiskPolicyStage,
} from "./github-risk-policy";
import type { GithubAutomationRiskProfile } from "./github-automation-types";
import { redactGithubAutomationSecrets } from "./github-automation-errors";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_BUFFER = 4 * 1024 * 1024;

export interface GithubDiffCollectOptions {
  cwd: string;
  /** Fixed base ref or commit (usually main / config baseRef). */
  baseRef: string;
  timeoutMs?: number;
  /**
   * Test hook: custom git runner. Production omits this.
   * argv is always ["git", ...args] style without shell.
   */
  runGit?: (args: readonly string[]) => Promise<string>;
}

export interface GithubDiffSnapshot {
  baseRef: string;
  files: GithubRiskPolicyFileChange[];
  nameStatusRawPreview: string;
  numstatRawPreview: string;
}

export interface GithubDiffPolicyEvaluation {
  stage: GithubRiskPolicyStage;
  snapshot: GithubDiffSnapshot;
  policy: GithubRiskPolicyResult;
}

async function defaultRunGit(
  cwd: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync("git", [...args], {
      cwd,
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: MAX_BUFFER,
      shell: false,
      env: {
        ...process.env,
        // Never pass through askpass / tokens for diff inspection.
        GIT_ASKPASS: "",
        GIT_TERMINAL_PROMPT: "0",
        GITHUB_TOKEN: "",
        GH_TOKEN: "",
      },
    });
    void stderr;
    return String(stdout ?? "");
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    const detail = redactGithubAutomationSecrets(
      (e.stderr || e.stdout || e.message || "git failed").trim(),
    ).slice(0, 300);
    throw new Error(`git ${args[0] ?? ""} failed: ${detail}`);
  }
}

function preview(text: string, max = 2000): string {
  const cleaned = redactGithubAutomationSecrets(text.replace(/\u0000/g, ""));
  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max)}…`;
}

/**
 * Parse `git diff --name-status` output into path + status.
 * Handles renames: `R100\told\tnew`.
 */
export function parseGitNameStatus(output: string): Array<{
  status: string;
  path: string;
  fromPath?: string;
}> {
  const rows: Array<{ status: string; path: string; fromPath?: string }> = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 2) continue;
    const status = (parts[0] ?? "").trim();
    if (!status) continue;
    if ((status.startsWith("R") || status.startsWith("C")) && parts.length >= 3) {
      rows.push({
        status,
        fromPath: parts[1],
        path: parts[2],
      });
      continue;
    }
    rows.push({ status, path: parts[parts.length - 1] ?? "" });
  }
  return rows.filter((r) => r.path);
}

/**
 * Parse `git diff --numstat` output.
 * Binary files appear as `-\t-\tpath`.
 */
export function parseGitNumstat(output: string): Array<{
  path: string;
  additions: number;
  deletions: number;
  isBinary: boolean;
}> {
  const rows: Array<{
    path: string;
    additions: number;
    deletions: number;
    isBinary: boolean;
  }> = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const addRaw = parts[0] ?? "0";
    const delRaw = parts[1] ?? "0";
    const path = parts.slice(2).join("\t");
    const isBinary = addRaw === "-" || delRaw === "-";
    rows.push({
      path,
      additions: isBinary ? 0 : Math.max(0, Number.parseInt(addRaw, 10) || 0),
      deletions: isBinary ? 0 : Math.max(0, Number.parseInt(delRaw, 10) || 0),
      isBinary,
    });
  }
  return rows.filter((r) => r.path);
}

function detectSymlink(cwd: string, relPath: string): boolean {
  try {
    const st = lstatSync(join(cwd, relPath));
    return st.isSymbolicLink();
  } catch {
    return false;
  }
}

function detectSubmoduleMode(modeLine: string | undefined): boolean {
  // git ls-files -s: <mode> <sha> <stage> <path>; mode 160000 = gitlink
  if (!modeLine) return false;
  return /^\s*160000\b/.test(modeLine);
}

/**
 * Collect diff snapshot of working tree + index vs baseRef (three-dot style for PR).
 * Uses: `git diff --name-status base...HEAD` and unstaged/staged against base when dirty.
 *
 * Strategy: prefer `baseRef...HEAD` for committed work; also merge `git diff --name-status baseRef`
 * to include uncommitted WorkTree changes before publisher commits.
 */
export async function collectGithubDiffSnapshot(
  options: GithubDiffCollectOptions,
): Promise<GithubDiffSnapshot> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const run =
    options.runGit ??
    ((args: readonly string[]) => defaultRunGit(options.cwd, args, timeoutMs));

  const baseRef = options.baseRef.trim() || "main";
  // Range for committed history on the automation branch.
  const range = `${baseRef}...HEAD`;

  const nameStatusCommitted = await run(["diff", "--name-status", range]);
  const numstatCommitted = await run(["diff", "--numstat", range]);
  // Uncommitted changes relative to base (includes staged+unstaged vs merge-base feel).
  // Using baseRef (two-dot) catches WIP not yet committed.
  let nameStatusDirty = "";
  let numstatDirty = "";
  try {
    nameStatusDirty = await run(["diff", "--name-status", baseRef]);
    numstatDirty = await run(["diff", "--numstat", baseRef]);
  } catch {
    nameStatusDirty = "";
    numstatDirty = "";
  }

  const nameRows = [
    ...parseGitNameStatus(nameStatusCommitted),
    ...parseGitNameStatus(nameStatusDirty),
  ];
  const numRows = [
    ...parseGitNumstat(numstatCommitted),
    ...parseGitNumstat(numstatDirty),
  ];

  const byPath = new Map<string, GithubRiskPolicyFileChange>();

  for (const row of nameRows) {
    const path = row.path.replace(/\\/g, "/");
    const prev = byPath.get(path) ?? { path };
    prev.status = row.status.charAt(0);
    byPath.set(path, prev);
  }
  for (const row of numRows) {
    const path = row.path.replace(/\\/g, "/");
    const prev = byPath.get(path) ?? { path };
    prev.additions = (prev.additions ?? 0) + row.additions;
    prev.deletions = (prev.deletions ?? 0) + row.deletions;
    if (row.isBinary) prev.isBinary = true;
    byPath.set(path, prev);
  }

  // Symlink / submodule enrichment (best-effort; tests can inject flags).
  let lsFiles = "";
  try {
    lsFiles = await run(["ls-files", "-s"]);
  } catch {
    lsFiles = "";
  }
  const modeByPath = new Map<string, string>();
  for (const line of lsFiles.split(/\r?\n/)) {
    if (!line.trim()) continue;
    // mode sha stage path — path may contain spaces
    const m = line.match(/^(\d+)\s+[0-9a-f]+\s+\d+\t(.+)$/i);
    if (m) modeByPath.set(m[2].replace(/\\/g, "/"), m[1]);
  }

  for (const [path, file] of byPath) {
    const mode = modeByPath.get(path);
    if (mode === "160000" || detectSubmoduleMode(mode ? `${mode} x 0\t${path}` : undefined)) {
      file.isSubmodule = true;
    }
    if (mode === "120000" || detectSymlink(options.cwd, path)) {
      file.isSymlink = true;
    }
  }

  const files = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));

  return {
    baseRef,
    files,
    nameStatusRawPreview: preview(
      [nameStatusCommitted, nameStatusDirty].filter(Boolean).join("\n"),
    ),
    numstatRawPreview: preview(
      [numstatCommitted, numstatDirty].filter(Boolean).join("\n"),
    ),
  };
}

export interface EvaluateGithubDiffPolicyInput {
  stage: GithubRiskPolicyStage;
  cwd: string;
  baseRef: string;
  limits: GithubRiskPolicyLimits;
  riskProfile?: GithubAutomationRiskProfile | string | null;
  planText?: string | null;
  issueTitlePreview?: string | null;
  explicitSmallBugfix?: boolean;
  /** Optional pre-built snapshot (tests). */
  snapshot?: GithubDiffSnapshot;
  runGit?: GithubDiffCollectOptions["runGit"];
  timeoutMs?: number;
}

/**
 * Collect (unless snapshot provided) and evaluate risk policy for a stage.
 */
export async function evaluateGithubDiffPolicy(
  input: EvaluateGithubDiffPolicyInput,
): Promise<GithubDiffPolicyEvaluation> {
  const snapshot =
    input.snapshot ??
    (await collectGithubDiffSnapshot({
      cwd: input.cwd,
      baseRef: input.baseRef,
      runGit: input.runGit,
      timeoutMs: input.timeoutMs,
    }));

  const policy = evaluateGithubRiskPolicy({
    stage: input.stage,
    riskProfile: input.riskProfile,
    limits: input.limits,
    files: snapshot.files,
    planText: input.planText,
    issueTitlePreview: input.issueTitlePreview,
    explicitSmallBugfix: input.explicitSmallBugfix,
  });

  return { stage: input.stage, snapshot, policy };
}

/**
 * True when final policy allows publish. No allow → no push.
 */
export function isGithubFinalDiffAllowed(
  evaluation: GithubDiffPolicyEvaluation,
): boolean {
  return (
    evaluation.stage === "final" &&
    evaluation.policy.decision === "allow" &&
    evaluation.policy.reasonCode !== "blocked_empty_diff"
  );
}

/**
 * Reject attempts to let Issue text supply git range / remote / paths.
 */
export function assertDiffArgsNotFromIssue(input: {
  issueProvidedBaseRef?: unknown;
  issueProvidedPaths?: unknown;
  issueProvidedRemote?: unknown;
}): void {
  if (input.issueProvidedBaseRef != null) {
    throw new Error("Issue text cannot set diff baseRef; use repository config only.");
  }
  if (input.issueProvidedPaths != null) {
    throw new Error("Issue text cannot set diff path filters.");
  }
  if (input.issueProvidedRemote != null) {
    throw new Error("Issue text cannot set git remote for policy evaluation.");
  }
}
