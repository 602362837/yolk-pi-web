import { activateOAuthAccount, listOAuthAccounts, OPENAI_CODEX_PROVIDER_ID, type OAuthAccountSummary } from "./oauth-accounts";
import { readPiWebConfig, type PiWebChatGptAutoFailoverConfig } from "./pi-web-config";
import { getOAuthAccountSubscriptionQuota } from "./subscription-quota";

export type ChatGptAccountFailoverReason = "quota_exhausted";
export type ChatGptAccountFailoverStatus =
  | "disabled"
  | "not_openai_codex"
  | "not_quota_error"
  | "retry_budget_exhausted"
  | "no_active_account"
  | "already_switched_by_other_session"
  | "no_usable_account"
  | "switched"
  | "failed";

export interface ChatGptAccountFailoverResult {
  status: ChatGptAccountFailoverStatus;
  reason?: ChatGptAccountFailoverReason;
  provider: string;
  triggerAccountId?: string | null;
  activeAccountId?: string | null;
  switchedToAccountId?: string | null;
  retry: boolean;
  message?: string;
}

export interface ChatGptAccountFailoverTurnBudget {
  attempts: number;
  switches: number;
}

interface FailoverGlobalState {
  lock: Promise<void> | null;
  exhaustedUntil: Map<string, number>;
  lastSwitchAt: number;
}

const state = (globalThis as typeof globalThis & { __piChatGptFailover?: FailoverGlobalState }).__piChatGptFailover ??= {
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

export function detectChatGptQuotaError(message: unknown): ChatGptAccountFailoverReason | null {
  const record = typeof message === "object" && message !== null ? message as Record<string, unknown> : {};
  const stopReason = String(record.stopReason ?? "");
  const combined = [record.errorMessage, record.message, record.error, record.statusText]
    .map(errorText)
    .join("\n")
    .toLowerCase();
  if (stopReason && stopReason !== "error" && !combined) return null;
  if (/quota|usage limit|usage_limit|insufficient_quota|exceeded your current quota|codex_rate_limits|rate limit reset credit/.test(combined)) {
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

function accountIsFreshlyUsable(account: OAuthAccountSummary, config: PiWebChatGptAutoFailoverConfig): boolean | null {
  const cache = account.quotaCache;
  if (!cache || !cache.success || !cache.queriedAt) return null;
  if (now() - cache.queriedAt > config.quotaCacheMaxAgeMs) return null;
  return cache.tiers.every((tier) => tier.utilization < 100);
}

async function isUsableAccount(account: OAuthAccountSummary, config: PiWebChatGptAutoFailoverConfig): Promise<boolean> {
  const cooldownUntil = state.exhaustedUntil.get(account.accountId) ?? 0;
  if (cooldownUntil > now()) return false;

  const cached = accountIsFreshlyUsable(account, config);
  if (cached !== null) return cached;

  try {
    const quota = await getOAuthAccountSubscriptionQuota(OPENAI_CODEX_PROVIDER_ID, account.accountId);
    if (!quota.success) return false;
    return quota.tiers.every((tier) => tier.utilization < 100);
  } catch {
    return false;
  }
}

async function chooseNextUsableAccount(triggerAccountId: string, config: PiWebChatGptAutoFailoverConfig): Promise<string | null> {
  const list = await listOAuthAccounts(OPENAI_CODEX_PROVIDER_ID);
  const accounts = list.accounts.filter((account) => account.accountId !== triggerAccountId);
  const activeIndex = list.accounts.findIndex((account) => account.accountId === triggerAccountId);
  const ordered = activeIndex >= 0
    ? [...list.accounts.slice(activeIndex + 1), ...list.accounts.slice(0, activeIndex)].filter((account) => account.accountId !== triggerAccountId)
    : accounts;
  for (const account of ordered) {
    if (await isUsableAccount(account, config)) return account.accountId;
  }
  return null;
}

export async function getActiveOpenAICodexAccountId(): Promise<string | null> {
  return (await listOAuthAccounts(OPENAI_CODEX_PROVIDER_ID)).activeAccountId;
}

export async function attemptChatGptAccountFailover(options: {
  provider: string | undefined;
  message: unknown;
  budget: ChatGptAccountFailoverTurnBudget;
  reloadAuthState: () => void | number;
  triggerAccountId?: string | null;
}): Promise<ChatGptAccountFailoverResult> {
  const provider = options.provider ?? "";
  if (provider !== OPENAI_CODEX_PROVIDER_ID) return { status: "not_openai_codex", provider, retry: false };

  const config = readPiWebConfig().chatgpt.autoFailover;
  if (!config.enabled) return { status: "disabled", provider, retry: false };

  const reason = detectChatGptQuotaError(options.message);
  if (!reason) return { status: "not_quota_error", provider, retry: false };

  if (options.budget.attempts >= config.maxAttemptsPerTurn || options.budget.switches >= config.maxAccountSwitchesPerTurn) {
    return { status: "retry_budget_exhausted", reason, provider, retry: false };
  }

  const triggerAccountId = options.triggerAccountId ?? (await getActiveOpenAICodexAccountId());
  if (!triggerAccountId) return { status: "no_active_account", reason, provider, retry: false };
  options.budget.attempts += 1;

  return withFailoverLock<ChatGptAccountFailoverResult>(async () => {
    state.exhaustedUntil.set(triggerAccountId, now() + config.exhaustedCooldownMs);

    const activeAfterLock = (await listOAuthAccounts(OPENAI_CODEX_PROVIDER_ID)).activeAccountId;
    if (activeAfterLock && activeAfterLock !== triggerAccountId) {
      return {
        status: "already_switched_by_other_session",
        reason,
        provider,
        triggerAccountId,
        activeAccountId: activeAfterLock,
        retry: true,
        message: "Another session already switched the active ChatGPT account.",
      };
    }

    const waitMs = Math.max(0, config.minSwitchIntervalMs - (now() - state.lastSwitchAt));
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));

    const nextAccountId = await chooseNextUsableAccount(triggerAccountId, config);
    if (!nextAccountId) return { status: "no_usable_account", reason, provider, triggerAccountId, activeAccountId: triggerAccountId, retry: false };

    const activeBeforeActivate = (await listOAuthAccounts(OPENAI_CODEX_PROVIDER_ID)).activeAccountId;
    if (activeBeforeActivate && activeBeforeActivate !== triggerAccountId) {
      return {
        status: "already_switched_by_other_session",
        reason,
        provider,
        triggerAccountId,
        activeAccountId: activeBeforeActivate,
        retry: true,
        message: "Another session already switched the active ChatGPT account.",
      };
    }

    await activateOAuthAccount(OPENAI_CODEX_PROVIDER_ID, nextAccountId);
    state.lastSwitchAt = now();
    options.reloadAuthState();
    options.budget.switches += 1;
    return {
      status: "switched",
      reason,
      provider,
      triggerAccountId,
      activeAccountId: triggerAccountId,
      switchedToAccountId: nextAccountId,
      retry: true,
    };
  }).catch((error: unknown): ChatGptAccountFailoverResult => ({
    status: "failed",
    reason: detectChatGptQuotaError(options.message) ?? undefined,
    provider,
    retry: false,
    message: errorText(error),
  }));
}
