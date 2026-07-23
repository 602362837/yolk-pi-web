/**
 * Provider-scoped API-key multi-account storage and active mirror service layer.
 *
 * Manages multiple API Key "accounts" per provider (opencode-go, xai, anyrouter)
 * in a dedicated application-managed directory, keeping upstream pi SDK /
 * CredentialStore/ModelRuntime unaware of multi-account semantics.  The currently
 * active credential is always mirrored back to `auth.json` so runtime auth reads
 * continue to work through the Web CredentialStore / ModelRuntime.getAuth path.
 *
 * Security boundaries:
 * - Metadata files never contain plaintext keys (only masked previews and
 *   fingerprints).
 * - Per-account secret files are stored with 0600 permissions under a 0700
 *   directory.
 * - List / summary functions only return masked previews; plaintext is only
 *   returned by the dedicated `revealApiKeyAccount` function.
 * - Mutations use an in-process queue + cross-process mkdir lock and atomic
 *   same-dir temp + fsync + rename writes.
 *
 * Provider policy notes:
 * - xai / opencode-go: deleting the Active account may fall back to the most
 *   recently activated remaining account (existing product contract).
 * - anyrouter: deleting/disabling Active requires an explicit replacement or
 *   disconnect (`clearActive`); never implicit recent-account fallback.
 */

import { createHash, randomBytes } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ApiKeyCredential } from "@earendil-works/pi-ai";
import {
  ANYROUTER_PROVIDER_ID,
  readAnyrouterConfigRaw,
  resolveLegacyAnyrouterSourceApiKey,
  validateAnyRouterBaseUrl,
} from "@/lib/anyrouter-config";
import { getWebCredentialStore } from "@/lib/web-credential-store";

// ---------------------------------------------------------------------------
// Provider allowlist — only listed providers enter managed accounts mode.
// Other API-key providers keep the legacy single-key model.
// ---------------------------------------------------------------------------

const MANAGED_ACCOUNT_PROVIDERS = new Set<string>(["opencode-go", "xai", ANYROUTER_PROVIDER_ID]);

/** Providers that forbid implicit Active fallback on delete. */
const EXPLICIT_ACTIVE_DELETE_PROVIDERS = new Set<string>([ANYROUTER_PROVIDER_ID]);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACCOUNT_STORE_DIR = "auth-api-key-accounts";
const METADATA_FILE = "accounts.json";
const JSON_FILE_MODE = 0o600;
const ACCOUNT_DIR_MODE = 0o700;
const LOCK_DIR_NAME = "provider.accounts.lock";
const LOCK_OWNER_FILE = "owner.json";
const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MIN_MS = 40;
const LOCK_RETRY_MAX_MS = 120;
const LOCK_MAX_WAIT_MS = 15_000;

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
  /**
   * Optional per-account Base URL override (AnyRouter and future managed
   * providers). Empty / missing means inherit provider-global default.
   */
  baseUrlOverride?: string;
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
  /** Validated optional Base URL override; never a secret. */
  baseUrlOverride?: string;
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

export interface ApiKeyAccountDeleteOptions {
  /** When deleting the Active account, activate this replacement instead. */
  replacementAccountId?: string;
  /** When deleting the Active account, clear the Active mirror instead of picking a fallback. */
  clearActive?: boolean;
}

export interface CreateApiKeyAccountInput {
  displayName: string;
  description?: string;
  apiKey: string;
  activate?: boolean;
  /** Optional account Base URL override; empty/undefined inherits global default. */
  baseUrlOverride?: string | null;
}

export interface UpdateApiKeyAccountInput {
  displayName?: string;
  description?: string;
  apiKey?: string;
  /**
   * Set to a non-empty URL to override, or `null` / `""` to clear.
   * Omit the field to leave the existing override unchanged.
   */
  baseUrlOverride?: string | null;
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

export function requiresExplicitActiveDisposition(provider: string): boolean {
  return EXPLICIT_ACTIVE_DELETE_PROVIDERS.has(provider);
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

function providerLockDir(provider: string): string {
  return join(accountStorePath(provider), LOCK_DIR_NAME);
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

/**
 * Atomic same-dir temp + fsync + rename write with best-effort 0600 modes.
 */
async function writeJsonFileAtomic(provider: string, p: string, value: unknown): Promise<void> {
  await ensureAccountStoreDir(provider);
  const temp = `${p}.tmp.${process.pid}.${randomBytes(6).toString("hex")}`;
  const body = `${JSON.stringify(value, null, 2)}\n`;
  try {
    const handle = await open(temp, "w", JSON_FILE_MODE);
    try {
      await handle.writeFile(body, "utf8");
      await handle.sync().catch(() => {});
    } finally {
      await handle.close();
    }
    await chmod(temp, JSON_FILE_MODE).catch(() => {});
    await rename(temp, p);
    await chmod(p, JSON_FILE_MODE).catch(() => {});
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
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

/**
 * Normalize optional account Base URL override.
 * Returns undefined when inherit/default; validated string otherwise.
 */
function normalizeBaseUrlOverride(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    return validateAnyRouterBaseUrl(trimmed);
  } catch {
    // Fail closed for stored invalid overrides: drop from projection rather
    // than returning a credential-bearing or malformed URL.
    return undefined;
  }
}

function parseBaseUrlOverrideInput(
  value: unknown,
  options: { requiredField?: boolean } = {},
): string | undefined | null {
  if (value === undefined) {
    if (options.requiredField) {
      throw new ApiKeyAccountStoreError("baseUrlOverride is required", 400);
    }
    return undefined;
  }
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new ApiKeyAccountStoreError("baseUrlOverride must be a string or null", 400);
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  return validateAnyRouterBaseUrl(trimmed);
}

// ---------------------------------------------------------------------------
// Provider lock (in-process queue + cross-process mkdir lock)
// ---------------------------------------------------------------------------

type LockOwner = {
  pid: number;
  createdAt: number;
};

const processQueues = new Map<string, Promise<unknown>>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitteredRetryMs(): number {
  return (
    LOCK_RETRY_MIN_MS +
    Math.floor(Math.random() * (LOCK_RETRY_MAX_MS - LOCK_RETRY_MIN_MS + 1))
  );
}

async function readLockOwner(lockDir: string): Promise<LockOwner | null> {
  try {
    const raw = JSON.parse(await readFile(join(lockDir, LOCK_OWNER_FILE), "utf8")) as unknown;
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

async function acquireProviderFsLock(provider: string): Promise<() => Promise<void>> {
  const accountDir = accountStorePath(provider);
  const lockDir = providerLockDir(provider);
  await mkdir(accountDir, { recursive: true, mode: ACCOUNT_DIR_MODE });
  await chmod(accountDir, ACCOUNT_DIR_MODE).catch(() => {});

  const startedAt = Date.now();
  while (true) {
    try {
      await mkdir(lockDir, { recursive: false, mode: ACCOUNT_DIR_MODE });
      const owner: LockOwner = { pid: process.pid, createdAt: Date.now() };
      await writeFile(join(lockDir, LOCK_OWNER_FILE), `${JSON.stringify(owner)}\n`, {
        encoding: "utf8",
        mode: JSON_FILE_MODE,
      });

      let released = false;
      return async () => {
        if (released) return;
        released = true;
        try {
          const current = await readLockOwner(lockDir);
          if (current && current.pid === process.pid && current.createdAt === owner.createdAt) {
            await rm(lockDir, { recursive: true, force: true });
            return;
          }
          if (!(await pathExists(lockDir))) return;
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
        throw new ApiKeyAccountStoreError(
          `API key account lock acquisition timed out for "${provider}"`,
          500,
        );
      }
      await sleep(jitteredRetryMs());
    }
  }
}

async function withProcessQueue<T>(provider: string, fn: () => Promise<T>): Promise<T> {
  const key = accountStorePath(provider);
  const previous = processQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolveGate) => {
    release = resolveGate;
  });
  const chain = previous.catch(() => {}).then(() => gate);
  processQueues.set(key, chain);

  await previous.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    if (processQueues.get(key) === chain) {
      processQueues.delete(key);
    }
  }
}

/**
 * Run `fn` under the provider-scoped critical section shared by account
 * mutations. Process queue is always applied; on-disk mkdir lock adds
 * cross-process safety without third-party lock packages.
 *
 * Lock order for AnyRouter Active work that also touches auth.json:
 * AnyRouter provider lock → auth.json (via CredentialStore). Callers must not
 * re-enter this lock from a CredentialStore decorator.
 */
export async function withApiKeyProviderLock<T>(
  provider: string,
  fn: () => Promise<T> | T,
): Promise<T> {
  assertManagedProvider(provider);
  return withProcessQueue(provider, async () => {
    const release = await acquireProviderFsLock(provider);
    try {
      return await fn();
    } finally {
      await release();
    }
  });
}

/** Test helper: confirms locks use fs mkdir primitives (no third-party package). */
export function __apiKeyAccountLockUsesFsPrimitivesForTests(): boolean {
  return LOCK_DIR_NAME.endsWith(".lock") && LOCK_OWNER_FILE === "owner.json";
}

// ---------------------------------------------------------------------------
// Metadata normalization
// ---------------------------------------------------------------------------

function normalizeAccountEntry(value: unknown): ApiKeyAccountMetadata | null {
  if (!isRecord(value)) return null;
  if (typeof value.accountId !== "string" || !value.accountId.trim()) return null;
  if (typeof value.createdAt !== "string" || typeof value.updatedAt !== "string") return null;

  const baseUrlOverride = normalizeBaseUrlOverride(value.baseUrlOverride);

  return {
    accountId: value.accountId,
    displayName:
      typeof value.displayName === "string" && value.displayName.trim()
        ? value.displayName.trim()
        : "Unnamed account",
    description: typeof value.description === "string" ? value.description.trim() : "",
    maskedKeyPreview: typeof value.maskedKeyPreview === "string" ? value.maskedKeyPreview : "****",
    keyFingerprint: typeof value.keyFingerprint === "string" ? value.keyFingerprint : "",
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    lastActivatedAt:
      typeof value.lastActivatedAt === "string" ? value.lastActivatedAt : value.createdAt,
    importedFromLegacyAt:
      typeof value.importedFromLegacyAt === "string" && value.importedFromLegacyAt.trim()
        ? value.importedFromLegacyAt
        : null,
    ...(baseUrlOverride ? { baseUrlOverride } : {}),
    disabled: typeof value.disabled === "boolean" ? value.disabled : undefined,
    disabledAt: typeof value.disabledAt === "string" ? value.disabledAt : undefined,
    disabledReason: typeof value.disabledReason === "string" ? value.disabledReason : undefined,
    disabledBy:
      value.disabledBy === "user" || value.disabledBy === "system" ? value.disabledBy : undefined,
    autoDisabledReason:
      value.autoDisabledReason === "account_unusable" || value.autoDisabledReason === "manual"
        ? value.autoDisabledReason
        : undefined,
    enabledAt: typeof value.enabledAt === "string" ? value.enabledAt : undefined,
    enabledBy:
      value.enabledBy === "user" || value.enabledBy === "system" ? value.enabledBy : undefined,
  };
}

/**
 * Normalize metadata. Missing file → empty store.
 * Malformed / future schema fails closed (throws) so writers never overwrite
 * unknown versions with an empty object.
 */
function normalizeMetadata(value: unknown, provider: string): ApiKeyAccountStoreMetadata {
  if (value === null || value === undefined) {
    return { version: 1, provider, activeAccountId: null, accounts: [] };
  }
  if (!isRecord(value)) {
    throw new ApiKeyAccountStoreError("API key account metadata is invalid", 500);
  }
  if (value.version !== 1) {
    throw new ApiKeyAccountStoreError(
      `Unsupported API key account metadata version: ${String(value.version)}`,
      500,
    );
  }

  const accounts = Array.isArray(value.accounts)
    ? value.accounts.map(normalizeAccountEntry).filter((e): e is ApiKeyAccountMetadata => e !== null)
    : [];

  const activeAccountId =
    typeof value.activeAccountId === "string" && value.activeAccountId.trim()
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
  await writeJsonFileAtomic(provider, metadataPath(provider), metadata);
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
    ...(entry.baseUrlOverride ? { baseUrlOverride: entry.baseUrlOverride } : {}),
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
 * Used by non-AnyRouter managed providers (xai / opencode-go). AnyRouter Active
 * work must use {@link syncAnyRouterActiveDerivedMirrors} under the provider
 * lock, then {@link reloadLiveAuthStateAfterUnlock} after unlock.
 *
 * Import `reloadRpcAuthState` lazily to avoid a circular dependency between
 * `rpc-manager.ts` and modules that import it.
 *
 * Callers that hold a provider lock must already have committed managed-store
 * changes before calling this (managed slot is authority; auth is a mirror).
 */
async function mirrorActiveCredential(
  provider: string,
  action: { type: "set"; credential: ApiKeyCredential } | { type: "clear" },
): Promise<void> {
  const store = await getWebCredentialStore();
  if (action.type === "set") {
    await store.modify(provider, async () => action.credential);
  } else {
    await store.delete(provider);
  }
  await reloadLiveAuthStateAfterUnlock();
}

/**
 * Offline-refresh live wrappers after releasing the provider lock.
 * Lazy import avoids a static cycle with rpc-manager.
 */
async function reloadLiveAuthStateAfterUnlock(): Promise<void> {
  const { reloadRpcAuthState } = await import("@/lib/rpc-manager");
  await Promise.resolve(reloadRpcAuthState());
}

/**
 * Rebuild AnyRouter Active runtime bridge + auth.json mirror under the
 * provider lock. Does not reload live wrappers — callers must call
 * {@link reloadLiveAuthStateAfterUnlock} after unlock.
 *
 * Managed slot/pointer is already committed; mirror failures throw and must
 * not be reported as Activate success (caller surfaces the error).
 */
async function syncAnyRouterActiveDerivedMirrors(
  knownActiveApiKey?: string | null,
): Promise<void> {
  const { syncAnyRouterDerivedMirrorsUnlocked } = await import(
    "@/lib/anyrouter-runtime-bridge"
  );
  await syncAnyRouterDerivedMirrorsUnlocked({
    knownActiveApiKey: knownActiveApiKey ?? null,
  });
}

// ---------------------------------------------------------------------------
// Legacy read-through import
// ---------------------------------------------------------------------------

async function importLegacyKeyFromAuthJson(provider: string): Promise<boolean> {
  const store = await getWebCredentialStore();
  const credential = await store.read(provider);
  if (!credential || credential.type !== "api_key" || !credential.key) return false;

  const fingerprint = fingerprintApiKey(credential.key);
  const metadata = await readMetadata(provider);

  const existing = metadata.accounts.find((a) => a.keyFingerprint === fingerprint);
  if (existing) {
    if (metadata.activeAccountId !== existing.accountId) {
      await writeMetadata(provider, { ...metadata, activeAccountId: existing.accountId });
    }
    return false;
  }

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

  await writeJsonFileAtomic(provider, secretPath(provider, accountId), {
    type: "api_key" as const,
    key: credential.key,
  });

  await writeMetadata(provider, {
    version: 1,
    provider,
    activeAccountId: accountId,
    accounts: [...metadata.accounts, entry],
  });

  if (provider === ANYROUTER_PROVIDER_ID) {
    // Under provider lock: rebuild bridge + auth. Caller reloads after unlock
    // when needed (create/activate paths already do).
    await syncAnyRouterActiveDerivedMirrors(credential.key);
  } else {
    await mirrorActiveCredential(provider, { type: "set", credential });
  }
  return true;
}

/**
 * Explicit, idempotent import of legacy `anyrouter.json.apiKey` into the
 * managed account store. Never deletes or rewrites the source config field.
 *
 * Must run under the AnyRouter provider lock. When a new Active is created,
 * rebuilds the runtime bridge + auth mirror under the same lock.
 */
async function importLegacyAnyrouterSourceKeyIfNeeded(): Promise<boolean> {
  const source = readAnyrouterConfigRaw();
  // Parse errors fail closed: do not invent accounts from an unreadable file.
  if (source.parseError) return false;

  const resolved = resolveLegacyAnyrouterSourceApiKey(source.apiKey);
  if (!resolved) return false;

  const fingerprint = fingerprintApiKey(resolved);
  const metadata = await readMetadata(ANYROUTER_PROVIDER_ID);
  const existing = metadata.accounts.find((a) => a.keyFingerprint === fingerprint);
  if (existing) return false;

  const now = new Date().toISOString();
  const accountId = generateAccountId();
  const shouldActivate = metadata.activeAccountId === null;
  const entry: ApiKeyAccountMetadata = {
    accountId,
    displayName: "Imported AnyRouter key",
    description: "Imported from anyrouter.json apiKey",
    maskedKeyPreview: maskApiKey(resolved),
    keyFingerprint: fingerprint,
    createdAt: now,
    updatedAt: now,
    lastActivatedAt: shouldActivate ? now : now,
    importedFromLegacyAt: now,
  };

  await writeJsonFileAtomic(ANYROUTER_PROVIDER_ID, secretPath(ANYROUTER_PROVIDER_ID, accountId), {
    type: "api_key" as const,
    key: resolved,
  });

  await writeMetadata(ANYROUTER_PROVIDER_ID, {
    version: 1,
    provider: ANYROUTER_PROVIDER_ID,
    activeAccountId: shouldActivate ? accountId : metadata.activeAccountId,
    accounts: [...metadata.accounts, entry],
  });

  if (shouldActivate) {
    await syncAnyRouterActiveDerivedMirrors(resolved);
  }

  return true;
}

/**
 * Ensure legacy single keys have been imported into the multi-account store.
 * Idempotent and non-destructive for source configs.
 *
 * Returns `true` when a new account was created (first import), `false`
 * otherwise.
 */
export async function importLegacyKeyIfNeeded(provider: string): Promise<boolean> {
  assertManagedProvider(provider);

  return withApiKeyProviderLock(provider, async () => {
    let imported = await importLegacyKeyFromAuthJson(provider);
    if (provider === ANYROUTER_PROVIDER_ID) {
      const sourceImported = await importLegacyAnyrouterSourceKeyIfNeeded();
      imported = imported || sourceImported;
    }
    return imported;
  });
}

// ---------------------------------------------------------------------------
// CRUD: list / create / update / delete / activate / reveal
// ---------------------------------------------------------------------------

async function listApiKeyAccountsUnlocked(provider: string): Promise<ApiKeyAccountsList> {
  const metadata = await readMetadata(provider);

  // Prune any entries whose secret file is missing
  const alive: ApiKeyAccountMetadata[] = [];
  for (const entry of metadata.accounts) {
    if (await pathExists(secretPath(provider, entry.accountId))) {
      alive.push(entry);
    }
  }

  if (alive.length !== metadata.accounts.length) {
    const activeAccountId =
      metadata.activeAccountId && alive.some((a) => a.accountId === metadata.activeAccountId)
        ? metadata.activeAccountId
        : null;
    await writeMetadata(provider, { version: 1, provider, activeAccountId, accounts: alive });
    return listApiKeyAccountsUnlocked(provider);
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

export async function listApiKeyAccounts(provider: string): Promise<ApiKeyAccountsList> {
  assertManagedProvider(provider);

  // Trigger legacy import if needed (already under provider lock).
  await importLegacyKeyIfNeeded(provider);

  return withApiKeyProviderLock(provider, () => listApiKeyAccountsUnlocked(provider));
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
  const baseUrlOverrideInput = parseBaseUrlOverrideInput(input.baseUrlOverride);

  // Import + create under one provider lock so concurrent creates cannot race
  // past a shared fingerprint check or miss a just-imported legacy key.
  let needsLiveReload = false;
  const listed = await withApiKeyProviderLock(provider, async () => {
    const activeBefore = (await readMetadata(provider)).activeAccountId;
    await importLegacyKeyFromAuthJson(provider);
    if (provider === ANYROUTER_PROVIDER_ID) {
      await importLegacyAnyrouterSourceKeyIfNeeded();
    }

    const metadata = await readMetadata(provider);
    // Legacy import may have written AnyRouter bridge/auth under this lock.
    if (
      provider === ANYROUTER_PROVIDER_ID &&
      metadata.activeAccountId &&
      metadata.activeAccountId !== activeBefore
    ) {
      needsLiveReload = true;
    }
    const fingerprint = fingerprintApiKey(apiKey);

    const duplicate = metadata.accounts.find((a) => a.keyFingerprint === fingerprint);
    if (duplicate) {
      throw new ApiKeyAccountStoreError("An account with the same API key already exists", 409);
    }

    const now = new Date().toISOString();
    const accountId = generateAccountId();
    const maskedKeyPreview = maskApiKey(apiKey);
    const shouldActivate = input.activate !== false || metadata.accounts.length === 0;
    const baseUrlOverride =
      baseUrlOverrideInput === null || baseUrlOverrideInput === undefined
        ? undefined
        : baseUrlOverrideInput;

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
      ...(baseUrlOverride ? { baseUrlOverride } : {}),
    };

    await writeJsonFileAtomic(provider, secretPath(provider, accountId), {
      type: "api_key" as const,
      key: apiKey,
    });

    const nextMetadata: ApiKeyAccountStoreMetadata = {
      version: 1,
      provider,
      activeAccountId: shouldActivate ? accountId : metadata.activeAccountId,
      accounts: [...metadata.accounts, entry],
    };
    await writeMetadata(provider, nextMetadata);

    if (shouldActivate) {
      if (provider === ANYROUTER_PROVIDER_ID) {
        // Managed Active is committed; rebuild bridge + auth under the same lock.
        await syncAnyRouterActiveDerivedMirrors(apiKey);
        needsLiveReload = true;
      } else {
        await mirrorActiveCredential(provider, {
          type: "set",
          credential: { type: "api_key", key: apiKey },
        });
      }
    }

    return listApiKeyAccountsUnlocked(provider);
  });
  if (needsLiveReload) {
    await reloadLiveAuthStateAfterUnlock();
  }
  return listed;
}

export async function updateApiKeyAccount(
  provider: string,
  accountId: string,
  input: UpdateApiKeyAccountInput,
): Promise<ApiKeyAccountsList> {
  assertManagedProvider(provider);
  const normalizedId = accountId.trim();
  if (!normalizedId) throw new ApiKeyAccountStoreError("accountId is required", 400);

  const hasBaseUrlOverride = Object.prototype.hasOwnProperty.call(input, "baseUrlOverride");
  const baseUrlOverrideInput = hasBaseUrlOverride
    ? parseBaseUrlOverrideInput(input.baseUrlOverride)
    : undefined;

  let needsLiveReload = false;
  const listed = await withApiKeyProviderLock(provider, async () => {
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
    let baseUrlOverrideChanged = false;

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
    if (hasBaseUrlOverride) {
      if (baseUrlOverrideInput === null || baseUrlOverrideInput === undefined) {
        delete nextEntry.baseUrlOverride;
      } else {
        nextEntry.baseUrlOverride = baseUrlOverrideInput;
      }
      baseUrlOverrideChanged =
        (entry.baseUrlOverride ?? null) !== (nextEntry.baseUrlOverride ?? null);
    }
    if (input.apiKey !== undefined) {
      const trimmed = input.apiKey.trim();
      if (!trimmed) throw new ApiKeyAccountStoreError("apiKey must not be empty", 400);
      const fingerprint = fingerprintApiKey(trimmed);
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
    // Non-active updates never change the Active pointer.
    await writeMetadata(provider, { ...metadata, accounts });

    if (keyChanged) {
      await writeJsonFileAtomic(provider, secretPath(provider, normalizedId), {
        type: "api_key" as const,
        key: newKey,
      });
    }

    const isActive = metadata.activeAccountId === normalizedId;

    // Non-active updates must never write bridge/auth.
    if (!isActive) {
      return listApiKeyAccountsUnlocked(provider);
    }

    if (provider === ANYROUTER_PROVIDER_ID) {
      // Active key *or* baseUrlOverride changes rebuild the runtime bridge.
      // displayName/description-only edits leave derived mirrors alone.
      if (keyChanged || baseUrlOverrideChanged) {
        await syncAnyRouterActiveDerivedMirrors(keyChanged ? newKey : null);
        needsLiveReload = true;
      }
    } else if (keyChanged) {
      await mirrorActiveCredential(provider, {
        type: "set",
        credential: { type: "api_key", key: newKey },
      });
    }

    return listApiKeyAccountsUnlocked(provider);
  });
  if (needsLiveReload) {
    await reloadLiveAuthStateAfterUnlock();
  }
  return listed;
}

/**
 * Delete an API key account.
 *
 * - Non-active: simply removes it.
 * - Active (xai / opencode-go): falls back to the most recently activated
 *   remaining account, or clears auth when deleting the last account.
 * - Active (anyrouter): requires explicit `replacementAccountId` or
 *   `clearActive` when other accounts remain; last-account delete clears.
 */
export async function deleteApiKeyAccount(
  provider: string,
  accountId: string,
  options: ApiKeyAccountDeleteOptions = {},
): Promise<ApiKeyAccountsList> {
  assertManagedProvider(provider);
  const normalizedId = accountId.trim();
  if (!normalizedId) throw new ApiKeyAccountStoreError("accountId is required", 400);

  let needsLiveReload = false;
  const listed = await withApiKeyProviderLock(provider, async () => {
    if (!(await pathExists(secretPath(provider, normalizedId)))) {
      throw new ApiKeyAccountStoreError("Account not found", 404);
    }

    const metadata = await readMetadata(provider);
    const remaining = metadata.accounts.filter((a) => a.accountId !== normalizedId);
    const isActive = metadata.activeAccountId === normalizedId;

    if (remaining.length === 0) {
      await unlink(secretPath(provider, normalizedId)).catch(() => {});
      await writeMetadata(provider, {
        version: 1,
        provider,
        activeAccountId: null,
        accounts: [],
      });
      if (isActive) {
        if (provider === ANYROUTER_PROVIDER_ID) {
          await syncAnyRouterActiveDerivedMirrors();
          needsLiveReload = true;
        } else {
          await mirrorActiveCredential(provider, { type: "clear" });
        }
      }
      return listApiKeyAccountsUnlocked(provider);
    }

    let nextActiveId = metadata.activeAccountId;
    let accountsToWrite = remaining;

    if (isActive) {
      if (requiresExplicitActiveDisposition(provider)) {
        const replacementId = options.replacementAccountId?.trim();
        if (replacementId) {
          if (replacementId === normalizedId) {
            throw new ApiKeyAccountStoreError("Cannot replace active account with itself", 400);
          }
          const replacement = remaining.find((a) => a.accountId === replacementId);
          if (!replacement) {
            throw new ApiKeyAccountStoreError("Replacement account not found", 404);
          }
          if (replacement.disabled) {
            throw new ApiKeyAccountStoreError(
              "Replacement account is disabled. Enable it first.",
              409,
            );
          }
          const now = new Date().toISOString();
          nextActiveId = replacement.accountId;
          accountsToWrite = remaining.map((a) =>
            a.accountId === replacement.accountId
              ? { ...a, lastActivatedAt: now, updatedAt: now }
              : a,
          );
        } else if (options.clearActive) {
          nextActiveId = null;
        } else {
          throw new ApiKeyAccountStoreError(
            "Cannot delete the active AnyRouter account without a replacement or explicit disconnect. " +
              "Provide a replacementAccountId or set clearActive to true.",
            409,
          );
        }
      } else {
        // Legacy providers: pick fallback by lastActivatedAt desc.
        const sorted = [...remaining].sort((a, b) => {
          const aTime = a.lastActivatedAt ?? a.updatedAt;
          const bTime = b.lastActivatedAt ?? b.updatedAt;
          return bTime.localeCompare(aTime);
        });
        const fallback = sorted[0];
        nextActiveId = fallback.accountId;
        const now = new Date().toISOString();
        accountsToWrite = remaining.map((a) =>
          a.accountId === fallback.accountId
            ? { ...a, lastActivatedAt: now, updatedAt: now }
            : a,
        );
      }
    }

    await unlink(secretPath(provider, normalizedId)).catch(() => {});
    await writeMetadata(provider, {
      version: 1,
      provider,
      activeAccountId: nextActiveId,
      accounts: accountsToWrite,
    });

    if (isActive) {
      if (provider === ANYROUTER_PROVIDER_ID) {
        await syncAnyRouterActiveDerivedMirrors();
        needsLiveReload = true;
      } else if (nextActiveId) {
        const secret = await readJsonFile(
          secretPath(provider, nextActiveId),
          "API key account secret",
        );
        if (secret && isRecord(secret) && typeof secret.key === "string") {
          await mirrorActiveCredential(provider, {
            type: "set",
            credential: { type: "api_key", key: secret.key },
          });
        }
      } else {
        await mirrorActiveCredential(provider, { type: "clear" });
      }
    }

    return listApiKeyAccountsUnlocked(provider);
  });
  if (needsLiveReload) {
    await reloadLiveAuthStateAfterUnlock();
  }
  return listed;
}

/**
 * Activate an API key account, mirror its credential to auth.json, and reload
 * the RPC auth state so live sessions pick up the new key.
 *
 * For AnyRouter, also rebuilds the Active runtime bridge under the provider
 * lock. Same-account Activate still re-syncs so a failed/missing derived
 * mirror can be repaired.
 */
export async function activateApiKeyAccount(
  provider: string,
  accountId: string,
): Promise<ApiKeyAccountsList> {
  assertManagedProvider(provider);
  const normalizedId = accountId.trim();
  if (!normalizedId) throw new ApiKeyAccountStoreError("accountId is required", 400);

  let needsLiveReload = false;
  const listed = await withApiKeyProviderLock(provider, async () => {
    if (!(await pathExists(secretPath(provider, normalizedId)))) {
      throw new ApiKeyAccountStoreError("Account not found", 404);
    }

    const secret = await readJsonFile(secretPath(provider, normalizedId), "API key account secret");
    if (!secret || !isRecord(secret) || typeof secret.key !== "string") {
      throw new ApiKeyAccountStoreError("Account secret is invalid", 500);
    }

    const metadata = await readMetadata(provider);

    const targetEntry = metadata.accounts.find((a) => a.accountId === normalizedId);
    if (targetEntry?.disabled) {
      throw new ApiKeyAccountDisabledError(
        targetEntry.disabledReason
          ? `Account is disabled: ${targetEntry.disabledReason}. Enable it first.`
          : undefined,
      );
    }

    // Same-account Activate still re-mirrors so a failed/missing auth/bridge
    // can be repaired (reconcile under lock).
    const now = new Date().toISOString();
    const accounts = metadata.accounts.map((a) =>
      a.accountId === normalizedId ? { ...a, lastActivatedAt: now, updatedAt: now } : a,
    );

    await writeMetadata(provider, {
      version: 1,
      provider,
      activeAccountId: normalizedId,
      accounts,
    });

    if (provider === ANYROUTER_PROVIDER_ID) {
      await syncAnyRouterActiveDerivedMirrors(secret.key);
      needsLiveReload = true;
    } else {
      await mirrorActiveCredential(provider, {
        type: "set",
        credential: { type: "api_key", key: secret.key },
      });
    }

    return listApiKeyAccountsUnlocked(provider);
  });
  if (needsLiveReload) {
    await reloadLiveAuthStateAfterUnlock();
  }
  return listed;
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

  // Read-only; no lock required. Missing/invalid secrets fail closed.
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
export async function getApiKeyProviderSummary(provider: string): Promise<{
  provider: string;
  configured: boolean;
  authMode: "managed_accounts" | "single";
  accountCount: number;
  activeAccountId: string | null;
  activeAccountDisplayName: string | null;
} | null> {
  if (!isManagedApiKeyProvider(provider)) return null;

  const metadata = await readMetadata(provider);

  const hasLocalAccounts = metadata.accounts.length > 0;
  const store = await getWebCredentialStore();
  const credential = await store.read(provider);
  let configured =
    hasLocalAccounts ||
    (credential?.type === "api_key" && typeof credential.key === "string");

  // AnyRouter may also be "configured" via source apiKey without auth.json yet.
  if (!configured && provider === ANYROUTER_PROVIDER_ID) {
    const source = readAnyrouterConfigRaw();
    if (!source.parseError && resolveLegacyAnyrouterSourceApiKey(source.apiKey)) {
      configured = true;
    }
  }

  let activeAccountDisplayName: string | null = null;
  if (hasLocalAccounts && metadata.activeAccountId) {
    const activeEntry = metadata.accounts.find((a) => a.accountId === metadata.activeAccountId);
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

  let needsLiveReload = false;
  const listed = await withApiKeyProviderLock(provider, async () => {
    if (!(await pathExists(secretPath(provider, normalizedId)))) {
      throw new ApiKeyAccountStoreError("Account not found", 404);
    }

    const metadata = await readMetadata(provider);
    const entry = metadata.accounts.find((a) => a.accountId === normalizedId);
    if (!entry) throw new ApiKeyAccountStoreError("Account metadata not found", 404);

    if (entry.disabled) {
      return listApiKeyAccountsUnlocked(provider);
    }

    const now = new Date().toISOString();
    const isActive = metadata.activeAccountId === normalizedId;
    let nextActiveId = metadata.activeAccountId;
    let replacementKey: string | null = null;

    if (isActive) {
      if (options.replacementAccountId) {
        const replacementId = options.replacementAccountId.trim();
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
        const revealed = await revealApiKeyAccountInternal(provider, replacementId);
        replacementKey = revealed.apiKey;
        nextActiveId = replacementId;
      } else if (options.clearActive) {
        nextActiveId = null;
      } else {
        throw new ApiKeyAccountStoreError(
          "Cannot disable the active account without a replacement or explicit clearActive. " +
            "Provide a replacementAccountId or set clearActive to true.",
          409,
        );
      }
    }

    const accounts = metadata.accounts.map((a) =>
      a.accountId === normalizedId
        ? {
            ...a,
            updatedAt: now,
            disabled: true,
            disabledAt: now,
            disabledReason:
              options.reason ||
              (options.disabledBy === "system" ? "Disabled" : "Manually disabled"),
            disabledBy: options.disabledBy || "user",
            autoDisabledReason: options.autoDisabledReason,
            enabledAt: undefined,
            enabledBy: undefined,
          }
        : a,
    );

    // Commit managed metadata first (authority), then derived mirrors.
    await writeMetadata(provider, {
      version: 1,
      provider,
      activeAccountId: nextActiveId,
      accounts,
    });

    if (isActive) {
      if (provider === ANYROUTER_PROVIDER_ID) {
        await syncAnyRouterActiveDerivedMirrors(replacementKey);
        needsLiveReload = true;
      } else if (replacementKey) {
        await mirrorActiveCredential(provider, {
          type: "set",
          credential: { type: "api_key", key: replacementKey },
        });
      } else if (options.clearActive) {
        await mirrorActiveCredential(provider, { type: "clear" });
      }
    }

    return listApiKeyAccountsUnlocked(provider);
  });
  if (needsLiveReload) {
    await reloadLiveAuthStateAfterUnlock();
  }
  return listed;
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

  return withApiKeyProviderLock(provider, async () => {
    if (!(await pathExists(secretPath(provider, normalizedId)))) {
      throw new ApiKeyAccountStoreError("Account not found", 404);
    }

    const metadata = await readMetadata(provider);
    const entry = metadata.accounts.find((a) => a.accountId === normalizedId);
    if (!entry) throw new ApiKeyAccountStoreError("Account metadata not found", 404);

    if (!entry.disabled) {
      return listApiKeyAccountsUnlocked(provider);
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

    return listApiKeyAccountsUnlocked(provider);
  });
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
