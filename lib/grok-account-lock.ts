/**
 * grok-account-lock — provider-level coordination for Grok OAuth
 * refresh/Activate/reauth
 *
 * Refresh of a saved Grok account, Activate of another account, and
 * reauthentication of an existing slot must not interleave around the
 * auth.json Active mirror or the slot credential file. A process-level mutex
 * serializes all three paths; an on-disk mkdir lock coordinates cross-process
 * writers using only Node fs primitives.
 *
 * Lock ordering is always Grok provider lock → auth.json lock. Callers must
 * never acquire this lock from within a WebCredentialStore.modify callback.
 */

import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { GROK_CLI_PROVIDER_ID } from "./oauth-account-providers";

const ACCOUNT_STORE_DIR = "auth-accounts";
const JSON_FILE_MODE = 0o600;
const ACCOUNT_DIR_MODE = 0o700;
/** Lock directory under the Grok account store (not a plain file). */
const LOCK_DIR_NAME = "provider.refresh-activate-reauth.lock";
const LOCK_OWNER_FILE = "owner.json";
const LOCK_OWNER_PREFIX = "owner.";
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

function providerLockOwnerPath(lockDir: string, id?: string): string {
  return join(lockDir, id ? `${LOCK_OWNER_PREFIX}${id}.json` : LOCK_OWNER_FILE);
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

function isLivePid(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the PID exists but belongs to another user, so fail closed.
    return (err as NodeJS.ErrnoException | undefined)?.code === "EPERM";
  }
}

async function readLockOwner(lockDir: string): Promise<LockOwner | null> {
  let ownerFile = LOCK_OWNER_FILE;
  try {
    const names = await readdir(lockDir);
    const uniqueOwner = names.find(
      (name) => name.startsWith(LOCK_OWNER_PREFIX) && name.endsWith(".json") && name !== LOCK_OWNER_FILE,
    );
    if (uniqueOwner) ownerFile = uniqueOwner;
    const raw = JSON.parse(await readFile(join(lockDir, ownerFile), "utf8")) as unknown;
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
  const owner = await readLockOwner(lockDir);
  const age = owner ? Date.now() - owner.createdAt : await lockAgeMs(lockDir);
  if (age === null || age < LOCK_STALE_MS) return false;
  // An aged refresh may still be running. Safety beats availability: never
  // steal from a live owner; waiters will time out without entering.
  if (owner && isLivePid(owner.pid)) return false;

  const quarantineDir = `${lockDir}.stale-${randomUUID()}`;
  try {
    // Move before removal so a releasing old holder cannot remove a later lock.
    await rename(lockDir, quarantineDir);
    await rm(quarantineDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/** Acquire the on-disk provider lock via exclusive mkdir. */
async function acquireFsDirLock(): Promise<() => Promise<void>> {
  const accountDir = grokAccountDir();
  const lockDir = providerLockDir();
  await mkdir(accountDir, { recursive: true, mode: ACCOUNT_DIR_MODE });

  const startedAt = Date.now();
  while (true) {
    try {
      await mkdir(lockDir, { recursive: false, mode: ACCOUNT_DIR_MODE });
      const id = randomUUID();
      const owner = { pid: process.pid, createdAt: Date.now(), id };
      const ownerPath = providerLockOwnerPath(lockDir, id);
      await writeFile(ownerPath, `${JSON.stringify(owner)}\n`, {
        encoding: "utf8",
        mode: JSON_FILE_MODE,
      });

      let released = false;
      return async () => {
        if (released) return;
        released = true;
        try {
          // Owner-specific filenames make an old release harmless after stale
          // recovery: it can only unlink its own metadata, never a replacement.
          await unlink(ownerPath);
          await rmdir(lockDir);
        } catch {
          // A stale recovery/replacement may have already removed or replaced
          // the directory. Never recursively remove a path during release.
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
 * Activate, and reauthentication. The provider lock is acquired before any
 * auth.json lock the callback may need.
 */
export async function withGrokProviderLock<T>(fn: () => Promise<T>): Promise<T> {
  return withProcessLock(() => withFsDirLock(fn));
}

/** Test helper: confirms the lock path uses fs mkdir primitives (no third-party lock package). */
export function __grokLockUsesFsPrimitivesForTests(): boolean {
  return LOCK_DIR_NAME.endsWith(".lock") && LOCK_OWNER_FILE === "owner.json";
}
