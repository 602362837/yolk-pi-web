import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  WORKTREE_CHECK_LIMITS,
  type CheckCommandEvidence,
  type CheckReasonCode,
  type CheckReportInput,
  type WorktreeCheckExecutionResult,
  type WorktreeCheckPhase,
  type WorktreeCheckPurpose,
  reconcileCheckReport,
} from "./worktree-check-policy";
import { getGitMetadataForCwd, getWorktreeMetadataForCwd } from "./git-worktree";

export interface WorktreeCheckExecInput {
  purpose: WorktreeCheckPurpose;
  executable: string;
  args: string[];
  cwd?: string;
  retryOfCommandId?: string;
}

export interface WorktreeCheckControllerOptions {
  worktreePath: string;
  agentDir?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  now?: () => number;
  /** Main worktrees use the same restricted profile but cannot prepare dependencies. */
  allowMainWorktree?: boolean;
  /** Durable generation-scoped prepare usage restored after a GitHub restart. */
  initialPrepareAttempts?: number;
  /** GitHub persists this reservation before a prepare process may start. */
  reservePrepareAttempt?: (input: Pick<WorktreeCheckExecInput, "executable" | "args" | "cwd">) => Promise<boolean>;
  /** Generation-scoped prepare hashes already consumed before a crash. */
  consumedPrepareCommandHashes?: readonly string[];
  /** One monotonic scheduler for every controller wait and watchdog. */
  scheduler?: Partial<WorktreeCheckScheduler>;
  /** @deprecated use scheduler; retained for compatibility with existing callers. */
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
}

export interface WorktreeCheckScheduler {
  setTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
  setInterval(callback: () => void, ms: number): ReturnType<typeof setInterval>;
  clearInterval(handle: ReturnType<typeof setInterval>): void;
  sleep(ms: number): Promise<void>;
}

const productionScheduler: WorktreeCheckScheduler = {
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  sleep: (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms)),
};

export interface WorktreeCheckToolResult {
  commandId: string;
  exitCode: number | null;
  output: string;
  reasonCode: CheckReasonCode | null;
  rejected: boolean;
}

const MAX_ARG_COUNT = 128;
const MAX_ARG_CHARS = 4096;
const MAX_OUTPUT_BYTES = WORKTREE_CHECK_LIMITS.outputBytes;
const PROTECTED_RELATIVE_PATHS = [".ypi/tasks", ".ypi/runtime", ".ypi/credentials"];
const SHELLS = new Set(["sh", "bash", "zsh", "fish", "cmd", "cmd.exe", "powershell", "pwsh", "node", "python", "python3", "ruby", "perl"]);
const HIGH_RISK = new Set(["sudo", "doas", "su", "curl", "wget", "ssh", "scp", "sftp", "docker", "launchctl", "systemctl", "service"]);
const GIT_MUTATING = new Set(["commit", "push", "reset", "clean", "checkout", "switch", "merge", "rebase", "config", "worktree"]);
const LAUNCHERS = new Set(["env", "xargs", "find", "command", "nice", "nohup"]);
const GIT_READ_ONLY = new Set(["status", "diff", "log", "show", "rev-parse", "ls-files"]);
const EXECUTION_ENV_KEYS = process.platform === "win32"
  ? ["PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "LANG", "LC_ALL", "TZ", "COMSPEC"]
  : ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "LC_CTYPE", "TZ"];
const globalConcurrency = { active: 0, waiters: [] as Array<{ grant: () => void; cancel: () => void }> };

/** Explicit minimum execution environment shared by SDK, CLI, and GitHub checks. */
export function buildWorktreeCheckEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = {} as NodeJS.ProcessEnv;
  for (const key of EXECUTION_ENV_KEYS) {
    const value = source[key];
    if (typeof value === "string" && value) env[key] = value;
  }
  return env;
}

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function nowIso(now: () => number): string { return new Date(now()).toISOString(); }
function contained(root: string, candidate: string): boolean { const rel = relative(root, candidate); return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel)); }
function boundedTail(text: string): string {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.byteLength <= MAX_OUTPUT_BYTES) return text;
  return bytes.subarray(bytes.byteLength - MAX_OUTPUT_BYTES).toString("utf8");
}
function redacted(text: string): string {
  return boundedTail(text)
    .replace(/(?:https?:\/\/)[^\s@]+@/gi, "[redacted-url]")
    .replace(/(?:token|secret|password|api[_-]?key)\s*[=:]\s*[^\s]+/gi, "$1=[redacted]")
    .replace(/(?:\/[^\s:]+){2,}/g, "[path]");
}
function pidAlive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch { return false; } }

/**
 * Controller for the server-owned generic Check protocol. The guards constrain
 * direct argv execution, but deliberately do not claim to sandbox repository
 * wrappers or lifecycle scripts they invoke.
 */
export class WorktreeCheckExecutionController {
  readonly worktreePath: string;
  private readonly agentDir: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly now: () => number;
  private readonly startedAt: number;
  /** Computed once: no lease/slot transition can restart this budget. */
  private readonly runDeadline: number;
  private readonly scheduler: WorktreeCheckScheduler;
  private readonly initialPrepareAttempts: number;
  private readonly allowMainWorktree: boolean;
  private readonly reservePrepareAttempt?: WorktreeCheckControllerOptions["reservePrepareAttempt"];
  private readonly consumedPrepareCommandHashes: ReadonlySet<string>;
  private activeKill?: () => void;
  private concurrencyHeld = false;
  private readonly ledger: CheckCommandEvidence[] = [];
  private phase: WorktreeCheckPhase = "discover";
  private repositoryEvidenceSeen = false;
  private cancelled = false;
  private terminalReason: CheckReasonCode | null = null;
  private report: CheckReportInput | undefined;
  private leasePath: string | null = null;
  private leaseToken: string | null = null;
  private leaseAcquired = false;
  private linkedWorktree = false;
  private abortListener?: () => void;
  private abortSignal?: AbortSignal;
  private waitingSlotCancel?: () => void;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private heartbeatInFlight: Promise<void> | null = null;

  constructor(options: WorktreeCheckControllerOptions) {
    this.worktreePath = resolve(options.worktreePath);
    this.agentDir = resolve(options.agentDir ?? getAgentDir());
    this.env = buildWorktreeCheckEnv(options.env ?? process.env);
    this.now = options.now ?? Date.now;
    this.startedAt = this.now();
    this.runDeadline = this.startedAt + WORKTREE_CHECK_LIMITS.runDurationMs;
    this.scheduler = {
      ...productionScheduler,
      ...options.scheduler,
      setInterval: options.scheduler?.setInterval ?? options.setInterval ?? productionScheduler.setInterval,
      clearInterval: options.scheduler?.clearInterval ?? options.clearInterval ?? productionScheduler.clearInterval,
    };
    this.initialPrepareAttempts = Number.isFinite(options.initialPrepareAttempts)
      ? Math.max(0, Math.min(WORKTREE_CHECK_LIMITS.prepareAttempts, Math.floor(options.initialPrepareAttempts!)))
      : 0;
    this.allowMainWorktree = options.allowMainWorktree === true;
    this.reservePrepareAttempt = options.reservePrepareAttempt;
    this.consumedPrepareCommandHashes = new Set(options.consumedPrepareCommandHashes ?? []);
    if (options.signal) {
      this.abortSignal = options.signal;
      this.abortListener = () => { this.cancelled = true; this.terminalReason = "check_cancelled"; this.waitingSlotCancel?.(); this.activeKill?.(); };
      options.signal.addEventListener("abort", this.abortListener, { once: true });
      if (options.signal.aborted) this.abortListener();
    }
  }

  /** Called only after a contained file operation returned actual content. */
  noteRepositoryEvidenceRead(): void { this.repositoryEvidenceSeen = true; }
  getPhase(): WorktreeCheckPhase { return this.phase; }
  getLedger(): readonly CheckCommandEvidence[] { return this.ledger; }

  async acquireLease(timeoutMs = 10_000): Promise<boolean> {
    const deadline = Math.min(this.runDeadline, this.now() + Math.max(0, timeoutMs));
    try {
      await this.validateLinkedWorktree();
      if (!await this.acquireGlobalSlot(timeoutMs)) { this.terminalReason = this.cancelled ? "check_cancelled" : "check_execution_lease_timeout"; return false; }
      const key = hash(await realpath(this.worktreePath));
      const path = join(this.agentDir, "worktree-check-leases", key);
      await mkdir(join(this.agentDir, "worktree-check-leases"), { recursive: true, mode: 0o700 });
      while (this.now() <= deadline && !this.cancelled) {
        const token = randomUUID();
        try {
          await mkdir(path, { mode: 0o700 });
          await this.writeOwner(path, { pid: process.pid, token, acquiredAt: nowIso(this.now), heartbeatAt: nowIso(this.now) });
          this.leasePath = path; this.leaseToken = token; this.leaseAcquired = true;
          this.heartbeatTimer = this.scheduler.setInterval(() => { void this.heartbeatLease(); }, 1_000);
          return true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          await this.recoverStaleLease(path);
          await this.sleepUntil(25, deadline);
        }
      }
      this.terminalReason = this.cancelled ? "check_cancelled" : "check_execution_lease_timeout";
      return false;
    } finally {
      if (!this.leaseAcquired) this.releaseGlobalSlot();
    }
  }

  async releaseLease(): Promise<void> {
    if (this.heartbeatTimer) { this.scheduler.clearInterval(this.heartbeatTimer); this.heartbeatTimer = undefined; }
    // A terminal release must wait for a heartbeat that already owns the
    // transition guard; otherwise that heartbeat could recreate a live owner.
    await this.heartbeatInFlight?.catch(() => undefined);
    const path = this.leasePath; const token = this.leaseToken;
    try { if (path && token) await this.withLeaseTransition(path, async () => {
      const owner = await this.readOwner(path);
      if (owner?.token === token) await rm(path, { recursive: true, force: true });
    }); } finally {
      this.leasePath = null; this.leaseToken = null; this.leaseAcquired = false;
      this.heartbeatInFlight = null;
      this.releaseGlobalSlot();
      if (this.abortListener && this.abortSignal) this.abortSignal.removeEventListener("abort", this.abortListener);
      this.abortListener = undefined;
      this.abortSignal = undefined;
    }
  }

  async execute(input: WorktreeCheckExecInput, signal?: AbortSignal): Promise<WorktreeCheckToolResult> {
    const rejected = (reasonCode: CheckReasonCode, output = "Command rejected by WorkTree Check policy.") => this.recordRejected(input, reasonCode, output);
    if (this.cancelled || signal?.aborted) return rejected("check_cancelled", "Check was cancelled.");
    if (!this.leaseAcquired) return rejected("check_execution_lease_timeout", "WorkTree check execution lease is unavailable.");
    if (this.remainingRunMs() <= 0) return rejected("check_validation_timeout", "Check run deadline was reached.");
    try { await this.validateLinkedWorktree(); } catch { return rejected("check_runtime_unavailable", "Linked WorkTree is unavailable."); }
    const policyError = await this.validateInput(input);
    if (policyError) return rejected(policyError);
    if (input.purpose === "prepare" && !this.allowPrepare()) return rejected("check_command_rejected", "Dependency preparation is limited to linked WorkTrees.");
    if ((input.purpose === "prepare" || input.purpose === "check") && !this.hasDiscoveryEvidence()) return rejected("check_dependency_discovery_inconclusive", "A successful contained repository read and probe are required before checks.");
    if (input.purpose === "probe" && (this.count("probe") >= WORKTREE_CHECK_LIMITS.probeCalls || this.duration("probe") >= WORKTREE_CHECK_LIMITS.probeDurationMs)) return rejected("check_dependency_discovery_inconclusive");
    if (input.purpose === "prepare" && this.duration("prepare") >= WORKTREE_CHECK_LIMITS.prepareDurationMs) return rejected("check_dependency_prepare_timeout");
    if (input.purpose === "prepare") {
      const prepares = this.ledger.filter((entry) => entry.purpose === "prepare");
      if (this.initialPrepareAttempts + prepares.length >= WORKTREE_CHECK_LIMITS.prepareAttempts) return rejected("check_dependency_prepare_attempt_limit");
      const commandHash = this.commandHash(input);
      if (this.consumedPrepareCommandHashes.has(commandHash) || prepares.some((entry) => entry.commandHash === commandHash)) return rejected("check_dependency_prepare_attempt_limit");
      if (prepares.length === 1 && (!input.retryOfCommandId || prepares[0].id !== input.retryOfCommandId || prepares[0].exitCode === 0)) return rejected("check_dependency_prepare_attempt_limit");
    }
    if (input.purpose === "prepare" && this.reservePrepareAttempt) {
      try {
        if (!await this.reservePrepareAttempt(input)) return rejected("check_runtime_unavailable", "Dependency preparation reservation is unavailable.");
      } catch { return rejected("check_runtime_unavailable", "Dependency preparation reservation is unavailable."); }
    }
    this.phase = input.purpose === "probe" ? "discover" : input.purpose;
    const before = input.purpose === "prepare" ? await this.gitStatus() : null;
    return this.spawnCommand(input, before, signal);
  }

  submitReport(value: unknown): WorktreeCheckExecutionResult {
    this.phase = "report";
    const reconciliation = reconcileCheckReport(value, this.ledger);
    if (reconciliation.accepted) this.report = value as CheckReportInput;
    const result = reconciliation.result;
    return { ...result, probeCount: this.count("probe"), prepareAttempts: this.count("prepare"), checkCount: this.count("check"), durationMs: this.now() - this.startedAt, timedOut: this.ledger.some((entry) => entry.timedOut), commandStarted: this.ledger.some((entry) => !entry.rejected), reportHash: reconciliation.accepted ? hash(JSON.stringify(value)) : null };
  }

  finalize(): WorktreeCheckExecutionResult {
    if (this.terminalReason) return this.safeTerminal(this.terminalReason);
    if (!this.report) {
      const observedFailure = [...this.ledger].reverse().find((entry) => entry.reasonCode && entry.reasonCode !== "check_command_rejected")?.reasonCode;
      return this.safeTerminal(observedFailure ?? "check_report_missing");
    }
    return this.submitReport(this.report);
  }

  private safeTerminal(reasonCode: CheckReasonCode): WorktreeCheckExecutionResult {
    const result = reconcileCheckReport({ environment: "blocked", verdict: "blocked", evidenceSummary: "", probeCommandIds: this.ids("probe"), prepareCommandIds: this.ids("prepare"), checkCommandIds: this.ids("check"), blockerCode: reasonCode }, this.ledger).result;
    return { ...result, probeCount: this.count("probe"), prepareAttempts: this.count("prepare"), checkCount: this.count("check"), durationMs: this.now() - this.startedAt, timedOut: reasonCode.endsWith("timeout"), commandStarted: this.ledger.some((entry) => !entry.rejected), reportHash: null };
  }

  private async validateLinkedWorktree(): Promise<void> {
    const metadata = await getWorktreeMetadataForCwd(this.worktreePath);
    if (!metadata && !this.allowMainWorktree) throw new Error("not linked worktree");
    if (!metadata && this.allowMainWorktree && !await getGitMetadataForCwd(this.worktreePath)) throw new Error("not git worktree");
    this.linkedWorktree = Boolean(metadata);
    const actual = await realpath(this.worktreePath);
    if (!contained(actual, actual)) throw new Error("invalid worktree");
  }

  private allowPrepare(): boolean { return this.linkedWorktree; }
  private hasDiscoveryEvidence(): boolean {
    return this.repositoryEvidenceSeen && this.ledger.some((entry) => entry.purpose === "probe" && !entry.rejected && entry.exitCode === 0 && !entry.timedOut && !entry.cancelled);
  }
  private async acquireGlobalSlot(timeoutMs: number): Promise<boolean> {
    if (this.cancelled) return false;
    if (globalConcurrency.active < 2) { globalConcurrency.active += 1; this.concurrencyHeld = true; return true; }
    return new Promise((done) => {
      let settled = false;
      const finish = (granted: boolean) => {
        if (settled) return;
        settled = true; this.scheduler.clearTimeout(timer); this.waitingSlotCancel = undefined;
        const index = globalConcurrency.waiters.indexOf(waiter);
        if (index >= 0) globalConcurrency.waiters.splice(index, 1);
        done(granted);
      };
      const timer = this.scheduler.setTimeout(() => finish(false), Math.max(0, Math.min(timeoutMs, this.remainingRunMs())));
      const waiter = { grant: () => { if (this.cancelled) return finish(false); this.concurrencyHeld = true; finish(true); }, cancel: () => finish(false) };
      this.waitingSlotCancel = waiter.cancel;
      globalConcurrency.waiters.push(waiter);
      if (this.cancelled) waiter.cancel();
    });
  }
  private releaseGlobalSlot(): void {
    if (!this.concurrencyHeld) return;
    this.concurrencyHeld = false;
    const next = globalConcurrency.waiters.shift();
    if (next) next.grant(); else globalConcurrency.active = Math.max(0, globalConcurrency.active - 1);
  }

  private async readOwner(path: string): Promise<{ pid: number; token: string; heartbeatAt: string } | null> {
    try {
      const owner = JSON.parse(await readFile(join(path, "owner.json"), "utf8")) as { pid?: unknown; token?: unknown; heartbeatAt?: unknown };
      return typeof owner.pid === "number" && typeof owner.token === "string" && typeof owner.heartbeatAt === "string" ? owner as { pid: number; token: string; heartbeatAt: string } : null;
    } catch { return null; }
  }
  private async writeOwner(path: string, owner: Record<string, unknown>): Promise<void> {
    const tmp = join(path, `.owner-${randomUUID()}.tmp`);
    await writeFile(tmp, JSON.stringify(owner), { mode: 0o600 });
    await rename(tmp, join(path, "owner.json"));
  }
  private async withLeaseTransition(path: string, operation: () => Promise<void>): Promise<void> {
    const guard = `${path}.transition`;
    // Guard contention is not success. Serialize until a bounded deadline so a
    // terminal release cannot silently leak an owner held by a heartbeat.
    // Lease transitions share the controller-wide deadline. A local transition
    // timeout would silently create a second budget authority during terminal
    // cleanup and could leave a matching owner behind after cancellation.
    const deadline = this.runDeadline;
    while (true) {
      try { await mkdir(guard, { mode: 0o700 }); break; } catch (error) {
        // Terminal release still has to serialize behind an in-flight heartbeat
        // after cancellation; it may only fail when the shared run deadline is
        // exhausted or the guard itself is unusable.
        if ((error as NodeJS.ErrnoException).code !== "EEXIST" || this.now() >= deadline) throw new Error("lease transition unavailable");
        await this.sleepUntil(25, deadline, true);
      }
    }
    try { await operation(); } finally { await rm(guard, { recursive: true, force: true }); }
  }
  private heartbeatLease(): Promise<void> {
    if (this.heartbeatInFlight) return this.heartbeatInFlight;
    const path = this.leasePath; const token = this.leaseToken;
    if (!path || !token || !this.leaseAcquired) return Promise.resolve();
    const heartbeat = this.withLeaseTransition(path, async () => {
      const owner = await this.readOwner(path);
      if (!owner || owner.token !== token || !this.leaseAcquired || this.leaseToken !== token) return;
      await this.writeOwner(path, { ...owner, heartbeatAt: nowIso(this.now) });
    });
    const tracked = heartbeat.finally(() => { if (this.heartbeatInFlight === tracked) this.heartbeatInFlight = null; });
    this.heartbeatInFlight = tracked;
    return tracked;
  }
  private async recoverStaleLease(path: string): Promise<void> {
    await this.withLeaseTransition(path, async () => {
      const owner = await this.readOwner(path);
      // Unknown metadata is fail-closed while it may belong to a live owner.
      if (!owner || pidAlive(owner.pid)) return;
      const confirmed = await this.readOwner(path);
      if (!confirmed || confirmed.token !== owner.token || pidAlive(confirmed.pid)) return;
      await rm(path, { recursive: true, force: true });
    });
  }

  private async validateInput(input: WorktreeCheckExecInput): Promise<CheckReasonCode | null> {
    if (!input || !["probe", "prepare", "check"].includes(input.purpose) || !Array.isArray(input.args) || input.args.length > MAX_ARG_COUNT) return "check_command_rejected";
    if (!input.executable || input.executable.length > MAX_ARG_CHARS || /[\u0000-\u001f\u007f]/.test(input.executable) || input.args.some((arg) => typeof arg !== "string" || arg.length > MAX_ARG_CHARS || /[\u0000-\u001f\u007f]/.test(arg))) return "check_command_rejected";
    if (input.args.some((arg) => /(?:https?:\/\/[^\s@]+@|(?:token|secret|password|api[_-]?key)\s*=)/i.test(arg))) return "check_command_rejected";
    const exe = basename(input.executable).toLowerCase();
    if (HIGH_RISK.has(exe) || SHELLS.has(exe) || LAUNCHERS.has(exe) || isAbsolute(input.executable)) return "check_command_rejected";
    if (input.executable.includes("/") || input.executable.includes("\\")) {
      const target = resolve(this.worktreePath, input.executable);
      if (!contained(await realpath(this.worktreePath), await realpath(target))) return "check_command_rejected";
      const info = await stat(target).catch(() => null);
      if (!info?.isFile()) return "check_dependency_tool_missing";
    } else if (!/^[a-zA-Z0-9._+-]+$/.test(input.executable)) return "check_command_rejected";
    if (input.cwd) {
      if (isAbsolute(input.cwd)) return "check_command_rejected";
      const cwd = resolve(this.worktreePath, input.cwd);
      if (!contained(await realpath(this.worktreePath), await realpath(cwd).catch(() => cwd))) return "check_command_rejected";
    }
    if (exe === "git") {
      const subcommand = input.args.find((arg) => !arg.startsWith("-"));
      if (!subcommand || !GIT_READ_ONLY.has(subcommand.toLowerCase()) || input.args.some((arg) => GIT_MUTATING.has(arg.toLowerCase()) || /^--?(?:C|git-dir|work-tree)(?:=|$)/.test(arg))) return "check_command_rejected";
    }
    if (input.args.some((arg) => /(^|\/)(\.\.?)(\/|$)|--(?:global|system)|(?:^|[-_])(eval|command)(?:$|=)|\||-execdir?\b/.test(arg))) return "check_command_rejected";
    for (const arg of input.args) {
      const pathValue = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : arg;
      if (isAbsolute(pathValue)) return "check_command_rejected";
      if ((arg.startsWith("-") && !arg.includes("=")) || !/[\\/]/.test(pathValue)) continue;
      try { await resolveWorktreeCheckPath(this.worktreePath, pathValue); } catch { return "check_command_rejected"; }
    }
    return null;
  }

  private async spawnCommand(input: WorktreeCheckExecInput, before: string | null, signal?: AbortSignal): Promise<WorktreeCheckToolResult> {
    const id = randomUUID(); const started = this.now(); const commandHash = this.commandHash(input);
    const cwd = input.cwd ? resolve(this.worktreePath, input.cwd) : this.worktreePath;
    const purposeLimit = input.purpose === "prepare" ? WORKTREE_CHECK_LIMITS.prepareDurationMs : input.purpose === "check" ? WORKTREE_CHECK_LIMITS.checkDurationMs : WORKTREE_CHECK_LIMITS.probeDurationMs;
    const timeout = Math.max(0, Math.min(purposeLimit - this.duration(input.purpose), this.remainingRunMs()));
    if (timeout <= 0) return this.recordRejected(input, input.purpose === "prepare" ? "check_dependency_prepare_timeout" : "check_validation_timeout", "Check budget is exhausted.");
    const child = spawn(input.executable, input.args, { cwd, env: this.env, shell: false, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; let timedOut = false; let cancelled = false;
    child.stdout.on("data", (chunk: Buffer) => { output = boundedTail(`${output}${chunk}`); });
    child.stderr.on("data", (chunk: Buffer) => { output = boundedTail(`${output}${chunk}`); });
    const kill = () => { if (process.platform !== "win32" && child.pid) { try { process.kill(-child.pid, "SIGKILL"); return; } catch {} } try { child.kill("SIGKILL"); } catch {} };
    this.activeKill = kill;
    const result = await new Promise<{ code: number | null; error?: Error }>((done) => {
      const timer = this.scheduler.setTimeout(() => { timedOut = true; kill(); }, timeout);
      const abort = () => { cancelled = true; kill(); };
      signal?.addEventListener("abort", abort, { once: true });
      child.once("error", (error) => done({ code: null, error }));
      child.once("close", (code) => { this.scheduler.clearTimeout(timer); signal?.removeEventListener("abort", abort); done({ code }); });
    });
    this.activeKill = undefined;
    let reasonCode: CheckReasonCode | null = null;
    if (cancelled || this.cancelled) reasonCode = "check_cancelled";
    else if (timedOut) reasonCode = input.purpose === "prepare" ? "check_dependency_prepare_timeout" : "check_validation_timeout";
    else if (result.error?.message.includes("ENOENT")) reasonCode = "check_dependency_tool_missing";
    else if (result.code !== 0) reasonCode = input.purpose === "prepare" ? "check_dependency_prepare_failed" : input.purpose === "check" ? "check_validation_failed" : "check_dependency_tool_missing";
    const entry: CheckCommandEvidence = { id, purpose: input.purpose, commandHash, startedAt: new Date(started).toISOString(), durationMs: this.now() - started, exitCode: result.code, timedOut, cancelled, rejected: false, reasonCode };
    this.ledger.push(entry);
    if (input.purpose === "prepare" && !reasonCode && before !== null && before !== await this.gitStatus()) entry.reasonCode = "check_dependency_prepare_mutated_sources";
    // A failed prepare may be corrected once with fresh evidence; only cancellation
    // and source mutation make the controller irreversibly terminal here.
    if (entry.reasonCode === "check_cancelled" || entry.reasonCode === "check_dependency_prepare_mutated_sources") this.terminalReason = entry.reasonCode;
    return { commandId: id, exitCode: entry.exitCode, output: redacted(output), reasonCode: entry.reasonCode, rejected: false };
  }

  private recordRejected(input: WorktreeCheckExecInput, reasonCode: CheckReasonCode, output: string): WorktreeCheckToolResult {
    const id = randomUUID();
    this.ledger.push({ id, purpose: input.purpose, commandHash: this.commandHash(input), startedAt: nowIso(this.now), durationMs: 0, exitCode: null, timedOut: false, cancelled: reasonCode === "check_cancelled", rejected: true, reasonCode });
    this.terminalReason ??= reasonCode;
    return { commandId: id, exitCode: null, output, reasonCode, rejected: true };
  }
  private remainingRunMs(): number { return Math.max(0, this.runDeadline - this.now()); }
  private async sleepUntil(ms: number, deadline: number, allowAfterCancellation = false): Promise<void> {
    if ((!allowAfterCancellation && this.cancelled) || this.now() >= deadline || this.remainingRunMs() <= 0) return;
    await this.scheduler.sleep(Math.max(0, Math.min(ms, deadline - this.now(), this.remainingRunMs())));
  }
  private commandHash(input: WorktreeCheckExecInput): string { return hash(JSON.stringify([input.executable, input.args, input.cwd ?? ""])); }
  private count(purpose: WorktreeCheckPurpose): number {
    const count = this.ledger.filter((entry) => entry.purpose === purpose).length;
    return purpose === "prepare" ? this.initialPrepareAttempts + count : count;
  }
  private duration(purpose: WorktreeCheckPurpose): number { return this.ledger.filter((entry) => entry.purpose === purpose).reduce((sum, entry) => sum + entry.durationMs, 0); }
  private ids(purpose: WorktreeCheckPurpose): string[] { return this.ledger.filter((entry) => entry.purpose === purpose).map((entry) => entry.id); }
  private async gitStatus(): Promise<string> {
    return new Promise((done) => execFile("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { cwd: this.worktreePath, maxBuffer: 1024 * 1024 }, (error, stdout) => done(error ? "" : String(stdout))));
  }
}

/** Containment utility shared by future SDK/CLI filesystem tool adapters. */
export async function resolveWorktreeCheckPath(worktreePath: string, requestedPath: string, write = false): Promise<string> {
  if (!requestedPath || isAbsolute(requestedPath) || /[\u0000-\u001f\u007f]/.test(requestedPath)) throw new Error("check_command_rejected");
  const root = await realpath(worktreePath);
  const candidate = resolve(root, requestedPath);
  let existing = candidate;
  while (true) {
    try { await lstat(existing); break; } catch {
      const parent = resolve(existing, "..");
      if (parent === existing) throw new Error("check_command_rejected");
      existing = parent;
    }
  }
  const canonical = await realpath(existing);
  if (!contained(root, canonical)) throw new Error("check_command_rejected");
  const rel = relative(root, candidate).replaceAll("\\", "/");
  if (write && PROTECTED_RELATIVE_PATHS.some((path) => rel === path || rel.startsWith(`${path}/`))) throw new Error("check_command_rejected");
  return candidate;
}
