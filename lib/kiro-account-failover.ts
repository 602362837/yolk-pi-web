/**
 * Kiro managed OAuth account failover controller.
 *
 * Path B: provider-scoped controller independent of ChatGPT / OpenCode / Grok.
 * Manual Activate only sets the global Active account; it is never a lock.
 * Eligible errors (explicit AWS quota reason codes or explicit quota/rate-limit
 * semantics) can rotate Active and retry the same turn once when
 * `kiro.autoFailover.enabled` is true.
 *
 * Not triggered: bare HTTP status, INSUFFICIENT_MODEL_CAPACITY, fuzzy help
 * text, auth/reauth, network, timeout, 5xx, context overflow, content filter,
 * model unavailable. Unknown/stale quota candidates fail closed.
 *
 * Concurrency (process-level, mirrors Grok semantics):
 * - globalThis.__piKiroFailover holds mutex + cooldown + lastSwitchAt
 * - trigger Active is snapshotted at run start
 * - after lock and before Activate, Active-changed => retry without cascade
 */

import {
  activateOAuthAccount,
  listOAuthAccounts,
  readOAuthActiveAccountId,
} from "./oauth-accounts";
import { KIRO_PROVIDER_ID } from "./oauth-account-providers";
import { getKiroAccountSubscriptionQuota, type KiroQuotaResultV1 } from "./kiro-subscription-quota";
import { readPiWebConfig, type PiWebKiroAutoFailoverConfig } from "./pi-web-config";

export type KiroAccountFailoverReason = "quota_exhausted" | "rate_limited";

export type KiroAccountFailoverStatus =
  | "disabled"
  | "not_kiro"
  | "not_eligible"
  | "retry_budget_exhausted"
  | "no_active_account"
  | "already_switched_by_other_session"
  | "no_usable_account"
  | "switched"
  | "failed";

export interface KiroAccountFailoverResult {
  status: KiroAccountFailoverStatus;
  reason?: KiroAccountFailoverReason;
  provider: string;
  /** Internal only — never projected to SSE/UI. */
  triggerAccountId?: string | null;
  /** Internal only — never projected to SSE/UI. */
  activeAccountId?: string | null;
  /** Internal only — never projected to SSE/UI. */
  switchedToAccountId?: string | null;
  retry: boolean;
  message?: string;
}

export interface KiroAccountFailoverTurnBudget {
  attempts: number;
  switches: number;
}

interface FailoverGlobalState {
  lock: Promise<void> | null;
  exhaustedUntil: Map<string, number>;
  lastSwitchAt: number;
}

const STATE_KEY = "__piKiroFailover" as const;

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
 * Includes Kiro `authFailure.reason` when present.
 */
function collectErrorText(message: unknown): {
  combined: string;
  lower: string;
  stopReason: string;
  authFailureReason: string;
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
  }

  // KiroAuthFailureMetadata-style nested object.
  let authFailureReason = "";
  const authFailure = record.authFailure
    ?? (typeof record.error === "object" && record.error !== null
      ? (record.error as Record<string, unknown>).authFailure
      : undefined);
  if (typeof authFailure === "object" && authFailure !== null) {
    const af = authFailure as Record<string, unknown>;
    authFailureReason = String(af.reason ?? "").trim();
    pushText(parts, af.reason);
    pushText(parts, af.message);
    pushText(parts, af.code);
    pushText(parts, af.type);
  } else if (typeof authFailure === "string") {
    authFailureReason = authFailure.trim();
    pushText(parts, authFailure);
  }

  const combined = parts.filter(Boolean).join("\n");
  return { combined, lower: combined.toLowerCase(), stopReason, authFailureReason };
}

/**
 * Classify a Kiro assistant error for automatic account failover.
 *
 * Hard negatives (auth/network/timeout/5xx/context/content/model/capacity and
 * bare status codes) are checked before any positive quota/rate-limit match.
 * Unknown fuzzy help text never triggers.
 */
export function detectKiroFailoverReason(message: unknown): KiroAccountFailoverReason | null {
  const { combined, lower, stopReason, authFailureReason } = collectErrorText(message);
  if (!combined.trim()) return null;
  if (stopReason && stopReason !== "error") return null;

  // Hard negatives first — never rotate on these.
  if (
    /\binsufficient[_ -]?model[_ -]?capacity\b/i.test(combined)
    || /\b(authentication|unauthorized|reauth|re-auth|reauthenticate|invalid.?token|expired.?token|invalid.?grant|login required|please (log|sign) ?in)\b/i.test(lower)
    || /\b(network|fetch failed|econnreset|enotfound|econnrefused|socket hang up)\b/i.test(lower)
    || /\b(timeout|timed out|deadline exceeded)\b/i.test(lower)
    || /\b(context (length |window )?(overflow|exceeded)|maximum context|token limit exceeded for context)\b/i.test(lower)
    || /\b(content filter|content.?policy|safety filter|moderation)\b/i.test(lower)
    || /\b(model (not found|unavailable|does not exist)|unknown model)\b/i.test(lower)
    || /(?:^|\s)(500|502|503|504)\b/.test(combined)
  ) {
    return null;
  }

  // Bare status without explicit Kiro limit semantics — do not trigger.
  if (/^(status=)?(429|400|401|403|404|500|502|503)$/i.test(combined.trim())) {
    return null;
  }

  // Structured AWS / Kiro quota reason codes (positive).
  if (
    /\bMONTHLY_REQUEST_COUNT\b/.test(combined)
    || /\bOVERAGE_REQUEST_LIMIT_EXCEEDED\b/.test(combined)
    || /\bCONVERSATION_LIMIT_EXCEEDED\b/.test(combined)
    || /\bDAILY_REQUEST_COUNT\b/.test(combined)
    || /\bServiceQuotaExceededError\b/i.test(combined)
  ) {
    return "quota_exhausted";
  }

  // authFailure.reason === "quota_or_entitlement" and not an auth subclass.
  if (authFailureReason === "quota_or_entitlement") {
    if (/\b(unauthorized|invalid.?token|expired.?token|invalid.?grant|reauth)\b/i.test(lower)) {
      return null;
    }
    return "quota_exhausted";
  }

  // Explicit rate-limit semantics (positive).
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

  // Explicit quota / usage exhaustion text.
  if (
    /\b(insufficient_quota|quota_exceeded|quota exceeded|quota exhausted)\b/i.test(lower)
    || /\b(usage[_ -]?limit|usage limit (reached|exceeded|exhausted))\b/i.test(lower)
    || /\b(monthly (usage )?limit (reached|exceeded|exhausted)|monthly quota)\b/i.test(lower)
    || /\b(daily (usage |request )?limit (reached|exceeded|exhausted)|daily quota)\b/i.test(lower)
    || /\b(credits? (exhausted|exceeded|depleted)|out of credits|no credits remaining)\b/i.test(lower)
    || /\b(exceeded your (current )?quota|you have exceeded your quota)\b/i.test(lower)
    || /\bcode["'=\s:]+(insufficient_quota|quota_exceeded|usage_limit)\b/i.test(combined)
    || /\btype["'=\s:]+(insufficient_quota|quota_exceeded|usage_limit)\b/i.test(combined)
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
 * primary bucket with remaining > 0. Unknown / stale fail closed.
 */
function isFreshUsableQuota(quota: KiroQuotaResultV1, config: PiWebKiroAutoFailoverConfig): boolean {
  if (!quota.success || quota.reauthRequired) return false;
  if (quota.cache.state === "none" || quota.cache.state === "stale") return false;
  if (quota.cache.state !== "fresh" && quota.cache.state !== "live") return false;

  const ageMs = quota.cache.ageMs;
  if (ageMs == null) return false;
  if (ageMs > config.quotaCacheMaxAgeMs) return false;

  const buckets = Array.isArray(quota.buckets) ? quota.buckets : [];
  if (buckets.length === 0) return false;

  const primary = quota.primaryBucketId
    ? buckets.find((bucket) => bucket.id === quota.primaryBucketId)
    : buckets[0];
  if (!primary) return false;
  if (!Number.isFinite(primary.remaining) || primary.remaining <= 0) return false;
  return true;
}

async function isUsableKiroAccount(
  accountId: string,
  config: PiWebKiroAutoFailoverConfig,
): Promise<boolean> {
  const cooldownUntil = state.exhaustedUntil.get(accountId) ?? 0;
  if (cooldownUntil > now()) return false;

  try {
    // Prefer cache first (no force) so we do not thrash GetUsageLimits.
    const cached = await getKiroAccountSubscriptionQuota(accountId, { forceRefresh: false });
    if (isFreshUsableQuota(cached, config)) return true;
    // Fresh/live but not usable (exhausted / reauth / no primary) — fail closed.
    if (cached.cache.state === "fresh" || cached.cache.state === "live") {
      return false;
    }
    // Missing/stale/error: one live probe. Stale-after-probe still fails closed.
    const live = await getKiroAccountSubscriptionQuota(accountId, { forceRefresh: true });
    return isFreshUsableQuota(live, config);
  } catch {
    return false;
  }
}

async function chooseNextUsableAccount(
  triggerAccountId: string,
  config: PiWebKiroAutoFailoverConfig,
): Promise<string | null> {
  const list = await listOAuthAccounts(KIRO_PROVIDER_ID);
  const activeIndex = list.accounts.findIndex((account) => account.accountId === triggerAccountId);
  const ordered = activeIndex >= 0
    ? [...list.accounts.slice(activeIndex + 1), ...list.accounts.slice(0, activeIndex)]
    : list.accounts.filter((account) => account.accountId !== triggerAccountId);

  for (const account of ordered) {
    if (account.accountId === triggerAccountId) continue;
    if (await isUsableKiroAccount(account.accountId, config)) return account.accountId;
  }
  return null;
}

export async function getActiveKiroFailoverAccountId(): Promise<string | null> {
  return readOAuthActiveAccountId(KIRO_PROVIDER_ID);
}

/**
 * Attempt Kiro global Active failover after Pi native retry/compaction and
 * other provider failover patches have declined to continue.
 */
export async function attemptKiroAccountFailover(options: {
  provider: string | undefined;
  message: unknown;
  budget: KiroAccountFailoverTurnBudget;
  reloadAuthState: () => void | number | Promise<void | number>;
  triggerAccountId?: string | null;
}): Promise<KiroAccountFailoverResult> {
  const provider = options.provider ?? "";
  if (provider !== KIRO_PROVIDER_ID) {
    return { status: "not_kiro", provider, retry: false };
  }

  const config = readPiWebConfig().kiro.autoFailover;
  if (!config.enabled) {
    return { status: "disabled", provider, retry: false };
  }

  const reason = detectKiroFailoverReason(options.message);
  if (!reason) {
    return { status: "not_eligible", provider, retry: false };
  }

  if (
    options.budget.attempts >= config.maxAttemptsPerTurn
    || options.budget.switches >= config.maxAccountSwitchesPerTurn
  ) {
    return {
      status: "retry_budget_exhausted",
      reason,
      provider,
      retry: false,
      message: "Kiro account failover budget exhausted for this turn.",
    };
  }

  const triggerAccountId = options.triggerAccountId ?? (await getActiveKiroFailoverAccountId());
  if (!triggerAccountId) {
    return {
      status: "no_active_account",
      reason,
      provider,
      retry: false,
      message: "No active Kiro account.",
    };
  }

  // Budget is committed only when this turn actually retries (switch or reuse).
  // Terminal outcomes (no usable account, failed, etc.) must not consume the
  // per-turn attempt/switch budget so a later user turn stays eligible.

  return withFailoverLock<KiroAccountFailoverResult>(async () => {
    state.exhaustedUntil.set(triggerAccountId, now() + config.exhaustedCooldownMs);

    const activeAfterLock = await readOAuthActiveAccountId(KIRO_PROVIDER_ID);
    if (activeAfterLock && activeAfterLock !== triggerAccountId) {
      options.budget.attempts += 1;
      return {
        status: "already_switched_by_other_session",
        reason,
        provider,
        triggerAccountId,
        activeAccountId: activeAfterLock,
        retry: true,
        message: "Another session already switched the active Kiro account.",
      };
    }

    const waitMs = Math.max(0, config.minSwitchIntervalMs - (now() - state.lastSwitchAt));
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));

    const nextAccountId = await chooseNextUsableAccount(triggerAccountId, config);
    if (!nextAccountId) {
      return {
        status: "no_usable_account",
        reason,
        provider,
        triggerAccountId,
        activeAccountId: triggerAccountId,
        retry: false,
        message: "No usable Kiro account is available after a limit error.",
      };
    }

    const activeBeforeActivate = await readOAuthActiveAccountId(KIRO_PROVIDER_ID);
    if (activeBeforeActivate && activeBeforeActivate !== triggerAccountId) {
      options.budget.attempts += 1;
      return {
        status: "already_switched_by_other_session",
        reason,
        provider,
        triggerAccountId,
        activeAccountId: activeBeforeActivate,
        retry: true,
        message: "Another session already switched the active Kiro account.",
      };
    }

    await activateOAuthAccount(KIRO_PROVIDER_ID, nextAccountId);
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
      retry: true,
      message: reason === "rate_limited"
        ? "Kiro rate limit hit; switched active account and retrying."
        : "Kiro quota limit hit; switched active account and retrying.",
    };
  }).catch((): KiroAccountFailoverResult => ({
    status: "failed",
    reason: detectKiroFailoverReason(options.message) ?? undefined,
    provider,
    retry: false,
    // Display-safe only: never include stack / paths / raw upstream bodies.
    message: "Kiro account failover failed.",
  }));
}

/** Test helper — clear process state between isolated runs. */
export function __resetKiroFailoverStateForTests(): void {
  state.lock = null;
  state.exhaustedUntil.clear();
  state.lastSwitchAt = 0;
}
