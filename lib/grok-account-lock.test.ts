import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.error(`✗ ${name}: ${error instanceof Error ? error.message : String(error)}`);
    failed += 1;
  }
}

async function main(): Promise<void> {
  const agentDir = await mkdtemp(join(tmpdir(), "ypi-grok-lock-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;

  try {
    const { withGrokProviderLock, __grokLockUsesFsPrimitivesForTests } = await import("./grok-account-lock");
    const lockDir = join(agentDir, "auth-accounts", "grok-cli", "provider.refresh-activate-reauth.lock");

    await test("serializes same-process callers", async () => {
      const order: string[] = [];
      const first = withGrokProviderLock(async () => {
        order.push("first-start");
        await new Promise((resolve) => setTimeout(resolve, 50));
        order.push("first-end");
      });
      const second = withGrokProviderLock(async () => {
        order.push("second");
      });
      await Promise.all([first, second]);
      assert.deepEqual(order, ["first-start", "first-end", "second"]);
    });

    await test("recovers an aged lock whose owner PID is dead", async () => {
      await mkdir(lockDir, { recursive: true, mode: 0o700 });
      await writeFile(join(lockDir, "owner.json"), `${JSON.stringify({ pid: 999_999_999, createdAt: 0 })}\n`, {
        mode: 0o600,
      });
      let entered = false;
      await withGrokProviderLock(async () => {
        entered = true;
      });
      assert.equal(entered, true);
    });

    await test("never stale-steals an aged lock with a live owner", async () => {
      await mkdir(lockDir, { recursive: true, mode: 0o700 });
      await writeFile(join(lockDir, "owner.json"), `${JSON.stringify({ pid: process.pid, createdAt: 0 })}\n`, {
        mode: 0o600,
      });
      let entered = false;
      const startedAt = Date.now();
      await assert.rejects(
        withGrokProviderLock(async () => {
          entered = true;
        }),
        /lock acquisition timed out/,
      );
      assert.equal(entered, false);
      assert.ok(Date.now() - startedAt >= 15_000, "live-owner waiter must wait rather than enter");
      await rm(lockDir, { recursive: true, force: true });
    });

    await test("documents owner identity and provider-before-auth lock ordering", async () => {
      assert.equal(__grokLockUsesFsPrimitivesForTests(), true);
      const source = await readFile(join(process.cwd(), "lib/grok-account-lock.ts"), "utf8");
      assert.ok(source.includes("Grok provider lock → auth.json lock"));
      assert.ok(source.includes("owner-specific filenames"));
    });
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await rm(agentDir, { recursive: true, force: true });
  }

  console.log(`Passed: ${passed} Failed: ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

void main();
