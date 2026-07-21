/**
 * Grok CLI managed OAuth account failover controller.
 *
 * Path B: provider-scoped controller independent of ChatGPT/Codex failover.
 * Manual Activate only sets the global Active account; it is never a lock.
 * Eligible errors (explicit quota/usage/credits/monthly/weekly exhaustion or
 * explicit rate-limit / too-many-requests) can still rotate Active and retry
 * the same turn once when `grok.autoFailover.enabled` is true.
 *
 * Not triggered: bare HTTP status, fuzzy help text, auth/reauth, network,
 * timeout, 5xx, context overflow, content filter, model unavailable.
 *
 * Concurrency (process-level, mirrors ChatGPT semantics):
 * - globalThis.__piGrokFailover holds mutex + cooldown + lastSwitchAt
 * - trigger Active is snapshotted at run start
 * - after lock and before Activate, Active-changed => retry without cascade
 */

import {
  activateOAuthAccount,
  listOAuthAccounts,
  readOAuthActiveAccountId,
} from "./oauth-accounts";
import { GROK_CLI_PROVIDER_ID } from "./oauth-account-providers";
import { getGrokAccountSubscriptionQuota, type GrokQuotaResultV1 } from "./grok-subscription-quota";
import { readPiWebConfig, type PiWebGrokAutoFailoverConfig } from "./pi-web-config";

export type GrokAccountFailoverReason = "quota_exhausted" | "rate_limited";

export type GrokAccountFailoverStatus =
  | "disabled"
  | "not_grok_cli"
  | "not_eligible"
  | "retry_budget_exhausted"
  | "no_active_account"
  | "already_switched_by_other_session"
  | "no_usable_account"
  | "fixed_token_bypass"
  | "switched"
  | "failed";

export interface GrokAccountFailoverResult {
  status: GrokAccountFailoverStatus;
  reason?: GrokAccountFailoverReason;
  provider: string;
  triggerAccountId?: string | null;
  activeAccountId?: string | null;
  switchedToAccountId?: string | null;
  retry: boolean;
  message?: string;
}

export interface GrokAccountFailoverTurnBudget {
  attempts: number;
  switches: number;
}

interface FailoverGlobalState {
  lock: Promise<void> | null;
  exhaustedUntil: Map<string, number>;
  lastSwitchAt: number;
}

const STATE_KEY = "__piGrokFailover" as const;

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

function collectErrorText(message: unknown): { combined: string; lower: string; stopReason: string } {
  const record = typeof message === "object" && message !== null ? message as Record<string, unknown> : {};
  const stopReason = String(record.stopReason ?? "");
  const parts = [
    record.errorMessage,
    record.message,
    record.error,
    record.statusText,
    record.code,
    record.type,
    record.errorCode,
    record.error_type,
    typeof record.status === "number" ? `status=${record.status}` : "",
  ].map(errorText);
  // Nested error objects from some upstream shapes
  if (typeof record.error === "object" && record.error !== null) {
    const nested = record.error as Record<string, unknown>;
    parts.push(errorText(nested.message), errorText(nested.code), errorText(nested.type), errorText(nested.error));
  }
  const combined = parts.filter(Boolean).join("\n");
  return { combined, lower: combined.toLowerCase(), stopReason };
}

/**
 * Classify a Grok assistant error for automatic account failover.
 *
 * Only `stopReason=error` (or missing with explicit error text) is considered.
 * Structured code/type is preferred; text allowlist is second. Broad
 * `/limit|rate/` matching is intentionally avoided.
 */
export function detectGrokFailoverReason(message: unknown): GrokAccountFailoverReason | null {
  const { combined, lower, stopReason } = collectErrorText(message);
  if (!combined.trim()) return null;
  if (stopReason && stopReason !== "error") return null;

  // Hard negatives first — never rotate on these.
  if (
    /\b(authentication|unauthorized|reauth|re-auth|reauthenticate|invalid.?token|expired.?token|login required|please (log|sign) ?in)\b/i.test(lower)
    || /\b(network|fetch failed|econnreset|enotfound|econnrefused|socket hang up)\b/i.test(lower)
    || /\b(timeout|timed out|deadline exceeded)\b/i.test(lower)
    || /\b(context (length |window )?(overflow|exceeded)|maximum context|token limit exceeded for context)\b/i.test(lower)
    || /\b(content filter|content.?policy|safety filter|moderation)\b/i.test(lower)
    || /\b(model (not found|unavailable|does not exist)|unknown model)\b/i.test(lower)
    || /(?:^|\s)(500|502|503|504)\b/.test(combined)
  ) {
    return null;
  }

  // Bare status without Grok limit semantics — do not trigger.
  if (/^(status=)?(429|400|401|403|404|500|502|503)$/i.test(combined.trim())) {
    return null;
  }

  // Structured / explicit rate-limit semantics (positive).
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

  // Explicit quota / usage / credits / monthly / weekly exhaustion.
  if (
    /\b(insufficient_quota|quota_exceeded|quota exceeded|quota exhausted)\b/i.test(lower)
    || /\b(usage[_ -]?limit|usage limit (reached|exceeded|exhausted))\b/i.test(lower)
    || /\b(monthly (usage )?limit (reached|exceeded|exhausted)|monthly quota)\b/i.test(lower)
    || /\b(weekly (usage )?limit (reached|exceeded|exhausted)|weekly quota)\b/i.test(lower)
    || /\b(credits? (exhausted|exceeded|depleted)|out of credits|no credits remaining)\b/i.test(lower)
    || /\b(exceeded your (current )?quota|you have exceeded your quota)\b/i.test(lower)
    || /\bcode["'=\s:]+(insufficient_quota|quota_exceeded|usage_limit)\b/i.test(combined)
    || /\btype["'=\s:]+(insufficient_quota|quota_exceeded|usage_limit)\b/i.test(combined)
  ) {
    return "quota_exhausted";
  }

  return null;
}

/**
 * Detect fixed-token env bypass that would make managed Activate a no-op for
 * actual request credentials. Returns a display-safe message or null.
 */
export function detectGrokFixedTokenBypass(): string | null {
  const token = process.env.GROK_CLI_OAUTH_TOKEN?.trim()
    || process.env.GROK_OAUTH_TOKEN?.trim()
    || process.env.XAI_OAUTH_TOKEN?.trim();
  if (!token) return null;
  return "Grok is using a fixed environment token, so managed account switching cannot change the request credential. Remove the fixed token override or manage credentials outside auto failover.";
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

function isFreshUsableQuota(quota: GrokQuotaResultV1, config: PiWebGrokAutoFailoverConfig): boolean {
  if (!quota.success || quota.reauthRequired) return false;
  if (!quota.monthly) return false;
  if (quota.monthly.remaining <= 0) return false;
  if (quota.weekly && quota.weekly.usedPercent >= 100) return false;

  const ageMs = quota.cache.ageMs;
  if (ageMs == null) return false;
  if (ageMs > config.quotaCacheMaxAgeMs) return false;
  if (quota.cache.state === "none" || quota.cache.state === "stale") return false;
  return true;
}

async function isUsableGrokAccount(
  accountId: string,
  config: PiWebGrokAutoFailoverConfig,
): Promise<boolean> {
  const cooldownUntil = state.exhaustedUntil.get(accountId) ?? 0;
  if (cooldownUntil > now()) return false;

  try {
    // Prefer cache first (no force) so we do not thrash billing.
    const cached = await getGrokAccountSubscriptionQuota(accountId, { forceRefresh: false });
    if (isFreshUsableQuota(cached, config)) return true;
    // If cache is missing/stale/error, try a live query once.
    if (cached.cache.state === "fresh" || cached.cache.state === "live") {
      // Fresh but not usable (exhausted / reauth) — do not requery.
      return false;
    }
    const live = await getGrokAccountSubscriptionQuota(accountId, { forceRefresh: true });
    return isFreshUsableQuota(live, config);
  } catch {
    return false;
  }
}

async function chooseNextUsableAccount(
  triggerAccountId: string,
  config: PiWebGrokAutoFailoverConfig,
): Promise<string | null> {
  const list = await listOAuthAccounts(GROK_CLI_PROVIDER_ID);
  const activeIndex = list.accounts.findIndex((account) => account.accountId === triggerAccountId);
  const ordered = activeIndex >= 0
    ? [...list.accounts.slice(activeIndex + 1), ...list.accounts.slice(0, activeIndex)]
    : list.accounts.filter((account) => account.accountId !== triggerAccountId);

  for (const account of ordered) {
    if (account.accountId === triggerAccountId) continue;
    if (await isUsableGrokAccount(account.accountId, config)) return account.accountId;
  }
  return null;
}

export async function getActiveGrokFailoverAccountId(): Promise<string | null> {
  return readOAuthActiveAccountId(GROK_CLI_PROVIDER_ID);
}

/**
 * Attempt Grok global Active failover after Pi native retry/compaction and
 * other provider failover patches have declined to continue.
 */
export async function attemptGrokAccountFailover(options: {
  provider: string | undefined;
  message: unknown;
  budget: GrokAccountFailoverTurnBudget;
  reloadAuthState: () => void | number | Promise<void | number>;
  triggerAccountId?: string | null;
}): Promise<GrokAccountFailoverResult> {
  const provider = options.provider ?? "";
  if (provider !== GROK_CLI_PROVIDER_ID) {
    return { status: "not_grok_cli", provider, retry: false };
  }

  const config = readPiWebConfig().grok.autoFailover;
  if (!config.enabled) {
    return { status: "disabled", provider, retry: false };
  }

  const reason = detectGrokFailoverReason(options.message);
  if (!reason) {
    return { status: "not_eligible", provider, retry: false };
  }

  const bypass = detectGrokFixedTokenBypass();
  if (bypass) {
    return {
      status: "fixed_token_bypass",
      reason,
      provider,
      retry: false,
      message: bypass,
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
      retry: false,
      message: "Grok account failover budget exhausted for this turn.",
    };
  }

  const triggerAccountId = options.triggerAccountId ?? (await getActiveGrokFailoverAccountId());
  if (!triggerAccountId) {
    return { status: "no_active_account", reason, provider, retry: false, message: "No active Grok account." };
  }
  options.budget.attempts += 1;

  return withFailoverLock<GrokAccountFailoverResult>(async () => {
    state.exhaustedUntil.set(triggerAccountId, now() + config.exhaustedCooldownMs);

    const activeAfterLock = await readOAuthActiveAccountId(GROK_CLI_PROVIDER_ID);
    if (activeAfterLock && activeAfterLock !== triggerAccountId) {
      return {
        status: "already_switched_by_other_session",
        reason,
        provider,
        triggerAccountId,
        activeAccountId: activeAfterLock,
        retry: true,
        message: "Another session already switched the active Grok account.",
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
        message: "No usable Grok account is available after a limit error.",
      };
    }

    const activeBeforeActivate = await readOAuthActiveAccountId(GROK_CLI_PROVIDER_ID);
    if (activeBeforeActivate && activeBeforeActivate !== triggerAccountId) {
      return {
        status: "already_switched_by_other_session",
        reason,
        provider,
        triggerAccountId,
        activeAccountId: activeBeforeActivate,
        retry: true,
        message: "Another session already switched the active Grok account.",
      };
    }

    await activateOAuthAccount(GROK_CLI_PROVIDER_ID, nextAccountId);
    state.lastSwitchAt = now();
    await options.reloadAuthState();
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
        ? "Grok rate limit hit; switched active account and retrying."
        : "Grok quota limit hit; switched active account and retrying.",
    };
  }).catch((error: unknown): GrokAccountFailoverResult => ({
    status: "failed",
    reason: detectGrokFailoverReason(options.message) ?? undefined,
    provider,
    retry: false,
    message: errorText(error),
  }));
}

/** Test helper — clear process state between isolated runs. */
export function __resetGrokFailoverStateForTests(): void {
  state.lock = null;
  state.exhaustedUntil.clear();
  state.lastSwitchAt = 0;
}
