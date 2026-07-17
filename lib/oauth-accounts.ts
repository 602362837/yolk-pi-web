/**
 * oauth-accounts — generic OAuth saved-account store
 *
 * Manages multiple saved OAuth accounts per provider.  Provider-specific
 * behaviour (credential shape, account-id derivation, label backfill, import)
 * lives in `oauth-account-providers.ts`; this module only implements the
 * shared storage, metadata, activation, and lifecycle logic.
 */

import { createHash, randomUUID } from "node:crypto";
import { access, chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { Credential } from "@earendil-works/pi-ai";
import { getOAuthApiKey } from "@/lib/pi-ai-oauth-compat";
import {
  getWebCredentialStore,
  type WebCredentialStore,
} from "@/lib/web-credential-store";

import {
  getOAuthAccountAdapter,
  ANTIGRAVITY_PROVIDER_ID,
  KIRO_PROVIDER_ID,
  maskAccountId,
  type OAuthAccountProviderAdapter,
} from "./oauth-account-providers";
import { withAntigravityProviderLock } from "./antigravity-account-lock";
import { withKiroProviderLock } from "./kiro-account-lock";

// Re-export for backward compatibility
export {
  OPENAI_CODEX_PROVIDER_ID,
  GROK_CLI_PROVIDER_ID,
  KIRO_PROVIDER_ID,
  ANTIGRAVITY_PROVIDER_ID,
  getOAuthAccountAdapter,
  isSupportedOAuthAccountProvider,
  maskAccountId,
} from "./oauth-account-providers";
export { extractOpenAICodexAccountId } from "./oauth-account-providers";
export type { OAuthAccountProviderAdapter } from "./oauth-account-providers";

import { convertOAuthAccountCredentialWithWarnings, type OAuthAccountImportMode, type OAuthAccountImportWarning } from "@/lib/oauth-account-converters";

// ─── Constants ───────────────────────────────────────────────────────────────

const ACCOUNT_STORE_DIR = "auth-accounts";
const METADATA_FILE = "accounts.json";
const JSON_FILE_MODE = 0o600;
const ACCOUNT_DIR_MODE = 0o700;
const DELETED_ACCOUNT_DIR = "deleted";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OAuthAccountQuotaCacheTier {
  name: string;
  utilization: number;
  resetsAt: string | null;
}

export interface OAuthAccountQuotaResetCredit {
  id: string;
  status: string;
  grantedAt: string;
  expiresAt: string;
}

export interface OAuthAccountQuotaCache {
  success: boolean;
  tiers: OAuthAccountQuotaCacheTier[];
  error: string | null;
  queriedAt: number | null;
  resetCreditsAvailableCount: number | null;
  resetCredits: OAuthAccountQuotaResetCredit[];
  resetCreditsError: string | null;
}

interface OAuthAccountMetadataEntry {
  /** Opaque storage id used as the file-system key. */
  accountId: string;
  /** Real/provider-native account identifier retained for diagnostics and outbound API calls. */
  chatgptAccountId?: string;
  label?: string;
  extraInfo?: string;
  quotaCache?: OAuthAccountQuotaCache;
  labelBackfillDisabledAt?: string;
  createdAt: string;
  updatedAt: string;
  lastActivatedAt?: string;
}

interface OAuthAccountStoreMetadata {
  version: 1 | 2;
  activeAccountId?: string;
  accounts: OAuthAccountMetadataEntry[];
}

export interface OAuthAccountSummary {
  accountId: string;
  label?: string;
  extraInfo?: string;
  quotaCache?: OAuthAccountQuotaCache;
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

export interface OAuthAccountImportResult extends OAuthAccountsList {
  /** Non-blocking conversion risks. Never contains credential material. */
  warnings: OAuthAccountImportWarning[];
}

/**
 * A saved OAuth credential returned by `readOAuthAccountCredential`.
 *
 * The `accountId` field is the provider-native real account id (ChatGPT account
 * id for openai-codex, refresh-derived hash for grok-cli/kiro).  The opaque storage
 * id is exposed as the non-enumerable `storageId` property.
 */
export interface SavedOAuthCredential extends Record<string, unknown> {
  access: string;
  refresh: string;
  expires: number;
  accountId: string;
}

interface SaveAccountOptions {
  markActive?: boolean;
  recordActivation?: boolean;
  /** Preserve the path of an existing saved account, including legacy v1 paths. */
  storageId?: string;
}

// ─── Error ───────────────────────────────────────────────────────────────────

export class OAuthAccountStoreError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "OAuthAccountStoreError";
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function getAdapter(provider: string): OAuthAccountProviderAdapter {
  try {
    return getOAuthAccountAdapter(provider);
  } catch (error) {
    throw new OAuthAccountStoreError(
      error instanceof Error ? error.message : `OAuth account management is unsupported for ${provider}`,
      400,
    );
  }
}

function accountStorePath(provider: string): string {
  getAdapter(provider); // validate provider
  return join(getAgentDir(), ACCOUNT_STORE_DIR, provider);
}

function metadataPath(provider: string): string {
  return join(accountStorePath(provider), METADATA_FILE);
}

function encodedCredentialFileName(accountId: string): string {
  return `${encodeURIComponent(accountId)}.json`;
}

function credentialPath(provider: string, accountId: string): string {
  return join(accountStorePath(provider), encodedCredentialFileName(accountId));
}

function deletedAccountStorePath(provider: string): string {
  return join(accountStorePath(provider), DELETED_ACCOUNT_DIR);
}

function deletedCredentialPath(provider: string, accountId: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return join(deletedAccountStorePath(provider), `${timestamp}_${encodedCredentialFileName(accountId)}`);
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

async function ensureDeletedAccountStoreDir(provider: string): Promise<void> {
  const dir = deletedAccountStorePath(provider);
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

// ─── Metadata normalization ──────────────────────────────────────────────────

function normalizeQuotaResetCredit(value: unknown): OAuthAccountQuotaResetCredit | null {
  if (!isRecord(value)) return null;
  return {
    id: typeof value.id === "string" ? value.id : "",
    status: typeof value.status === "string" ? value.status : "available",
    grantedAt: typeof value.grantedAt === "string" ? value.grantedAt : "",
    expiresAt: typeof value.expiresAt === "string" ? value.expiresAt : "",
  };
}

function normalizeQuotaCache(value: unknown): OAuthAccountQuotaCache | undefined {
  if (!isRecord(value)) return undefined;
  const tiers = Array.isArray(value.tiers)
    ? value.tiers.filter(isRecord).map((tier) => ({
      name: typeof tier.name === "string" ? tier.name : "unknown",
      utilization: typeof tier.utilization === "number" && Number.isFinite(tier.utilization) ? tier.utilization : 0,
      resetsAt: typeof tier.resetsAt === "string" ? tier.resetsAt : null,
    }))
    : [];
  const resetCredits = Array.isArray(value.resetCredits)
    ? value.resetCredits.map(normalizeQuotaResetCredit).filter((credit): credit is OAuthAccountQuotaResetCredit => Boolean(credit))
    : [];

  return {
    success: value.success === true,
    tiers,
    error: typeof value.error === "string" ? value.error : null,
    queriedAt: typeof value.queriedAt === "number" && Number.isFinite(value.queriedAt) ? value.queriedAt : null,
    resetCreditsAvailableCount: typeof value.resetCreditsAvailableCount === "number" && Number.isFinite(value.resetCreditsAvailableCount) ? value.resetCreditsAvailableCount : null,
    resetCredits,
    resetCreditsError: typeof value.resetCreditsError === "string" ? value.resetCreditsError : null,
  };
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
  if (typeof value.chatgptAccountId === "string" && value.chatgptAccountId.trim()) entry.chatgptAccountId = value.chatgptAccountId.trim();
  if (typeof value.label === "string" && value.label.trim()) entry.label = value.label.trim();
  if (typeof value.extraInfo === "string" && value.extraInfo.trim()) entry.extraInfo = value.extraInfo.trim();
  const quotaCache = normalizeQuotaCache(value.quotaCache);
  if (quotaCache) entry.quotaCache = quotaCache;
  if (typeof value.labelBackfillDisabledAt === "string" && value.labelBackfillDisabledAt.trim()) entry.labelBackfillDisabledAt = value.labelBackfillDisabledAt;
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

  const version = value.version === 2 ? 2 : 1;
  return { version, activeAccountId, accounts };
}

async function readMetadata(provider: string): Promise<OAuthAccountStoreMetadata> {
  return normalizeMetadata(await readJsonFile(metadataPath(provider), "OAuth account metadata"));
}

async function writeMetadata(provider: string, metadata: OAuthAccountStoreMetadata): Promise<void> {
  await writeJsonFile(provider, metadataPath(provider), metadata);
}

// ─── Credential identity helpers ─────────────────────────────────────────────

function createStorageId(): string {
  try {
    return `acct_${randomUUID()}`;
  } catch {
    return `acct_${Date.now().toString(36)}_${createHash("sha256").update(`${Math.random()}-${process.pid}`).digest("hex").slice(0, 20)}`;
  }
}

async function allocateStorageId(provider: string): Promise<string> {
  for (;;) {
    const storageId = createStorageId();
    if (!(await pathExists(credentialPath(provider, storageId)))) return storageId;
  }
}

function normalizeStorageId(value: string | undefined): string | undefined {
  const storageId = value?.trim();
  return storageId || undefined;
}

/** Attach a non-enumerable `storageId` property so it never leaks into serialized credential JSON. */
function withStorageId(credential: Record<string, unknown>, storageId: string): SavedOAuthCredential {
  Object.defineProperty(credential, "storageId", { value: storageId, enumerable: false });
  return credential as SavedOAuthCredential;
}

function credentialStorageId(credential: SavedOAuthCredential): string | undefined {
  const candidate = (credential as SavedOAuthCredential & { storageId?: unknown }).storageId;
  return typeof candidate === "string" ? normalizeStorageId(candidate) : undefined;
}

// ─── Metadata management ─────────────────────────────────────────────────────

function upsertMetadataAccount(
  metadata: OAuthAccountStoreMetadata,
  storageId: string,
  realAccountId: string,
  options: SaveAccountOptions,
): OAuthAccountStoreMetadata {
  const now = new Date().toISOString();
  const existing = metadata.accounts.find((entry) => entry.accountId === storageId);
  const nextEntry: OAuthAccountMetadataEntry = existing
    ? { ...existing, chatgptAccountId: realAccountId, updatedAt: now }
    : { accountId: storageId, chatgptAccountId: realAccountId, createdAt: now, updatedAt: now };

  if (options.markActive && (options.recordActivation || !nextEntry.lastActivatedAt)) {
    nextEntry.lastActivatedAt = now;
  }

  const accounts = existing
    ? metadata.accounts.map((entry) => entry.accountId === storageId ? nextEntry : entry)
    : [...metadata.accounts, nextEntry];

  return {
    version: 2,
    accounts,
    activeAccountId: options.markActive ? storageId : metadata.activeAccountId,
  };
}

function accountSummary(metadata: OAuthAccountStoreMetadata, entry: OAuthAccountMetadataEntry): OAuthAccountSummary {
  const realAccountId = entry.chatgptAccountId ?? entry.accountId;
  const masked = maskAccountId(realAccountId);
  return {
    accountId: entry.accountId,
    label: entry.label,
    extraInfo: entry.extraInfo,
    quotaCache: entry.quotaCache,
    displayName: entry.label ?? masked,
    maskedAccountId: masked,
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

// ─── Label backfill ──────────────────────────────────────────────────────────

async function backfillMissingAccountLabels(
  provider: string,
  adapter: OAuthAccountProviderAdapter,
  accounts: OAuthAccountMetadataEntry[],
): Promise<{ accounts: OAuthAccountMetadataEntry[]; changed: boolean }> {
  if (!adapter.backfillLabel) return { accounts, changed: false };

  let changed = false;
  const nextAccounts: OAuthAccountMetadataEntry[] = [];

  for (const entry of accounts) {
    if (entry.label || entry.labelBackfillDisabledAt) {
      nextAccounts.push(entry);
      continue;
    }

    const credential = await readJsonFile(credentialPath(provider, entry.accountId), "OAuth account credential");
    if (!adapter.isCredential(credential)) {
      nextAccounts.push(entry);
      continue;
    }

    const cred = credential as Record<string, unknown>;
    const label = await adapter.backfillLabel(
      typeof cred.access === "string" ? cred.access : "",
      entry.chatgptAccountId ?? entry.accountId,
    );
    if (!label) {
      nextAccounts.push(entry);
      continue;
    }

    nextAccounts.push({ ...entry, label, updatedAt: new Date().toISOString() });
    changed = true;
  }

  return { accounts: nextAccounts, changed };
}

async function clearActiveAccount(provider: string): Promise<void> {
  const path = metadataPath(provider);
  if (!(await pathExists(path))) return;

  const metadata = await readMetadata(provider);
  if (!metadata.activeAccountId) return;

  await writeMetadata(provider, { ...metadata, activeAccountId: undefined });
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Read a saved OAuth credential by its opaque storage id.
 *
 * The returned credential has `accountId` set to the provider-native real
 * account id (ChatGPT account id for openai-codex, refresh-derived hash for
 * grok-cli/kiro) and a non-enumerable `storageId` property for the opaque key.
 */
export async function readOAuthAccountCredential(
  provider: string,
  storageId: string,
): Promise<SavedOAuthCredential> {
  if (!storageId.trim()) throw new OAuthAccountStoreError("accountId is required", 400);

  const adapter = getAdapter(provider);
  const credential = await readJsonFile(credentialPath(provider, storageId), "OAuth account credential");
  if (!credential) throw new OAuthAccountStoreError("Saved OAuth account not found", 404);
  if (!adapter.isCredential(credential)) {
    throw new OAuthAccountStoreError("Saved OAuth account credential is invalid", 500);
  }
  const cred = credential as Record<string, unknown>;
  const accountId = adapter.deriveRealAccountId(cred);
  return withStorageId({ ...cred, accountId }, storageId);
}

/**
 * Resolve an access token for a saved account, refreshing when necessary.
 *
 * Extension providers (Grok/Kiro/Antigravity) use the public OAuth compatibility
 * helper after fixed-provider preload. Builtin OAuth providers (openai-codex)
 * use an isolated ModelRuntime with an in-memory credential so Active is not
 * overwritten when refreshing a non-active saved account.
 */
export async function getOAuthAccountAccessToken(
  provider: string,
  credential: SavedOAuthCredential,
): Promise<string | undefined> {
  getAdapter(provider); // validate provider
  if (Date.now() >= credential.expires && !credential.refresh.trim()) {
    throw new Error("OAuth access token expired and no refresh token is available. Please re-import the credential or log in again.");
  }

  // Prefer legacy compatibility refresh for third-party extension providers.
  // Do not overwrite an already-registered mock/provider table entry.
  const { getOAuthProvider } = await import("./pi-ai-oauth-compat");
  if (!getOAuthProvider(provider)) {
    const { ensureWebProvidersBootstrapped } = await import("./pi-provider-extensions");
    await ensureWebProvidersBootstrapped();
  }
  const compatResult = await getOAuthApiKey(provider, { [provider]: credential }).catch(() => null);
  if (compatResult?.apiKey) {
    await saveOAuthAccountCredential(provider, { ...credential, ...compatResult.newCredentials }, {
      storageId: credentialStorageId(credential),
    }).catch(() => {});
    return compatResult.apiKey;
  }

  // Builtin OAuth path (e.g. openai-codex): isolated runtime + in-memory store.
  const { createInMemoryWebCredentialStore } = await import("./web-credential-store");
  const { createWebModelRuntime } = await import("./web-model-runtime");
  const memory = createInMemoryWebCredentialStore({
    [provider]: { type: "oauth", ...credential } as unknown as Credential,
  });
  const runtime = await createWebModelRuntime({ credentials: memory });
  const auth = await runtime.getAuth(provider);
  const apiKey = auth?.auth.apiKey;
  if (!apiKey) return undefined;

  // If runtime refreshed the token, persist the new credential back to the account file.
  const refreshed = await memory.read(provider);
  if (refreshed && refreshed.type === "oauth") {
    await saveOAuthAccountCredential(provider, refreshed, {
      storageId: credentialStorageId(credential),
    }).catch(() => {});
  }
  return apiKey;
}

/**
 * Save an OAuth credential as a managed saved account.
 *
 * Each call allocates an opaque storage id (unless `options.storageId`
 * overrides it for in-place refresh updates).  The adapter validates the
 * credential shape and derives the real account id for metadata.
 */
export async function saveOAuthAccountCredential(
  provider: string,
  credential: unknown,
  options: SaveAccountOptions = {},
): Promise<OAuthAccountSummary> {
  const adapter = getAdapter(provider);
  if (!adapter.isCredential(credential)) {
    throw new OAuthAccountStoreError("Expected an OAuth credential for the account store", 400);
  }

  const cred = credential as Record<string, unknown>;
  const realAccountId = adapter.deriveRealAccountId(cred);
  const storageId = normalizeStorageId(options.storageId) ?? await allocateStorageId(provider);
  // Write the credential as-is — the adapter's real account id is stored in
  // metadata only, never injected into the credential file.
  await writeJsonFile(provider, credentialPath(provider, storageId), cred);

  const metadata = upsertMetadataAccount(await readMetadata(provider), storageId, realAccountId, options);
  await writeMetadata(provider, metadata);

  const entry = metadata.accounts.find((account) => account.accountId === storageId);
  if (!entry) throw new OAuthAccountStoreError("Saved OAuth account metadata is invalid", 500);
  return accountSummary(metadata, entry);
}

/**
 * Sync the active credential from auth.json (via CredentialStore) into the
 * saved-account store.  Returns the active account summary, or null if
 * no valid credential exists.
 */
export async function syncActiveOAuthAccountCredential(
  provider: string,
  credentials?: WebCredentialStore | { read(providerId: string): Promise<Credential | undefined> },
): Promise<OAuthAccountSummary | null> {
  const adapter = getAdapter(provider);
  const store = credentials ?? await getWebCredentialStore();
  const credential = await store.read(provider);
  if (!adapter.isCredential(credential)) {
    await clearActiveAccount(provider);
    return null;
  }

  // Active auth.json holds a plain Pi credential without a storage id.
  // The active metadata pointer is authoritative for an existing managed account.
  const metadata = await readMetadata(provider);
  const activeStorageId = metadata.activeAccountId && await pathExists(credentialPath(provider, metadata.activeAccountId))
    ? metadata.activeAccountId
    : undefined;
  return saveOAuthAccountCredential(provider, credential, { markActive: true, storageId: activeStorageId });
}

/**
 * Import one or more OAuth credentials from external formats (raw / CPA / sub2api).
 *
 * Only providers whose adapter declares `supportsCredentialImport: true` accept
 * this operation; grok-cli and kiro return a client error.
 */
export async function importOAuthAccountCredential(
  provider: string,
  mode: OAuthAccountImportMode,
  credential: unknown,
): Promise<OAuthAccountImportResult> {
  const adapter = getAdapter(provider);
  if (!adapter.supportsCredentialImport) {
    throw new OAuthAccountStoreError(
      `Credential import is not supported for ${provider}. Use OAuth login instead.`,
      400,
    );
  }

  let rawCredentials: Record<string, unknown>[];
  let warnings: OAuthAccountImportWarning[];
  try {
    const converted = convertOAuthAccountCredentialWithWarnings(mode, credential);
    rawCredentials = converted.credentials;
    warnings = converted.warnings;
  } catch (error) {
    throw new OAuthAccountStoreError(error instanceof Error ? error.message : "Invalid OAuth account credential", 400);
  }

  // Validate every item before allocating paths or creating any files.
  const normalizedCredentials = rawCredentials.map((rawCredential, index) => {
    if (!adapter.isCredential(rawCredential)) {
      throw new OAuthAccountStoreError(`Expected OAuth credential JSON with type, access, refresh, and expires at account ${index + 1}`, 400);
    }
    return { credential: rawCredential, realAccountId: adapter.deriveRealAccountId(rawCredential) };
  });

  const storageIds = await Promise.all(normalizedCredentials.map(() => allocateStorageId(provider)));
  const writtenPaths: string[] = [];
  try {
    for (let index = 0; index < normalizedCredentials.length; index += 1) {
      const path = credentialPath(provider, storageIds[index]);
      await writeJsonFile(provider, path, normalizedCredentials[index].credential);
      writtenPaths.push(path);
    }

    let metadata = await readMetadata(provider);
    for (let index = 0; index < normalizedCredentials.length; index += 1) {
      metadata = upsertMetadataAccount(metadata, storageIds[index], normalizedCredentials[index].realAccountId, {});
    }
    await writeMetadata(provider, metadata);
  } catch (error) {
    await Promise.all(writtenPaths.map((path) => unlink(path).catch(() => {})));
    throw new OAuthAccountStoreError(error instanceof Error ? error.message : "Failed to save OAuth account credentials", 500);
  }

  return { ...await listOAuthAccounts(provider), warnings };
}

/**
 * List all saved OAuth accounts for a provider, sorted active-first then by
 * last-activated / updated-at descending.
 */
export async function listOAuthAccounts(provider: string): Promise<OAuthAccountsList> {
  const adapter = getAdapter(provider);
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

  const backfilled = await backfillMissingAccountLabels(provider, adapter, existingAccounts);
  if (backfilled.changed) changed = true;

  const activeAccountId = metadata.activeAccountId && backfilled.accounts.some((entry) => entry.accountId === metadata.activeAccountId)
    ? metadata.activeAccountId
    : undefined;
  if (activeAccountId !== metadata.activeAccountId) changed = true;

  const nextMetadata: OAuthAccountStoreMetadata = { version: metadata.version, activeAccountId, accounts: backfilled.accounts };
  if (changed) await writeMetadata(provider, nextMetadata);

  return {
    provider,
    activeAccountId: activeAccountId ?? null,
    accounts: sortAccountSummaries(backfilled.accounts.map((entry) => accountSummary(nextMetadata, entry))),
  };
}

/**
 * Update mutable metadata (label, extraInfo) for a saved account.
 */
export async function updateOAuthAccountMetadata(
  provider: string,
  accountId: string,
  updates: { label?: unknown; extraInfo?: unknown },
): Promise<OAuthAccountsList> {
  getAdapter(provider);
  const normalizedAccountId = accountId.trim();
  if (!normalizedAccountId) throw new OAuthAccountStoreError("accountId is required", 400);
  if (!(await pathExists(credentialPath(provider, normalizedAccountId)))) {
    throw new OAuthAccountStoreError("Saved OAuth account not found", 404);
  }

  const metadata = await readMetadata(provider);
  let found = false;
  const now = new Date().toISOString();
  const accounts = metadata.accounts.map((entry) => {
    if (entry.accountId !== normalizedAccountId) return entry;
    found = true;
    const nextEntry: OAuthAccountMetadataEntry = { ...entry, updatedAt: now };
    if ("label" in updates) {
      const normalizedLabel = typeof updates.label === "string" ? updates.label.trim() : "";
      if (normalizedLabel) {
        nextEntry.label = normalizedLabel;
        delete nextEntry.labelBackfillDisabledAt;
      } else {
        delete nextEntry.label;
        nextEntry.labelBackfillDisabledAt = now;
      }
    }
    if ("extraInfo" in updates) {
      const normalizedExtraInfo = typeof updates.extraInfo === "string" ? updates.extraInfo.trim() : "";
      if (normalizedExtraInfo) nextEntry.extraInfo = normalizedExtraInfo;
      else delete nextEntry.extraInfo;
    }
    return nextEntry;
  });

  if (!found) throw new OAuthAccountStoreError("Saved OAuth account metadata not found", 404);
  await writeMetadata(provider, { ...metadata, accounts });
  return listOAuthAccounts(provider);
}

export async function updateOAuthAccountLabel(provider: string, accountId: string, label: unknown): Promise<OAuthAccountsList> {
  return updateOAuthAccountMetadata(provider, accountId, { label });
}

/**
 * Persist quota cache for a specific saved account.  No-op if the account
 * does not exist.
 */
export async function updateOAuthAccountQuotaCache(
  provider: string,
  accountId: string,
  quotaCache: OAuthAccountQuotaCache,
): Promise<void> {
  getAdapter(provider);
  const normalizedAccountId = accountId.trim();
  if (!normalizedAccountId) return;
  const metadata = await readMetadata(provider);
  const now = new Date().toISOString();
  let changed = false;
  const accounts = metadata.accounts.map((entry) => {
    if (entry.accountId !== normalizedAccountId) return entry;
    changed = true;
    return { ...entry, quotaCache, updatedAt: now };
  });
  if (changed) await writeMetadata(provider, { ...metadata, accounts });
}

/**
 * Delete a saved account.
 *
 * The active account cannot be deleted — callers must activate a different
 * account or disconnect the provider first.  The credential file is moved to
 * a `deleted/` subdirectory for recovery.
 */
export async function deleteOAuthAccount(provider: string, accountId: string): Promise<OAuthAccountsList> {
  getAdapter(provider);
  const normalizedAccountId = accountId.trim();
  if (!normalizedAccountId) throw new OAuthAccountStoreError("accountId is required", 400);

  await syncActiveOAuthAccountCredential(provider);
  const metadata = await readMetadata(provider);
  if (metadata.activeAccountId === normalizedAccountId) {
    throw new OAuthAccountStoreError("Active OAuth account cannot be deleted", 409);
  }

  const sourcePath = credentialPath(provider, normalizedAccountId);
  if (!(await pathExists(sourcePath))) throw new OAuthAccountStoreError("Saved OAuth account not found", 404);

  await ensureDeletedAccountStoreDir(provider);
  await rename(sourcePath, deletedCredentialPath(provider, normalizedAccountId));

  const accounts = metadata.accounts.filter((entry) => entry.accountId !== normalizedAccountId);
  await writeMetadata(provider, { ...metadata, accounts });
  return listOAuthAccounts(provider);
}

/**
 * Activate a saved account so it becomes the default for new sessions and
 * is mirrored to `auth.json` for Pi's model availability checks.
 *
 * For Kiro and Antigravity, Activate shares the provider-level lock with token
 * refresh so a concurrent non-active refresh cannot overwrite the newly
 * activated mirror.
 */
export async function activateOAuthAccount(provider: string, accountId: string): Promise<OAuthAccountsList> {
  getAdapter(provider);
  const normalizedAccountId = accountId.trim();
  if (!normalizedAccountId) throw new OAuthAccountStoreError("accountId is required", 400);

  const run = async (): Promise<OAuthAccountsList> => {
    const store = await getWebCredentialStore();
    await syncActiveOAuthAccountCredential(provider, store);

    const credential = await readOAuthAccountCredential(provider, normalizedAccountId);
    // CredentialStore expects type:"oauth" for OAuth entries. grok-cli / kiro /
    // antigravity credentials from their providers lack this sentinel but are
    // otherwise compatible with Pi's OAuth credential contract.
    const authCredential = (credential as Record<string, unknown>).type
      ? credential
      : { ...credential, type: "oauth" as const };
    try {
      await store.modify(provider, async () => authCredential as unknown as Credential);
    } catch {
      throw new OAuthAccountStoreError("Failed to update active OAuth credential", 500);
    }
    await saveOAuthAccountCredential(provider, credential, {
      markActive: true,
      recordActivation: true,
      storageId: normalizedAccountId,
    });

    return listOAuthAccounts(provider);
  };

  if (provider === KIRO_PROVIDER_ID) {
    return withKiroProviderLock(run);
  }
  if (provider === ANTIGRAVITY_PROVIDER_ID) {
    return withAntigravityProviderLock(run);
  }
  return run();
}
