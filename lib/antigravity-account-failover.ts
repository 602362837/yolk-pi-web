/**
 * Antigravity managed OAuth account failover controller.
 *
 * Path B: provider-scoped controller independent of ChatGPT / OpenCode / Grok / Kiro.
 * Manual Activate only sets the global Active account; it is never a lock.
 * Eligible errors (explicit RESOURCE_EXHAUSTED / quota exhaustion / reset or
 * explicit rate-limit / too-many-requests) can rotate Active and retry the same
 * turn once when `antigravity.autoFailover.enabled` is true.
 *
 * Model-aware: candidates require a fresh/live quota entry matching the
 * *current public model* with remainingFraction > 0. Quota for other models
 * never proves the current model is usable. Unknown/stale/reauth/unmapped
 * models fail closed.
 *
 * Not triggered: bare HTTP status (including bare 429 / "Cloud Code Assist API
 * error (429)"), auth/reauth/project, network, timeout, abort, 5xx/529,
 * capacity/overloaded, context overflow, content/safety, model unavailable,
 * fuzzy help text.
 *
 * Concurrency (process-level, mirrors Kiro semantics):
 * - globalThis.__piAntigravityFailover holds mutex + cooldown + lastSwitchAt
 * - trigger Active + public model id are snapshotted at run start
 * - after lock and before Activate, Active-changed => retry only when the new
 *   Active still has fresh matching-model quota; otherwise terminal
 */

import {
  activateOAuthAccount,
  listOAuthAccounts,
  readOAuthAccountCredential,
} from "./oauth-accounts";
import { ANTIGRAVITY_PROVIDER_ID } from "./oauth-account-providers";
import {
  findAntigravityQuotaWindowForPublicModel,
  isAntigravityPublicModelFailoverSupported,
} from "./antigravity-model-quota";
import {
  getAntigravityAccountSubscriptionQuota,
  type AntigravityQuotaResultV1,
} from "./antigravity-subscription-quota";
import { readPiWebConfig, type PiWebAntigravityAutoFailoverConfig } from "./pi-web-config";

export type AntigravityAccountFailoverReason = "quota_exhausted" | "rate_limited";

export type AntigravityAccountFailoverStatus =
  | "disabled"
  | "not_antigravity"
  | "not_eligible"
  | "model_unsupported"
  | "retry_budget_exhausted"
  | "no_active_account"
  | "already_switched_by_other_session"
  | "no_usable_account"
  | "switched"
  | "failed";

export interface AntigravityAccountFailoverResult {
  status: AntigravityAccountFailoverStatus;
  reason?: AntigravityAccountFailoverReason;
  provider: string;
  /** Internal only — never projected to SSE/UI. */
  triggerAccountId?: string | null;
  /** Internal only — never projected to SSE/UI. */
  activeAccountId?: string | null;
  /** Internal only — never projected to SSE/UI. */
  switchedToAccountId?: string | null;
  /** Internal only — never projected to SSE/UI. */
  publicModelId?: string | null;
  retry: boolean;
  message?: string;
}

export interface AntigravityAccountFailoverTurnBudget {
  attempts: number;
  switches: number;
}

interface FailoverGlobalState {
  lock: Promise<void> | null;
  exhaustedUntil: Map<string, number>;
  lastSwitchAt: number;
}

const STATE_KEY = "__piAntigravityFailover" as const;

const state = (
  globalThis as typeof globalThis & { [STATE_KEY]?: FailoverGlobalState }
)[STATE_KEY] ??= {
  lock: null,
  exhaustedUntil: new Map<string, number>(),
  lastSwitchAt: 0,
};

function now(): number {
  return Date.now();
}

function errorText(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function pushText(parts: string[], value: unknown): void {
  const text = errorText(value);
  if (text) parts.push(text);
}

/**
 * Collect classifier text from assistant message / nested error shapes.
 */
function collectErrorText(message: unknown): {
  combined: string;
  lower: string;
  stopReason: string;
} {
  const record = typeof message === "object" && message !== null ? message as Record<string, unknown> : {};
  const stopReason = String(record.stopReason ?? "");
  const parts: string[] = [];

  pushText(parts, record.errorMessage);
  pushText(parts, record.message);
  pushText(parts, record.error);
  pushText(parts, record.statusText);
  pushText(parts, record.code);
  pushText(parts, record.type);
  pushText(parts, record.errorCode);
  pushText(parts, record.error_type);
  pushText(parts, record.reason);
  if (typeof record.status === "number") parts.push(`status=${record.status}`);

  if (typeof record.error === "object" && record.error !== null) {
    const nested = record.error as Record<string, unknown>;
    pushText(parts, nested.message);
    pushText(parts, nested.code);
    pushText(parts, nested.type);
    pushText(parts, nested.error);
    pushText(parts, nested.reason);
    pushText(parts, nested.errorCode);
    pushText(parts, nested.statusText);
    if (typeof nested.status === "number") parts.push(`status=${nested.status}`);
  }

  const combined = parts.filter(Boolean).join("\n");
  return { combined, lower: combined.toLowerCase(), stopReason };
}

/**
 * Classify an Antigravity assistant error for automatic account failover.
 *
 * Hard negatives (auth/project/network/timeout/abort/5xx/capacity/context/
 * content/model and bare 429 / Cloud Code Assist API error (429)) are checked
 * before any positive quota/rate-limit match. Unknown fuzzy help text never
 * triggers.
 */
export function detectAntigravityFailoverReason(message: unknown): AntigravityAccountFailoverReason | null {
  const { combined, lower, stopReason } = collectErrorText(message);
  if (!combined.trim()) return null;
  if (stopReason && stopReason !== "error") return null;

  // Hard negatives first — never rotate on these.
  if (
    // Auth / token / reauth
    /\b(authentication|unauthorized|reauth|re-auth|reauthenticate|invalid.?token|expired.?token|invalid.?grant|login required|please (log|sign) ?in)\b/i.test(lower)
    // Project / access (403-class project issues are not quota)
    || /\b(project (id )?(missing|invalid|not found|required)|invalid[_ -]?project|access[_ -]?denied|permission denied|forbidden)\b/i.test(lower)
    // Network / transport
    || /\b(network|fetch failed|econnreset|enotfound|econnrefused|socket hang up)\b/i.test(lower)
    // Timeout / abort
    || /\b(timeout|timed out|deadline exceeded|aborted|abort(?:ed)?(?:error)?)\b/i.test(lower)
    // Context / content / safety
    || /\b(context (length |window )?(overflow|exceeded)|maximum context|token limit exceeded for context)\b/i.test(lower)
    || /\b(content filter|content.?policy|safety filter|moderation)\b/i.test(lower)
    // Model availability
    || /\b(model (not found|unavailable|does not exist)|unknown model)\b/i.test(lower)
    // Capacity / overloaded (not quota)
    || /\b(insufficient[_ -]?model[_ -]?capacity|overloaded|model capacity|capacity exceeded)\b/i.test(lower)
    // 5xx / 529
    || /(?:^|\s)(500|502|503|504|529)\b/.test(combined)
  ) {
    return null;
  }

  // Bare status without explicit Antigravity limit semantics — do not trigger.
  // Includes bare 429 and Cloud Code Assist API error (429) without quota text.
  if (/^(status=)?(429|400|401|403|404|500|502|503|504|529)$/i.test(combined.trim())) {
    return null;
  }
  // "Cloud Code Assist API error (429)" alone is a hard negative.
  if (
    /\bcloud code assist api error\s*\(\s*429\s*\)\b/i.test(lower)
    && !/\b(resource_exhausted|quota_exhausted|quota exceeded|quota exhausted|quotareset|rate_limit|too many requests|rate limit)\b/i.test(lower)
  ) {
    return null;
  }

  // Explicit structured quota exhaustion (positive).
  if (
    /\bRESOURCE_EXHAUSTED\b/.test(combined)
    || /\bquota_exhausted\b/i.test(combined)
    || /\bquota[_ -]?exceeded\b/i.test(lower)
    || /\bquota[_ -]?exhausted\b/i.test(lower)
    || /\bquotaResetDelay\b/i.test(combined)
    || /\bquotaResetTimeStamp\b/i.test(combined)
    || /\bquotaResetTime\b/i.test(combined)
  ) {
    return "quota_exhausted";
  }

  // Explicit rate-limit semantics (positive). Bare 429 already rejected above.
  if (
    /\b(rate_limit_exceeded|rate-limit-exceeded|ratelimitexceeded)\b/i.test(combined)
    || /\btoo[_ -]?many[_ -]?requests\b/i.test(lower)
    || /\brate[_ -]?limit(?:ed|ing)?\b/i.test(lower)
    || /\bcode["'=\s:]+rate[_-]?limit/i.test(combined)
    || /\btype["'=\s:]+rate[_-]?limit/i.test(combined)
  ) {
    // Reject fuzzy help / documentation-like phrases that merely mention rate.
    if (/\b(how to|learn more|documentation|for more information about rate|rate of change)\b/i.test(lower)) {
      return null;
    }
    return "rate_limited";
  }

  // Explicit quota / usage exhaustion text (secondary allowlist).
  if (
    /\b(insufficient_quota|quota_exceeded|quota exceeded|quota exhausted)\b/i.test(lower)
    || /\b(usage[_ -]?limit|usage limit (reached|exceeded|exhausted))\b/i.test(lower)
    || /\b(exceeded your (current )?quota|you have exceeded your quota)\b/i.test(lower)
    || /\bcode["'=\s:]+(insufficient_quota|quota_exceeded|usage_limit|resource_exhausted|quota_exhausted)\b/i.test(combined)
    || /\btype["'=\s:]+(insufficient_quota|quota_exceeded|usage_limit|resource_exhausted|quota_exhausted)\b/i.test(combined)
  ) {
    return "quota_exhausted";
  }

  return null;
}

async function withFailoverLock<T>(fn: () => Promise<T>): Promise<T> {
  while (state.lock) await state.lock.catch(() => {});
  let release!: () => void;
  state.lock = new Promise<void>((resolve) => { release = resolve; });
  try {
    return await fn();
  } finally {
    release();
    state.lock = null;
  }
}

/**
 * Candidate quota must be fresh/live, successful, non-reauth, and have a
 * matching entry for the *current public model* with remainingFraction > 0.
 * Unknown / stale / other-model-only fail closed.
 */
function isFreshMatchingModelQuota(
  quota: AntigravityQuotaResultV1,
  publicModelId: string,
  config: PiWebAntigravityAutoFailoverConfig,
): boolean {
  if (!quota.success || quota.reauthRequired) return false;
  if (quota.cache.state === "none" || quota.cache.state === "stale") return false;
  if (quota.cache.state !== "fresh" && quota.cache.state !== "live") return false;

  const ageMs = quota.cache.ageMs;
  if (ageMs == null) return false;
  if (ageMs > config.quotaCacheMaxAgeMs) return false;

  const models = Array.isArray(quota.models) ? quota.models : [];
  if (models.length === 0) return false;

  const window = findAntigravityQuotaWindowForPublicModel(publicModelId, models);
  if (!window) return false;
  if (!Number.isFinite(window.remainingFraction) || window.remainingFraction <= 0) return false;
  return true;
}

async function hasReadableCredential(accountId: string): Promise<boolean> {
  try {
    await readOAuthAccountCredential(ANTIGRAVITY_PROVIDER_ID, accountId);
    return true;
  } catch {
    return false;
  }
}

async function isUsableAntigravityAccount(
  accountId: string,
  publicModelId: string,
  config: PiWebAntigravityAutoFailoverConfig,
): Promise<boolean> {
  const cooldownUntil = state.exhaustedUntil.get(accountId) ?? 0;
  if (cooldownUntil > now()) return false;

  if (!(await hasReadableCredential(accountId))) return false;

  try {
    // Prefer cache first (no force) so we do not thrash fetchAvailableModels.
    const cached = await getAntigravityAccountSubscriptionQuota(accountId, { forceRefresh: false });
    if (isFreshMatchingModelQuota(cached, publicModelId, config)) return true;
    // Fresh/live but not usable for this model (exhausted / reauth / other model only).
    if (cached.cache.state === "fresh" || cached.cache.state === "live") {
      return false;
    }
    // Missing/stale/error: one live probe. Stale-after-probe still fails closed.
    const live = await getAntigravityAccountSubscriptionQuota(accountId, { forceRefresh: true });
    return isFreshMatchingModelQuota(live, publicModelId, config);
  } catch {
    return false;
  }
}

async function chooseNextUsableAccount(
  triggerAccountId: string,
  publicModelId: string,
  config: PiWebAntigravityAutoFailoverConfig,
): Promise<string | null> {
  const list = await listOAuthAccounts(ANTIGRAVITY_PROVIDER_ID);
  const activeIndex = list.accounts.findIndex((account) => account.accountId === triggerAccountId);
  const ordered = activeIndex >= 0
    ? [...list.accounts.slice(activeIndex + 1), ...list.accounts.slice(0, activeIndex)]
    : list.accounts.filter((account) => account.accountId !== triggerAccountId);

  for (const account of ordered) {
    if (account.accountId === triggerAccountId) continue;
    if (await isUsableAntigravityAccount(account.accountId, publicModelId, config)) {
      return account.accountId;
    }
  }
  return null;
}

export async function getActiveAntigravityFailoverAccountId(): Promise<string | null> {
  return (await listOAuthAccounts(ANTIGRAVITY_PROVIDER_ID)).activeAccountId;
}

/**
 * Attempt Antigravity global Active failover after Pi native retry/compaction
 * and other provider failover patches have declined to continue.
 */
export async function attemptAntigravityAccountFailover(options: {
  provider: string | undefined;
  message: unknown;
  budget: AntigravityAccountFailoverTurnBudget;
  reloadAuthState: () => void | number | Promise<void | number>;
  triggerAccountId?: string | null;
  /** Public catalog model id for the failing request (model-aware gate). */
  publicModelId?: string | null;
}): Promise<AntigravityAccountFailoverResult> {
  const provider = options.provider ?? "";
  if (provider !== ANTIGRAVITY_PROVIDER_ID) {
    return { status: "not_antigravity", provider, retry: false };
  }

  const config = readPiWebConfig().antigravity.autoFailover;
  if (!config.enabled) {
    return { status: "disabled", provider, retry: false };
  }

  const reason = detectAntigravityFailoverReason(options.message);
  if (!reason) {
    return { status: "not_eligible", provider, retry: false };
  }

  const publicModelId = typeof options.publicModelId === "string" ? options.publicModelId.trim() : "";
  if (!publicModelId || !isAntigravityPublicModelFailoverSupported(publicModelId)) {
    return {
      status: "model_unsupported",
      reason,
      provider,
      publicModelId: publicModelId || null,
      retry: false,
      message: "Antigravity model is not mapped for automatic account failover.",
    };
  }

  if (
    options.budget.attempts >= config.maxAttemptsPerTurn
    || options.budget.switches >= config.maxAccountSwitchesPerTurn
  ) {
    return {
      status: "retry_budget_exhausted",
      reason,
      provider,
      publicModelId,
      retry: false,
      message: "Antigravity account failover budget exhausted for this turn.",
    };
  }

  const triggerAccountId = options.triggerAccountId ?? (await getActiveAntigravityFailoverAccountId());
  if (!triggerAccountId) {
    return {
      status: "no_active_account",
      reason,
      provider,
      publicModelId,
      retry: false,
      message: "No active Antigravity account.",
    };
  }

  // Budget is committed only when this turn actually retries (switch or reuse).
  // Terminal outcomes (no usable account, failed, etc.) must not consume the
  // per-turn attempt/switch budget so a later user turn stays eligible.

  return withFailoverLock<AntigravityAccountFailoverResult>(async () => {
    state.exhaustedUntil.set(triggerAccountId, now() + config.exhaustedCooldownMs);

    const activeAfterLock = (await listOAuthAccounts(ANTIGRAVITY_PROVIDER_ID)).activeAccountId;
    if (activeAfterLock && activeAfterLock !== triggerAccountId) {
      // Reuse only when the new Active still has fresh matching-model quota.
      const reusable = await isUsableAntigravityAccount(activeAfterLock, publicModelId, config);
      if (!reusable) {
        return {
          status: "no_usable_account",
          reason,
          provider,
          triggerAccountId,
          activeAccountId: activeAfterLock,
          publicModelId,
          retry: false,
          message: "Another session switched Antigravity Active, but the new account has no usable quota for the current model.",
        };
      }
      options.budget.attempts += 1;
      return {
        status: "already_switched_by_other_session",
        reason,
        provider,
        triggerAccountId,
        activeAccountId: activeAfterLock,
        publicModelId,
        retry: true,
        message: "Another session already switched the active Antigravity account.",
      };
    }

    const waitMs = Math.max(0, config.minSwitchIntervalMs - (now() - state.lastSwitchAt));
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));

    const nextAccountId = await chooseNextUsableAccount(triggerAccountId, publicModelId, config);
    if (!nextAccountId) {
      return {
        status: "no_usable_account",
        reason,
        provider,
        triggerAccountId,
        activeAccountId: triggerAccountId,
        publicModelId,
        retry: false,
        message: "No usable Antigravity account is available after a limit error.",
      };
    }

    const activeBeforeActivate = (await listOAuthAccounts(ANTIGRAVITY_PROVIDER_ID)).activeAccountId;
    if (activeBeforeActivate && activeBeforeActivate !== triggerAccountId) {
      const reusable = await isUsableAntigravityAccount(activeBeforeActivate, publicModelId, config);
      if (!reusable) {
        return {
          status: "no_usable_account",
          reason,
          provider,
          triggerAccountId,
          activeAccountId: activeBeforeActivate,
          publicModelId,
          retry: false,
          message: "Another session switched Antigravity Active, but the new account has no usable quota for the current model.",
        };
      }
      options.budget.attempts += 1;
      return {
        status: "already_switched_by_other_session",
        reason,
        provider,
        triggerAccountId,
        activeAccountId: activeBeforeActivate,
        publicModelId,
        retry: true,
        message: "Another session already switched the active Antigravity account.",
      };
    }

    // Final candidate revalidation (TOCTOU) immediately before Activate.
    if (!(await isUsableAntigravityAccount(nextAccountId, publicModelId, config))) {
      return {
        status: "no_usable_account",
        reason,
        provider,
        triggerAccountId,
        activeAccountId: triggerAccountId,
        publicModelId,
        retry: false,
        message: "No usable Antigravity account is available after a limit error.",
      };
    }

    await activateOAuthAccount(ANTIGRAVITY_PROVIDER_ID, nextAccountId);
    state.lastSwitchAt = now();
    await options.reloadAuthState();
    options.budget.attempts += 1;
    options.budget.switches += 1;
    return {
      status: "switched",
      reason,
      provider,
      triggerAccountId,
      activeAccountId: triggerAccountId,
      switchedToAccountId: nextAccountId,
      publicModelId,
      retry: true,
      message: reason === "rate_limited"
        ? "Antigravity rate limit hit; switched active account and retrying."
        : "Antigravity quota limit hit; switched active account and retrying.",
    };
  }).catch((): AntigravityAccountFailoverResult => ({
    status: "failed",
    reason: detectAntigravityFailoverReason(options.message) ?? undefined,
    provider,
    publicModelId: publicModelId || null,
    retry: false,
    // Display-safe only: never include stack / paths / raw upstream bodies.
    message: "Antigravity account failover failed.",
  }));
}

/** Test helper — clear process state between isolated runs. */
export function __resetAntigravityFailoverStateForTests(): void {
  state.lock = null;
  state.exhaustedUntil.clear();
  state.lastSwitchAt = 0;
}
