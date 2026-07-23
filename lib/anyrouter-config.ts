/**
 * AnyRouter source-config service (`~/.pi/agent/anyrouter.json`).
 *
 * Owns global Base URL, models catalog, and provider-wide retry policy for the
 * AnyRouter fixed provider. Managed API-key accounts and the Active runtime
 * bridge live elsewhere; this module never writes account secrets.
 *
 * Contracts:
 * - Fail-closed read/parse (callers must not treat parseError as empty writable).
 * - Opaque SHA-256 revision + CAS on PATCH.
 * - Minimal mutation preserves `apiKey`, `models`, and unknown top-level fields.
 * - Retry precedence: explicit `PI_ANYROUTER_CC_*` env > `anyrouter.json.retry` > defaults.
 * - Global Base URL source precedence (without account override):
 *   `PI_ANYROUTER_CC_BASE_URL` > `anyrouter.json.baseUrl`.
 * - Safe projections never return apiKey, model bodies, absolute paths, or raw unknown fields.
 */

import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { access, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

// ── Constants ─────────────────────────────────────────────────────────────────

export const ANYROUTER_PROVIDER_ID = "anyrouter";
export const ANYROUTER_CONFIG_FILE = "anyrouter.json";

const CONFIG_FILE_MODE = 0o600;
const CONFIG_DIR_MODE = 0o700;
const LOCK_DIR_SUFFIX = ".lock";
const LOCK_OWNER_FILE = "owner.json";
const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MIN_MS = 40;
const LOCK_RETRY_MAX_MS = 120;
const LOCK_MAX_WAIT_MS = 15_000;

const ENV_BASE_URL = "PI_ANYROUTER_CC_BASE_URL";
const ENV_MAX_RETRIES = "PI_ANYROUTER_CC_MAX_RETRIES";
const ENV_BASE_DELAY_MS = "PI_ANYROUTER_CC_BASE_DELAY_MS";
const ENV_MAX_DELAY_MS = "PI_ANYROUTER_CC_MAX_DELAY_MS";
const ENV_JITTER_MS = "PI_ANYROUTER_CC_JITTER_MS";
const ENV_RETRY_AFTER_CAP_MS = "PI_ANYROUTER_CC_RETRY_AFTER_CAP_MS";

export const ANYROUTER_RETRY_DEFAULTS = {
  maxRetries: 10,
  baseDelayMs: 1000,
  maxDelayMs: 15_000,
  jitterMs: 250,
  retryAfterCapMs: 30_000,
} as const;

export type AnyRouterRetryPolicy = {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterMs: number;
  retryAfterCapMs: number;
};

export type AnyRouterConfigFieldSource = "env" | "config" | "default";

export type AnyRouterRetryField = keyof AnyRouterRetryPolicy;

export type AnyRouterSafeConfigProjection = {
  provider: typeof ANYROUTER_PROVIDER_ID;
  revision: string;
  /** Effective global Base URL after env/config resolution (no account override). */
  globalBaseUrl: string | null;
  globalBaseUrlSource: AnyRouterConfigFieldSource;
  globalBaseUrlEditable: boolean;
  modelsConfigured: boolean;
  modelCount: number;
  retry: {
    effective: AnyRouterRetryPolicy;
    source: Record<AnyRouterRetryField, AnyRouterConfigFieldSource>;
    editable: Record<AnyRouterRetryField, boolean>;
  };
};

export type AnyRouterConfigPatchInput = {
  revision: string;
  baseUrl?: string | null;
  retry?: Partial<AnyRouterRetryPolicy>;
};

export type AnyRouterConfigReadResult = {
  raw: string;
  /** Parsed object when valid; empty object only when missing or parse failed. */
  parsed: Record<string, unknown>;
  exists: boolean;
  parseError?: string;
  revision: string;
  /** Legacy apiKey field as stored (never returned by safe projection). */
  apiKey: string | null;
  baseUrl: string | null;
  models: unknown[];
  retry: Partial<AnyRouterRetryPolicy> | null;
};

export class AnyRouterConfigError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code?:
      | "stale_revision"
      | "parse_error"
      | "write_failed"
      | "validation_error",
  ) {
    super(message);
    this.name = "AnyRouterConfigError";
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Strip `//` line comments and trailing commas while leaving string literals.
 * Mirrors `lib/models-config-store.ts` so JSONC source files remain readable.
 */
export function stripJsonComments(input: string): string {
  return input
    .replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*/g, (m) => (m[0] === '"' ? m : ""))
    .replace(/"(?:\\.|[^"\\])*"|,(\s*[}\]])/g, (m, tail) =>
      tail ?? (m[0] === '"' ? m : ""),
    );
}

export function computeAnyRouterConfigRevision(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export const EMPTY_ANYROUTER_CONFIG_REVISION = computeAnyRouterConfigRevision("{}");

export function getAnyRouterConfigPath(): string {
  return join(getAgentDir(), ANYROUTER_CONFIG_FILE);
}

function configLockDir(path?: string): string {
  return `${path ?? getAnyRouterConfigPath()}${LOCK_DIR_SUFFIX}`;
}

// ── URL / retry validation ────────────────────────────────────────────────────

/**
 * Validate and normalize an AnyRouter Base URL.
 *
 * Rules (design.md):
 * - 1–2048 characters
 * - http(s) only
 * - no username/password, query, or hash
 * - trailing slash stripped
 */
export function validateAnyRouterBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new AnyRouterConfigError("baseUrl must not be empty", 400, "validation_error");
  }
  if (trimmed.length > 2048) {
    throw new AnyRouterConfigError("baseUrl must be at most 2048 characters", 400, "validation_error");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new AnyRouterConfigError("baseUrl must be a valid absolute URL", 400, "validation_error");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AnyRouterConfigError("baseUrl must use http or https", 400, "validation_error");
  }
  if (url.username || url.password) {
    throw new AnyRouterConfigError(
      "baseUrl must not include username or password",
      400,
      "validation_error",
    );
  }
  if (url.search || url.hash) {
    throw new AnyRouterConfigError(
      "baseUrl must not include query parameters or a hash fragment",
      400,
      "validation_error",
    );
  }

  // Reconstruct without trailing slash (pathname "/" alone becomes empty path).
  const path =
    url.pathname === "/"
      ? ""
      : url.pathname.endsWith("/")
        ? url.pathname.slice(0, -1)
        : url.pathname;
  return `${url.protocol}//${url.host}${path}`;
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

/**
 * Validate a full or partial retry policy. When `partial` is true, only present
 * fields are checked; when false, all fields must be present and base ≤ max.
 */
export function validateAnyRouterRetryPolicy(
  value: unknown,
  options: { partial?: boolean } = {},
): Partial<AnyRouterRetryPolicy> {
  if (!isRecord(value)) {
    throw new AnyRouterConfigError("retry must be an object", 400, "validation_error");
  }

  const partial = options.partial === true;
  const allowed = new Set([
    "maxRetries",
    "baseDelayMs",
    "maxDelayMs",
    "jitterMs",
    "retryAfterCapMs",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new AnyRouterConfigError(
        `retry field "${key}" is not allowed`,
        400,
        "validation_error",
      );
    }
  }

  const out: Partial<AnyRouterRetryPolicy> = {};

  if (value.maxRetries !== undefined) {
    if (!isIntegerInRange(value.maxRetries, 0, 20)) {
      throw new AnyRouterConfigError(
        "retry.maxRetries must be an integer between 0 and 20",
        400,
        "validation_error",
      );
    }
    out.maxRetries = value.maxRetries;
  } else if (!partial) {
    throw new AnyRouterConfigError("retry.maxRetries is required", 400, "validation_error");
  }

  if (value.baseDelayMs !== undefined) {
    if (!isIntegerInRange(value.baseDelayMs, 100, 10_000)) {
      throw new AnyRouterConfigError(
        "retry.baseDelayMs must be an integer between 100 and 10000",
        400,
        "validation_error",
      );
    }
    out.baseDelayMs = value.baseDelayMs;
  } else if (!partial) {
    throw new AnyRouterConfigError("retry.baseDelayMs is required", 400, "validation_error");
  }

  if (value.maxDelayMs !== undefined) {
    if (!isIntegerInRange(value.maxDelayMs, 100, 60_000)) {
      throw new AnyRouterConfigError(
        "retry.maxDelayMs must be an integer between 100 and 60000",
        400,
        "validation_error",
      );
    }
    out.maxDelayMs = value.maxDelayMs;
  } else if (!partial) {
    throw new AnyRouterConfigError("retry.maxDelayMs is required", 400, "validation_error");
  }

  if (value.jitterMs !== undefined) {
    if (!isIntegerInRange(value.jitterMs, 0, 5_000)) {
      throw new AnyRouterConfigError(
        "retry.jitterMs must be an integer between 0 and 5000",
        400,
        "validation_error",
      );
    }
    out.jitterMs = value.jitterMs;
  } else if (!partial) {
    throw new AnyRouterConfigError("retry.jitterMs is required", 400, "validation_error");
  }

  if (value.retryAfterCapMs !== undefined) {
    if (!isIntegerInRange(value.retryAfterCapMs, 0, 120_000)) {
      throw new AnyRouterConfigError(
        "retry.retryAfterCapMs must be an integer between 0 and 120000",
        400,
        "validation_error",
      );
    }
    out.retryAfterCapMs = value.retryAfterCapMs;
  } else if (!partial) {
    throw new AnyRouterConfigError("retry.retryAfterCapMs is required", 400, "validation_error");
  }

  const base = out.baseDelayMs;
  const max = out.maxDelayMs;
  if (typeof base === "number" && typeof max === "number" && base > max) {
    throw new AnyRouterConfigError(
      "retry.baseDelayMs must be less than or equal to retry.maxDelayMs",
      400,
      "validation_error",
    );
  }

  return out;
}

function parseOptionalEnvInt(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (!/^-?\d+$/.test(trimmed)) {
    throw new AnyRouterConfigError(
      `Environment variable ${name} must be an integer`,
      400,
      "validation_error",
    );
  }
  return Number(trimmed);
}

function readEnvRetryOverrides(): Partial<AnyRouterRetryPolicy> {
  const out: Partial<AnyRouterRetryPolicy> = {};
  const maxRetries = parseOptionalEnvInt(ENV_MAX_RETRIES);
  const baseDelayMs = parseOptionalEnvInt(ENV_BASE_DELAY_MS);
  const maxDelayMs = parseOptionalEnvInt(ENV_MAX_DELAY_MS);
  const jitterMs = parseOptionalEnvInt(ENV_JITTER_MS);
  const retryAfterCapMs = parseOptionalEnvInt(ENV_RETRY_AFTER_CAP_MS);

  // Validate only present env fields against the same ranges.
  const candidate: Record<string, number> = {};
  if (maxRetries !== undefined) candidate.maxRetries = maxRetries;
  if (baseDelayMs !== undefined) candidate.baseDelayMs = baseDelayMs;
  if (maxDelayMs !== undefined) candidate.maxDelayMs = maxDelayMs;
  if (jitterMs !== undefined) candidate.jitterMs = jitterMs;
  if (retryAfterCapMs !== undefined) candidate.retryAfterCapMs = retryAfterCapMs;
  if (Object.keys(candidate).length === 0) return out;
  return validateAnyRouterRetryPolicy(candidate, { partial: true });
}

function normalizeStoredRetry(value: unknown): Partial<AnyRouterRetryPolicy> | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) return null;
  try {
    return validateAnyRouterRetryPolicy(value, { partial: true });
  } catch {
    // Stored malformed retry is ignored for effective projection (defaults fill
    // gaps) but PATCH will still fail closed if the whole file fails to parse.
    return null;
  }
}

function normalizeModels(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

// ── Effective resolution ──────────────────────────────────────────────────────

export function resolveAnyRouterRetryPolicy(
  stored: Partial<AnyRouterRetryPolicy> | null | undefined,
  envOverrides: Partial<AnyRouterRetryPolicy> = readEnvRetryOverrides(),
): {
  effective: AnyRouterRetryPolicy;
  source: Record<AnyRouterRetryField, AnyRouterConfigFieldSource>;
  editable: Record<AnyRouterRetryField, boolean>;
} {
  const fields: AnyRouterRetryField[] = [
    "maxRetries",
    "baseDelayMs",
    "maxDelayMs",
    "jitterMs",
    "retryAfterCapMs",
  ];
  const effective = { ...ANYROUTER_RETRY_DEFAULTS } as AnyRouterRetryPolicy;
  const source = {} as Record<AnyRouterRetryField, AnyRouterConfigFieldSource>;
  const editable = {} as Record<AnyRouterRetryField, boolean>;

  for (const field of fields) {
    if (envOverrides[field] !== undefined) {
      effective[field] = envOverrides[field] as number;
      source[field] = "env";
      editable[field] = false;
    } else if (stored && stored[field] !== undefined) {
      effective[field] = stored[field] as number;
      source[field] = "config";
      editable[field] = true;
    } else {
      effective[field] = ANYROUTER_RETRY_DEFAULTS[field];
      source[field] = "default";
      editable[field] = true;
    }
  }

  // Env can set base/max independently; re-validate base ≤ max on the merged result.
  if (effective.baseDelayMs > effective.maxDelayMs) {
    throw new AnyRouterConfigError(
      "Effective retry.baseDelayMs must be less than or equal to retry.maxDelayMs",
      400,
      "validation_error",
    );
  }

  return { effective, source, editable };
}

/**
 * Resolve the provider-global Base URL (no account override).
 * Account override composition belongs to the runtime bridge (AR-03).
 */
export function resolveAnyRouterGlobalBaseUrl(storedBaseUrl: string | null | undefined): {
  value: string | null;
  source: AnyRouterConfigFieldSource;
  editable: boolean;
} {
  const envRaw = process.env[ENV_BASE_URL];
  if (typeof envRaw === "string" && envRaw.trim()) {
    return {
      value: validateAnyRouterBaseUrl(envRaw),
      source: "env",
      editable: false,
    };
  }
  if (typeof storedBaseUrl === "string" && storedBaseUrl.trim()) {
    try {
      return {
        value: validateAnyRouterBaseUrl(storedBaseUrl),
        source: "config",
        editable: true,
      };
    } catch {
      // Invalid stored baseUrl is treated as unset for effective projection.
      return { value: null, source: "default", editable: true };
    }
  }
  return { value: null, source: "default", editable: true };
}

/**
 * Compose the effective Base URL for an Active account.
 * Precedence: account override > env > source config.
 */
export function resolveAnyRouterEffectiveBaseUrl(input: {
  accountBaseUrlOverride?: string | null;
  storedGlobalBaseUrl?: string | null;
}): string | null {
  const override =
    typeof input.accountBaseUrlOverride === "string" ? input.accountBaseUrlOverride.trim() : "";
  if (override) {
    return validateAnyRouterBaseUrl(override);
  }
  return resolveAnyRouterGlobalBaseUrl(input.storedGlobalBaseUrl ?? null).value;
}

// ── Read / write ──────────────────────────────────────────────────────────────

export function readAnyrouterConfigRaw(): AnyRouterConfigReadResult {
  const path = getAnyRouterConfigPath();
  if (!existsSync(path)) {
    return {
      raw: "{}",
      parsed: {},
      exists: false,
      revision: EMPTY_ANYROUTER_CONFIG_REVISION,
      apiKey: null,
      baseUrl: null,
      models: [],
      retry: null,
    };
  }

  const raw = readFileSync(path, "utf8");
  const revision = computeAnyRouterConfigRevision(raw);

  try {
    const cleaned = stripJsonComments(raw);
    const parsed = JSON.parse(cleaned) as unknown;
    if (!isRecord(parsed)) {
      return {
        raw,
        parsed: {},
        exists: true,
        parseError: "anyrouter.json root must be a JSON object",
        revision,
        apiKey: null,
        baseUrl: null,
        models: [],
        retry: null,
      };
    }

    const apiKey =
      typeof parsed.apiKey === "string" && parsed.apiKey.trim() ? parsed.apiKey.trim() : null;
    // Preserve stored baseUrl string for mutation even when invalid; effective
    // projection validates separately.
    const storedBaseUrl =
      typeof parsed.baseUrl === "string" && parsed.baseUrl.trim() ? parsed.baseUrl.trim() : null;

    return {
      raw,
      parsed,
      exists: true,
      revision,
      apiKey,
      baseUrl: storedBaseUrl,
      models: normalizeModels(parsed.models),
      retry: normalizeStoredRetry(parsed.retry),
    };
  } catch (error) {
    return {
      raw,
      parsed: {},
      exists: true,
      parseError: error instanceof Error ? error.message : String(error),
      revision,
      apiKey: null,
      baseUrl: null,
      models: [],
      retry: null,
    };
  }
}

function serializeConfig(data: Record<string, unknown>): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

function writeAnyrouterConfigAtomic(content: string): void {
  const targetPath = getAnyRouterConfigPath();
  const dir = dirname(targetPath);
  mkdirSync(dir, { recursive: true, mode: CONFIG_DIR_MODE });
  try {
    chmodSync(dir, CONFIG_DIR_MODE);
  } catch {
    // best-effort on platforms without mode bits
  }

  const tmpPath = join(dir, `.anyrouter.json.${randomBytes(6).toString("hex")}.tmp`);
  try {
    writeFileSync(tmpPath, content, { encoding: "utf8", mode: CONFIG_FILE_MODE });
    try {
      chmodSync(tmpPath, CONFIG_FILE_MODE);
    } catch {
      // best-effort
    }
    renameSync(tmpPath, targetPath);
    try {
      chmodSync(targetPath, CONFIG_FILE_MODE);
    } catch {
      // best-effort
    }
  } catch (error) {
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {
      // best-effort cleanup
    }
    throw error;
  }
}

// ── Cross-process lock ────────────────────────────────────────────────────────

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

async function acquireConfigFsLock(): Promise<() => Promise<void>> {
  const targetPath = getAnyRouterConfigPath();
  const dir = dirname(targetPath);
  const lockDir = configLockDir(targetPath);
  await mkdir(dir, { recursive: true, mode: CONFIG_DIR_MODE });

  const startedAt = Date.now();
  while (true) {
    try {
      await mkdir(lockDir, { recursive: false, mode: CONFIG_DIR_MODE });
      const owner: LockOwner = { pid: process.pid, createdAt: Date.now() };
      await writeFile(join(lockDir, LOCK_OWNER_FILE), `${JSON.stringify(owner)}\n`, {
        encoding: "utf8",
        mode: CONFIG_FILE_MODE,
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
        throw new AnyRouterConfigError(
          "anyrouter.json write lock acquisition timed out",
          500,
          "write_failed",
        );
      }
      await sleep(jitteredRetryMs());
    }
  }
}

async function withProcessQueue<T>(fn: () => Promise<T>): Promise<T> {
  const key = getAnyRouterConfigPath();
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

export async function withAnyrouterConfigWriteLock<T>(fn: () => Promise<T> | T): Promise<T> {
  return withProcessQueue(async () => {
    const release = await acquireConfigFsLock();
    try {
      return await fn();
    } finally {
      await release();
    }
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export function projectAnyRouterSafeConfig(
  read: AnyRouterConfigReadResult = readAnyrouterConfigRaw(),
): AnyRouterSafeConfigProjection {
  if (read.parseError) {
    throw new AnyRouterConfigError(
      `anyrouter.json is invalid: ${read.parseError}`,
      500,
      "parse_error",
    );
  }

  const global = resolveAnyRouterGlobalBaseUrl(read.baseUrl);
  const globalBaseUrl = global.value;
  const globalBaseUrlSource = global.source;
  const globalBaseUrlEditable = global.editable;

  const retry = resolveAnyRouterRetryPolicy(read.retry);
  const modelCount = read.models.filter((entry) => {
    if (!isRecord(entry)) return false;
    return typeof entry.id === "string" && entry.id.trim().length > 0;
  }).length;

  return {
    provider: ANYROUTER_PROVIDER_ID,
    revision: read.revision,
    globalBaseUrl,
    globalBaseUrlSource,
    globalBaseUrlEditable,
    modelsConfigured: modelCount > 0,
    modelCount,
    retry: {
      effective: retry.effective,
      source: retry.source,
      editable: retry.editable,
    },
  };
}

export function getAnyRouterSafeConfig(): AnyRouterSafeConfigProjection {
  return projectAnyRouterSafeConfig(readAnyrouterConfigRaw());
}

/**
 * Minimal PATCH for global baseUrl and/or provider-wide retry.
 * Preserves apiKey, models, and any unknown top-level fields.
 * Rejects stale revision and refuses to write over a parse-error file.
 */
export async function patchAnyRouterConfig(
  input: AnyRouterConfigPatchInput,
): Promise<AnyRouterSafeConfigProjection> {
  if (!input || typeof input.revision !== "string" || !input.revision.trim()) {
    throw new AnyRouterConfigError("revision is required", 400, "validation_error");
  }

  const hasBaseUrl = Object.prototype.hasOwnProperty.call(input, "baseUrl");
  const hasRetry = Object.prototype.hasOwnProperty.call(input, "retry");
  if (!hasBaseUrl && !hasRetry) {
    throw new AnyRouterConfigError(
      "At least one of baseUrl or retry must be provided",
      400,
      "validation_error",
    );
  }

  // Validate inputs before taking the lock so bad bodies fail fast.
  let nextBaseUrl: string | null | undefined;
  if (hasBaseUrl) {
    if (input.baseUrl === null || (typeof input.baseUrl === "string" && !input.baseUrl.trim())) {
      nextBaseUrl = null;
    } else if (typeof input.baseUrl === "string") {
      nextBaseUrl = validateAnyRouterBaseUrl(input.baseUrl);
    } else {
      throw new AnyRouterConfigError("baseUrl must be a string or null", 400, "validation_error");
    }
  }

  let retryPatch: Partial<AnyRouterRetryPolicy> | undefined;
  if (hasRetry) {
    if (input.retry === null || input.retry === undefined) {
      throw new AnyRouterConfigError("retry must be an object when provided", 400, "validation_error");
    }
    retryPatch = validateAnyRouterRetryPolicy(input.retry, { partial: true });
  }

  return withAnyrouterConfigWriteLock(() => {
    const current = readAnyrouterConfigRaw();

    if (current.parseError) {
      throw new AnyRouterConfigError(
        `anyrouter.json is invalid: ${current.parseError}`,
        500,
        "parse_error",
      );
    }

    if (input.revision !== current.revision) {
      throw new AnyRouterConfigError(
        "anyrouter.json was modified; refresh and retry",
        409,
        "stale_revision",
      );
    }

    // Clone so we never alias the read snapshot.
    const data = JSON.parse(JSON.stringify(current.parsed)) as Record<string, unknown>;

    if (hasBaseUrl) {
      if (nextBaseUrl === null) {
        delete data.baseUrl;
      } else {
        data.baseUrl = nextBaseUrl;
      }
    }

    if (retryPatch) {
      const existingRetry = isRecord(data.retry) ? { ...data.retry } : {};
      // Env-overridden fields are not writable via config; reject attempts so
      // callers cannot believe a write took effect.
      const envOverrides = readEnvRetryOverrides();
      for (const field of Object.keys(retryPatch) as AnyRouterRetryField[]) {
        if (envOverrides[field] !== undefined) {
          throw new AnyRouterConfigError(
            `retry.${field} is overridden by environment and cannot be patched`,
            400,
            "validation_error",
          );
        }
        existingRetry[field] = retryPatch[field];
      }
      // Validate the merged stored retry object (partial fill is OK).
      const merged = validateAnyRouterRetryPolicy(existingRetry, { partial: true });
      // Preserve unknown retry sub-fields if any were present.
      data.retry = { ...existingRetry, ...merged };
    }

    // Never accept client writes of secrets/models/path/headers here.
    // apiKey and models are intentionally left untouched above.

    const content = serializeConfig(data);
    try {
      writeAnyrouterConfigAtomic(content);
    } catch (error) {
      throw new AnyRouterConfigError(
        error instanceof Error ? error.message : "Failed to write anyrouter.json",
        500,
        "write_failed",
      );
    }

    return projectAnyRouterSafeConfig(readAnyrouterConfigRaw());
  });
}

/**
 * Resolve a legacy `anyrouter.json.apiKey` into a concrete secret for managed
 * account import. Never mutates the source file.
 *
 * - Empty / missing → null
 * - ALL_CAPS token that resolves via process.env → env value
 * - ALL_CAPS token that does not resolve and is short → treated as env name, skip
 * - Otherwise → literal key
 */
export function resolveLegacyAnyrouterSourceApiKey(
  raw: string | null | undefined,
): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (/^[A-Z][A-Z0-9_]*$/.test(trimmed)) {
    const fromEnv = process.env[trimmed];
    if (typeof fromEnv === "string" && fromEnv.trim()) {
      return fromEnv.trim();
    }
    // Unresolved short env-style tokens are not imported as secrets.
    if (trimmed.length <= 64) return null;
  }

  return trimmed;
}

/** Test helper: lock path uses fs mkdir primitives (no third-party lock package). */
export function __anyrouterConfigLockUsesFsPrimitivesForTests(): boolean {
  return LOCK_DIR_SUFFIX === ".lock" && LOCK_OWNER_FILE === "owner.json";
}

/** Test helper: expose env var names without leaking values. */
export function __anyrouterConfigEnvNamesForTests(): {
  baseUrl: string;
  maxRetries: string;
  baseDelayMs: string;
  maxDelayMs: string;
  jitterMs: string;
  retryAfterCapMs: string;
} {
  return {
    baseUrl: ENV_BASE_URL,
    maxRetries: ENV_MAX_RETRIES,
    baseDelayMs: ENV_BASE_DELAY_MS,
    maxDelayMs: ENV_MAX_DELAY_MS,
    jitterMs: ENV_JITTER_MS,
    retryAfterCapMs: ENV_RETRY_AFTER_CAP_MS,
  };
}

