/**
 * Low-level Grok Active credential transaction primitives.
 *
 * Callers must already hold `withGrokProviderLock()`. The managed Active slot
 * is authoritative; auth.json is only the Pi-compatible mirror, so a mirror
 * write failure never rolls a rotated slot back to an old refresh token.
 */

import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import type { Credential } from "@earendil-works/pi-ai";
import { GROK_CLI_PROVIDER_ID } from "./oauth-account-providers";
import type { WebCredentialStore } from "./web-credential-store";

const ACCOUNT_STORE_DIR = "auth-accounts";
const METADATA_FILE = "accounts.json";
const ACCOUNT_DIR_MODE = 0o700;
const JSON_FILE_MODE = 0o600;

type AccountMetadata = {
  activeAccountId?: string;
  accounts: unknown[];
};

export type GrokActiveSnapshot = {
  storageId: string;
  credential: Credential;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function accountDirFor(rawStore: WebCredentialStore): string {
  return join(dirname(rawStore.authPath), ACCOUNT_STORE_DIR, GROK_CLI_PROVIDER_ID);
}

function credentialPath(accountDir: string, storageId: string): string {
  return join(accountDir, `${encodeURIComponent(storageId)}.json`);
}

function asOAuthCredential(value: unknown): Credential | null {
  if (!isRecord(value)) return null;
  if (typeof value.access !== "string" || typeof value.refresh !== "string") return null;
  if (typeof value.expires !== "number" || !Number.isFinite(value.expires)) return null;
  return { ...value, type: "oauth" } as Credential;
}

async function readMetadata(accountDir: string): Promise<AccountMetadata | null> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(join(accountDir, METADATA_FILE), "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return null;
    throw new Error("Grok account metadata is invalid");
  }
  if (!isRecord(raw) || !Array.isArray(raw.accounts)) {
    throw new Error("Grok account metadata is invalid");
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
export async function readGrokActiveSnapshot(
  rawStore: WebCredentialStore,
): Promise<GrokActiveSnapshot | null> {
  const accountDir = accountDirFor(rawStore);
  const metadata = await readMetadata(accountDir);
  const storageId = metadata?.activeAccountId;
  if (!storageId) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(credentialPath(accountDir, storageId), "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return null;
    throw new Error("Grok Active credential is unreadable");
  }
  const credential = asOAuthCredential(raw);
  if (!credential) throw new Error("Grok Active credential is invalid");
  return { storageId, credential };
}

/** Same read primitive, named to make lock ownership explicit at writers. */
export const readGrokActiveSnapshotUnderLock = readGrokActiveSnapshot;

async function atomicWriteSlot(accountDir: string, storageId: string, credential: Credential): Promise<void> {
  await mkdir(accountDir, { recursive: true, mode: ACCOUNT_DIR_MODE });
  const target = credentialPath(accountDir, storageId);
  const temp = `${target}.tmp.${process.pid}.${randomBytes(6).toString("hex")}`;
  // The slot format intentionally remains provider-native; `type` is Pi's
  // auth.json sentinel and is not required by the managed-account adapter.
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

export type CommitGrokCredentialResult = {
  mirrored: boolean;
  activeChanged: boolean;
};

/**
 * Persist a refreshed slot first, then re-read the Active pointer and mirror
 * auth.json only if that exact slot is still Active. This function deliberately
 * does not catch auth mirror errors: the durable slot is retained for recovery.
 */
export async function commitGrokCredentialUnderLock(input: {
  rawStore: WebCredentialStore;
  storageId: string;
  credential: Credential;
}): Promise<CommitGrokCredentialResult> {
  const accountDir = accountDirFor(input.rawStore);
  await atomicWriteSlot(accountDir, input.storageId, input.credential);

  const current = await readGrokActiveSnapshotUnderLock(input.rawStore);
  if (!current || current.storageId !== input.storageId) {
    return { mirrored: false, activeChanged: true };
  }

  // Provider lock is held before this obtains WebCredentialStore's auth lock.
  await input.rawStore.modify(GROK_CLI_PROVIDER_ID, async () => input.credential);
  return { mirrored: true, activeChanged: false };
}
