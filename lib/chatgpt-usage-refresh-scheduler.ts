import { promises as fs } from "fs";
import { hostname } from "os";
import { join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { listOAuthAccounts } from "@/lib/oauth-accounts";
import { readPiWebConfig, type PiWebChatGptConfig } from "@/lib/pi-web-config";
import { getOAuthAccountSubscriptionQuota } from "@/lib/subscription-quota";

interface RefreshLockFile {
  ownerId: string;
  pid: number;
  hostname: string;
  createdAt: number;
  updatedAt: number;
}

interface RefreshLockDiagnostics {
  path: string;
  exists: boolean;
  ownedByCurrentProcess: boolean;
  stale: boolean;
  staleAfterMs: number;
  ageMs: number | null;
  lock: RefreshLockFile | null;
  error?: string;
}

interface SchedulerState {
  ownerId: string;
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  enabled: boolean;
  lockOwned: boolean;
  nextRunAt: number | null;
  lastRunStartedAt: number | null;
  lastRunFinishedAt: number | null;
  lastError: string | null;
  lastAccountId: string | null;
  lastAccountError: string | null;
}

export interface ChatGptUsageRefreshStatus {
  enabled: boolean;
  running: boolean;
  lockOwned: boolean;
  nextRunAt: number | null;
  lastRunStartedAt: number | null;
  lastRunFinishedAt: number | null;
  lastError: string | null;
  lastAccountId: string | null;
  lastAccountError: string | null;
  lock: RefreshLockDiagnostics;
}

declare global {
  var __piChatGptUsageRefreshScheduler: SchedulerState | undefined;
}

const PROVIDER = "openai-codex";

function getState(): SchedulerState {
  if (!globalThis.__piChatGptUsageRefreshScheduler) {
    globalThis.__piChatGptUsageRefreshScheduler = {
      ownerId: `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timer: null,
      running: false,
      enabled: false,
      lockOwned: false,
      nextRunAt: null,
      lastRunStartedAt: null,
      lastRunFinishedAt: null,
      lastError: null,
      lastAccountId: null,
      lastAccountError: null,
    };
  }
  return globalThis.__piChatGptUsageRefreshScheduler;
}

function lockPath(): string {
  return join(getAgentDir(), "chatgpt-usage-refresh.lock");
}

function staleAfterMs(config: PiWebChatGptConfig): number {
  return config.refreshCycleIntervalSeconds * 2 * 1000;
}

function randomSeconds(min: number, max: number): number {
  if (max <= min) return min;
  return min + Math.floor(Math.random() * (max - min + 1));
}

function cycleDelayMs(config: PiWebChatGptConfig): number {
  return (config.refreshCycleIntervalSeconds + randomSeconds(config.refreshCycleSaltMinSeconds, config.refreshCycleSaltMaxSeconds)) * 1000;
}

function accountDelayMs(config: PiWebChatGptConfig): number {
  return (config.refreshAccountIntervalSeconds + randomSeconds(config.refreshAccountSaltMinSeconds, config.refreshAccountSaltMaxSeconds)) * 1000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseLock(value: unknown): RefreshLockFile | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.ownerId !== "string" || typeof record.pid !== "number" || typeof record.hostname !== "string" || typeof record.createdAt !== "number" || typeof record.updatedAt !== "number") return null;
  return {
    ownerId: record.ownerId,
    pid: record.pid,
    hostname: record.hostname,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

async function readLock(): Promise<{ lock: RefreshLockFile | null; error?: string }> {
  try {
    const raw = await fs.readFile(lockPath(), "utf8");
    const parsed = parseLock(JSON.parse(raw) as unknown);
    if (!parsed) return { lock: null, error: "Lock file is invalid" };
    return { lock: parsed };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { lock: null };
    return { lock: null, error: error instanceof Error ? error.message : String(error) };
  }
}

function createLock(state: SchedulerState, createdAt = Date.now()): RefreshLockFile {
  return {
    ownerId: state.ownerId,
    pid: process.pid,
    hostname: hostname(),
    createdAt,
    updatedAt: Date.now(),
  };
}

async function writeLock(lock: RefreshLockFile, exclusive: boolean): Promise<void> {
  await fs.mkdir(getAgentDir(), { recursive: true });
  await fs.writeFile(lockPath(), `${JSON.stringify(lock, null, 2)}\n`, { encoding: "utf8", flag: exclusive ? "wx" : "w" });
}

function isOwnedByCurrentProcess(lock: RefreshLockFile | null, state: SchedulerState): boolean {
  return Boolean(lock && lock.ownerId === state.ownerId && lock.pid === process.pid && lock.hostname === hostname());
}

function isLockStale(lock: RefreshLockFile | null, config: PiWebChatGptConfig): boolean {
  return Boolean(lock && Date.now() - lock.updatedAt > staleAfterMs(config));
}

async function getLockDiagnostics(config = readPiWebConfig().chatgpt): Promise<RefreshLockDiagnostics> {
  const state = getState();
  const { lock, error } = await readLock();
  const ageMs = lock ? Date.now() - lock.updatedAt : null;
  return {
    path: lockPath(),
    exists: Boolean(lock || error),
    ownedByCurrentProcess: isOwnedByCurrentProcess(lock, state),
    stale: isLockStale(lock, config),
    staleAfterMs: staleAfterMs(config),
    ageMs,
    lock,
    error,
  };
}

async function acquireLock(config: PiWebChatGptConfig): Promise<boolean> {
  const state = getState();
  const now = Date.now();
  const firstLock = createLock(state, now);
  try {
    await writeLock(firstLock, true);
    state.lockOwned = true;
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      state.lastError = error instanceof Error ? error.message : String(error);
      state.lockOwned = false;
      return false;
    }
  }

  const { lock } = await readLock();
  if (isOwnedByCurrentProcess(lock, state)) {
    await writeLock(createLock(state, lock?.createdAt ?? now), false);
    state.lockOwned = true;
    return true;
  }

  if (isLockStale(lock, config) || !lock) {
    await fs.unlink(lockPath()).catch(() => {});
    try {
      await writeLock(firstLock, true);
      state.lockOwned = true;
      return true;
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
    }
  }

  state.lockOwned = false;
  return false;
}

async function heartbeat(): Promise<void> {
  const state = getState();
  const { lock } = await readLock();
  if (!isOwnedByCurrentProcess(lock, state)) {
    state.lockOwned = false;
    return;
  }
  await writeLock(createLock(state, lock?.createdAt), false);
  state.lockOwned = true;
}

async function releaseLockIfOwned(): Promise<void> {
  const state = getState();
  const { lock } = await readLock();
  if (isOwnedByCurrentProcess(lock, state)) {
    await fs.unlink(lockPath()).catch(() => {});
  }
  state.lockOwned = false;
}

function clearTimer(state: SchedulerState): void {
  if (state.timer) clearTimeout(state.timer);
  state.timer = null;
  state.nextRunAt = null;
}

function scheduleNext(config: PiWebChatGptConfig): void {
  const state = getState();
  clearTimer(state);
  if (!config.autoRefreshEnabled || !state.lockOwned) return;
  const delay = cycleDelayMs(config);
  state.nextRunAt = Date.now() + delay;
  state.timer = setTimeout(() => {
    void runCycle();
  }, delay);
}

async function runCycle(): Promise<void> {
  const state = getState();
  if (state.running) return;
  const config = readPiWebConfig().chatgpt;
  if (!config.autoRefreshEnabled) {
    await stopChatGptUsageRefreshScheduler();
    return;
  }
  if (!(await acquireLock(config))) return;

  state.running = true;
  state.nextRunAt = null;
  state.lastRunStartedAt = Date.now();
  state.lastError = null;
  state.lastAccountError = null;
  try {
    await heartbeat();
    const accounts = (await listOAuthAccounts(PROVIDER)).accounts;
    for (let index = 0; index < accounts.length; index += 1) {
      const account = accounts[index];
      state.lastAccountId = account.accountId;
      try {
        const quota = await getOAuthAccountSubscriptionQuota(PROVIDER, account.accountId);
        state.lastAccountError = quota.success ? null : quota.error ?? quota.credentialMessage ?? "Usage query failed";
      } catch (error) {
        state.lastAccountError = error instanceof Error ? error.message : String(error);
      }
      await heartbeat();
      if (!state.lockOwned) break;
      if (index < accounts.length - 1) {
        await sleep(accountDelayMs(config));
        await heartbeat();
        if (!state.lockOwned) break;
      }
    }
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : String(error);
  } finally {
    state.running = false;
    state.lastRunFinishedAt = Date.now();
    scheduleNext(readPiWebConfig().chatgpt);
  }
}

export async function ensureChatGptUsageRefreshScheduler(forceReschedule = false): Promise<ChatGptUsageRefreshStatus> {
  const state = getState();
  const config = readPiWebConfig().chatgpt;
  state.enabled = config.autoRefreshEnabled;
  if (!config.autoRefreshEnabled) {
    await stopChatGptUsageRefreshScheduler();
    return getChatGptUsageRefreshStatus();
  }
  if (await acquireLock(config)) {
    if (forceReschedule || (!state.timer && !state.running)) scheduleNext(config);
  }
  return getChatGptUsageRefreshStatus();
}

export async function stopChatGptUsageRefreshScheduler(): Promise<void> {
  const state = getState();
  state.enabled = false;
  clearTimer(state);
  await releaseLockIfOwned();
}

export async function getChatGptUsageRefreshStatus(): Promise<ChatGptUsageRefreshStatus> {
  const state = getState();
  const config = readPiWebConfig().chatgpt;
  return {
    enabled: config.autoRefreshEnabled,
    running: state.running,
    lockOwned: state.lockOwned,
    nextRunAt: state.nextRunAt,
    lastRunStartedAt: state.lastRunStartedAt,
    lastRunFinishedAt: state.lastRunFinishedAt,
    lastError: state.lastError,
    lastAccountId: state.lastAccountId,
    lastAccountError: state.lastAccountError,
    lock: await getLockDiagnostics(config),
  };
}

export async function repairChatGptUsageRefreshLock(confirm: boolean): Promise<ChatGptUsageRefreshStatus> {
  if (!confirm) throw new Error("confirmation is required");
  const state = getState();
  const config = readPiWebConfig().chatgpt;
  const { lock } = await readLock();
  if (isOwnedByCurrentProcess(lock, state) && !isLockStale(lock, config)) {
    throw new Error("Current process owns a healthy lock; repair refused");
  }
  await fs.unlink(lockPath()).catch(() => {});
  state.lockOwned = false;
  clearTimer(state);
  return ensureChatGptUsageRefreshScheduler();
}

export async function runChatGptUsageRefreshNow(): Promise<ChatGptUsageRefreshStatus> {
  const state = getState();
  if (!state.running) void runCycle();
  return getChatGptUsageRefreshStatus();
}
