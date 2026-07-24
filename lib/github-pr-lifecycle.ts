/**
 * github-pr-lifecycle — reconcile known automation pull_request events (GHA-09).
 *
 * Rules:
 * - Only mutate jobs for allowlisted repositoryId + known head/PR identity.
 * - Fork heads and head-collision ambiguities never mutate jobs.
 * - Distinguish merged vs closed-unmerged; never auto-close Issues here.
 * - Never persist PR body, review comments, credentials, or absolute paths.
 * - Status/refresh callers must not enqueue work through this module.
 */

import { findRepositoryConfigById } from "./github-automation-config";
import type { GithubAutomationConfigV1 } from "./github-automation-types";
import {
  appendGithubAutomationSafeEvent,
  listGithubAutomationJobs,
  readGithubAutomationJob,
  upsertEffectMarker,
  writeGithubAutomationJob,
  type GithubAutomationEffectMarker,
  type GithubAutomationJobRecord,
  type GithubAutomationJobPhase,
  type GithubAutomationJobStatus,
} from "./github-automation-store";
import { buildGithubAutomationBranchName } from "./github-automation-worktree";
import { redactGithubAutomationSecrets } from "./github-automation-errors";

// ─── Types ───────────────────────────────────────────────────────────────────

export type GithubPullRequestLifecycleAction =
  | "opened"
  | "reopened"
  | "synchronize"
  | "edited"
  | "closed"
  | "ready_for_review"
  | "converted_to_draft"
  | "assigned"
  | "unassigned"
  | "labeled"
  | "unlabeled"
  | "review_requested"
  | "review_request_removed"
  | "other";

export type GithubPullRequestLifecycleDisposition =
  | "ignored_unknown_identity"
  | "ignored_fork"
  | "ignored_head_collision"
  | "ignored_not_allowlisted"
  | "ignored_unsupported_action"
  | "reconciled_open"
  | "reconciled_merged"
  | "reconciled_closed_unmerged"
  | "noop_already_terminal";

export interface GithubPullRequestEventIdentity {
  action: GithubPullRequestLifecycleAction;
  deliveryId: string | null;
  repositoryId: number;
  repositoryFullName: string | null;
  installationId: number | null;
  prNumber: number;
  /** Safe https URL only; never API tokens. */
  htmlUrl: string | null;
  headRef: string;
  baseRef: string;
  headRepositoryId: number | null;
  headRepositoryFullName: string | null;
  headIsFork: boolean;
  merged: boolean;
  state: "open" | "closed" | "other";
  /** Safe author login only. */
  authorLogin: string | null;
}

export interface GithubPullRequestLifecycleResult {
  disposition: GithubPullRequestLifecycleDisposition;
  reasonCode: string;
  jobId: string | null;
  prNumber: number | null;
  merged: boolean | null;
  /** True only when a job record was written. */
  mutated: boolean;
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asPositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const n = Number(value);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return null;
}

function sanitizeRef(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[^a-zA-Z0-9._/-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200);
}

function sanitizeLogin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const login = value.trim().slice(0, 64);
  if (!login || !/^[A-Za-z0-9-]+$/.test(login)) return null;
  return login;
}

function sanitizeHtmlUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("https://github.com/")) return null;
  if (trimmed.length > 300) return null;
  if (/[?\s]/.test(trimmed)) return null;
  return trimmed;
}

function mapAction(raw: unknown): GithubPullRequestLifecycleAction {
  if (typeof raw !== "string") return "other";
  const a = raw.trim().toLowerCase();
  switch (a) {
    case "opened":
    case "reopened":
    case "synchronize":
    case "edited":
    case "closed":
    case "ready_for_review":
    case "converted_to_draft":
    case "assigned":
    case "unassigned":
    case "labeled":
    case "unlabeled":
    case "review_requested":
    case "review_request_removed":
      return a;
    default:
      return "other";
  }
}

/**
 * Parse a verified GitHub pull_request webhook payload into a safe identity.
 * Returns null when required identity fields are missing.
 * Never retains body / reviews / comments.
 */
export function parseGithubPullRequestEventIdentity(options: {
  payload: unknown;
  deliveryId?: string | null;
}): GithubPullRequestEventIdentity | null {
  const payload = isRecord(options.payload) ? options.payload : null;
  if (!payload) return null;

  const repository = isRecord(payload.repository) ? payload.repository : null;
  const pullRequest = isRecord(payload.pull_request) ? payload.pull_request : null;
  if (!repository || !pullRequest) return null;

  const repositoryId = asPositiveInt(repository.id);
  const prNumber = asPositiveInt(pullRequest.number);
  if (repositoryId === null || prNumber === null) return null;

  const head = isRecord(pullRequest.head) ? pullRequest.head : null;
  const base = isRecord(pullRequest.base) ? pullRequest.base : null;
  const headRef = sanitizeRef(head?.ref);
  const baseRef = sanitizeRef(base?.ref) || "main";
  if (!headRef) return null;

  const headRepo = head && isRecord(head.repo) ? head.repo : null;
  const headRepositoryId = headRepo ? asPositiveInt(headRepo.id) : null;
  const headRepositoryFullName =
    headRepo && typeof headRepo.full_name === "string"
      ? headRepo.full_name.trim().slice(0, 200) || null
      : null;
  const headIsFork =
    headRepo && typeof headRepo.fork === "boolean" ? headRepo.fork : false;

  const merged = pullRequest.merged === true;
  const stateRaw =
    typeof pullRequest.state === "string" ? pullRequest.state.trim().toLowerCase() : "";
  const state: GithubPullRequestEventIdentity["state"] =
    stateRaw === "open" || stateRaw === "closed" ? stateRaw : "other";

  const user = isRecord(pullRequest.user) ? pullRequest.user : null;
  const authorLogin = sanitizeLogin(user?.login);

  let repositoryFullName: string | null = null;
  if (typeof repository.full_name === "string") {
    repositoryFullName = repository.full_name.trim().slice(0, 200) || null;
  }

  let installationId: number | null = null;
  if (isRecord(payload.installation)) {
    installationId = asPositiveInt(payload.installation.id);
  }

  return {
    action: mapAction(payload.action),
    deliveryId:
      typeof options.deliveryId === "string" && options.deliveryId.trim()
        ? options.deliveryId.trim().slice(0, 128)
        : null,
    repositoryId,
    repositoryFullName,
    installationId,
    prNumber,
    htmlUrl: sanitizeHtmlUrl(pullRequest.html_url),
    headRef,
    baseRef,
    headRepositoryId,
    headRepositoryFullName,
    headIsFork,
    merged,
    state,
    authorLogin,
  };
}

// ─── Matching ────────────────────────────────────────────────────────────────

const AUTOMATION_HEAD_RE =
  /^ypi\/gha\/(\d+)\/issue-(\d+)\/g(\d+)$/i;

export function parseAutomationHeadBranch(headRef: string): {
  repositoryId: number;
  issueNumber: number;
  generation: number;
} | null {
  const m = sanitizeRef(headRef).match(AUTOMATION_HEAD_RE);
  if (!m) return null;
  const repositoryId = Number.parseInt(m[1] ?? "", 10);
  const issueNumber = Number.parseInt(m[2] ?? "", 10);
  const generation = Number.parseInt(m[3] ?? "", 10);
  if (
    !Number.isInteger(repositoryId) ||
    repositoryId <= 0 ||
    !Number.isInteger(issueNumber) ||
    issueNumber <= 0 ||
    !Number.isInteger(generation) ||
    generation <= 0
  ) {
    return null;
  }
  return { repositoryId, issueNumber, generation };
}

function effectRemoteIds(
  job: GithubAutomationJobRecord,
  name: GithubAutomationEffectMarker["name"],
): string[] {
  return job.effects
    .filter((e) => e.name === name && typeof e.remoteId === "string" && e.remoteId)
    .map((e) => e.remoteId as string);
}

function jobExpectedHead(job: GithubAutomationJobRecord): string {
  const branchFromEffect = effectRemoteIds(job, "branch")[0];
  if (branchFromEffect) return sanitizeRef(branchFromEffect);
  return buildGithubAutomationBranchName({
    repositoryId: job.repositoryId,
    issueNumber: job.issueNumber,
    generation: job.generation,
  });
}

export type GithubPullRequestJobMatch =
  | { kind: "none" }
  | { kind: "collision"; jobIds: string[] }
  | { kind: "match"; job: GithubAutomationJobRecord; matchBy: "pr_number" | "head_branch" };

/**
 * Resolve the single known automation job for a PR event.
 * Unknown / multi-match → no mutation.
 */
export function matchGithubAutomationJobForPullRequest(options: {
  identity: GithubPullRequestEventIdentity;
  jobs: readonly GithubAutomationJobRecord[];
}): GithubPullRequestJobMatch {
  const { identity, jobs } = options;
  const sameRepo = jobs.filter((j) => j.repositoryId === identity.repositoryId);
  if (sameRepo.length === 0) return { kind: "none" };

  const prKey = String(identity.prNumber);
  const byPr = sameRepo.filter((j) =>
    effectRemoteIds(j, "pull_request").includes(prKey),
  );
  if (byPr.length === 1) {
    return { kind: "match", job: byPr[0]!, matchBy: "pr_number" };
  }
  if (byPr.length > 1) {
    return {
      kind: "collision",
      jobIds: byPr.map((j) => j.jobId).sort(),
    };
  }

  const head = sanitizeRef(identity.headRef);
  const byHead = sameRepo.filter((j) => jobExpectedHead(j) === head);
  if (byHead.length === 1) {
    return { kind: "match", job: byHead[0]!, matchBy: "head_branch" };
  }
  if (byHead.length > 1) {
    return {
      kind: "collision",
      jobIds: byHead.map((j) => j.jobId).sort(),
    };
  }

  // Parsed automation head may still point at a job that has not recorded branch effect yet.
  const parsed = parseAutomationHeadBranch(head);
  if (
    parsed &&
    parsed.repositoryId === identity.repositoryId
  ) {
    const byParsed = sameRepo.filter(
      (j) =>
        j.issueNumber === parsed.issueNumber &&
        j.generation === parsed.generation,
    );
    if (byParsed.length === 1) {
      return { kind: "match", job: byParsed[0]!, matchBy: "head_branch" };
    }
    if (byParsed.length > 1) {
      return {
        kind: "collision",
        jobIds: byParsed.map((j) => j.jobId).sort(),
      };
    }
  }

  return { kind: "none" };
}

// ─── State transitions ───────────────────────────────────────────────────────

function isTerminalJob(job: GithubAutomationJobRecord): boolean {
  return (
    job.status === "completed" ||
    job.status === "cancelled" ||
    job.status === "ignored" ||
    job.phase === "completed" ||
    job.phase === "cancelled"
  );
}

function applyPrEffect(
  job: GithubAutomationJobRecord,
  identity: GithubPullRequestEventIdentity,
  reasonCode: string,
): GithubAutomationEffectMarker[] {
  return upsertEffectMarker(job.effects, {
    name: "pull_request",
    status: "remote_confirmed",
    remoteId: String(identity.prNumber),
    generation: job.generation,
    reasonCode,
    updatedAt: new Date().toISOString(),
  });
}

function maybeApplyBranchEffect(
  effects: GithubAutomationEffectMarker[],
  job: GithubAutomationJobRecord,
  headRef: string,
): GithubAutomationEffectMarker[] {
  const head = sanitizeRef(headRef);
  if (!head.startsWith("ypi/gha/")) return effects;
  if (effectRemoteIds({ ...job, effects }, "branch").includes(head)) {
    return effects;
  }
  return upsertEffectMarker(effects, {
    name: "branch",
    status: "remote_confirmed",
    remoteId: head,
    generation: job.generation,
    reasonCode: "pr_head_observed",
    updatedAt: new Date().toISOString(),
  });
}

export function projectPullRequestLifecycleTransition(options: {
  job: GithubAutomationJobRecord;
  identity: GithubPullRequestEventIdentity;
}): {
  disposition: GithubPullRequestLifecycleDisposition;
  reasonCode: string;
  next: GithubAutomationJobRecord | null;
} {
  const { job, identity } = options;
  const now = new Date().toISOString();

  if (identity.action === "closed" || identity.state === "closed") {
    if (identity.merged) {
      if (job.phase === "completed" && job.status === "completed") {
        return {
          disposition: "noop_already_terminal",
          reasonCode: "already_merged",
          next: null,
        };
      }
      let effects = applyPrEffect(job, identity, "pr_merged");
      effects = maybeApplyBranchEffect(effects, job, identity.headRef);
      const next: GithubAutomationJobRecord = {
        ...job,
        phase: "completed",
        status: "completed",
        reasonCode: "pr_merged",
        checkpoint: "completed",
        nextRetryAt: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        effects,
        updatedAt: now,
      };
      return {
        disposition: "reconciled_merged",
        reasonCode: "pr_merged",
        next,
      };
    }

    // closed-unmerged: block automation continuation; Issue stays open (no API close).
    if (
      job.reasonCode === "pr_closed_unmerged" &&
      (job.status === "blocked" || job.phase === "blocked")
    ) {
      return {
        disposition: "noop_already_terminal",
        reasonCode: "already_closed_unmerged",
        next: null,
      };
    }
    if (job.phase === "completed" && job.status === "completed") {
      // Do not downgrade a previously merged completion.
      return {
        disposition: "noop_already_terminal",
        reasonCode: "already_merged",
        next: null,
      };
    }
    let effects = applyPrEffect(job, identity, "pr_closed_unmerged");
    effects = maybeApplyBranchEffect(effects, job, identity.headRef);
    const next: GithubAutomationJobRecord = {
      ...job,
      phase: "blocked",
      status: "blocked",
      reasonCode: "pr_closed_unmerged",
      checkpoint: "pr_closed_unmerged",
      nextRetryAt: null,
      effects,
      updatedAt: now,
    };
    return {
      disposition: "reconciled_closed_unmerged",
      reasonCode: "pr_closed_unmerged",
      next,
    };
  }

  // Open-path actions: keep/mark pr_open without inventing publish success if never published.
  if (
    identity.action === "opened" ||
    identity.action === "reopened" ||
    identity.action === "synchronize" ||
    identity.action === "edited" ||
    identity.action === "ready_for_review" ||
    identity.state === "open"
  ) {
    if (isTerminalJob(job) && job.reasonCode === "pr_merged") {
      return {
        disposition: "noop_already_terminal",
        reasonCode: "already_merged",
        next: null,
      };
    }
    let effects = applyPrEffect(job, identity, "pr_open");
    effects = maybeApplyBranchEffect(effects, job, identity.headRef);
    const alreadyOpen =
      job.phase === "pr_open" &&
      job.status === "completed" &&
      effectRemoteIds(job, "pull_request").includes(String(identity.prNumber));
    if (alreadyOpen) {
      return {
        disposition: "reconciled_open",
        reasonCode: "pr_open_observed",
        next: null,
      };
    }
    const next: GithubAutomationJobRecord = {
      ...job,
      phase: "pr_open",
      // Publishing already finished; keep completed status when already open PR.
      status: job.status === "running" ? "completed" : job.status === "queued" ? "completed" : "completed",
      reasonCode: "pr_open",
      checkpoint: "pr_open",
      nextRetryAt: null,
      effects,
      updatedAt: now,
    };
    return {
      disposition: "reconciled_open",
      reasonCode: "pr_open",
      next,
    };
  }

  return {
    disposition: "ignored_unsupported_action",
    reasonCode: `unsupported_action_${identity.action}`,
    next: null,
  };
}

// ─── Orchestration ───────────────────────────────────────────────────────────

export async function reconcileGithubPullRequestEvent(options: {
  config: GithubAutomationConfigV1;
  payload: unknown;
  deliveryId?: string | null;
  /**
   * Optional job list injection for tests. Production lists from store.
   */
  jobs?: readonly GithubAutomationJobRecord[];
}): Promise<GithubPullRequestLifecycleResult> {
  const identity = parseGithubPullRequestEventIdentity({
    payload: options.payload,
    deliveryId: options.deliveryId,
  });
  if (!identity) {
    return {
      disposition: "ignored_unknown_identity",
      reasonCode: "malformed_pull_request_payload",
      jobId: null,
      prNumber: null,
      merged: null,
      mutated: false,
    };
  }

  if (!findRepositoryConfigById(options.config, identity.repositoryId)) {
    return {
      disposition: "ignored_not_allowlisted",
      reasonCode: "repository_not_allowlisted",
      jobId: null,
      prNumber: identity.prNumber,
      merged: identity.merged,
      mutated: false,
    };
  }

  // Fork head or head repo mismatch → never mutate.
  if (
    identity.headIsFork ||
    (identity.headRepositoryId !== null &&
      identity.headRepositoryId !== identity.repositoryId)
  ) {
    await appendGithubAutomationSafeEvent({
      at: new Date().toISOString(),
      kind: "pr_lifecycle_ignored",
      repositoryId: identity.repositoryId,
      issueNumber: null,
      jobId: null,
      deliveryId: identity.deliveryId,
      phase: null,
      reasonCode: "fork_or_external_head",
      traceId: null,
      meta: {
        prNumber: identity.prNumber,
        headIsFork: identity.headIsFork,
      },
    });
    return {
      disposition: "ignored_fork",
      reasonCode: "fork_or_external_head",
      jobId: null,
      prNumber: identity.prNumber,
      merged: identity.merged,
      mutated: false,
    };
  }

  const jobs =
    options.jobs !== undefined
      ? [...options.jobs]
      : await listGithubAutomationJobs();
  const match = matchGithubAutomationJobForPullRequest({ identity, jobs });

  if (match.kind === "none") {
    await appendGithubAutomationSafeEvent({
      at: new Date().toISOString(),
      kind: "pr_lifecycle_ignored",
      repositoryId: identity.repositoryId,
      issueNumber: null,
      jobId: null,
      deliveryId: identity.deliveryId,
      phase: null,
      reasonCode: "unknown_pr_identity",
      traceId: null,
      meta: {
        prNumber: identity.prNumber,
        headRef: redactGithubAutomationSecrets(identity.headRef).slice(0, 120),
      },
    });
    return {
      disposition: "ignored_unknown_identity",
      reasonCode: "unknown_pr_identity",
      jobId: null,
      prNumber: identity.prNumber,
      merged: identity.merged,
      mutated: false,
    };
  }

  if (match.kind === "collision") {
    await appendGithubAutomationSafeEvent({
      at: new Date().toISOString(),
      kind: "pr_lifecycle_ignored",
      repositoryId: identity.repositoryId,
      issueNumber: null,
      jobId: null,
      deliveryId: identity.deliveryId,
      phase: null,
      reasonCode: "head_collision",
      traceId: null,
      meta: {
        prNumber: identity.prNumber,
        jobCount: match.jobIds.length,
      },
    });
    return {
      disposition: "ignored_head_collision",
      reasonCode: "head_collision",
      jobId: null,
      prNumber: identity.prNumber,
      merged: identity.merged,
      mutated: false,
    };
  }

  // Re-read latest job to avoid stale write over a newer generation.
  const latest = (await readGithubAutomationJob(match.job.jobId)) ?? match.job;
  if (latest.generation > match.job.generation) {
    return {
      disposition: "ignored_unknown_identity",
      reasonCode: "stale_job_generation",
      jobId: latest.jobId,
      prNumber: identity.prNumber,
      merged: identity.merged,
      mutated: false,
    };
  }

  const transition = projectPullRequestLifecycleTransition({
    job: latest,
    identity,
  });

  if (!transition.next) {
    await appendGithubAutomationSafeEvent({
      at: new Date().toISOString(),
      kind: "pr_lifecycle_noop",
      repositoryId: identity.repositoryId,
      issueNumber: latest.issueNumber,
      jobId: latest.jobId,
      deliveryId: identity.deliveryId,
      phase: latest.phase,
      reasonCode: transition.reasonCode,
      traceId: latest.traceId,
      meta: {
        prNumber: identity.prNumber,
        disposition: transition.disposition,
        merged: identity.merged,
      },
    });
    return {
      disposition: transition.disposition,
      reasonCode: transition.reasonCode,
      jobId: latest.jobId,
      prNumber: identity.prNumber,
      merged: identity.merged,
      mutated: false,
    };
  }

  await writeGithubAutomationJob(transition.next);
  await appendGithubAutomationSafeEvent({
    at: new Date().toISOString(),
    kind: "pr_lifecycle_reconciled",
    repositoryId: identity.repositoryId,
    issueNumber: transition.next.issueNumber,
    jobId: transition.next.jobId,
    deliveryId: identity.deliveryId,
    phase: transition.next.phase,
    reasonCode: transition.reasonCode,
    traceId: transition.next.traceId,
    meta: {
      prNumber: identity.prNumber,
      disposition: transition.disposition,
      merged: identity.merged,
      matchBy: match.matchBy,
      // Explicit: lifecycle does not post duplicate completion comments.
      postsComment: false,
      closesIssue: false,
    },
  });

  return {
    disposition: transition.disposition,
    reasonCode: transition.reasonCode,
    jobId: transition.next.jobId,
    prNumber: identity.prNumber,
    merged: identity.merged,
    mutated: true,
  };
}

/** Phase helpers for tests / projection. */
export function githubPullRequestLifecycleTerminalPhase(
  disposition: GithubPullRequestLifecycleDisposition,
): GithubAutomationJobPhase | null {
  switch (disposition) {
    case "reconciled_merged":
      return "completed";
    case "reconciled_closed_unmerged":
      return "blocked";
    case "reconciled_open":
      return "pr_open";
    default:
      return null;
  }
}

export function githubPullRequestLifecycleTerminalStatus(
  disposition: GithubPullRequestLifecycleDisposition,
): GithubAutomationJobStatus | null {
  switch (disposition) {
    case "reconciled_merged":
      return "completed";
    case "reconciled_closed_unmerged":
      return "blocked";
    case "reconciled_open":
      return "completed";
    default:
      return null;
  }
}
