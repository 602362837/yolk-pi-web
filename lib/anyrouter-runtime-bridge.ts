/**
 * AnyRouter Active runtime bridge.
 *
 * Managed account slot/pointer is the authority. Derived mirrors:
 * 1. `auth-api-key-accounts/anyrouter/.runtime/provider.json` (0600) — Active-only
 *    snapshot consumed by patched `pi-anyrouter@0.3.2` via `PI_ANYROUTER_CC_CONFIG`
 * 2. `auth.json.anyrouter` — Pi/Web CredentialStore compatibility mirror
 *
 * This module never mutates process env per request. The fixed provider loader
 * points `PI_ANYROUTER_CC_CONFIG` at the stable bridge path once before the
 * package is first imported. Lock order for Active work is always
 * AnyRouter provider lock → auth.json (raw WebCredentialStore).
 */

import { randomBytes } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  unlink,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ApiKeyCredential } from "@earendil-works/pi-ai";
import {
  ANYROUTER_PROVIDER_ID,
  ANYROUTER_RETRY_DEFAULTS,
  type AnyRouterRetryPolicy,
  readAnyrouterConfigRaw,
  resolveAnyRouterEffectiveBaseUrl,
  resolveAnyRouterRetryPolicy,
} from "@/lib/anyrouter-config";
import { getWebCredentialStore } from "@/lib/web-credential-store";

// ── Paths / modes ─────────────────────────────────────────────────────────────

const ACCOUNT_STORE_DIR = "auth-api-key-accounts";
const METADATA_FILE = "accounts.json";
const RUNTIME_DIR = ".runtime";
const BRIDGE_FILE = "provider.json";
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

const ENV_CONFIG_PATH = "PI_ANYROUTER_CC_CONFIG";

export type AnyRouterRuntimeBridgeSnapshot = {
  webManaged: true;
  baseUrl: string;
  apiKey: string;
  models: unknown[];
  retry: AnyRouterRetryPolicy;
};

export type AnyRouterRuntimeBridgeSyncResult = {
  /** Current managed Active account id after re-read (null when disconnected). */
  activeAccountId: string | null;
  /** Whether a webManaged bridge file is present after sync. */
  bridgePresent: boolean;
  /** Whether auth.json.anyrouter was written or cleared to match Active. */
  authMirrored: boolean;
  /** Effective Base URL written into the bridge (null when bridge removed). */
  effectiveBaseUrl: string | null;
  /** True when managed Active exists but secret/baseUrl/models blocked a full bridge. */
  incomplete?: boolean;
  /** Stable machine-readable reason when incomplete or mirror partially failed. */
  reason?: string;
};

export class AnyRouterRuntimeBridgeError extends Error {
  constructor(
    message: string,
    public readonly status = 500,
    public readonly code:
      | "write_failed"
      | "auth_mirror_failed"
      | "parse_error"
      | "incomplete_active" = "write_failed",
    public readonly retryable = true,
  ) {
    super(message);
    this.name = "AnyRouterRuntimeBridgeError";
  }
}

// ── Path helpers ──────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function anyrouterAccountDir(): string {
  return join(getAgentDir(), ACCOUNT_STORE_DIR, ANYROUTER_PROVIDER_ID);
}

function metadataPath(): string {
  return join(anyrouterAccountDir(), METADATA_FILE);
}

function secretPath(accountId: string): string {
  return join(anyrouterAccountDir(), `${encodeURIComponent(accountId)}.json`);
}

export function getAnyRouterRuntimeBridgeDir(): string {
  return join(anyrouterAccountDir(), RUNTIME_DIR);
}

/**
 * Stable absolute path of the Active runtime bridge file.
 * Patched pi-anyrouter reads this via `PI_ANYROUTER_CC_CONFIG`.
 */
export function getAnyRouterRuntimeBridgePath(): string {
  return join(getAnyRouterRuntimeBridgeDir(), BRIDGE_FILE);
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

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: DIR_MODE });
  await chmod(dir, DIR_MODE).catch(() => {});
}

async function writeJsonFileAtomic(targetPath: string, value: unknown): Promise<void> {
  await ensureDir(dirname(targetPath));
  const temp = `${targetPath}.tmp.${process.pid}.${randomBytes(6).toString("hex")}`;
  const body = `${JSON.stringify(value, null, 2)}\n`;
  try {
    const handle = await open(temp, "w", FILE_MODE);
    try {
      await handle.writeFile(body, "utf8");
      await handle.sync().catch(() => {});
    } finally {
      await handle.close();
    }
    await chmod(temp, FILE_MODE).catch(() => {});
    await rename(temp, targetPath);
    await chmod(targetPath, FILE_MODE).catch(() => {});
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

async function removeFileIfExists(targetPath: string): Promise<void> {
  try {
    await unlink(targetPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw error;
  }
}

// ── Env pointer (loader-time only) ────────────────────────────────────────────

/**
 * Point patched pi-anyrouter at the Web-managed bridge path.
 *
 * Must run before the package module is first evaluated: `CONFIG_PATH` is a
 * module-level constant. Never rewrite this env per request / per account.
 */
export function ensureAnyRouterConfigEnvPointsAtBridge(): string {
  const bridgePath = getAnyRouterRuntimeBridgePath();
  process.env[ENV_CONFIG_PATH] = bridgePath;
  return bridgePath;
}

export function getAnyRouterConfigEnvNameForTests(): string {
  return ENV_CONFIG_PATH;
}

// ── Managed store reads (authority) ───────────────────────────────────────────

type ManagedMetadata = {
  activeAccountId: string | null;
  accounts: Array<{
    accountId: string;
    baseUrlOverride?: string;
    disabled?: boolean;
  }>;
};

async function readManagedMetadata(): Promise<ManagedMetadata> {
  try {
    const raw = JSON.parse(await readFile(metadataPath(), "utf8")) as unknown;
    if (!isRecord(raw) || raw.version !== 1) {
      // Fail closed: do not invent Active state from a future/malformed schema.
      throw new AnyRouterRuntimeBridgeError(
        "AnyRouter account metadata is invalid or unsupported",
        500,
        "parse_error",
        false,
      );
    }
    const accounts = Array.isArray(raw.accounts)
      ? raw.accounts
          .map((entry) => {
            if (!isRecord(entry) || typeof entry.accountId !== "string") return null;
            const baseUrlOverride =
              typeof entry.baseUrlOverride === "string" && entry.baseUrlOverride.trim()
                ? entry.baseUrlOverride.trim()
                : undefined;
            return {
              accountId: entry.accountId,
              ...(baseUrlOverride ? { baseUrlOverride } : {}),
              disabled: entry.disabled === true ? true : undefined,
            };
          })
          .filter((e): e is NonNullable<typeof e> => e !== null)
      : [];
    const activeAccountId =
      typeof raw.activeAccountId === "string" && raw.activeAccountId.trim()
        ? raw.activeAccountId.trim()
        : null;
    return { activeAccountId, accounts };
  } catch (error) {
    if (error instanceof AnyRouterRuntimeBridgeError) throw error;
    if (isNodeError(error) && error.code === "ENOENT") {
      return { activeAccountId: null, accounts: [] };
    }
    throw new AnyRouterRuntimeBridgeError(
      "Failed to read AnyRouter account metadata",
      500,
      "parse_error",
      true,
    );
  }
}

async function readManagedSecretKey(accountId: string): Promise<string | null> {
  try {
    const raw = JSON.parse(await readFile(secretPath(accountId), "utf8")) as unknown;
    if (!isRecord(raw) || typeof raw.key !== "string" || !raw.key.trim()) return null;
    return raw.key;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    return null;
  }
}

// ── Bridge build / write ──────────────────────────────────────────────────────

function buildBridgeSnapshot(input: {
  apiKey: string;
  baseUrl: string;
  models: unknown[];
  retry: AnyRouterRetryPolicy;
}): AnyRouterRuntimeBridgeSnapshot {
  return {
    webManaged: true,
    baseUrl: input.baseUrl,
    // Literal key only — never an env-name indirection (webManaged path does
    // not re-layer process env for apiKey/baseUrl).
    apiKey: input.apiKey,
    models: input.models,
    retry: input.retry,
  };
}

/**
 * Atomically write the Active runtime bridge (0600 under 0700 `.runtime/`).
 * Callers must already hold the AnyRouter provider lock for Active mutations.
 */
export async function writeAnyRouterRuntimeBridgeUnlocked(
  snapshot: AnyRouterRuntimeBridgeSnapshot,
): Promise<void> {
  if (snapshot.webManaged !== true) {
    throw new AnyRouterRuntimeBridgeError(
      "Runtime bridge must set webManaged: true",
      500,
      "write_failed",
      false,
    );
  }
  if (!snapshot.baseUrl) {
    throw new AnyRouterRuntimeBridgeError(
      "Runtime bridge requires an effective baseUrl",
      500,
      "incomplete_active",
      true,
    );
  }
  try {
    await writeJsonFileAtomic(getAnyRouterRuntimeBridgePath(), snapshot);
  } catch (error) {
    throw new AnyRouterRuntimeBridgeError(
      error instanceof Error ? error.message : "Failed to write AnyRouter runtime bridge",
      500,
      "write_failed",
      true,
    );
  }
}

/**
 * Remove the derived runtime bridge file. Used when there is no usable Active
 * snapshot (disconnect) or effective endpoint cannot be resolved.
 */
export async function removeAnyRouterRuntimeBridgeUnlocked(): Promise<void> {
  try {
    await removeFileIfExists(getAnyRouterRuntimeBridgePath());
  } catch (error) {
    throw new AnyRouterRuntimeBridgeError(
      error instanceof Error ? error.message : "Failed to remove AnyRouter runtime bridge",
      500,
      "write_failed",
      true,
    );
  }
}

/**
 * Read the on-disk bridge for tests / diagnostics. Never log the returned key.
 */
export async function readAnyRouterRuntimeBridgeUnlocked(): Promise<AnyRouterRuntimeBridgeSnapshot | null> {
  const path = getAnyRouterRuntimeBridgePath();
  if (!(await pathExists(path))) return null;
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!isRecord(raw) || raw.webManaged !== true) return null;
    if (typeof raw.baseUrl !== "string" || !raw.baseUrl.trim()) return null;
    const apiKey = typeof raw.apiKey === "string" ? raw.apiKey : "";
    const models = Array.isArray(raw.models) ? raw.models : [];
    const retryRaw = isRecord(raw.retry) ? raw.retry : {};
    const retry: AnyRouterRetryPolicy = {
      maxRetries:
        typeof retryRaw.maxRetries === "number"
          ? retryRaw.maxRetries
          : ANYROUTER_RETRY_DEFAULTS.maxRetries,
      baseDelayMs:
        typeof retryRaw.baseDelayMs === "number"
          ? retryRaw.baseDelayMs
          : ANYROUTER_RETRY_DEFAULTS.baseDelayMs,
      maxDelayMs:
        typeof retryRaw.maxDelayMs === "number"
          ? retryRaw.maxDelayMs
          : ANYROUTER_RETRY_DEFAULTS.maxDelayMs,
      jitterMs:
        typeof retryRaw.jitterMs === "number"
          ? retryRaw.jitterMs
          : ANYROUTER_RETRY_DEFAULTS.jitterMs,
      retryAfterCapMs:
        typeof retryRaw.retryAfterCapMs === "number"
          ? retryRaw.retryAfterCapMs
          : ANYROUTER_RETRY_DEFAULTS.retryAfterCapMs,
    };
    return {
      webManaged: true,
      baseUrl: raw.baseUrl,
      apiKey,
      models,
      retry,
    };
  } catch {
    return null;
  }
}

// ── Auth mirror (CAS against managed Active) ──────────────────────────────────

async function mirrorAuthJson(
  action: { type: "set"; credential: ApiKeyCredential } | { type: "clear" },
): Promise<void> {
  try {
    const store = await getWebCredentialStore();
    if (action.type === "set") {
      await store.modify(ANYROUTER_PROVIDER_ID, async () => action.credential);
    } else {
      await store.delete(ANYROUTER_PROVIDER_ID);
    }
  } catch (error) {
    throw new AnyRouterRuntimeBridgeError(
      error instanceof Error ? error.message : "Failed to mirror AnyRouter auth.json",
      500,
      "auth_mirror_failed",
      true,
    );
  }
}

// ── Sync (caller holds provider lock) ─────────────────────────────────────────

/**
 * Rebuild derived mirrors from managed Active authority.
 *
 * Call only while holding the AnyRouter provider lock (or from a cold-load
 * path that acquires it). Does **not** call `reloadRpcAuthState` — callers
 * must reload after releasing the provider lock.
 *
 * Failure semantics:
 * - Managed slot/pointer is never rolled back here (caller already committed).
 * - Bridge / auth failures throw a retryable `AnyRouterRuntimeBridgeError`
 *   so the API surface can report failure without false success.
 * - Same-account Activate / cold load re-run this to repair missing mirrors.
 */
export async function syncAnyRouterDerivedMirrorsUnlocked(options?: {
  /**
   * Optional key already loaded by the caller (avoids a second secret read
   * during Activate). Still re-validates Active id under lock.
   */
  knownActiveApiKey?: string | null;
}): Promise<AnyRouterRuntimeBridgeSyncResult> {
  // Always re-read authority under the caller's lock.
  const metadata = await readManagedMetadata();
  let activeAccountId = metadata.activeAccountId;

  // Disabled Active is treated as incomplete: do not keep serving its key.
  if (activeAccountId) {
    const activeEntry = metadata.accounts.find((a) => a.accountId === activeAccountId);
    if (!activeEntry || activeEntry.disabled) {
      activeAccountId = null;
    }
  }

  const source = readAnyrouterConfigRaw();
  if (source.parseError) {
    // Fail closed: do not invent models/baseUrl from a broken source file.
    throw new AnyRouterRuntimeBridgeError(
      `anyrouter.json is invalid: ${source.parseError}`,
      500,
      "parse_error",
      false,
    );
  }

  const retry = resolveAnyRouterRetryPolicy(source.retry).effective;
  const models = source.models;

  if (!activeAccountId) {
    // Disconnect / no Active: remove Active-only secrets from the bridge and
    // clear the auth.json compatibility mirror. Keep a catalog-only bridge
    // when global baseUrl + models exist so cold registration can still load.
    const globalBaseUrl = resolveAnyRouterEffectiveBaseUrl({
      accountBaseUrlOverride: null,
      storedGlobalBaseUrl: source.baseUrl,
    });

    if (globalBaseUrl && models.length > 0) {
      await writeAnyRouterRuntimeBridgeUnlocked(
        buildBridgeSnapshot({
          apiKey: "",
          baseUrl: globalBaseUrl,
          models,
          retry,
        }),
      );
    } else {
      await removeAnyRouterRuntimeBridgeUnlocked();
    }

    await mirrorAuthJson({ type: "clear" });
    return {
      activeAccountId: null,
      bridgePresent: Boolean(globalBaseUrl && models.length > 0),
      authMirrored: true,
      effectiveBaseUrl: globalBaseUrl && models.length > 0 ? globalBaseUrl : null,
    };
  }

  const activeEntry = metadata.accounts.find((a) => a.accountId === activeAccountId);
  const apiKey =
    typeof options?.knownActiveApiKey === "string" && options.knownActiveApiKey
      ? options.knownActiveApiKey
      : await readManagedSecretKey(activeAccountId);

  if (!apiKey) {
    // Active pointer without a usable secret: clear derived mirrors so we do
    // not keep serving a stale auth/bridge snapshot. Managed metadata stays
    // (authority); repeat Activate after repairing the secret slot.
    await removeAnyRouterRuntimeBridgeUnlocked();
    await mirrorAuthJson({ type: "clear" });
    throw new AnyRouterRuntimeBridgeError(
      "Active AnyRouter account secret is missing or invalid",
      500,
      "incomplete_active",
      true,
    );
  }

  let effectiveBaseUrl: string | null = null;
  try {
    effectiveBaseUrl = resolveAnyRouterEffectiveBaseUrl({
      accountBaseUrlOverride: activeEntry?.baseUrlOverride ?? null,
      storedGlobalBaseUrl: source.baseUrl,
    });
  } catch {
    effectiveBaseUrl = null;
  }

  if (!effectiveBaseUrl) {
    await removeAnyRouterRuntimeBridgeUnlocked();
    // Still mirror the key into auth.json for CredentialStore status; stream
    // adapter cannot work without baseUrl until config is fixed.
    await mirrorAuthJson({
      type: "set",
      credential: { type: "api_key", key: apiKey },
    });
    throw new AnyRouterRuntimeBridgeError(
      "Active AnyRouter account has no effective Base URL (set account override or global baseUrl)",
      500,
      "incomplete_active",
      true,
    );
  }

  if (models.length === 0) {
    // Write Active key+baseUrl+retry with empty models so request-time path can
    // still see credentials if models are added later without re-Activate; the
    // package registration path will fail closed on empty models until fixed.
    await writeAnyRouterRuntimeBridgeUnlocked(
      buildBridgeSnapshot({
        apiKey,
        baseUrl: effectiveBaseUrl,
        models: [],
        retry,
      }),
    );
  } else {
    await writeAnyRouterRuntimeBridgeUnlocked(
      buildBridgeSnapshot({
        apiKey,
        baseUrl: effectiveBaseUrl,
        models,
        retry,
      }),
    );
  }

  // Active-CAS: re-read managed Active before writing auth.json so a concurrent
  // mutation that already committed a different Active (under a later lock
  // acquisition) cannot be clobbered by a stale writer. Under a correct lock
  // this re-read matches activeAccountId; if not, refuse to write auth.
  const recheck = await readManagedMetadata();
  if (recheck.activeAccountId !== activeAccountId) {
    throw new AnyRouterRuntimeBridgeError(
      "AnyRouter Active account changed during mirror; retry",
      409,
      "auth_mirror_failed",
      true,
    );
  }

  await mirrorAuthJson({
    type: "set",
    credential: { type: "api_key", key: apiKey },
  });

  return {
    activeAccountId,
    bridgePresent: true,
    authMirrored: true,
    effectiveBaseUrl,
    incomplete: models.length === 0 ? true : undefined,
    reason: models.length === 0 ? "models_empty" : undefined,
  };
}

/**
 * Acquire the AnyRouter provider lock and reconcile derived mirrors.
 * Safe for cold provider load and repeated same-account Activate repair.
 * Does not reload live RPC wrappers — caller should `reloadRpcAuthState`
 * after this returns when a live refresh is required.
 */
export async function reconcileAnyRouterRuntimeMirrors(): Promise<AnyRouterRuntimeBridgeSyncResult> {
  // Dynamic import breaks the static cycle with api-key-accounts.
  const { withApiKeyProviderLock } = await import("@/lib/api-key-accounts");
  return withApiKeyProviderLock(ANYROUTER_PROVIDER_ID, () => syncAnyRouterDerivedMirrorsUnlocked());
}

/**
 * Rebuild bridge (+ auth when Active) after source-config changes
 * (global baseUrl / retry). Must be awaited by config PATCH (AR-04).
 */
export async function rebuildAnyRouterRuntimeBridgeAfterConfigChange(): Promise<AnyRouterRuntimeBridgeSyncResult> {
  return reconcileAnyRouterRuntimeMirrors();
}
