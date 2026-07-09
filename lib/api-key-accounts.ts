/**
 * Provider-scoped API-key multi-account storage and active mirror service layer.
 *
 * Manages multiple API Key "accounts" per provider (v1: opencode-go only) in a
 * dedicated application-managed directory, keeping upstream pi SDK / AuthStorage
 * unaware of multi-account semantics.  The currently active credential is always
 * mirrored back to `auth.json` so runtime auth reads continue to work through
 * the existing `AuthStorage.get(provider)` contract.
 *
 * Security boundaries:
 * - Metadata files never contain plaintext keys (only masked previews and
 *   fingerprints).
 * - Per-account secret files are stored with 0600 permissions under a 0700
 *   directory.
 * - List / summary functions only return masked previews; plaintext is only
 *   returned by the dedicated `revealApiKeyAccount` function.
 */

import { createHash, randomBytes } from "node:crypto";
import { access, chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AuthStorage, getAgentDir, type ApiKeyCredential } from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Provider allowlist — v1 only opencode-go enters managed accounts mode.
// Other API-key providers keep the legacy single-key model.
// ---------------------------------------------------------------------------

const MANAGED_ACCOUNT_PROVIDERS = new Set<string>(["opencode-go"]);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACCOUNT_STORE_DIR = "auth-api-key-accounts";
const METADATA_FILE = "accounts.json";
const JSON_FILE_MODE = 0o600;
const ACCOUNT_DIR_MODE = 0o700;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ApiKeyAccountMetadata {
  accountId: string;
  displayName: string;
  description: string;
  maskedKeyPreview: string;
  keyFingerprint: string;
  createdAt: string;
  updatedAt: string;
  lastActivatedAt: string;
  importedFromLegacyAt: string | null;
  /** Whether the account is disabled. Only enabled accounts can be activated or selected for failover. */
  disabled?: boolean;
  /** ISO timestamp of when the account was last disabled. */
  disabledAt?: string;
  /** Human-readable reason the account is disabled (e.g. "Account unusable: Invalid API key"). */
  disabledReason?: string;
  /** Who or what disabled the account. */
  disabledBy?: "user" | "system";
  /** Machine-readable reason for automatic disabling (e.g. "account_unusable"). */
  autoDisabledReason?: "account_unusable" | "manual";
  /** ISO timestamp of when the account was last re-enabled. */
  enabledAt?: string;
  /** Who or what enabled the account. */
  enabledBy?: "user" | "system";
}

interface ApiKeyAccountStoreMetadata {
  version: 1;
  provider: string;
  activeAccountId: string | null;
  accounts: ApiKeyAccountMetadata[];
}

export interface ApiKeyAccountSummary {
  accountId: string;
  displayName: string;
  description: string;
  maskedKeyPreview: string;
  active: boolean;
  disabled?: boolean;
  disabledReason?: string;
  disabledBy?: string;
  autoDisabledReason?: string;
  enabledAt?: string;
  createdAt: string;
  updatedAt: string;
  lastActivatedAt: string | null;
  importedFromLegacyAt: string | null;
}

export interface ApiKeyAccountsList {
  provider: string;
  authMode: "managed_accounts" | "single";
  activeAccountId: string | null;
  accountCount: number;
  accounts: ApiKeyAccountSummary[];
}

export interface ApiKeyAccountRevealResult {
  accountId: string;
  apiKey: string;
}

export interface ApiKeyAccountDisableOptions {
  /** Human-readable reason for disabling (e.g. "Manually disabled", "Account unusable: Invalid API key"). */
  reason?: string;
  /** Who is disabling the account. */
  disabledBy?: "user" | "system";
  /** If the account is active, a replacement account id to switch to. */
  replacementAccountId?: string;
  /** If the account is active and no replacement is available, explicitly clear the active mirror. */
  clearActive?: boolean;
  /** Machine-readable reason for automatic disable (set by failover controller). */
  autoDisabledReason?: "account_unusable" | "manual";
}

export interface CreateApiKeyAccountInput {
  displayName: string;
  description?: string;
  apiKey: string;
  activate?: boolean;
}

export interface UpdateApiKeyAccountInput {
  displayName?: string;
  description?: string;
  apiKey?: string;
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class ApiKeyAccountStoreError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "ApiKeyAccountStoreError";
  }
}

export class ApiKeyAccountDisabledError extends ApiKeyAccountStoreError {
  constructor(message = "Account is disabled and cannot be activated. Enable it first.") {
    super(message, 409);
    this.name = "ApiKeyAccountDisabledError";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function assertManagedProvider(provider: string): void {
  if (!MANAGED_ACCOUNT_PROVIDERS.has(provider)) {
    throw new ApiKeyAccountStoreError(
      `Multi-account API key management is not enabled for "${provider}". ` +
      `Supported providers: ${[...MANAGED_ACCOUNT_PROVIDERS].join(", ")}`,
      400,
    );
  }
}

export function isManagedApiKeyProvider(provider: string): boolean {
  return MANAGED_ACCOUNT_PROVIDERS.has(provider);
}

/**
 * Check whether any managed API key accounts exist for a provider,
 * without triggering legacy import.  Returns false for non-managed
 * providers or when the metadata file is missing / has zero accounts.
 */
export async function hasManagedApiKeyAccounts(provider: string): Promise<boolean> {
  if (!isManagedApiKeyProvider(provider)) return false;
  const metadata = await readMetadata(provider);
  return metadata.accounts.length > 0;
}

function accountStorePath(provider: string): string {
  return join(getAgentDir(), ACCOUNT_STORE_DIR, provider);
}

function metadataPath(provider: string): string {
  return join(accountStorePath(provider), METADATA_FILE);
}

function secretPath(provider: string, accountId: string): string {
  return join(accountStorePath(provider), `${encodeURIComponent(accountId)}.json`);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
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

async function readJsonFile(p: string, description: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(p, "utf8")) as unknown;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw new ApiKeyAccountStoreError(`Failed to read ${description}`, 500);
  }
}

async function writeJsonFile(provider: string, p: string, value: unknown): Promise<void> {
  await ensureAccountStoreDir(provider);
  await writeFile(p, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: JSON_FILE_MODE });
  await chmod(p, JSON_FILE_MODE).catch(() => {});
}

/** Generate a stable, opaque account id. */
function generateAccountId(): string {
  return `ak_${randomBytes(16).toString("hex")}`;
}

/** Produce a SHA-256 fingerprint of an API key for dedup / identity matching. */
function fingerprintApiKey(key: string): string {
  return `sha256:${createHash("sha256").update(key).digest("hex")}`;
}

/**
 * Build a masked preview string from an API key.
 * - key <= 12 chars: entirely masked.
 * - otherwise: first 4 + `****` + last 4.
 */
function maskApiKey(key: string): string {
  if (!key) return "****";
  if (key.length <= 12) return "****";
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Metadata normalization
// ---------------------------------------------------------------------------

function normalizeAccountEntry(value: unknown): ApiKeyAccountMetadata | null {
  if (!isRecord(value)) return null;
  if (typeof value.accountId !== "string" || !value.accountId.trim()) return null;
  if (typeof value.createdAt !== "string" || typeof value.updatedAt !== "string") return null;

  return {
    accountId: value.accountId,
    displayName: typeof value.displayName === "string" && value.displayName.trim()
      ? value.displayName.trim()
      : "Unnamed account",
    description: typeof value.description === "string" ? value.description.trim() : "",
    maskedKeyPreview: typeof value.maskedKeyPreview === "string" ? value.maskedKeyPreview : "****",
    keyFingerprint: typeof value.keyFingerprint === "string" ? value.keyFingerprint : "",
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    lastActivatedAt: typeof value.lastActivatedAt === "string" ? value.lastActivatedAt : value.createdAt,
    importedFromLegacyAt: typeof value.importedFromLegacyAt === "string" && value.importedFromLegacyAt.trim()
      ? value.importedFromLegacyAt
      : null,
    disabled: typeof value.disabled === "boolean" ? value.disabled : undefined,
    disabledAt: typeof value.disabledAt === "string" ? value.disabledAt : undefined,
    disabledReason: typeof value.disabledReason === "string" ? value.disabledReason : undefined,
    disabledBy: value.disabledBy === "user" || value.disabledBy === "system" ? value.disabledBy : undefined,
    autoDisabledReason: value.autoDisabledReason === "account_unusable" || value.autoDisabledReason === "manual" ? value.autoDisabledReason : undefined,
    enabledAt: typeof value.enabledAt === "string" ? value.enabledAt : undefined,
    enabledBy: value.enabledBy === "user" || value.enabledBy === "system" ? value.enabledBy : undefined,
  };
}

function normalizeMetadata(value: unknown, provider: string): ApiKeyAccountStoreMetadata {
  if (!isRecord(value) || value.version !== 1) {
    return { version: 1, provider, activeAccountId: null, accounts: [] };
  }

  const accounts = Array.isArray(value.accounts)
    ? value.accounts.map(normalizeAccountEntry).filter((e): e is ApiKeyAccountMetadata => e !== null)
    : [];

  const activeAccountId = typeof value.activeAccountId === "string" && value.activeAccountId.trim()
    ? value.activeAccountId.trim()
    : null;

  return { version: 1, provider, activeAccountId, accounts };
}

// ---------------------------------------------------------------------------
// Metadata I/O
// ---------------------------------------------------------------------------

async function readMetadata(provider: string): Promise<ApiKeyAccountStoreMetadata> {
  const raw = await readJsonFile(metadataPath(provider), "API key account metadata");
  return normalizeMetadata(raw, provider);
}

async function writeMetadata(provider: string, metadata: ApiKeyAccountStoreMetadata): Promise<void> {
  await writeJsonFile(provider, metadataPath(provider), metadata);
}

// ---------------------------------------------------------------------------
// Account summary projection
// ---------------------------------------------------------------------------

function accountSummary(
  metadata: ApiKeyAccountStoreMetadata,
  entry: ApiKeyAccountMetadata,
): ApiKeyAccountSummary {
  return {
    accountId: entry.accountId,
    displayName: entry.displayName,
    description: entry.description,
    maskedKeyPreview: entry.maskedKeyPreview,
    active: metadata.activeAccountId === entry.accountId,
    disabled: entry.disabled === true ? true : undefined,
    disabledReason: entry.disabledReason,
    disabledBy: entry.disabledBy,
    autoDisabledReason: entry.autoDisabledReason,
    enabledAt: entry.enabledAt,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    lastActivatedAt: entry.lastActivatedAt || null,
    importedFromLegacyAt: entry.importedFromLegacyAt,
  };
}

function sortAccountSummaries(accounts: ApiKeyAccountSummary[]): ApiKeyAccountSummary[] {
  return [...accounts].sort((a, b) => {
    // active first
    if (a.active !== b.active) return a.active ? -1 : 1;
    // then by lastActivatedAt desc
    const aTime = a.lastActivatedAt ?? a.updatedAt;
    const bTime = b.lastActivatedAt ?? b.updatedAt;
    return bTime.localeCompare(aTime);
  });
}

// ---------------------------------------------------------------------------
// Active mirror helper
// ---------------------------------------------------------------------------

/**
 * Write (or remove) the credential for `provider` in `auth.json` and reload
 * the RPC auth state so live wrappers pick up the change.
 *
 * Import `reloadRpcAuthState` lazily to avoid a circular dependency between
 * `rpc-manager.ts` and modules that import it.
 */
async function mirrorActiveCredential(
  provider: string,
  action: { type: "set"; credential: ApiKeyCredential } | { type: "clear" },
): Promise<void> {
  const authStorage = AuthStorage.create();
  if (action.type === "set") {
    authStorage.set(provider, action.credential);
  } else {
    authStorage.remove(provider);
  }
  // Lazily import reloadRpcAuthState to avoid a static circular import
  // between this module and rpc-manager.
  const { reloadRpcAuthState } = await import("@/lib/rpc-manager");
  reloadRpcAuthState();
}

// ---------------------------------------------------------------------------
// Legacy read-through import
// ---------------------------------------------------------------------------

/**
 * Ensure the legacy single key stored in `auth.json` for `provider` has been
 * imported into the multi-account store.  This is idempotent: if a matching
 * fingerprint already exists in the store, it is only aligned as active.
 *
 * Returns `true` when a new account was created (first import), `false`
 * otherwise.
 */
export async function importLegacyKeyIfNeeded(provider: string): Promise<boolean> {
  assertManagedProvider(provider);

  const authStorage = AuthStorage.create();
  const credential = authStorage.get(provider);
  if (!credential || credential.type !== "api_key" || !credential.key) return false;

  const fingerprint = fingerprintApiKey(credential.key);
  const metadata = await readMetadata(provider);

  // Already imported — skip
  const existing = metadata.accounts.find((a) => a.keyFingerprint === fingerprint);
  if (existing) {
    // Align activeAccountId if it differs
    if (metadata.activeAccountId !== existing.accountId) {
      await writeMetadata(provider, { ...metadata, activeAccountId: existing.accountId });
    }
    return false;
  }

  // Perform import
  const now = new Date().toISOString();
  const accountId = generateAccountId();
  const maskedPreview = maskApiKey(credential.key);

  const entry: ApiKeyAccountMetadata = {
    accountId,
    displayName: "Imported key",
    description: "Imported from legacy single-key config",
    maskedKeyPreview: maskedPreview,
    keyFingerprint: fingerprint,
    createdAt: now,
    updatedAt: now,
    lastActivatedAt: now,
    importedFromLegacyAt: now,
  };

  // Persist secret
  await writeJsonFile(provider, secretPath(provider, accountId), {
    type: "api_key" as const,
    key: credential.key,
  });

  // Persist metadata
  await writeMetadata(provider, {
    version: 1,
    provider,
    activeAccountId: accountId,
    accounts: [...metadata.accounts, entry],
  });

  // Mirror the active key (already in auth.json, but ensure consistency)
  await mirrorActiveCredential(provider, { type: "set", credential });

  return true;
}

// ---------------------------------------------------------------------------
// CRUD: list / create / update / delete / activate / reveal
// ---------------------------------------------------------------------------

export async function listApiKeyAccounts(
  provider: string,
): Promise<ApiKeyAccountsList> {
  assertManagedProvider(provider);

  // Trigger legacy import if needed
  await importLegacyKeyIfNeeded(provider);

  const metadata = await readMetadata(provider);

  // Prune any entries whose secret file is missing
  const alive: ApiKeyAccountMetadata[] = [];
  for (const entry of metadata.accounts) {
    if (await pathExists(secretPath(provider, entry.accountId))) {
      alive.push(entry);
    }
  }

  if (alive.length !== metadata.accounts.length) {
    const activeAccountId = metadata.activeAccountId && alive.some((a) => a.accountId === metadata.activeAccountId)
      ? metadata.activeAccountId
      : null;
    await writeMetadata(provider, { version: 1, provider, activeAccountId, accounts: alive });
    return listApiKeyAccounts(provider);
  }

  const summaries = alive.map((entry) => accountSummary(metadata, entry));

  return {
    provider,
    authMode: "managed_accounts",
    activeAccountId: metadata.activeAccountId,
    accountCount: summaries.length,
    accounts: sortAccountSummaries(summaries),
  };
}

export async function createApiKeyAccount(
  provider: string,
  input: CreateApiKeyAccountInput,
): Promise<ApiKeyAccountsList> {
  assertManagedProvider(provider);

  const apiKey = input.apiKey?.trim();
  if (!apiKey) throw new ApiKeyAccountStoreError("apiKey is required", 400);
  const displayName = input.displayName?.trim() || "Unnamed account";
  const description = input.description?.trim() || "";

  // Trigger legacy import first so the new account doesn't collide with an
  // unimported legacy key.
  await importLegacyKeyIfNeeded(provider);

  const metadata = await readMetadata(provider);
  const fingerprint = fingerprintApiKey(apiKey);

  // Guard against duplicate key
  const duplicate = metadata.accounts.find((a) => a.keyFingerprint === fingerprint);
  if (duplicate) {
    throw new ApiKeyAccountStoreError(
      "An account with the same API key already exists",
      409,
    );
  }

  const now = new Date().toISOString();
  const accountId = generateAccountId();
  const maskedKeyPreview = maskApiKey(apiKey);
  const shouldActivate = input.activate !== false || metadata.accounts.length === 0;

  const entry: ApiKeyAccountMetadata = {
    accountId,
    displayName,
    description,
    maskedKeyPreview,
    keyFingerprint: fingerprint,
    createdAt: now,
    updatedAt: now,
    lastActivatedAt: shouldActivate ? now : now,
    importedFromLegacyAt: null,
  };

  // Persist secret
  await writeJsonFile(provider, secretPath(provider, accountId), {
    type: "api_key" as const,
    key: apiKey,
  });

  // Persist metadata
  const nextMetadata: ApiKeyAccountStoreMetadata = {
    version: 1,
    provider,
    activeAccountId: shouldActivate ? accountId : metadata.activeAccountId,
    accounts: [...metadata.accounts, entry],
  };
  await writeMetadata(provider, nextMetadata);

  // Mirror active credential if this account is the new active
  if (shouldActivate) {
    await mirrorActiveCredential(provider, {
      type: "set",
      credential: { type: "api_key", key: apiKey },
    });
  }

  return listApiKeyAccounts(provider);
}

export async function updateApiKeyAccount(
  provider: string,
  accountId: string,
  input: UpdateApiKeyAccountInput,
): Promise<ApiKeyAccountsList> {
  assertManagedProvider(provider);
  const normalizedId = accountId.trim();
  if (!normalizedId) throw new ApiKeyAccountStoreError("accountId is required", 400);

  // Ensure secret file exists
  if (!(await pathExists(secretPath(provider, normalizedId)))) {
    throw new ApiKeyAccountStoreError("Account not found", 404);
  }

  const metadata = await readMetadata(provider);
  const idx = metadata.accounts.findIndex((a) => a.accountId === normalizedId);
  if (idx === -1) throw new ApiKeyAccountStoreError("Account metadata not found", 404);

  const now = new Date().toISOString();
  const entry = metadata.accounts[idx];
  let keyChanged = false;
  let newKey = "";

  const nextEntry: ApiKeyAccountMetadata = {
    ...entry,
    updatedAt: now,
  };

  if (input.displayName !== undefined) {
    nextEntry.displayName = input.displayName.trim() || "Unnamed account";
  }
  if (input.description !== undefined) {
    nextEntry.description = input.description.trim();
  }
  if (input.apiKey !== undefined) {
    const trimmed = input.apiKey.trim();
    if (!trimmed) throw new ApiKeyAccountStoreError("apiKey must not be empty", 400);
    const fingerprint = fingerprintApiKey(trimmed);
    // Guard against duplicate key (skip the current entry)
    const duplicate = metadata.accounts.find(
      (a) => a.accountId !== normalizedId && a.keyFingerprint === fingerprint,
    );
    if (duplicate) {
      throw new ApiKeyAccountStoreError("An account with the same API key already exists", 409);
    }
    nextEntry.keyFingerprint = fingerprint;
    nextEntry.maskedKeyPreview = maskApiKey(trimmed);
    keyChanged = true;
    newKey = trimmed;
  }

  const accounts = [...metadata.accounts];
  accounts[idx] = nextEntry;
  await writeMetadata(provider, { ...metadata, accounts });

  // If the key was changed, update the secret file
  if (keyChanged) {
    await writeJsonFile(provider, secretPath(provider, normalizedId), {
      type: "api_key" as const,
      key: newKey,
    });
  }

  // If this is the active account and the key changed, mirror the new key
  if (keyChanged && metadata.activeAccountId === normalizedId) {
    await mirrorActiveCredential(provider, {
      type: "set",
      credential: { type: "api_key", key: newKey },
    });
  }

  return listApiKeyAccounts(provider);
}

/**
 * Delete an API key account.
 *
 * - Deleting a non-active account: simply removes it.
 * - Deleting the active account while other accounts exist: picks a fallback
 *   (by lastActivatedAt desc, then updatedAt desc), activates it, and mirrors
 *   the new active credential to auth.json.
 * - Deleting the last remaining account: clears the provider from auth.json.
 */
export async function deleteApiKeyAccount(
  provider: string,
  accountId: string,
): Promise<ApiKeyAccountsList> {
  assertManagedProvider(provider);
  const normalizedId = accountId.trim();
  if (!normalizedId) throw new ApiKeyAccountStoreError("accountId is required", 400);

  // Ensure the account exists
  if (!(await pathExists(secretPath(provider, normalizedId)))) {
    throw new ApiKeyAccountStoreError("Account not found", 404);
  }

  const metadata = await readMetadata(provider);
  const remaining = metadata.accounts.filter((a) => a.accountId !== normalizedId);

  if (remaining.length === 0) {
    // Last account: delete secret, clear metadata, clear auth.json
    await unlink(secretPath(provider, normalizedId)).catch(() => {});
    await writeMetadata(provider, {
      version: 1,
      provider,
      activeAccountId: null,
      accounts: [],
    });
    await mirrorActiveCredential(provider, { type: "clear" });
    return listApiKeyAccounts(provider);
  }

  // Delete the secret file
  await unlink(secretPath(provider, normalizedId)).catch(() => {});

  let nextActiveId = metadata.activeAccountId;
  if (metadata.activeAccountId === normalizedId) {
    // Pick fallback: sort by lastActivatedAt desc, then updatedAt desc
    const sorted = [...remaining].sort((a, b) => {
      const aTime = a.lastActivatedAt ?? a.updatedAt;
      const bTime = b.lastActivatedAt ?? b.updatedAt;
      return bTime.localeCompare(aTime);
    });
    const fallback = sorted[0];
    nextActiveId = fallback.accountId;

    // Update lastActivatedAt for the fallback
    const now = new Date().toISOString();
    const updatedRemaining = remaining.map((a) =>
      a.accountId === fallback.accountId ? { ...a, lastActivatedAt: now, updatedAt: now } : a,
    );

    await writeMetadata(provider, {
      version: 1,
      provider,
      activeAccountId: nextActiveId,
      accounts: updatedRemaining,
    });

    // Mirror the fallback credential to auth.json
    const secret = await readJsonFile(
      secretPath(provider, fallback.accountId),
      "API key account secret",
    );
    if (secret && isRecord(secret) && typeof secret.key === "string") {
      await mirrorActiveCredential(provider, {
        type: "set",
        credential: { type: "api_key", key: secret.key },
      });
    }
  } else {
    await writeMetadata(provider, {
      version: 1,
      provider,
      activeAccountId: nextActiveId,
      accounts: remaining,
    });
  }

  return listApiKeyAccounts(provider);
}

/**
 * Activate an API key account, mirror its credential to auth.json, and reload
 * the RPC auth state so live sessions pick up the new key.
 */
export async function activateApiKeyAccount(
  provider: string,
  accountId: string,
): Promise<ApiKeyAccountsList> {
  assertManagedProvider(provider);
  const normalizedId = accountId.trim();
  if (!normalizedId) throw new ApiKeyAccountStoreError("accountId is required", 400);

  // Ensure the account exists
  if (!(await pathExists(secretPath(provider, normalizedId)))) {
    throw new ApiKeyAccountStoreError("Account not found", 404);
  }

  const secret = await readJsonFile(secretPath(provider, normalizedId), "API key account secret");
  if (!secret || !isRecord(secret) || typeof secret.key !== "string") {
    throw new ApiKeyAccountStoreError("Account secret is invalid", 500);
  }

  const metadata = await readMetadata(provider);

  // Reject disabled accounts
  const targetEntry = metadata.accounts.find((a) => a.accountId === normalizedId);
  if (targetEntry?.disabled) {
    throw new ApiKeyAccountDisabledError(
      targetEntry.disabledReason
        ? `Account is disabled: ${targetEntry.disabledReason}. Enable it first.`
        : undefined,
    );
  }

  // No-op if already active
  if (metadata.activeAccountId === normalizedId) {
    return listApiKeyAccounts(provider);
  }

  const now = new Date().toISOString();
  const accounts = metadata.accounts.map((a) =>
    a.accountId === normalizedId
      ? { ...a, lastActivatedAt: now, updatedAt: now }
      : a,
  );

  await writeMetadata(provider, {
    version: 1,
    provider,
    activeAccountId: normalizedId,
    accounts,
  });

  // Mirror active credential to auth.json and reload
  await mirrorActiveCredential(provider, {
    type: "set",
    credential: { type: "api_key", key: secret.key },
  });

  return listApiKeyAccounts(provider);
}

/**
 * Reveal the plaintext API key for a single account.
 *
 * This function intentionally returns the plaintext key. Callers (API routes)
 * MUST apply `Cache-Control: no-store` and must not log / embed the key in
 * error messages or toast text.
 */
export async function revealApiKeyAccount(
  provider: string,
  accountId: string,
): Promise<ApiKeyAccountRevealResult> {
  assertManagedProvider(provider);
  const normalizedId = accountId.trim();
  if (!normalizedId) throw new ApiKeyAccountStoreError("accountId is required", 400);

  const secret = await readJsonFile(secretPath(provider, normalizedId), "API key account secret");
  if (!secret || !isRecord(secret) || typeof secret.key !== "string") {
    throw new ApiKeyAccountStoreError("Account not found or secret is invalid", 404);
  }

  return { accountId: normalizedId, apiKey: secret.key };
}

/**
 * Return a lightweight summary for a provider (used to extend the existing
 * `/api/auth/api-key/[provider]` GET response).  Does NOT trigger legacy
 * import — callers that need the accounts list should use `listApiKeyAccounts`.
 */
export async function getApiKeyProviderSummary(
  provider: string,
): Promise<{
  provider: string;
  configured: boolean;
  authMode: "managed_accounts" | "single";
  accountCount: number;
  activeAccountId: string | null;
  activeAccountDisplayName: string | null;
} | null> {
  if (!isManagedApiKeyProvider(provider)) return null;

  const metadata = await readMetadata(provider);

  // If no metadata file exists and no accounts, we might still need to trigger
  // a legacy import on first access.  But for a lightweight summary, just
  // check whether auth.json has a credential.
  const hasLocalAccounts = metadata.accounts.length > 0;
  const authStorage = AuthStorage.create();
  const credential = authStorage.get(provider);
  const configured =
    hasLocalAccounts ||
    (credential?.type === "api_key" && typeof credential.key === "string");

  // Only return activeAccountDisplayName when we actually have managed
  // accounts in the store (avoids reading secret files for legacy single key
  // before import).
  let activeAccountDisplayName: string | null = null;
  if (hasLocalAccounts && metadata.activeAccountId) {
    const activeEntry = metadata.accounts.find(
      (a) => a.accountId === metadata.activeAccountId,
    );
    activeAccountDisplayName = activeEntry?.displayName ?? null;
  }

  return {
    provider,
    configured: !!configured,
    authMode: "managed_accounts",
    accountCount: Math.max(metadata.accounts.length, configured ? 1 : 0),
    activeAccountId: metadata.activeAccountId,
    activeAccountDisplayName,
  };
}

// ---------------------------------------------------------------------------
// Enable / disable helpers
// ---------------------------------------------------------------------------

/**
 * Return the current active account id for a provider, or null if no account
 * is active or the provider is not managed.
 */
export async function getActiveApiKeyAccountId(provider: string): Promise<string | null> {
  if (!isManagedApiKeyProvider(provider)) return null;
  const metadata = await readMetadata(provider);
  return metadata.activeAccountId;
}

/**
 * Disable an API key account.
 *
 * - Non-active accounts are disabled immediately.
 * - Disabling the active account requires either `replacementAccountId`
 *   (to switch to another account) or `clearActive` (to clear the active
 *   mirror).  If neither is provided and the account is active, a 409 error
 *   is thrown.
 * - After disabling, the account cannot be activated or used for failover
 *   until `enableApiKeyAccount` is called.
 */
export async function disableApiKeyAccount(
  provider: string,
  accountId: string,
  options: ApiKeyAccountDisableOptions = {},
): Promise<ApiKeyAccountsList> {
  assertManagedProvider(provider);
  const normalizedId = accountId.trim();
  if (!normalizedId) throw new ApiKeyAccountStoreError("accountId is required", 400);

  // Ensure the account exists
  if (!(await pathExists(secretPath(provider, normalizedId)))) {
    throw new ApiKeyAccountStoreError("Account not found", 404);
  }

  const metadata = await readMetadata(provider);
  const entry = metadata.accounts.find((a) => a.accountId === normalizedId);
  if (!entry) throw new ApiKeyAccountStoreError("Account metadata not found", 404);

  // Already disabled — treat as no-op
  if (entry.disabled) {
    return listApiKeyAccounts(provider);
  }

  const now = new Date().toISOString();
  const isActive = metadata.activeAccountId === normalizedId;

  // Handle active-account disable constraints
  if (isActive) {
    if (options.replacementAccountId) {
      const replacementId = options.replacementAccountId.trim();
      // Validate replacement exists, is not disabled, and is not the same
      if (replacementId === normalizedId) {
        throw new ApiKeyAccountStoreError("Cannot replace active account with itself", 400);
      }
      const replacement = metadata.accounts.find((a) => a.accountId === replacementId);
      if (!replacement) {
        throw new ApiKeyAccountStoreError("Replacement account not found", 404);
      }
      if (replacement.disabled) {
        throw new ApiKeyAccountStoreError(
          "Replacement account is disabled. Enable it first.",
          409,
        );
      }
      // Activate the replacement first
      await mirrorActiveCredential(provider, {
        type: "set",
        credential: { type: "api_key", key: (await revealApiKeyAccountInternal(provider, replacementId)).apiKey },
      });
    } else if (options.clearActive) {
      // Explicitly clear the active mirror
      await mirrorActiveCredential(provider, { type: "clear" });
    } else {
      throw new ApiKeyAccountStoreError(
        "Cannot disable the active account without a replacement or explicit clearActive. " +
        "Provide a replacementAccountId or set clearActive to true.",
        409,
      );
    }
  }

  // Update metadata: set disabled fields and clear activeAccountId if needed
  const nextActiveId = isActive ? (options.replacementAccountId?.trim() ?? null) : metadata.activeAccountId;

  const accounts = metadata.accounts.map((a) =>
    a.accountId === normalizedId
      ? {
          ...a,
          updatedAt: now,
          disabled: true,
          disabledAt: now,
          disabledReason: options.reason || (options.disabledBy === "system" ? "Disabled" : "Manually disabled"),
          disabledBy: options.disabledBy || "user",
          autoDisabledReason: options.autoDisabledReason,
          // Remove enable-related tracking fields since we're now disabled
          enabledAt: undefined,
          enabledBy: undefined,
        }
      : a,
  );

  await writeMetadata(provider, {
    version: 1,
    provider,
    activeAccountId: nextActiveId,
    accounts,
  });

  return listApiKeyAccounts(provider);
}

/**
 * Re-enable a previously disabled API key account.
 *
 * This only restores the account's eligibility to be activated or used for
 * failover; it does NOT automatically activate the account.  The caller
 * must call `activateApiKeyAccount` separately if they want to make it
 * active.
 */
export async function enableApiKeyAccount(
  provider: string,
  accountId: string,
): Promise<ApiKeyAccountsList> {
  assertManagedProvider(provider);
  const normalizedId = accountId.trim();
  if (!normalizedId) throw new ApiKeyAccountStoreError("accountId is required", 400);

  // Ensure the account exists
  if (!(await pathExists(secretPath(provider, normalizedId)))) {
    throw new ApiKeyAccountStoreError("Account not found", 404);
  }

  const metadata = await readMetadata(provider);
  const entry = metadata.accounts.find((a) => a.accountId === normalizedId);
  if (!entry) throw new ApiKeyAccountStoreError("Account metadata not found", 404);

  // Already enabled — treat as no-op
  if (!entry.disabled) {
    return listApiKeyAccounts(provider);
  }

  const now = new Date().toISOString();

  const accounts = metadata.accounts.map((a) =>
    a.accountId === normalizedId
      ? {
          ...a,
          updatedAt: now,
          disabled: false,
          disabledAt: undefined,
          disabledReason: undefined,
          disabledBy: undefined,
          autoDisabledReason: undefined,
          enabledAt: now,
          enabledBy: "user" as const,
        }
      : a,
  );

  await writeMetadata(provider, {
    version: 1,
    provider,
    activeAccountId: metadata.activeAccountId,
    accounts,
  });

  return listApiKeyAccounts(provider);
}

/**
 * Internal helper to reveal an account's plaintext key without the public
 * `revealApiKeyAccount` error wrapping, used by `disableApiKeyAccount` when
 * activating a replacement.
 */
async function revealApiKeyAccountInternal(
  provider: string,
  accountId: string,
): Promise<{ accountId: string; apiKey: string }> {
  const secret = await readJsonFile(secretPath(provider, accountId), "API key account secret");
  if (!secret || !isRecord(secret) || typeof secret.key !== "string") {
    throw new ApiKeyAccountStoreError("Account secret is invalid", 500);
  }
  return { accountId, apiKey: secret.key };
}
