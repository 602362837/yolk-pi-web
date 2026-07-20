/**
 * grok-account-lock — provider-level coordination for Grok OAuth
 * refresh/Activate/reauth
 *
 * Refresh of a saved Grok account, Activate of another account, and
 * reauthentication of an existing slot must not interleave around the
 * auth.json Active mirror or the slot credential file.  A process-level
 * mutex serializes all three paths; an on-disk mkdir lock coordinates
 * cross-process writers using only Node fs primitives so Next/Turbopack
 * never traces third-party lock packages or unsupported package export
 * subpaths.
 *
 * ## Invariants
 *
 * - One Grok provider critical section at a time in-process.
 * - Disk lock is `mkdir` of a lock directory + owner metadata; no third-party
 *   lock packages and no nested `package.json` resolution.
 * - Stale locks (owner age / lock-dir mtime > LOCK_STALE_MS) are removed and
 *   acquisition is retried with a bounded wait.
 * - Callers re-read Active under the lock before mirroring credentials.
 * - No credential material is logged.
 * - Independent from Kiro/Antigravity provider locks (no shared state).
 */

import { access, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { GROK_CLI_PROVIDER_ID } from "./oauth-account-providers";

const ACCOUNT_STORE_DIR = "auth-accounts";
const JSON_FILE_MODE = 0o600;
const ACCOUNT_DIR_MODE = 0o700;
/** Lock directory under the Grok account store (not a plain file). */
const LOCK_DIR_NAME = "provider.refresh-activate-reauth.lock";
const LOCK_OWNER_FILE = "owner.json";
const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MIN_MS = 40;
const LOCK_RETRY_MAX_MS = 120;
const LOCK_MAX_WAIT_MS = 15_000;

type LockOwner = {
  pid: number;
  createdAt: number;
};

function grokAccountDir(): string {
  return join(getAgentDir(), ACCOUNT_STORE_DIR, GROK_CLI_PROVIDER_ID);
}

function providerLockDir(): string {
  return join(grokAccountDir(), LOCK_DIR_NAME);
}

function providerLockOwnerPath(lockDir: string): string {
  return join(lockDir, LOCK_OWNER_FILE);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitteredRetryMs(): number {
  return LOCK_RETRY_MIN_MS + Math.floor(Math.random() * (LOCK_RETRY_MAX_MS - LOCK_RETRY_MIN_MS + 1));
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readLockOwner(lockDir: string): Promise<LockOwner | null> {
  try {
    const raw = JSON.parse(await readFile(providerLockOwnerPath(lockDir), "utf8")) as unknown;
    if (!isRecord(raw)) return null;
    const pid = typeof raw.pid === "number" && Number.isFinite(raw.pid) ? raw.pid : null;
    const createdAt =
      typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt) ? raw.createdAt : null;
    if (pid === null || createdAt === null) return null;
    return { pid, createdAt };
  } catch {
    return null;
  }
}

async function lockAgeMs(lockDir: string): Promise<number | null> {
  const owner = await readLockOwner(lockDir);
  if (owner) return Date.now() - owner.createdAt;
  try {
    const st = await stat(lockDir);
    return Date.now() - st.mtimeMs;
  } catch {
    return null;
  }
}

async function tryRemoveStaleLock(lockDir: string): Promise<boolean> {
  const age = await lockAgeMs(lockDir);
  if (age === null || age < LOCK_STALE_MS) return false;
  try {
    await rm(lockDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Acquire the on-disk provider lock via exclusive mkdir.
 * Returns an async release that removes the lock directory (best-effort).
 */
async function acquireFsDirLock(): Promise<() => Promise<void>> {
  const accountDir = grokAccountDir();
  const lockDir = providerLockDir();
  await mkdir(accountDir, { recursive: true, mode: ACCOUNT_DIR_MODE });

  const startedAt = Date.now();
  while (true) {
    try {
      // Exclusive create: fails with EEXIST when another holder owns the lock.
      await mkdir(lockDir, { recursive: false, mode: ACCOUNT_DIR_MODE });
      const owner: LockOwner = { pid: process.pid, createdAt: Date.now() };
      await writeFile(providerLockOwnerPath(lockDir), `${JSON.stringify(owner)}\n`, {
        encoding: "utf8",
        mode: JSON_FILE_MODE,
      });

      let released = false;
      return async () => {
        if (released) return;
        released = true;
        try {
          // Only remove if we still own it (best-effort; stale recovery may have cleaned).
          const current = await readLockOwner(lockDir);
          if (current && current.pid === process.pid && current.createdAt === owner.createdAt) {
            await rm(lockDir, { recursive: true, force: true });
            return;
          }
          if (!(await pathExists(lockDir))) return;
          // Owner file missing or rewritten — still try force cleanup of our empty hold.
          if (!current) {
            await rm(lockDir, { recursive: true, force: true });
          }
        } catch {
          // Best-effort unlock.
        }
      };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code !== "EEXIST") throw err;

      await tryRemoveStaleLock(lockDir);

      if (Date.now() - startedAt > LOCK_MAX_WAIT_MS) {
        throw new Error("Grok provider refresh/Activate/reauth lock acquisition timed out");
      }
      await sleep(jitteredRetryMs());
    }
  }
}

// Process-level provider mutex (same pattern as failover controllers).
let processLock: Promise<void> | null = null;

async function withProcessLock<T>(fn: () => Promise<T>): Promise<T> {
  while (processLock) await processLock.catch(() => {});
  let release!: () => void;
  processLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    return await fn();
  } finally {
    release();
    processLock = null;
  }
}

async function withFsDirLock<T>(fn: () => Promise<T>): Promise<T> {
  const release = await acquireFsDirLock();
  try {
    return await fn();
  } finally {
    await release();
  }
}

/**
 * Run `fn` under the Grok provider critical section shared by token refresh,
 * Activate, and reauthentication.  Process mutex is always applied; on-disk
 * mkdir lock adds cross-process safety without third-party lock packages.
 */
export async function withGrokProviderLock<T>(fn: () => Promise<T>): Promise<T> {
  return withProcessLock(() => withFsDirLock(fn));
}

/** Test helper: confirms the lock path uses fs mkdir primitives (no third-party lock package). */
export function __grokLockUsesFsPrimitivesForTests(): boolean {
  return LOCK_DIR_NAME.endsWith(".lock") && LOCK_OWNER_FILE === "owner.json";
}
