/**
 * Opencode-Go managed API-key account failover controller.
 *
 * Implements conservative error detection and process-level concurrency-safe
 * account switching for `opencode-go` provider managed API-key accounts.
 * Designed as a pure-passive failover: no proactive quota/balance queries.
 *
 * Trigger errors:
 * - `quota_exhausted`: explicit quota/balance/monthly-limit strings; the
 *   trigger account enters a process-level cooldown.
 * - `account_unusable`: AuthError Invalid/Missing API key, 401/403 permanent
 *   auth failures; the trigger account is **persistently disabled** inside
 *   the lock, and candidates must skip disabled accounts.
 *
 * Not triggered: transient 429/rate-limit, network errors, 5xx, timeouts,
 * stream-end, context overflow, content filter.
 *
 * Concurrency model (process-level):
 * - globalThis.__piOpencodeGoFailover holds a mutex and cooldown map.
 * - Requests bind to the trigger account before locking; after locking,
 *   if the active account has changed (another session already switched),
 *   we retry without switching again (no A→B→C cascade).
 * - A double-check before activation guards TOCTOU.
 */

import {
  activateApiKeyAccount,
  disableApiKeyAccount,
  getActiveApiKeyAccountId,
  listApiKeyAccounts,
} from "./api-key-accounts";
import { readPiWebConfig } from "./pi-web-config";

// ---------------------------------------------------------------------------
// Provider identity
// ---------------------------------------------------------------------------

export const OPENCODE_GO_PROVIDER_ID = "opencode-go";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OpencodeGoFailoverReason = "quota_exhausted" | "account_unusable";

export type OpencodeGoFailoverStatus =
  | "disabled"
  | "not_opencode_go"
  | "not_eligible"
  | "retry_budget_exhausted"
  | "no_active_account"
  | "already_switched_by_other_session"
  | "no_usable_account"
  | "switched"
  | "disabled_account"
  | "failed";

export interface OpencodeGoFailoverResult {
  status: OpencodeGoFailoverStatus;
  reason?: OpencodeGoFailoverReason;
  provider: string;
  triggerAccountId?: string | null;
  activeAccountId?: string | null;
  switchedToAccountId?: string | null;
  disabledAccountId?: string | null;
  retry: boolean;
  message?: string;
}

export interface OpencodeGoFailoverTurnBudget {
  attempts: number;
  switches: number;
  attemptedAccountIds: string[];
}

interface FailoverGlobalState {
  lock: Promise<void> | null;
  /** Map of accountId → timestamp (ms) until which the account is in cooldown. */
  exhaustedUntil: Map<string, number>;
  lastSwitchAt: number;
}

// ---------------------------------------------------------------------------
// Global state (process-level)
// ---------------------------------------------------------------------------

const STATE_KEY = "__piOpencodeGoFailover" as const;

const state = (
  globalThis as typeof globalThis & { [STATE_KEY]?: FailoverGlobalState }
)[STATE_KEY] ??= {
  lock: null,
  exhaustedUntil: new Map<string, number>(),
  lastSwitchAt: 0,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Error detection
// ---------------------------------------------------------------------------

/**
 * Classify an error as an eligible opencode-go failover reason.
 *
 * `quota_exhausted` — explicit quota/balance/monthly-limit/billing strings.
 * `account_unusable` — AuthError Invalid/Missing API key, 401/403 permanent
 *   auth failures.
 * `null` — transient errors (429, rate-limit, network, 5xx, timeouts, etc.)
 *   or errors from non-opencode-go providers.
 */
export function detectOpencodeGoFailoverReason(
  message: unknown,
): OpencodeGoFailoverReason | null {
  const record =
    typeof message === "object" && message !== null
      ? (message as Record<string, unknown>)
      : {};
  const combined = [
    record.errorMessage,
    record.message,
    record.error,
    record.statusText,
    typeof record.status === "number" ? String(record.status) : "",
  ]
    .map(errorText)
    .join("\n");

  const lower = combined.toLowerCase();

  // --- account_unusable: permanent API-key auth failures ---
  if (
    /autherror.*invalid api key/i.test(lower) ||
    /autherror.*missing api key/i.test(lower) ||
    /invalid api key/i.test(lower) ||
    /missing api key/i.test(lower)
  ) {
    return "account_unusable";
  }

  // 401/403 only qualifies when the body explicitly indicates invalid/missing key
  if (
    /(?:^|\s)401\b/.test(combined) ||
    /(?:^|\s)403\b/.test(combined)
  ) {
    if (
      /autherror|invalid.*key|missing.*key/i.test(lower)
    ) {
      return "account_unusable";
    }
  }

  // --- quota_exhausted: quota / balance / monthly-limit ---
  if (
    /gousagelimiterror|freeusagelimiterror/i.test(combined) ||
    /monthly usage limit reached/i.test(lower) ||
    /available balance/i.test(lower) ||
    /insufficient_quota/i.test(lower) ||
    /out of budget/i.test(lower) ||
    /quota exceeded/i.test(lower) ||
    /\bbilling\b/i.test(lower)
  ) {
    return "quota_exhausted";
  }

  // 402 Payment Required with quota/balance hints
  if (/(?:^|\s)402\b/.test(combined)) {
    if (
      /credits|balance|quota|monthly limit|usage limit/i.test(lower)
    ) {
      return "quota_exhausted";
    }
  }

  // Explicit transient signals that must NOT trigger
  // (kept for clarity; anything not matched returns null anyway)
  if (
    /(?:^|\s)429\b/.test(combined) ||
    /rate limit/i.test(lower) ||
    /too many requests/i.test(lower)
  ) {
    return null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Process-level mutex
// ---------------------------------------------------------------------------

async function withFailoverLock<T>(fn: () => Promise<T>): Promise<T> {
  while (state.lock) {
    await state.lock.catch(() => {});
  }
  let release!: () => void;
  state.lock = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    return await fn();
  } finally {
    release();
    state.lock = null;
  }
}

// ---------------------------------------------------------------------------
// Candidate selection
// ---------------------------------------------------------------------------

/**
 * Choose the next enabled, non-cooldown, non-disabled candidate account
 * for failover.  Returns null when no usable account is available.
 *
 * Selection order: circular traversal from the trigger account's position
 * in the account list.  Skipped accounts:
 * - active account
 * - trigger account
 * - already attempted this turn
 * - disabled (disabled === true)
 * - in cooldown (exhaustedUntil not expired)
 */
async function chooseNextEnabledAccount(
  provider: string,
  triggerAccountId: string,
  attemptedIds: string[],
): Promise<string | null> {
  const list = await listApiKeyAccounts(provider);
  const all = list.accounts;

  // Index of trigger account for circular traversal
  const triggerIdx = all.findIndex((a) => a.accountId === triggerAccountId);
  const ordered =
    triggerIdx >= 0
      ? [...all.slice(triggerIdx + 1), ...all.slice(0, triggerIdx)]
      : all;

  const attemptedSet = new Set(attemptedIds);
  const activeId = list.activeAccountId;

  for (const account of ordered) {
    // Skip active
    if (account.accountId === activeId) continue;
    // Skip trigger
    if (account.accountId === triggerAccountId) continue;
    // Skip already attempted this turn
    if (attemptedSet.has(account.accountId)) continue;
    // Skip disabled
    if (account.disabled) continue;
    // Skip cooldown
    const cooldownUntil = state.exhaustedUntil.get(account.accountId) ?? 0;
    if (cooldownUntil > now()) continue;

    return account.accountId;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main failover entry point
// ---------------------------------------------------------------------------

export async function getActiveOpencodeGoAccountId(): Promise<string | null> {
  return getActiveApiKeyAccountId(OPENCODE_GO_PROVIDER_ID);
}

/**
 * Attempt to fail over the current opencode-go managed API-key account.
 *
 * Callers must supply:
 * - `provider`: the provider string from the model (must be `"opencode-go"`).
 * - `message`: the assistant message / error object that caused the failure.
 * - `budget`: per-turn failover budget (mutated in place).
 * - `reloadAuthState`: callback to reload live RPC auth state (typically
 *   `reloadRpcAuthState`).
 * - `triggerAccountId`: (optional) the account id that was active when the
 *   failing request was initiated.  If omitted, the current active account
 *   is resolved inside the lock.
 */
export async function attemptOpencodeGoAccountFailover(options: {
  provider: string | undefined;
  message: unknown;
  budget: OpencodeGoFailoverTurnBudget;
  reloadAuthState: () => void | number | Promise<void | number>;
  triggerAccountId?: string | null;
}): Promise<OpencodeGoFailoverResult> {
  const provider = options.provider ?? "";

  // 1. Only for opencode-go
  if (provider !== OPENCODE_GO_PROVIDER_ID) {
    return { status: "not_opencode_go", provider, retry: false };
  }

  // 2. Config guard
  const config = readPiWebConfig().opencodeGo.autoFailover;
  if (!config.enabled) {
    return { status: "disabled", provider, retry: false };
  }

  // 3. Error classification
  const reason = detectOpencodeGoFailoverReason(options.message);
  if (!reason) {
    return { status: "not_eligible", provider, retry: false };
  }

  // 4. Budget check
  if (
    options.budget.attempts >= config.maxAttemptsPerTurn ||
    options.budget.switches >= config.maxAccountSwitchesPerTurn
  ) {
    return {
      status: "retry_budget_exhausted",
      reason,
      provider,
      retry: false,
    };
  }

  // 5. Resolve trigger account
  let triggerAccountId = options.triggerAccountId ?? null;
  if (!triggerAccountId) {
    triggerAccountId = await getActiveOpencodeGoAccountId();
  }
  if (!triggerAccountId) {
    return {
      status: "no_active_account",
      reason,
      provider,
      retry: false,
    };
  }

  // Mark trigger as attempted for this turn
  if (!options.budget.attemptedAccountIds.includes(triggerAccountId)) {
    options.budget.attemptedAccountIds.push(triggerAccountId);
  }
  options.budget.attempts += 1;

  // 6. Enter lock
  return withFailoverLock<OpencodeGoFailoverResult>(async () => {
    // --- 6a. Handle account_unusable: persist disable ---
    let disabledAccountId: string | null = null;
    if (reason === "account_unusable") {
      try {
        // Check if already disabled (idempotent)
        const accountsAfterLock = await listApiKeyAccounts(provider);
        const triggerEntry = accountsAfterLock.accounts.find(
          (a) => a.accountId === triggerAccountId,
        );
        if (triggerEntry && !triggerEntry.disabled) {
          await disableApiKeyAccount(provider, triggerAccountId!, {
            reason: "Account unusable: Invalid API key",
            disabledBy: "system",
            autoDisabledReason: "account_unusable",
            // If this is the active account, the disable helper will handle
            // clearing or replacing the active mirror per its active-account
            // policy.  At this point we pass clearActive because the failover
            // will attempt to activate a replacement next.
            clearActive: true,
          });
          disabledAccountId = triggerAccountId!;
        } else if (triggerEntry?.disabled) {
          disabledAccountId = triggerAccountId!;
        }
      } catch (disableError: unknown) {
        return {
          status: "failed",
          reason,
          provider,
          triggerAccountId: triggerAccountId!,
          retry: false,
          message: `Failed to disable unusable account: ${errorText(disableError)}`,
        };
      }
    } else {
      // quota_exhausted: mark cooldown
      state.exhaustedUntil.set(
        triggerAccountId!,
        now() + config.exhaustedCooldownMs,
      );
    }

    // --- 6b. Check if active changed after lock ---
    const activeAfterLock = await getActiveOpencodeGoAccountId();
    if (activeAfterLock && activeAfterLock !== triggerAccountId) {
      return {
        status: "already_switched_by_other_session",
        reason,
        provider,
        triggerAccountId: triggerAccountId!,
        activeAccountId: activeAfterLock,
        disabledAccountId,
        retry: true,
        message:
          "Another session already switched the active OpenCode Go account.",
      };
    }

    // --- 6c. Min switch interval ---
    const waitMs = Math.max(
      0,
      config.minSwitchIntervalMs - (now() - state.lastSwitchAt),
    );
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    // --- 6d. Choose candidate ---
    const nextAccountId = await chooseNextEnabledAccount(
      provider,
      triggerAccountId!,
      options.budget.attemptedAccountIds,
    );
    if (!nextAccountId) {
      return {
        status: "no_usable_account",
        reason,
        provider,
        triggerAccountId: triggerAccountId!,
        activeAccountId: activeAfterLock ?? triggerAccountId!,
        disabledAccountId,
        retry: false,
        message:
          "No enabled OpenCode Go account is available for failover.",
      };
    }

    // --- 6e. Double-check active before activate (TOCTOU guard) ---
    const activeBeforeActivate = await getActiveOpencodeGoAccountId();
    if (activeBeforeActivate && activeBeforeActivate !== triggerAccountId) {
      return {
        status: "already_switched_by_other_session",
        reason,
        provider,
        triggerAccountId: triggerAccountId!,
        activeAccountId: activeBeforeActivate,
        disabledAccountId,
        retry: true,
        message:
          "Another session already switched the active OpenCode Go account.",
      };
    }

    // --- 6f. Activate candidate ---
    try {
      await activateApiKeyAccount(provider, nextAccountId);
      state.lastSwitchAt = now();
      await options.reloadAuthState();
      options.budget.switches += 1;
      // Add the candidate to attempted so the same turn won't try it again
      if (!options.budget.attemptedAccountIds.includes(nextAccountId)) {
        options.budget.attemptedAccountIds.push(nextAccountId);
      }
      return {
        status: "switched",
        reason,
        provider,
        triggerAccountId: triggerAccountId!,
        activeAccountId: triggerAccountId!,
        switchedToAccountId: nextAccountId,
        disabledAccountId,
        retry: true,
        message: disabledAccountId
          ? `OpenCode Go account disabled (Invalid API key). Switched to another account.`
          : `OpenCode Go account switched due to quota exhausted.`,
      };
    } catch (activationError: unknown) {
      return {
        status: "failed",
        reason,
        provider,
        triggerAccountId: triggerAccountId!,
        disabledAccountId,
        retry: false,
        message: `Failed to activate fallback account: ${errorText(activationError)}`,
      };
    }
  }).catch((lockError: unknown): OpencodeGoFailoverResult => ({
    status: "failed",
    reason,
    provider,
    retry: false,
    message: `Failover lock error: ${errorText(lockError)}`,
  }));
}
