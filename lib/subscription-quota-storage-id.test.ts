import { strictEqual } from "node:assert";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function main(): Promise<void> {
  const agentDir = await mkdtemp(join(tmpdir(), "ypi-oauth-quota-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const realChatGptAccountId = "real-chatgpt-account-id";
  const requests: Request[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push(request);
    if (request.url.includes("reset-credits")) {
      return new Response(JSON.stringify({ available_count: 0, credits: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ rate_limit: { primary_window: { used_percent: 25, limit_window_seconds: 18000, reset_at: 1_800_000_000 } } }), { status: 200 });
  };

  try {
    const { OPENAI_CODEX_PROVIDER_ID, saveOAuthAccountCredential } = await import("./oauth-accounts");
    const { getOAuthAccountSubscriptionQuota } = await import("./subscription-quota");
    const credential = {
      type: "oauth" as const,
      access: "access-token",
      refresh: "refresh-token",
      expires: Date.now() + 60 * 60 * 1000,
      accountId: realChatGptAccountId,
    };
    const first = await saveOAuthAccountCredential(OPENAI_CODEX_PROVIDER_ID, credential);
    const second = await saveOAuthAccountCredential(OPENAI_CODEX_PROVIDER_ID, { ...credential, access: "other-access-token" });

    const quota = await getOAuthAccountSubscriptionQuota(OPENAI_CODEX_PROVIDER_ID, second.accountId);
    strictEqual(quota.success, true);
    const usageRequest = requests.find((request) => request.url.includes("/wham/usage"));
    strictEqual(usageRequest?.headers.get("ChatGPT-Account-Id"), realChatGptAccountId, "outbound quota header uses the real ChatGPT account id");

    const metadata = JSON.parse(await readFile(join(agentDir, "auth-accounts", OPENAI_CODEX_PROVIDER_ID, "accounts.json"), "utf8")) as {
      accounts: Array<{ accountId: string; quotaCache?: unknown }>;
    };
    strictEqual(metadata.accounts.find((account) => account.accountId === first.accountId)?.quotaCache, undefined, "same-real-id sibling does not receive the quota cache");
    strictEqual(Boolean(metadata.accounts.find((account) => account.accountId === second.accountId)?.quotaCache), true, "quota cache is keyed by the saved-account id");
    console.log("OAuth quota storage identity tests passed");
  } finally {
    globalThis.fetch = originalFetch;
    await rm(agentDir, { recursive: true, force: true });
  }
}

// The aggregate runner awaits exported completion promises before changing its
// temporary PI_CODING_AGENT_DIR for the next isolated test.
export const subscriptionQuotaStorageIdTestCompletion = main();
