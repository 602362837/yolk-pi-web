/**
 * github-full-agent-profile — P1 full-agent capability + residual-risk contract (GHA-06).
 *
 * Product decision (approved):
 * - P1 uses the **standard full agent** path with normal file / bash / network tools.
 * - Restricted tools are **not** a launch hard gate.
 * - Owner-only trigger, WorkTree, and final diff gate are business/publish guards —
 *   they are **not** a host sandbox.
 *
 * Residual risk (must remain explicit in docs/tests/UI):
 * - Agent may execute arbitrary commands and network requests within the OS user.
 * - Agent may read same-OS-user files outside the WorkTree (including credentials).
 * - Agent may produce non-Git side effects before any final diff gate.
 * - Final diff gate only limits what may be published; it cannot undo side effects.
 *
 * Credential isolation still enforced by product code:
 * - Do not deliberately inject App private key / JWT / installation token,
 *   webhook secret, or machine personal credential into agent prompt / task /
 *   session / child env / publisher fields.
 * - Server-owned publisher remains out of agent capability (GHA-07).
 */

import {
  ENV_GITHUB_APP_ID,
  ENV_GITHUB_APP_PRIVATE_KEY_FILE,
  ENV_GITHUB_APP_SLUG,
  ENV_GITHUB_APP_WEBHOOK_SECRET,
} from "./github-app-credentials";
import type {
  GithubAutomationExecutionProfile,
  GithubAutomationRiskProfile,
} from "./github-automation-types";

/** Stable execution profile id for unattended automation. */
export const GITHUB_FULL_AGENT_EXECUTION_PROFILE: GithubAutomationExecutionProfile =
  "full-agent";

/** Stable risk profile id for the first unattended scope. */
export const GITHUB_FULL_AGENT_RISK_PROFILE: GithubAutomationRiskProfile =
  "docs-and-small-bugfix";

/** Policy id used when recording internal policyGrant evidence. */
export const GITHUB_UNATTENDED_POLICY_ID = "docs-and-small-bugfix";

/** Policy version bound into policyGrant (bump when gate semantics change). */
export const GITHUB_UNATTENDED_POLICY_VERSION = "1";

/**
 * Explicit residual-risk codes. Settings / docs / tests must surface these —
 * none of them are dismissed by WorkTree or final diff gates.
 */
export const GITHUB_FULL_AGENT_RESIDUAL_RISK_CODES = [
  "arbitrary_commands",
  "network_access",
  "same_os_user_filesystem_read",
  "non_git_side_effects_before_diff_gate",
  "prompt_injection_via_issue_or_repo_content",
] as const;

export type GithubFullAgentResidualRiskCode =
  (typeof GITHUB_FULL_AGENT_RESIDUAL_RISK_CODES)[number];

export interface GithubFullAgentProfile {
  executionProfile: GithubAutomationExecutionProfile;
  riskProfile: GithubAutomationRiskProfile;
  /** Always false for this product decision — do not treat as sandbox. */
  sandboxed: false;
  /** Restricted tools are never required to start. */
  restrictedToolsRequired: false;
  residualRiskCodes: readonly GithubFullAgentResidualRiskCode[];
  residualRiskSummary: string;
  recommendedDeployment: string;
}

export const GITHUB_FULL_AGENT_PROFILE: GithubFullAgentProfile = {
  executionProfile: GITHUB_FULL_AGENT_EXECUTION_PROFILE,
  riskProfile: GITHUB_FULL_AGENT_RISK_PROFILE,
  sandboxed: false,
  restrictedToolsRequired: false,
  residualRiskCodes: GITHUB_FULL_AGENT_RESIDUAL_RISK_CODES,
  residualRiskSummary:
    "Full agent is not sandboxed: it may run arbitrary commands, use the network, read same-OS-user files outside the WorkTree, and produce non-Git side effects before any final diff gate. Owner-only, WorkTree, and diff gates are not host isolation.",
  recommendedDeployment:
    "Run production automation under a dedicated low-privilege OS account or container with minimal host credentials and network policy. This recommendation is not a sandbox guarantee.",
};

/**
 * Env var names that automation owns and must never be deliberately present
 * in child agent process env. Defensive allowlist for scrubbing only —
 * absence here does not prove the agent cannot read host files.
 */
export const GITHUB_AUTOMATION_OWNED_SECRET_ENV_KEYS = [
  ENV_GITHUB_APP_ID,
  ENV_GITHUB_APP_PRIVATE_KEY_FILE,
  ENV_GITHUB_APP_WEBHOOK_SECRET,
  ENV_GITHUB_APP_SLUG,
  // Common personal / machine credential channels that must not be injected.
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GH_ENTERPRISE_TOKEN",
  "GITHUB_APP_JWT",
  "GITHUB_APP_INSTALLATION_TOKEN",
  "YPI_GITHUB_INSTALLATION_TOKEN",
  "YPI_GITHUB_APP_JWT",
  "YPI_GITHUB_MACHINE_TOKEN",
] as const;

export type GithubAutomationOwnedSecretEnvKey =
  (typeof GITHUB_AUTOMATION_OWNED_SECRET_ENV_KEYS)[number];

/**
 * Return a shallow-copied env object with automation-owned secret keys removed.
 * Does not claim the resulting process cannot read secrets from disk.
 */
export function scrubGithubAutomationOwnedSecretsFromEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  const next: Record<string, string | undefined> = { ...env };
  for (const key of GITHUB_AUTOMATION_OWNED_SECRET_ENV_KEYS) {
    delete next[key];
  }
  // Defense-in-depth: drop any env whose name looks like App/installation material.
  for (const key of Object.keys(next)) {
    const upper = key.toUpperCase();
    if (
      upper.includes("GITHUB_APP") ||
      upper.includes("INSTALLATION_TOKEN") ||
      upper.includes("WEBHOOK_SECRET") ||
      upper.endsWith("_PRIVATE_KEY") ||
      upper.endsWith("_PRIVATE_KEY_FILE")
    ) {
      delete next[key];
    }
  }
  return next;
}

/**
 * True when a candidate string looks like it would deliberately inject
 * automation-owned secret material into agent context (prompt/task/session/env).
 * Used by tests and preflight sentinels — not a sandbox guarantee.
 */
export function containsGithubAutomationSecretInjectionMarker(
  value: unknown,
): boolean {
  if (value === null || value === undefined) return false;
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  if (!text) return false;
  return (
    /YPI_GITHUB_APP_(?:ID|PRIVATE_KEY|WEBHOOK_SECRET)/i.test(text) ||
    /-----BEGIN[ A-Z0-9]*PRIVATE KEY-----/i.test(text) ||
    /\bghs_[A-Za-z0-9_]{10,}/.test(text) ||
    /\bgho_[A-Za-z0-9_]{10,}/.test(text) ||
    /\bghu_[A-Za-z0-9_]{10,}/.test(text) ||
    /\bgithub_pat_[A-Za-z0-9_]{10,}/.test(text) ||
    /x-hub-signature-256/i.test(text) ||
    /installation[_\s-]?token/i.test(text)
  );
}

/** Safe projection for Settings / tests (no secrets, no absolute paths). */
export function toGithubFullAgentProfileSafeProjection(): {
  executionProfile: GithubAutomationExecutionProfile;
  riskProfile: GithubAutomationRiskProfile;
  sandboxed: false;
  restrictedToolsRequired: false;
  residualRiskCodes: readonly GithubFullAgentResidualRiskCode[];
  residualRiskSummary: string;
  recommendedDeployment: string;
} {
  return {
    executionProfile: GITHUB_FULL_AGENT_PROFILE.executionProfile,
    riskProfile: GITHUB_FULL_AGENT_PROFILE.riskProfile,
    sandboxed: false,
    restrictedToolsRequired: false,
    residualRiskCodes: GITHUB_FULL_AGENT_PROFILE.residualRiskCodes,
    residualRiskSummary: GITHUB_FULL_AGENT_PROFILE.residualRiskSummary,
    recommendedDeployment: GITHUB_FULL_AGENT_PROFILE.recommendedDeployment,
  };
}
