import { createHash } from "node:crypto";
import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AuthStorage, getAgentDir, type OAuthCredential } from "@earendil-works/pi-coding-agent";

export const OPENAI_CODEX_PROVIDER_ID = "openai-codex";

const ACCOUNT_STORE_DIR = "auth-accounts";
const METADATA_FILE = "accounts.json";
const JSON_FILE_MODE = 0o600;
const ACCOUNT_DIR_MODE = 0o700;

interface StoredOpenAICodexCredential extends OAuthCredential {
  type: "oauth";
  access: string;
  refresh: string;
  expires: number;
  accountId?: string;
  [key: string]: unknown;
}

type NormalizedOpenAICodexCredential = StoredOpenAICodexCredential & { accountId: string };

interface OAuthAccountMetadataEntry {
  accountId: string;
  label?: string;
  createdAt: string;
  updatedAt: string;
  lastActivatedAt?: string;
}

interface OAuthAccountStoreMetadata {
  version: 1;
  activeAccountId?: string;
  accounts: OAuthAccountMetadataEntry[];
}

export interface OAuthAccountSummary {
  accountId: string;
  label?: string;
  displayName: string;
  maskedAccountId: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  lastActivatedAt: string | null;
}

export interface OAuthAccountsList {
  provider: string;
  activeAccountId: string | null;
  accounts: OAuthAccountSummary[];
}

interface SaveAccountOptions {
  markActive?: boolean;
  recordActivation?: boolean;
}

export class OAuthAccountStoreError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "OAuthAccountStoreError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function assertSupportedProvider(provider: string): void {
  if (provider !== OPENAI_CODEX_PROVIDER_ID) {
    throw new OAuthAccountStoreError(`OAuth account switching is only supported for ${OPENAI_CODEX_PROVIDER_ID}`, 400);
  }
}

function accountStorePath(provider: string): string {
  assertSupportedProvider(provider);
  return join(getAgentDir(), ACCOUNT_STORE_DIR, provider);
}

function metadataPath(provider: string): string {
  return join(accountStorePath(provider), METADATA_FILE);
}

function credentialPath(provider: string, accountId: string): string {
  return join(accountStorePath(provider), `${encodeURIComponent(accountId)}.json`);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

async function ensureAccountStoreDir(provider: string): Promise<void> {
  const dir = accountStorePath(provider);
  await mkdir(dir, { recursive: true, mode: ACCOUNT_DIR_MODE });
  await chmod(dir, ACCOUNT_DIR_MODE).catch(() => {});
}

async function readJsonFile(path: string, description: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw new OAuthAccountStoreError(`Failed to read ${description}`, 500);
  }
}

async function writeJsonFile(provider: string, path: string, value: unknown): Promise<void> {
  await ensureAccountStoreDir(provider);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: JSON_FILE_MODE });
  await chmod(path, JSON_FILE_MODE).catch(() => {});
}

function normalizeAccountEntry(value: unknown): OAuthAccountMetadataEntry | null {
  if (!isRecord(value)) return null;
  if (typeof value.accountId !== "string" || value.accountId.trim().length === 0) return null;
  if (typeof value.createdAt !== "string" || typeof value.updatedAt !== "string") return null;

  const entry: OAuthAccountMetadataEntry = {
    accountId: value.accountId,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
  if (typeof value.label === "string" && value.label.trim()) entry.label = value.label.trim();
  if (typeof value.lastActivatedAt === "string" && value.lastActivatedAt.trim()) entry.lastActivatedAt = value.lastActivatedAt;
  return entry;
}

function normalizeMetadata(value: unknown): OAuthAccountStoreMetadata {
  if (!isRecord(value)) return { version: 1, accounts: [] };

  const accounts = Array.isArray(value.accounts)
    ? value.accounts.map(normalizeAccountEntry).filter((entry): entry is OAuthAccountMetadataEntry => Boolean(entry))
    : [];
  const activeAccountId = typeof value.activeAccountId === "string" && value.activeAccountId.trim()
    ? value.activeAccountId
    : undefined;

  return { version: 1, activeAccountId, accounts };
}

async function readMetadata(provider: string): Promise<OAuthAccountStoreMetadata> {
  return normalizeMetadata(await readJsonFile(metadataPath(provider), "OAuth account metadata"));
}

async function writeMetadata(provider: string, metadata: OAuthAccountStoreMetadata): Promise<void> {
  await writeJsonFile(provider, metadataPath(provider), metadata);
}

function isStoredOpenAICodexCredential(value: unknown): value is StoredOpenAICodexCredential {
  return isRecord(value)
    && value.type === "oauth"
    && typeof value.access === "string"
    && typeof value.refresh === "string"
    && typeof value.expires === "number";
}

export function extractOpenAICodexAccountId(accessToken: string): string | null {
  const [, payload] = accessToken.split(".");
  if (!payload) return null;

  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as {
      "https://api.openai.com/auth"?: { chatgpt_account_id?: unknown };
    };
    const accountId = decoded["https://api.openai.com/auth"]?.chatgpt_account_id;
    return typeof accountId === "string" && accountId.length > 0 ? accountId : null;
  } catch {
    return null;
  }
}

function deriveAccountId(credential: StoredOpenAICodexCredential): string {
  if (typeof credential.accountId === "string" && credential.accountId.trim()) return credential.accountId.trim();

  const tokenAccountId = extractOpenAICodexAccountId(credential.access);
  if (tokenAccountId) return tokenAccountId;

  const hash = createHash("sha256")
    .update(credential.refresh)
    .update("\0")
    .update(credential.access)
    .digest("hex")
    .slice(0, 16);
  return `unknown-${hash}`;
}

function normalizeCredentialAccountId(credential: StoredOpenAICodexCredential): NormalizedOpenAICodexCredential {
  return { ...credential, accountId: deriveAccountId(credential) };
}

function upsertMetadataAccount(
  metadata: OAuthAccountStoreMetadata,
  accountId: string,
  options: SaveAccountOptions,
): OAuthAccountStoreMetadata {
  const now = new Date().toISOString();
  const existing = metadata.accounts.find((entry) => entry.accountId === accountId);
  const nextEntry: OAuthAccountMetadataEntry = existing
    ? { ...existing, updatedAt: now }
    : { accountId, createdAt: now, updatedAt: now };

  if (options.markActive && (options.recordActivation || !nextEntry.lastActivatedAt)) {
    nextEntry.lastActivatedAt = now;
  }

  const accounts = existing
    ? metadata.accounts.map((entry) => entry.accountId === accountId ? nextEntry : entry)
    : [...metadata.accounts, nextEntry];

  return {
    version: 1,
    accounts,
    activeAccountId: options.markActive ? accountId : metadata.activeAccountId,
  };
}

function maskAccountId(accountId: string): string {
  if (accountId.length <= 10) return accountId;
  return `${accountId.slice(0, 6)}…${accountId.slice(-4)}`;
}

function accountSummary(metadata: OAuthAccountStoreMetadata, entry: OAuthAccountMetadataEntry): OAuthAccountSummary {
  const maskedAccountId = maskAccountId(entry.accountId);
  return {
    accountId: entry.accountId,
    label: entry.label,
    displayName: entry.label ?? `Account ${maskedAccountId}`,
    maskedAccountId,
    active: metadata.activeAccountId === entry.accountId,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    lastActivatedAt: entry.lastActivatedAt ?? null,
  };
}

function sortAccountSummaries(accounts: OAuthAccountSummary[]): OAuthAccountSummary[] {
  return [...accounts].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    const aTime = a.lastActivatedAt ?? a.updatedAt;
    const bTime = b.lastActivatedAt ?? b.updatedAt;
    return bTime.localeCompare(aTime);
  });
}

async function clearActiveAccount(provider: string): Promise<void> {
  const path = metadataPath(provider);
  if (!(await pathExists(path))) return;

  const metadata = await readMetadata(provider);
  if (!metadata.activeAccountId) return;

  await writeMetadata(provider, { ...metadata, activeAccountId: undefined });
}

async function readAccountCredential(provider: string, accountId: string): Promise<NormalizedOpenAICodexCredential> {
  if (!accountId.trim()) throw new OAuthAccountStoreError("accountId is required", 400);

  const credential = await readJsonFile(credentialPath(provider, accountId), "OAuth account credential");
  if (!credential) throw new OAuthAccountStoreError("Saved OAuth account not found", 404);
  if (!isStoredOpenAICodexCredential(credential)) {
    throw new OAuthAccountStoreError("Saved OAuth account credential is invalid", 500);
  }
  return normalizeCredentialAccountId(credential);
}

export async function saveOAuthAccountCredential(
  provider: string,
  credential: unknown,
  options: SaveAccountOptions = {},
): Promise<OAuthAccountSummary> {
  assertSupportedProvider(provider);
  if (!isStoredOpenAICodexCredential(credential)) {
    throw new OAuthAccountStoreError("Expected an OAuth credential for the account store", 400);
  }

  const normalizedCredential = normalizeCredentialAccountId(credential);
  const accountId = normalizedCredential.accountId;
  await writeJsonFile(provider, credentialPath(provider, accountId), normalizedCredential);

  const metadata = upsertMetadataAccount(await readMetadata(provider), accountId, options);
  await writeMetadata(provider, metadata);

  const entry = metadata.accounts.find((account) => account.accountId === accountId);
  if (!entry) throw new OAuthAccountStoreError("Saved OAuth account metadata is invalid", 500);
  return accountSummary(metadata, entry);
}

export async function syncActiveOAuthAccountCredential(
  provider: string,
  authStorage = AuthStorage.create(),
): Promise<OAuthAccountSummary | null> {
  assertSupportedProvider(provider);
  const credential = authStorage.get(provider);
  if (!isStoredOpenAICodexCredential(credential)) {
    await clearActiveAccount(provider);
    return null;
  }

  return saveOAuthAccountCredential(provider, credential, { markActive: true });
}

export async function listOAuthAccounts(provider: string): Promise<OAuthAccountsList> {
  assertSupportedProvider(provider);
  await syncActiveOAuthAccountCredential(provider);

  const metadata = await readMetadata(provider);
  const existingAccounts: OAuthAccountMetadataEntry[] = [];
  let changed = false;

  for (const entry of metadata.accounts) {
    if (await pathExists(credentialPath(provider, entry.accountId))) {
      existingAccounts.push(entry);
    } else {
      changed = true;
    }
  }

  const activeAccountId = metadata.activeAccountId && existingAccounts.some((entry) => entry.accountId === metadata.activeAccountId)
    ? metadata.activeAccountId
    : undefined;
  if (activeAccountId !== metadata.activeAccountId) changed = true;

  const nextMetadata = { version: 1 as const, activeAccountId, accounts: existingAccounts };
  if (changed) await writeMetadata(provider, nextMetadata);

  return {
    provider,
    activeAccountId: activeAccountId ?? null,
    accounts: sortAccountSummaries(existingAccounts.map((entry) => accountSummary(nextMetadata, entry))),
  };
}

export async function activateOAuthAccount(provider: string, accountId: string): Promise<OAuthAccountsList> {
  assertSupportedProvider(provider);
  const normalizedAccountId = accountId.trim();
  if (!normalizedAccountId) throw new OAuthAccountStoreError("accountId is required", 400);

  const authStorage = AuthStorage.create();
  await syncActiveOAuthAccountCredential(provider, authStorage);

  const credential = await readAccountCredential(provider, normalizedAccountId);
  authStorage.set(provider, credential);
  if (authStorage.drainErrors().length > 0) {
    throw new OAuthAccountStoreError("Failed to update active OAuth credential", 500);
  }
  await saveOAuthAccountCredential(provider, credential, { markActive: true, recordActivation: true });

  return listOAuthAccounts(provider);
}
