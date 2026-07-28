/**
 * github-automation-notification — server-owned terminal-disposition outbox drain.
 *
 * Only normalized terminal data selects labels or comment copy. Issue text, child
 * output and remote error text never become policy input or durable state.
 */

import {
  buildGithubAutomationCommentMarker,
  buildImplementerDispositionStatusCommentBody,
  upsertGithubAutomationComment,
} from "./github-automation-comments";
import {
  addGithubIssueLabels,
  issueHasLabel,
  listGithubIssueLabelNames,
  YPI_LABEL_BLOCKED,
  YPI_LABEL_DECISION_NEEDS_INFO,
  YPI_LABEL_RISK_HIGH,
  type YpiApprovedLabel,
} from "./github-automation-labels";
import type {
  GithubAutomationNotificationOperationStatus,
  GithubAutomationTerminalDisposition,
} from "./github-automation-types";

export interface GithubAutomationNotificationTarget {
  installationId: number;
  repositoryId: number;
  owner: string;
  repo: string;
  issueNumber: number;
}

export interface GithubAutomationNotificationDrainResult {
  labels: GithubAutomationNotificationOperationStatus;
  comment: GithubAutomationNotificationOperationStatus;
  lastFailureOperation?: "labels" | "comment" | "reconcile";
}

/** Approved exceptional-disposition label mapping; cancelled/paused preserve labels. */
export function labelsForGithubTerminalDisposition(
  disposition: Pick<GithubAutomationTerminalDisposition, "kind" | "reasonCode">,
): readonly YpiApprovedLabel[] {
  if (disposition.kind === "needs_user_decision") {
    return [YPI_LABEL_BLOCKED, YPI_LABEL_DECISION_NEEDS_INFO, YPI_LABEL_RISK_HIGH];
  }
  if (disposition.kind === "policy_blocked") {
    return [YPI_LABEL_BLOCKED, YPI_LABEL_RISK_HIGH];
  }
  if (
    disposition.kind === "provider_transport_failure" ||
    disposition.kind === "check_failure" ||
    disposition.kind === "runtime_failed"
  ) {
    return [YPI_LABEL_BLOCKED];
  }
  return [];
}

function labelsPresent(labels: unknown, expected: readonly string[]): boolean {
  return expected.every((label) => issueHasLabel(labels, label));
}

/**
 * Apply a label set once, then reconcile a potentially unknown write by GET.
 * Never blindly retries POST, which could conceal an ambiguous remote result.
 */
async function ensureDispositionLabels(
  target: GithubAutomationNotificationTarget,
  labels: readonly YpiApprovedLabel[],
  signal?: AbortSignal,
): Promise<GithubAutomationNotificationOperationStatus> {
  if (labels.length === 0) return "confirmed";
  try {
    const returned = await addGithubIssueLabels({ ...target, labels: [...labels], signal });
    if (labelsPresent(returned, labels)) return "confirmed";
  } catch {
    // Reconcile below. The durable caller records only operation, never error text.
  }

  try {
    const current = await listGithubIssueLabelNames({ ...target, signal });
    return labelsPresent(current, labels) ? "confirmed" : "failed";
  } catch {
    return "failed";
  }
}

/**
 * Drain notification side effects for one already-persisted exceptional terminal
 * disposition. It never invokes members, checker, validation, or publisher.
 */
export async function drainGithubTerminalDispositionNotification(input: {
  target: GithubAutomationNotificationTarget;
  disposition: GithubAutomationTerminalDisposition;
  signal?: AbortSignal;
}): Promise<GithubAutomationNotificationDrainResult> {
  const { disposition, target, signal } = input;
  if (disposition.kind === "succeeded" || disposition.reasonCode === null) {
    return { labels: "confirmed", comment: "confirmed" };
  }

  const labels = await ensureDispositionLabels(
    target,
    labelsForGithubTerminalDisposition(disposition),
    signal,
  );

  const marker = buildGithubAutomationCommentMarker({
    kind: "automation_status",
    repositoryId: target.repositoryId,
    issueNumber: target.issueNumber,
  });
  let comment: GithubAutomationNotificationOperationStatus = "confirmed";
  try {
    await upsertGithubAutomationComment({
      ...target,
      kind: "automation_status",
      body: buildImplementerDispositionStatusCommentBody({
        marker,
        kind: disposition.kind,
        reasonCode: disposition.reasonCode,
        blockedAtLayer:
          disposition.blockedAtLayer === "operator_notification"
            ? "operator_notification"
            : "agent",
        retryability: disposition.retryability,
      }),
      signal,
    });
  } catch {
    comment = "failed";
  }

  if (labels === "confirmed" && comment === "confirmed") {
    return { labels, comment };
  }
  return {
    labels,
    comment,
    lastFailureOperation:
      labels === "failed" && comment === "failed"
        ? "reconcile"
        : labels === "failed"
          ? "labels"
          : "comment",
  };
}
