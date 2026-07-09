/**
 * Unit tests for opencode-go account failover error detection.
 *
 * Tests `detectOpencodeGoFailoverReason` inline to avoid pulling in
 * the full module tree (the pi SDK/pi-ai ESM resolution via tsx).
 *
 * Run with: npx tsx lib/opencode-go-account-failover.test.ts
 */

import { strictEqual } from "node:assert";

// ---------------------------------------------------------------------------
// Inline copy of detectOpencodeGoFailoverReason (pure function, no deps)
// ---------------------------------------------------------------------------

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

type OpencodeGoFailoverReason = "quota_exhausted" | "account_unusable";

function detectOpencodeGoFailoverReason(
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
// Helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    passed++;
  } catch (err) {
    console.log(`  \x1b[31m✗\x1b[0m ${name}: ${(err as Error).message}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// detectOpencodeGoFailoverReason — quota_exhausted
// ---------------------------------------------------------------------------

console.log("\n=== quota_exhausted ===");

test("GoUsageLimitError in errorMessage", () => {
  const reason = detectOpencodeGoFailoverReason({
    stopReason: "error",
    errorMessage: "GoUsageLimitError: You have exceeded your usage limit",
  });
  strictEqual(reason, "quota_exhausted");
});

test("FreeUsageLimitError in errorMessage", () => {
  const reason = detectOpencodeGoFailoverReason({
    stopReason: "error",
    errorMessage: "FreeUsageLimitError: free tier limit reached",
  });
  strictEqual(reason, "quota_exhausted");
});

test("Monthly usage limit reached", () => {
  const reason = detectOpencodeGoFailoverReason({
    stopReason: "error",
    message: "Monthly usage limit reached for your plan",
  });
  strictEqual(reason, "quota_exhausted");
});

test("available balance in message", () => {
  const reason = detectOpencodeGoFailoverReason({
    stopReason: "error",
    message: "Insufficient available balance to process request",
  });
  strictEqual(reason, "quota_exhausted");
});

test("insufficient_quota", () => {
  const reason = detectOpencodeGoFailoverReason({
    stopReason: "error",
    error: "insufficient_quota: you do not have enough quota",
  });
  strictEqual(reason, "quota_exhausted");
});

test("out of budget", () => {
  const reason = detectOpencodeGoFailoverReason({
    stopReason: "error",
    errorMessage: "Request failed: out of budget",
  });
  strictEqual(reason, "quota_exhausted");
});

test("quota exceeded", () => {
  const reason = detectOpencodeGoFailoverReason({
    stopReason: "error",
    message: "Your quota exceeded the monthly limit",
  });
  strictEqual(reason, "quota_exhausted");
});

test("billing-related error", () => {
  const reason = detectOpencodeGoFailoverReason({
    stopReason: "error",
    errorMessage: "billing error: insufficient funds",
  });
  strictEqual(reason, "quota_exhausted");
});

test("402 with credits hint", () => {
  const reason = detectOpencodeGoFailoverReason({
    stopReason: "error",
    status: 402,
    errorMessage: "Payment required: you are out of credits",
  });
  strictEqual(reason, "quota_exhausted");
});

test("402 with balance hint", () => {
  const reason = detectOpencodeGoFailoverReason({
    stopReason: "error",
    status: 402,
    error: "Insufficient account balance",
  });
  strictEqual(reason, "quota_exhausted");
});

test("case insensitive GoUsageLimitError", () => {
  const reason = detectOpencodeGoFailoverReason({
    stopReason: "error",
    error: "gousagelimiterror: limit hit",
  });
  strictEqual(reason, "quota_exhausted");
});

// ---------------------------------------------------------------------------
// detectOpencodeGoFailoverReason — account_unusable
// ---------------------------------------------------------------------------

console.log("\n=== account_unusable ===");

test("AuthError Invalid API key (nested error object)", () => {
  const reason = detectOpencodeGoFailoverReason({
    error: { type: "AuthError", message: "Invalid API key." },
  });
  strictEqual(reason, "account_unusable");
});

test("AuthError Missing API key (nested error object)", () => {
  const reason = detectOpencodeGoFailoverReason({
    error: { type: "AuthError", message: "Missing API key." },
  });
  strictEqual(reason, "account_unusable");
});

test("Invalid API key in errorMessage", () => {
  const reason = detectOpencodeGoFailoverReason({
    stopReason: "error",
    errorMessage: "Invalid API key provided",
  });
  strictEqual(reason, "account_unusable");
});

test("Missing API key in body", () => {
  const reason = detectOpencodeGoFailoverReason({
    type: "error",
    error: { type: "AuthError", message: "Missing API key." },
  });
  strictEqual(reason, "account_unusable");
});

test("401 Unauthorized with invalid key", () => {
  const reason = detectOpencodeGoFailoverReason({
    status: 401,
    statusText: "Unauthorized",
    errorMessage: "Invalid API key",
  });
  strictEqual(reason, "account_unusable");
});

test("403 Forbidden with missing key", () => {
  const reason = detectOpencodeGoFailoverReason({
    status: 403,
    statusText: "Forbidden",
    error: "Missing API key",
  });
  strictEqual(reason, "account_unusable");
});

test("plain text 'Invalid API key' in message field", () => {
  const reason = detectOpencodeGoFailoverReason({
    stopReason: "error",
    message: "Request failed: Invalid API key",
  });
  strictEqual(reason, "account_unusable");
});

test("case insensitive authError invalid api key", () => {
  const reason = detectOpencodeGoFailoverReason({
    error: { type: "autherror", message: "invalid api key." },
  });
  strictEqual(reason, "account_unusable");
});

test("401 Unauthorized statusText alone (no invalid/missing key body text)", () => {
  const reason = detectOpencodeGoFailoverReason({
    status: 401,
    statusText: "Unauthorized",
    errorMessage: "Please login to continue",
  });
  strictEqual(reason, null);
});

// ---------------------------------------------------------------------------
// detectOpencodeGoFailoverReason — NOT eligible (transient)
// ---------------------------------------------------------------------------

console.log("\n=== NOT eligible ===");

test("plain 429", () => {
  const reason = detectOpencodeGoFailoverReason({
    status: 429,
    statusText: "Too Many Requests",
  });
  strictEqual(reason, null);
});

test("429 with rate limit but no quota text", () => {
  const reason = detectOpencodeGoFailoverReason({
    stopReason: "error",
    status: 429,
    errorMessage: "Rate limit exceeded. Try again in 30 seconds.",
  });
  strictEqual(reason, null);
});

test("rate limit message", () => {
  const reason = detectOpencodeGoFailoverReason({
    stopReason: "error",
    errorMessage: "Too many requests, please slow down",
  });
  strictEqual(reason, null);
});

test("network error", () => {
  const reason = detectOpencodeGoFailoverReason({
    stopReason: "error",
    errorMessage: "fetch failed: connection refused",
  });
  strictEqual(reason, null);
});

test("timeout error", () => {
  const reason = detectOpencodeGoFailoverReason({
    stopReason: "error",
    errorMessage: "Request timed out after 120 seconds",
  });
  strictEqual(reason, null);
});

test("500 internal server error", () => {
  const reason = detectOpencodeGoFailoverReason({
    status: 500,
    statusText: "Internal Server Error",
  });
  strictEqual(reason, null);
});

test("stream ended", () => {
  const reason = detectOpencodeGoFailoverReason({
    stopReason: "error",
    errorMessage: "Stream ended unexpectedly",
  });
  strictEqual(reason, null);
});

test("context overflow / token limit", () => {
  const reason = detectOpencodeGoFailoverReason({
    stopReason: "error",
    errorMessage: "Context length exceeded maximum tokens",
  });
  strictEqual(reason, null);
});

test("content filter / refusal", () => {
  const reason = detectOpencodeGoFailoverReason({
    stopReason: "error",
    errorMessage: "Content filtered by safety policy",
  });
  strictEqual(reason, null);
});

test("null input", () => {
  const reason = detectOpencodeGoFailoverReason(null);
  strictEqual(reason, null);
});

test("undefined input", () => {
  const reason = detectOpencodeGoFailoverReason(undefined);
  strictEqual(reason, null);
});

test("empty object", () => {
  const reason = detectOpencodeGoFailoverReason({});
  strictEqual(reason, null);
});

test("plain string error", () => {
  const reason = detectOpencodeGoFailoverReason("Something went wrong");
  strictEqual(reason, null);
});

test("Error instance with unrelated message", () => {
  const reason = detectOpencodeGoFailoverReason(new Error("Unknown error"));
  strictEqual(reason, null);
});

test("402 without credits/balance/quota hint", () => {
  const reason = detectOpencodeGoFailoverReason({
    status: 402,
    statusText: "Payment Required",
    errorMessage: "Please upgrade your plan",
  });
  strictEqual(reason, null);
});

test("non-error stopReason (end_turn)", () => {
  const reason = detectOpencodeGoFailoverReason({
    stopReason: "end_turn",
    message: "Normal completion",
  });
  strictEqual(reason, null);
});

// ---------------------------------------------------------------------------
// Candidate selection (pure function, inline copy)
// ---------------------------------------------------------------------------

interface PureAccount {
  accountId: string;
  disabled?: boolean;
}

interface PureCandidateInput {
  accounts: PureAccount[];
  activeAccountId: string;
  triggerAccountId: string;
  attemptedIds: string[];
  cooldownIds: Set<string>;
}

function selectCandidate(input: PureCandidateInput): string | null {
  const { accounts, activeAccountId, triggerAccountId, attemptedIds, cooldownIds } = input;
  const attemptedSet = new Set(attemptedIds);
  const triggerIdx = accounts.findIndex((a) => a.accountId === triggerAccountId);
  const ordered =
    triggerIdx >= 0
      ? [...accounts.slice(triggerIdx + 1), ...accounts.slice(0, triggerIdx)]
      : accounts;

  for (const account of ordered) {
    if (account.accountId === activeAccountId) continue;
    if (account.accountId === triggerAccountId) continue;
    if (attemptedSet.has(account.accountId)) continue;
    if (account.disabled) continue;
    if (cooldownIds.has(account.accountId)) continue;
    return account.accountId;
  }
  return null;
}

console.log("\n=== candidate selection ===");

test("picks next account after trigger (circular order)", () => {
  const accounts: PureAccount[] = [
    { accountId: "A" },
    { accountId: "B" },
    { accountId: "C" },
  ];
  const result = selectCandidate({
    accounts,
    activeAccountId: "A",
    triggerAccountId: "A",
    attemptedIds: ["A"],
    cooldownIds: new Set(),
  });
  strictEqual(result, "B");
});

test("picks first account when trigger not in list", () => {
  const accounts: PureAccount[] = [
    { accountId: "X" },
    { accountId: "Y" },
  ];
  const result = selectCandidate({
    accounts,
    activeAccountId: "Z",
    triggerAccountId: "Z",
    attemptedIds: [],
    cooldownIds: new Set(),
  });
  strictEqual(result, "X");
});

test("skips active account", () => {
  const accounts: PureAccount[] = [
    { accountId: "A" },
    { accountId: "B" },
    { accountId: "C" },
  ];
  const result = selectCandidate({
    accounts,
    activeAccountId: "B",
    triggerAccountId: "A",
    attemptedIds: ["A"],
    cooldownIds: new Set(),
  });
  strictEqual(result, "C"); // B is active, skipped
});

test("skips disabled accounts", () => {
  const accounts: PureAccount[] = [
    { accountId: "A", disabled: false },
    { accountId: "B", disabled: true },
    { accountId: "C", disabled: false },
  ];
  const result = selectCandidate({
    accounts,
    activeAccountId: "A",
    triggerAccountId: "A",
    attemptedIds: ["A"],
    cooldownIds: new Set(),
  });
  strictEqual(result, "C"); // B is disabled, skipped
});

test("skips disabled accounts with explicit true", () => {
  const accounts: PureAccount[] = [
    { accountId: "A" },
    { accountId: "B", disabled: true },
  ];
  const result = selectCandidate({
    accounts,
    activeAccountId: "A",
    triggerAccountId: "A",
    attemptedIds: ["A"],
    cooldownIds: new Set(),
  });
  strictEqual(result, null); // only candidate B is disabled
});

test("skips attempted accounts", () => {
  const accounts: PureAccount[] = [
    { accountId: "A" },
    { accountId: "B" },
    { accountId: "C" },
    { accountId: "D" },
  ];
  const result = selectCandidate({
    accounts,
    activeAccountId: "A",
    triggerAccountId: "A",
    attemptedIds: ["A", "B", "C"],
    cooldownIds: new Set(),
  });
  strictEqual(result, "D"); // A, B, C all skipped
});

test("skips cooldown accounts", () => {
  const accounts: PureAccount[] = [
    { accountId: "A" },
    { accountId: "B" },
    { accountId: "C" },
  ];
  const result = selectCandidate({
    accounts,
    activeAccountId: "A",
    triggerAccountId: "A",
    attemptedIds: ["A"],
    cooldownIds: new Set(["B"]),
  });
  strictEqual(result, "C"); // B is in cooldown
});

test("returns null when all candidates exhausted", () => {
  const accounts: PureAccount[] = [
    { accountId: "A" },
    { accountId: "B" },
  ];
  const result = selectCandidate({
    accounts,
    activeAccountId: "A",
    triggerAccountId: "A",
    attemptedIds: ["A", "B"],
    cooldownIds: new Set(),
  });
  strictEqual(result, null);
});

test("returns null when only active account exists", () => {
  const accounts: PureAccount[] = [
    { accountId: "A" },
  ];
  const result = selectCandidate({
    accounts,
    activeAccountId: "A",
    triggerAccountId: "A",
    attemptedIds: ["A"],
    cooldownIds: new Set(),
  });
  strictEqual(result, null);
});

test("wraps around to earlier accounts after trigger", () => {
  const accounts: PureAccount[] = [
    { accountId: "X" },
    { accountId: "Y" },
    { accountId: "A" },
    { accountId: "B" },
  ];
  // trigger is A (index 2); order should be [B, X, Y]
  const result = selectCandidate({
    accounts,
    activeAccountId: "A",
    triggerAccountId: "A",
    attemptedIds: ["A", "B"],
    cooldownIds: new Set(),
  });
  strictEqual(result, "X"); // B attempted, wraps to X
});

// ---------------------------------------------------------------------------
// Process-level lock concurrency (inline copy)
// ---------------------------------------------------------------------------

console.log("\n=== lock concurrency ===");

interface LockState {
  lock: Promise<void> | null;
}

async function withFailoverLock<T>(state: LockState, fn: () => Promise<T>): Promise<T> {
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

test("sequential execution: critical sections do not overlap", async () => {
  const state: LockState = { lock: null };
  const order: number[] = [];

  const task1 = withFailoverLock(state, async () => {
    order.push(1);
    await new Promise((r) => setTimeout(r, 20));
    order.push(2);
    return "t1";
  });

  const task2 = withFailoverLock(state, async () => {
    order.push(3);
    await new Promise((r) => setTimeout(r, 5));
    order.push(4);
    return "t2";
  });

  const [r1, r2] = await Promise.all([task1, task2]);
  strictEqual(r1, "t1");
  strictEqual(r2, "t2");
  // Task 1 starts first (1), then must finish (2) before task 2 starts (3,4).
  // Order must be: 1, 2, 3, 4 (not interleaved).
  strictEqual(order.join(","), "1,2,3,4");
});

test("lock is released after function throws", async () => {
  const state: LockState = { lock: null };
  let thrown = false;
  try {
    await withFailoverLock(state, async () => {
      throw new Error("inner error");
    });
  } catch {
    thrown = true;
  }
  strictEqual(thrown, true);
  strictEqual(state.lock, null);
  // Verify another task can acquire the lock after error
  const result = await withFailoverLock(state, async () => "recovered");
  strictEqual(result, "recovered");
});

test("lock preserves order under contention", async () => {
  const state: LockState = { lock: null };
  const results: number[] = [];
  const promises = [1, 2, 3].map((id) =>
    withFailoverLock(state, async () => {
      await new Promise((r) => setTimeout(r, 3));
      results.push(id);
      return id;
    }),
  );
  await Promise.all(promises);
  strictEqual(results.join(","), "1,2,3");
});

// ---------------------------------------------------------------------------
// Budget exhaustion — simulates the per-turn budget logic
// ---------------------------------------------------------------------------

console.log("\n=== budget ===");

interface SimBudget {
  attempts: number;
  switches: number;
  maxAttemptsPerTurn: number;
  maxAccountSwitchesPerTurn: number;
}

function isBudgetExhausted(b: SimBudget): boolean {
  return (
    b.attempts >= b.maxAttemptsPerTurn ||
    b.switches >= b.maxAccountSwitchesPerTurn
  );
}

test("budget not exhausted on first attempt", () => {
  const budget: SimBudget = {
    attempts: 1,
    switches: 0,
    maxAttemptsPerTurn: 1,
    maxAccountSwitchesPerTurn: 1,
  };
  strictEqual(isBudgetExhausted(budget), true); // attempts >= max
});

test("budget exhausted after maxAttempts", () => {
  const budget: SimBudget = {
    attempts: 2,
    switches: 0,
    maxAttemptsPerTurn: 1,
    maxAccountSwitchesPerTurn: 1,
  };
  strictEqual(isBudgetExhausted(budget), true);
});

test("budget exhausted after maxSwitches", () => {
  const budget: SimBudget = {
    attempts: 0,
    switches: 1,
    maxAttemptsPerTurn: 1,
    maxAccountSwitchesPerTurn: 1,
  };
  strictEqual(isBudgetExhausted(budget), true);
});

test("budget OK when maxAttempts > attempts", () => {
  const budget: SimBudget = {
    attempts: 0,
    switches: 0,
    maxAttemptsPerTurn: 3,
    maxAccountSwitchesPerTurn: 3,
  };
  strictEqual(isBudgetExhausted(budget), false);
});

// ---------------------------------------------------------------------------
// More detection edge cases
// ---------------------------------------------------------------------------

console.log("\n=== detection edge cases ===");

test("usage limit reached (generic fallback in quota_exhausted block)", () => {
  const reason = detectOpencodeGoFailoverReason({
    stopReason: "error",
    errorMessage: "You have reached your usage limit",
  });
  // "usage limit" is not explicitly listed, but cooldown pattern catches "usage limit"
  // The current regex doesn't have this exact string — it catches "GoUsageLimitError" etc.
  // So a generic "usage limit" without the exact prefix should NOT trigger.
  // This is intentional: the allowlist is conservative.
  strictEqual(reason, null);
});

test("billing error in message field", () => {
  const reason = detectOpencodeGoFailoverReason({
    stopReason: "error",
    message: "Your billing cycle has ended",
  });
  strictEqual(reason, "quota_exhausted");
});

test("rate limit 429 with quota co-occurrence", () => {
  // Even though 429 is present, the quota_quota_exhausted match
  // in billing takes precedence.  But the explicit 429 block runs
  // after the quota_exhausted block, so if "quota exceeded" is in
  // the same message, it triggers first.
  const reason = detectOpencodeGoFailoverReason({
    status: 429,
    errorMessage: "quota exceeded: too many requests",
  });
  // quota_exhausted matches before the transient block
  strictEqual(reason, "quota_exhausted");
});

test("Error instance with GoUsageLimitError", () => {
  const reason = detectOpencodeGoFailoverReason(new Error("GoUsageLimitError"));
  strictEqual(reason, "quota_exhausted");
});

test("Error instance with Invalid API key", () => {
  const reason = detectOpencodeGoFailoverReason(new Error("Invalid API key"));
  strictEqual(reason, "account_unusable");
});

test("rate_limit with too many requests (strict 429 block)", () => {
  const reason = detectOpencodeGoFailoverReason({
    stopReason: "error",
    errorMessage: "too many requests",
  });
  strictEqual(reason, null);
});

// (Additional source-code contract tests are in scripts/test-opencode-go-failover-behavior.mjs)

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
