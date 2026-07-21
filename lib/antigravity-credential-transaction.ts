/**
 * Low-level Antigravity Active credential transaction primitives.
 *
 * Callers must already hold `withAntigravityProviderLock()`. The managed Active
 * slot is authoritative; auth.json is only the Pi-compatible mirror, so a mirror
 * write failure never rolls a rotated slot back to an old refresh token.
 */

import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Credential } from "@earendil-works/pi-ai";
import { ANTIGRAVITY_PROVIDER_ID } from "./oauth-account-providers";
import type { WebCredentialStore } from "./web-credential-store";

const ACCOUNT_STORE_DIR = "auth-accounts";
const METADATA_FILE = "accounts.json";
const ACCOUNT_DIR_MODE = 0o700;
const JSON_FILE_MODE = 0o600;

type AccountMetadata = {
  activeAccountId?: string;
  accounts: unknown[];
};

export type AntigravityActiveSnapshot = {
  storageId: string;
  credential: Credential;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function accountDirFor(rawStore: WebCredentialStore): string {
  return join(dirname(rawStore.authPath), ACCOUNT_STORE_DIR, ANTIGRAVITY_PROVIDER_ID);
}

function credentialPath(accountDir: string, storageId: string): string {
  return join(accountDir, `${encodeURIComponent(storageId)}.json`);
}

function asOAuthCredential(value: unknown): Credential | null {
  if (!isRecord(value)) return null;
  if (typeof value.access !== "string" || typeof value.refresh !== "string") return null;
  if (typeof value.expires !== "number" || !Number.isFinite(value.expires)) return null;
  // Provider-native slots omit Pi's auth.json-only type sentinel.
  return { ...value, type: "oauth" } as Credential;
}

async function readMetadata(accountDir: string): Promise<AccountMetadata | null> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(join(accountDir, METADATA_FILE), "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return null;
    throw new Error("Antigravity account metadata is invalid");
  }
  if (!isRecord(raw) || !Array.isArray(raw.accounts)) {
    throw new Error("Antigravity account metadata is invalid");
  }
  return {
    activeAccountId: typeof raw.activeAccountId === "string" && raw.activeAccountId.trim()
      ? raw.activeAccountId
      : undefined,
    accounts: raw.accounts,
  };
}

/**
 * Optimistically read the Active pointer and slot. Refresh writers must use the
 * under-lock variant below for their authoritative decision.
 */
export async function readAntigravityActiveSnapshot(
  rawStore: WebCredentialStore,
): Promise<AntigravityActiveSnapshot | null> {
  const accountDir = accountDirFor(rawStore);
  const metadata = await readMetadata(accountDir);
  const storageId = metadata?.activeAccountId;
  if (!storageId) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(credentialPath(accountDir, storageId), "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return null;
    throw new Error("Antigravity Active credential is unreadable");
  }
  const credential = asOAuthCredential(raw);
  if (!credential) throw new Error("Antigravity Active credential is invalid");
  return { storageId, credential };
}

/** Same read primitive, named to make lock ownership explicit at writers. */
export const readAntigravityActiveSnapshotUnderLock = readAntigravityActiveSnapshot;

async function atomicWriteSlot(accountDir: string, storageId: string, credential: Credential): Promise<void> {
  await mkdir(accountDir, { recursive: true, mode: ACCOUNT_DIR_MODE });
  const target = credentialPath(accountDir, storageId);
  const temp = `${target}.tmp.${process.pid}.${randomBytes(6).toString("hex")}`;
  // Keep the managed slot provider-native: strip Pi's auth.json type sentinel.
  const { type: _type, ...slotCredential } = credential as Credential & Record<string, unknown>;
  try {
    const handle = await open(temp, "w", JSON_FILE_MODE);
    try {
      await handle.writeFile(`${JSON.stringify(slotCredential, null, 2)}\n`, "utf8");
      await handle.sync().catch(() => {});
    } finally {
      await handle.close();
    }
    await chmod(temp, JSON_FILE_MODE).catch(() => {});
    await rename(temp, target);
    await chmod(target, JSON_FILE_MODE).catch(() => {});
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

export type CommitAntigravityCredentialResult = {
  mirrored: boolean;
  activeChanged: boolean;
};

function comparableCredential(credential: Credential): Record<string, unknown> {
  const { type: _type, ...rest } = credential as Credential & Record<string, unknown>;
  return rest;
}

function credentialsMatch(left: Credential, right: Credential): boolean {
  return isDeepStrictEqual(comparableCredential(left), comparableCredential(right));
}

function mirrorReconcileError(): Error {
  // Do not leak auth-file paths or credential values through this recovery path.
  return new Error("Antigravity Active credential mirror reconciliation failed");
}

/**
 * Persist a refreshed slot first, then re-read the Active pointer and mirror
 * auth.json only if that exact slot is still Active. This function deliberately
 * does not catch auth mirror errors: the durable slot is retained for recovery.
 */
export async function commitAntigravityCredentialUnderLock(input: {
  rawStore: WebCredentialStore;
  storageId: string;
  credential: Credential;
}): Promise<CommitAntigravityCredentialResult> {
  const accountDir = accountDirFor(input.rawStore);
  await atomicWriteSlot(accountDir, input.storageId, input.credential);

  const current = await readAntigravityActiveSnapshotUnderLock(input.rawStore);
  if (!current || current.storageId !== input.storageId) {
    return { mirrored: false, activeChanged: true };
  }

  // Provider lock is held before this obtains WebCredentialStore's auth lock.
  await input.rawStore.modify(ANTIGRAVITY_PROVIDER_ID, async () => input.credential);
  return { mirrored: true, activeChanged: false };
}

/**
 * Repair a missing or stale auth.json mirror from the authoritative Active
 * slot. Callers must already hold the Antigravity provider lock. This is
 * deliberately one-way: the mirror is never used to update a managed slot here.
 */
export async function reconcileAntigravityActiveMirrorUnderLock(input: {
  rawStore: WebCredentialStore;
  storageId: string;
}): Promise<CommitAntigravityCredentialResult> {
  const current = await readAntigravityActiveSnapshotUnderLock(input.rawStore);
  if (!current || current.storageId !== input.storageId) {
    return { mirrored: false, activeChanged: true };
  }

  let mirror: Credential | undefined;
  try {
    mirror = await input.rawStore.read(ANTIGRAVITY_PROVIDER_ID);
  } catch {
    throw mirrorReconcileError();
  }
  if (mirror && credentialsMatch(current.credential, mirror)) {
    return { mirrored: false, activeChanged: false };
  }

  try {
    // Provider lock is held before this obtains WebCredentialStore's auth lock.
    await input.rawStore.modify(ANTIGRAVITY_PROVIDER_ID, async () => current.credential);
  } catch {
    // The slot has not been touched, so callers can safely retry a later read.
    throw mirrorReconcileError();
  }
  return { mirrored: true, activeChanged: false };
}
