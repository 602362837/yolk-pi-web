/**
 * github-automation-labels — approved label catalog + App-managed claim labels (GHA-03).
 *
 * Rules:
 * - Only manage the approved ypi:* / type / risk catalog.
 * - Never delete unrelated user labels.
 * - Claim success requires `ypi:claimed` read-back; incomplete claims must not keep Bot-managed claimed.
 */

import { githubAppInstallationRequest } from "./github-app-client";
import { GithubAutomationError } from "./github-automation-errors";

// ─── Catalog ─────────────────────────────────────────────────────────────────

export const YPI_LABEL_CLAIMED = "ypi:claimed" as const;
export const YPI_LABEL_CLAIM_BLOCKED = "ypi:claim-blocked" as const;
export const YPI_LABEL_TRIAGED = "ypi:triaged" as const;
export const YPI_LABEL_AWAITING_OWNER = "ypi:awaiting-owner" as const;
export const YPI_LABEL_IMPLEMENTING = "ypi:implementing" as const;
export const YPI_LABEL_BLOCKED = "ypi:blocked" as const;
export const YPI_LABEL_PR_OPEN = "ypi:pr-open" as const;

export const YPI_LABEL_DECISION_YES = "ypi:decision-yes" as const;
export const YPI_LABEL_DECISION_NO = "ypi:decision-no" as const;
export const YPI_LABEL_DECISION_NEEDS_INFO = "ypi:decision-needs-info" as const;

export const YPI_LABEL_RISK_LOW = "ypi:risk-low" as const;
export const YPI_LABEL_RISK_MEDIUM = "ypi:risk-medium" as const;
export const YPI_LABEL_RISK_HIGH = "ypi:risk-high" as const;

export const YPI_LABEL_TYPE_DOCS = "ypi:type-docs" as const;
export const YPI_LABEL_TYPE_BUG = "ypi:type-bug" as const;
export const YPI_LABEL_TYPE_FEATURE = "ypi:type-feature" as const;
export const YPI_LABEL_TYPE_OTHER = "ypi:type-other" as const;

/** Bot-managed lifecycle labels (may be added/removed by automation). */
export const YPI_BOT_MANAGED_LIFECYCLE_LABELS = [
  YPI_LABEL_CLAIMED,
  YPI_LABEL_CLAIM_BLOCKED,
  YPI_LABEL_TRIAGED,
  YPI_LABEL_AWAITING_OWNER,
  YPI_LABEL_IMPLEMENTING,
  YPI_LABEL_BLOCKED,
  YPI_LABEL_PR_OPEN,
] as const;

/** Full approved catalog — automation never deletes labels outside this set. */
export const YPI_APPROVED_LABEL_CATALOG = [
  ...YPI_BOT_MANAGED_LIFECYCLE_LABELS,
  YPI_LABEL_DECISION_YES,
  YPI_LABEL_DECISION_NO,
  YPI_LABEL_DECISION_NEEDS_INFO,
  YPI_LABEL_RISK_LOW,
  YPI_LABEL_RISK_MEDIUM,
  YPI_LABEL_RISK_HIGH,
  YPI_LABEL_TYPE_DOCS,
  YPI_LABEL_TYPE_BUG,
  YPI_LABEL_TYPE_FEATURE,
  YPI_LABEL_TYPE_OTHER,
] as const;

export type YpiApprovedLabel = (typeof YPI_APPROVED_LABEL_CATALOG)[number];

export type YpiTriageDecisionLabel =
  | typeof YPI_LABEL_DECISION_YES
  | typeof YPI_LABEL_DECISION_NO
  | typeof YPI_LABEL_DECISION_NEEDS_INFO;

export type YpiTriageRiskLabel =
  | typeof YPI_LABEL_RISK_LOW
  | typeof YPI_LABEL_RISK_MEDIUM
  | typeof YPI_LABEL_RISK_HIGH;

export type YpiTriageTypeLabel =
  | typeof YPI_LABEL_TYPE_DOCS
  | typeof YPI_LABEL_TYPE_BUG
  | typeof YPI_LABEL_TYPE_FEATURE
  | typeof YPI_LABEL_TYPE_OTHER;

const LABEL_COLORS: Record<string, string> = {
  [YPI_LABEL_CLAIMED]: "0E8A16",
  [YPI_LABEL_CLAIM_BLOCKED]: "B60205",
  [YPI_LABEL_TRIAGED]: "1D76DB",
  [YPI_LABEL_AWAITING_OWNER]: "FBCA04",
  [YPI_LABEL_IMPLEMENTING]: "5319E7",
  [YPI_LABEL_BLOCKED]: "D93F0B",
  [YPI_LABEL_PR_OPEN]: "0052CC",
  [YPI_LABEL_DECISION_YES]: "0E8A16",
  [YPI_LABEL_DECISION_NO]: "BFDADC",
  [YPI_LABEL_DECISION_NEEDS_INFO]: "FEF2C0",
  [YPI_LABEL_RISK_LOW]: "C2E0C6",
  [YPI_LABEL_RISK_MEDIUM]: "FEF2C0",
  [YPI_LABEL_RISK_HIGH]: "E99695",
  [YPI_LABEL_TYPE_DOCS]: "0075CA",
  [YPI_LABEL_TYPE_BUG]: "D73A4A",
  [YPI_LABEL_TYPE_FEATURE]: "A2EEEF",
  [YPI_LABEL_TYPE_OTHER]: "D4C5F9",
};

const LABEL_DESCRIPTIONS: Record<string, string> = {
  [YPI_LABEL_CLAIMED]: "YPI automation claim complete (label + machine assignee)",
  [YPI_LABEL_CLAIM_BLOCKED]: "YPI automation claim incomplete (assignee/credential)",
  [YPI_LABEL_TRIAGED]: "YPI automation triage complete",
  [YPI_LABEL_AWAITING_OWNER]: "Waiting for repository owner adoption",
  [YPI_LABEL_IMPLEMENTING]: "YPI unattended implementation in progress",
  [YPI_LABEL_BLOCKED]: "YPI automation blocked",
  [YPI_LABEL_PR_OPEN]: "YPI automation opened a linked PR",
  [YPI_LABEL_DECISION_YES]: "Triage recommends adoption",
  [YPI_LABEL_DECISION_NO]: "Triage does not recommend adoption",
  [YPI_LABEL_DECISION_NEEDS_INFO]: "Triage needs more information",
  [YPI_LABEL_RISK_LOW]: "Low automation risk",
  [YPI_LABEL_RISK_MEDIUM]: "Medium automation risk",
  [YPI_LABEL_RISK_HIGH]: "High automation risk / fail-closed",
  [YPI_LABEL_TYPE_DOCS]: "Documentation change",
  [YPI_LABEL_TYPE_BUG]: "Bug fix",
  [YPI_LABEL_TYPE_FEATURE]: "Feature request",
  [YPI_LABEL_TYPE_OTHER]: "Other / unclassified",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

export function isApprovedYpiLabel(name: string): name is YpiApprovedLabel {
  return (YPI_APPROVED_LABEL_CATALOG as readonly string[]).includes(name);
}

export function isBotManagedLifecycleLabel(name: string): boolean {
  return (YPI_BOT_MANAGED_LIFECYCLE_LABELS as readonly string[]).includes(name);
}

export function extractLabelNames(labels: unknown): string[] {
  if (!Array.isArray(labels)) return [];
  const out: string[] = [];
  for (const item of labels) {
    if (typeof item === "string" && item.trim()) {
      out.push(item.trim());
      continue;
    }
    if (isRecord(item) && typeof item.name === "string" && item.name.trim()) {
      out.push(item.name.trim());
    }
  }
  return out;
}

export function issueHasLabel(labels: unknown, name: string): boolean {
  const target = name.toLowerCase();
  return extractLabelNames(labels).some((n) => n.toLowerCase() === target);
}

/**
 * Mutual-exclusion groups: when adding one, remove the other Bot-managed siblings.
 */
export function decisionLabelsToRemove(keep: YpiTriageDecisionLabel): string[] {
  return [YPI_LABEL_DECISION_YES, YPI_LABEL_DECISION_NO, YPI_LABEL_DECISION_NEEDS_INFO].filter(
    (n) => n !== keep,
  );
}

export function riskLabelsToRemove(keep: YpiTriageRiskLabel): string[] {
  return [YPI_LABEL_RISK_LOW, YPI_LABEL_RISK_MEDIUM, YPI_LABEL_RISK_HIGH].filter(
    (n) => n !== keep,
  );
}

export function typeLabelsToRemove(keep: YpiTriageTypeLabel): string[] {
  return [
    YPI_LABEL_TYPE_DOCS,
    YPI_LABEL_TYPE_BUG,
    YPI_LABEL_TYPE_FEATURE,
    YPI_LABEL_TYPE_OTHER,
  ].filter((n) => n !== keep);
}

// ─── Repo label ensure ───────────────────────────────────────────────────────

export async function ensureGithubRepoLabel(options: {
  installationId: number;
  owner: string;
  repo: string;
  name: string;
  signal?: AbortSignal;
}): Promise<void> {
  const { installationId, owner, repo, name, signal } = options;
  if (!isApprovedYpiLabel(name)) {
    throw new GithubAutomationError("invalid_config", "Label is not in the approved catalog", {
      status: 400,
      details: { label: name },
    });
  }

  const get = await githubAppInstallationRequest(
    installationId,
    `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/labels/${encodePathSegment(name)}`,
    { method: "GET", signal },
  );
  if (get.status === 200) return;

  if (get.status === 404) {
    const created = await githubAppInstallationRequest(
      installationId,
      `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/labels`,
      {
        method: "POST",
        signal,
        body: {
          name,
          color: LABEL_COLORS[name] ?? "ededed",
          description: LABEL_DESCRIPTIONS[name] ?? "YPI automation label",
        },
      },
    );
    // 422 often means race-created; treat as ok when label now exists.
    if (created.status === 201 || created.status === 200 || created.status === 422) {
      return;
    }
    if (created.status === 403 || created.status === 401) {
      throw new GithubAutomationError("permission_missing", undefined, {
        status: 403,
        details: { reason: "labels_write" },
      });
    }
    throw new GithubAutomationError("github_bad_response", undefined, {
      status: 502,
      details: { httpStatus: created.status, reason: "create_label" },
    });
  }

  if (get.status === 403 || get.status === 401) {
    throw new GithubAutomationError("permission_missing", undefined, {
      status: 403,
      details: { reason: "labels_read" },
    });
  }
  throw new GithubAutomationError("github_bad_response", undefined, {
    status: 502,
    details: { httpStatus: get.status, reason: "get_label" },
  });
}

// ─── Issue label mutations ───────────────────────────────────────────────────

export async function addGithubIssueLabels(options: {
  installationId: number;
  owner: string;
  repo: string;
  issueNumber: number;
  labels: string[];
  signal?: AbortSignal;
}): Promise<string[]> {
  const unique = [...new Set(options.labels.map((l) => l.trim()).filter(Boolean))];
  for (const name of unique) {
    if (!isApprovedYpiLabel(name)) {
      throw new GithubAutomationError("invalid_config", "Refusing non-catalog label add", {
        status: 400,
        details: { label: name },
      });
    }
    await ensureGithubRepoLabel({
      installationId: options.installationId,
      owner: options.owner,
      repo: options.repo,
      name,
      signal: options.signal,
    });
  }

  if (unique.length === 0) return extractLabelNames([]);

  const result = await githubAppInstallationRequest(
    options.installationId,
    `/repos/${encodePathSegment(options.owner)}/${encodePathSegment(options.repo)}/issues/${options.issueNumber}/labels`,
    {
      method: "POST",
      signal: options.signal,
      body: { labels: unique },
    },
  );

  if (result.status === 403 || result.status === 401) {
    throw new GithubAutomationError("permission_missing", undefined, {
      status: 403,
      details: { reason: "issue_labels_write" },
    });
  }
  if (result.status < 200 || result.status >= 300) {
    throw new GithubAutomationError("github_bad_response", undefined, {
      status: 502,
      details: { httpStatus: result.status, reason: "add_labels" },
    });
  }
  return extractLabelNames(result.body);
}

/**
 * Remove a Bot-managed label only. Never removes non-catalog / user labels.
 */
export async function removeGithubIssueBotLabel(options: {
  installationId: number;
  owner: string;
  repo: string;
  issueNumber: number;
  label: string;
  signal?: AbortSignal;
}): Promise<void> {
  if (!isBotManagedLifecycleLabel(options.label) && !isApprovedYpiLabel(options.label)) {
    throw new GithubAutomationError("invalid_config", "Refusing non-catalog label remove", {
      status: 400,
      details: { label: options.label },
    });
  }

  const result = await githubAppInstallationRequest(
    options.installationId,
    `/repos/${encodePathSegment(options.owner)}/${encodePathSegment(options.repo)}/issues/${options.issueNumber}/labels/${encodePathSegment(options.label)}`,
    { method: "DELETE", signal: options.signal },
  );

  // 404 = already absent — success for reconciliation.
  if (result.status === 404 || result.status === 200 || result.status === 204) {
    return;
  }
  if (result.status === 403 || result.status === 401) {
    throw new GithubAutomationError("permission_missing", undefined, {
      status: 403,
      details: { reason: "issue_labels_delete" },
    });
  }
  throw new GithubAutomationError("github_bad_response", undefined, {
    status: 502,
    details: { httpStatus: result.status, reason: "remove_label" },
  });
}

/**
 * Ensure claim-complete labels: has ypi:claimed, no ypi:claim-blocked.
 * Returns whether ypi:claimed is present after the call (caller must still re-fetch issue).
 */
export async function ensureClaimCompleteLabels(options: {
  installationId: number;
  owner: string;
  repo: string;
  issueNumber: number;
  currentLabels: unknown;
  signal?: AbortSignal;
}): Promise<{ claimedPresent: boolean; removedBlocked: boolean }> {
  let removedBlocked = false;
  if (issueHasLabel(options.currentLabels, YPI_LABEL_CLAIM_BLOCKED)) {
    await removeGithubIssueBotLabel({
      ...options,
      label: YPI_LABEL_CLAIM_BLOCKED,
    });
    removedBlocked = true;
  }

  if (!issueHasLabel(options.currentLabels, YPI_LABEL_CLAIMED)) {
    await addGithubIssueLabels({
      ...options,
      labels: [YPI_LABEL_CLAIMED],
    });
  }

  return { claimedPresent: true, removedBlocked };
}

/**
 * Incomplete claim reconciliation: withhold/remove Bot-managed ypi:claimed,
 * optionally ensure ypi:claim-blocked.
 */
export async function ensureClaimBlockedLabels(options: {
  installationId: number;
  owner: string;
  repo: string;
  issueNumber: number;
  currentLabels: unknown;
  signal?: AbortSignal;
}): Promise<{ claimedRemoved: boolean; blockedPresent: boolean }> {
  let claimedRemoved = false;
  if (issueHasLabel(options.currentLabels, YPI_LABEL_CLAIMED)) {
    await removeGithubIssueBotLabel({
      ...options,
      label: YPI_LABEL_CLAIMED,
    });
    claimedRemoved = true;
  }

  if (!issueHasLabel(options.currentLabels, YPI_LABEL_CLAIM_BLOCKED)) {
    await addGithubIssueLabels({
      ...options,
      labels: [YPI_LABEL_CLAIM_BLOCKED],
    });
  }

  return { claimedRemoved, blockedPresent: true };
}

/**
 * Apply triage classification labels without touching unrelated user labels.
 */
export async function ensureTriageClassificationLabels(options: {
  installationId: number;
  owner: string;
  repo: string;
  issueNumber: number;
  currentLabels: unknown;
  decision: YpiTriageDecisionLabel;
  risk: YpiTriageRiskLabel;
  type: YpiTriageTypeLabel;
  lifecycle?: Array<
    | typeof YPI_LABEL_TRIAGED
    | typeof YPI_LABEL_AWAITING_OWNER
    | typeof YPI_LABEL_BLOCKED
  >;
  signal?: AbortSignal;
}): Promise<void> {
  const current = extractLabelNames(options.currentLabels);
  const toRemove = [
    ...decisionLabelsToRemove(options.decision),
    ...riskLabelsToRemove(options.risk),
    ...typeLabelsToRemove(options.type),
  ].filter((name) => current.some((c) => c.toLowerCase() === name.toLowerCase()));

  for (const label of toRemove) {
    // Only remove approved catalog siblings.
    if (isApprovedYpiLabel(label)) {
      await removeGithubIssueBotLabel({
        installationId: options.installationId,
        owner: options.owner,
        repo: options.repo,
        issueNumber: options.issueNumber,
        label,
        signal: options.signal,
      });
    }
  }

  const toAdd = [
    options.decision,
    options.risk,
    options.type,
    ...(options.lifecycle ?? [YPI_LABEL_TRIAGED]),
  ].filter(
    (name) => !current.some((c) => c.toLowerCase() === name.toLowerCase()),
  );

  if (toAdd.length > 0) {
    await addGithubIssueLabels({
      installationId: options.installationId,
      owner: options.owner,
      repo: options.repo,
      issueNumber: options.issueNumber,
      labels: toAdd,
      signal: options.signal,
    });
  }
}
