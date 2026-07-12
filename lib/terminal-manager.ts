import { randomUUID } from "crypto";
import { accessSync, constants, statSync } from "fs";
import { delimiter, isAbsolute } from "path";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "child_process";
import * as pty from "@lydell/node-pty";
import { getAllowedRoots, isPathAllowed } from "./allowed-roots";
import { existingCanonicalCwd } from "./cwd";
import { readPiWebConfig, type PiWebTerminalConfig, type PiWebTerminalShell } from "./pi-web-config";
import {
  createTerminalSshLaunchPlan,
  sweepTerminalSshTempDirs,
  TerminalSshRunnerError,
  type TerminalSshLaunchPlan,
} from "./terminal-ssh-runner";
import {
  isBudgetExpired,
  type DiagnosticBudget,
  type DiagnosticLimits,
  type TerminalDiagnostic,
} from "./memory-diagnostics-types";

const TERMINAL_IDLE_KILL_MS = 5_000;
const TERMINAL_BUFFER_LIMIT = 500;

export class TerminalError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "TerminalError";
  }
}

export type CreateTerminalSessionInput =
  | { kind?: "local"; cwd?: unknown; cols?: unknown; rows?: unknown }
  | { kind: "ssh"; cwd?: unknown; profileId?: unknown; cols?: unknown; rows?: unknown };

export interface TerminalSessionInfo {
  id: string;
  kind: "local" | "ssh";
  cwd: string;
  shell: string;
  backend: "pty" | "script" | "pipe";
  profileId?: string;
  profileLabel?: string;
  targetLabel?: string;
}

interface TerminalProcess {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(listener: (chunk: string) => void): void;
  onExit(listener: (event: { exitCode: number; signal?: number | string }) => void): void;
}

interface ResolvedShell {
  command: string;
  args: string[];
  label: string;
}

interface TerminalSession {
  id: string;
  kind: "local" | "ssh";
  cwd: string;
  shell: string;
  process: TerminalProcess;
  backend: "pty" | "script" | "pipe";
  subscribers: Set<(chunk: string) => void>;
  buffer: string[];
  cleanupTimer: NodeJS.Timeout | null;
  closed: boolean;
  cleanupCallbacks: Array<() => void | Promise<void>>;
  profileId?: string;
  profileLabel?: string;
  targetLabel?: string;
}

declare global {
  var __piTerminalSessions: Map<string, TerminalSession> | undefined;
  var __piTerminalSshTempSweepStarted: boolean | undefined;
}

if (!globalThis.__piTerminalSshTempSweepStarted) {
  globalThis.__piTerminalSshTempSweepStarted = true;
  sweepTerminalSshTempDirs().catch(() => {});
}

function getTerminalSessions(): Map<string, TerminalSession> {
  if (!globalThis.__piTerminalSessions) globalThis.__piTerminalSessions = new Map();
  return globalThis.__piTerminalSessions;
}

function validateEnv(env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new TerminalError(`Invalid environment variable name: ${key}`);
    }
    out[key] = value;
  }
  return out;
}

function assertExecutablePath(filePath: string): void {
  if (!isAbsolute(filePath)) {
    throw new TerminalError("Custom shell path must be an absolute path");
  }
  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) throw new TerminalError("Custom shell path must point to a file");
    if (process.platform !== "win32") accessSync(filePath, constants.X_OK);
  } catch (error) {
    if (error instanceof TerminalError) throw error;
    throw new TerminalError(`Custom shell path is not executable or does not exist: ${filePath}`);
  }
}

function findWindowsExecutable(command: string): string | null {
  const extensions = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  const candidates = command.includes(".") ? [command] : [command, ...extensions.map((extension) => `${command}${extension.toLowerCase()}`), ...extensions.map((extension) => `${command}${extension.toUpperCase()}`)];
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    for (const candidate of candidates) {
      const filePath = `${directory.replace(/[\\/]$/, "")}\\${candidate}`;
      try {
        const stat = statSync(filePath);
        if (stat.isFile()) return filePath;
      } catch {
      }
    }
  }
  return null;
}

function commandExists(command: string): boolean {
  if (process.platform === "win32") return findWindowsExecutable(command) !== null;
  const result = spawnSync("/bin/sh", ["-lc", `command -v ${command}`], { encoding: "utf8" });
  return result.status === 0 && Boolean(result.stdout.trim());
}

function resolveNamedShell(shell: Exclude<PiWebTerminalShell, "custom">): ResolvedShell {
  if (process.platform === "win32") {
    const windowsCommand = shell === "cmd" ? "cmd.exe" : shell === "powershell" ? "powershell.exe" : shell === "pwsh" ? "pwsh.exe" : shell;
    const resolved = findWindowsExecutable(windowsCommand);
    if (!resolved) throw new TerminalError(`Shell is not available on PATH: ${windowsCommand}`);
    if (shell === "cmd") return { command: resolved, args: [], label: "cmd" };
    if (shell === "powershell" || shell === "pwsh") return { command: resolved, args: ["-NoLogo"], label: shell };
    return { command: resolved, args: ["-i"], label: shell };
  }

  if (shell === "cmd" || shell === "powershell" || shell === "pwsh") {
    throw new TerminalError(`Shell is only supported on Windows: ${shell}`);
  }
  const result = spawnSync("/bin/sh", ["-lc", `command -v ${shell}`], { encoding: "utf8" });
  const resolved = result.stdout.trim().split(/\r?\n/)[0];
  if (result.status === 0 && resolved) return { command: resolved, args: ["-i"], label: shell };
  throw new TerminalError(`Shell is not available on PATH: ${shell}`);
}

function resolveShell(config: PiWebTerminalConfig): ResolvedShell {
  if (config.shell === "custom") {
    const customShellPath = config.customShellPath.trim();
    if (!customShellPath) throw new TerminalError("Custom shell path is required when terminal shell is custom");
    assertExecutablePath(customShellPath);
    return { command: customShellPath, args: [], label: customShellPath };
  }
  return resolveNamedShell(config.shell);
}

function getSession(id: string): TerminalSession {
  const session = getTerminalSessions().get(id);
  if (!session || session.closed) throw new TerminalError("Terminal session not found", 404);
  return session;
}

function appendBuffer(session: TerminalSession, chunk: string): void {
  session.buffer.push(chunk);
  if (session.buffer.length > TERMINAL_BUFFER_LIMIT) {
    session.buffer.splice(0, session.buffer.length - TERMINAL_BUFFER_LIMIT);
  }
}

function scheduleIdleKill(session: TerminalSession): void {
  if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
  session.cleanupTimer = setTimeout(() => {
    if (session.subscribers.size === 0) closeTerminalSession(session.id);
  }, TERMINAL_IDLE_KILL_MS);
}

function runCleanupCallbacks(session: TerminalSession): void {
  for (const cleanup of session.cleanupCallbacks.splice(0)) {
    Promise.resolve(cleanup()).catch(() => {});
  }
}

function wrapPtyProcess(term: pty.IPty): TerminalProcess {
  return {
    write: (data) => term.write(data),
    resize: (cols, rows) => term.resize(cols, rows),
    kill: () => term.kill(),
    onData: (listener) => { term.onData(listener); },
    onExit: (listener) => { term.onExit(({ exitCode, signal }) => listener({ exitCode, signal })); },
  };
}

function wrapPipeProcess(child: ChildProcessWithoutNullStreams, normalizeEnter: boolean): TerminalProcess {
  return {
    write: (data) => { child.stdin.write(normalizeEnter ? data.replace(/\r/g, "\n") : data); },
    resize: () => { /* Pipe/script fallbacks do not support terminal resize. */ },
    kill: () => { child.kill(); },
    onData: (listener) => {
      child.stdout.on("data", (chunk) => listener(chunk.toString()));
      child.stderr.on("data", (chunk) => listener(chunk.toString()));
    },
    onExit: (listener) => {
      child.on("exit", (code, signal) => listener({ exitCode: code ?? 0, signal: signal ?? undefined }));
    },
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function trySpawnScript(shell: ResolvedShell, cwd: string, env: Record<string, string>): { process: TerminalProcess; backend: "script" } | null {
  // macOS script(1) requires a controlling tty and exits immediately when
  // spawned with stdio pipes, so only use this fallback on non-Darwin systems.
  if (process.platform === "darwin" || process.platform === "win32" || !commandExists("script")) return null;
  const common = {
    cwd,
    env: { ...env, TERM: env.TERM ?? "xterm-256color" } as unknown as NodeJS.ProcessEnv,
    stdio: "pipe" as const,
  };
  const command = [shellQuote(shell.command), ...shell.args.map(shellQuote)].join(" ");
  const child = spawn("script", ["-q", "-c", command, "/dev/null"], common);
  return { backend: "script", process: wrapPipeProcess(child, false) };
}

function spawnTerminalProcess(shell: ResolvedShell, cwd: string, env: Record<string, string>, cols: number, rows: number): { process: TerminalProcess; backend: "pty" | "script" | "pipe" } {
  try {
    return {
      backend: "pty",
      process: wrapPtyProcess(pty.spawn(shell.command, shell.args, {
        name: "xterm-256color",
        cols,
        rows,
        cwd,
        env,
      })),
    };
  } catch {
    const scriptFallback = trySpawnScript(shell, cwd, env);
    if (scriptFallback) return scriptFallback;
    const child = spawn(shell.command, shell.args, {
      cwd,
      env: { ...env, TERM: env.TERM ?? "xterm-256color" } as unknown as NodeJS.ProcessEnv,
      stdio: "pipe",
    });
    return {
      backend: "pipe",
      process: wrapPipeProcess(child, process.platform !== "win32"),
    };
  }
}

function targetLabelFor(profileLabel: string, launchPlan: TerminalSshLaunchPlan): string {
  const target = launchPlan.redacted.target;
  const userPrefix = target.username ? `${target.username}@` : "";
  return `${profileLabel} (${userPrefix}${target.host}:${target.port})`;
}

export async function createTerminalSession(input: CreateTerminalSessionInput): Promise<TerminalSessionInfo> {
  const config = readPiWebConfig().terminal;
  if (!config.enabled) throw new TerminalError("Web terminal is disabled", 403);
  if (typeof input.cwd !== "string" || !input.cwd.trim()) throw new TerminalError("cwd is required");

  const cwd = existingCanonicalCwd(input.cwd);
  if (!cwd) throw new TerminalError("cwd does not exist");
  const roots = await getAllowedRoots();
  if (!isPathAllowed(cwd, roots)) throw new TerminalError("cwd is outside allowed workspaces", 403);

  const rawKind = "kind" in input ? input.kind : undefined;
  if (rawKind !== undefined && rawKind !== "local" && rawKind !== "ssh") throw new TerminalError("kind must be local or ssh");
  const kind = rawKind === "ssh" ? "ssh" : "local";
  const cols = typeof input.cols === "number" && Number.isInteger(input.cols) && input.cols > 0 ? input.cols : 80;
  const rows = typeof input.rows === "number" && Number.isInteger(input.rows) && input.rows > 0 ? input.rows : 24;
  const id = randomUUID();

  let shell: ResolvedShell;
  let env: Record<string, string>;
  let cleanupCallbacks: TerminalSession["cleanupCallbacks"] = [];
  let profileId: string | undefined;
  let profileLabel: string | undefined;
  let targetLabel: string | undefined;

  if (kind === "ssh") {
    if (!config.ssh.enabled) throw new TerminalError("Web terminal SSH is disabled", 403);
    const profileIdValue = "profileId" in input ? input.profileId : undefined;
    if (typeof profileIdValue !== "string" || !profileIdValue.trim()) throw new TerminalError("profileId is required for SSH terminal sessions");
    const profile = config.ssh.profiles.find((candidate) => candidate.id === profileIdValue.trim());
    if (!profile) throw new TerminalError("SSH profile not found", 404);
    let launchPlan: TerminalSshLaunchPlan;
    try {
      launchPlan = await createTerminalSshLaunchPlan({
        sessionId: id,
        profile,
        sshConfig: config.ssh,
        baseEnv: process.env,
        terminalEnv: validateEnv(config.env),
      });
    } catch (error) {
      if (error instanceof TerminalSshRunnerError) throw new TerminalError(error.message, error.status);
      throw new TerminalError(`Failed to prepare SSH session: ${error instanceof Error ? error.message : String(error)}`, 500);
    }
    cleanupCallbacks = [launchPlan.cleanup];
    profileId = profile.id;
    profileLabel = profile.label;
    targetLabel = targetLabelFor(profile.label, launchPlan);
    shell = { command: launchPlan.command, args: launchPlan.args, label: `ssh: ${profile.label}` };
    env = launchPlan.env as Record<string, string>;
  } else {
    shell = resolveShell(config);
    env = { ...process.env, ...validateEnv(config.env) } as Record<string, string>;
  }

  let terminalProcess: { process: TerminalProcess; backend: "pty" | "script" | "pipe" };
  try {
    terminalProcess = spawnTerminalProcess(shell, cwd, env, cols, rows);
  } catch (error) {
    for (const cleanup of cleanupCallbacks) await Promise.resolve(cleanup()).catch(() => {});
    const label = kind === "ssh" ? "SSH session" : "shell";
    throw new TerminalError(`Failed to start ${label}: ${error instanceof Error ? error.message : String(error)}`, 500);
  }

  const session: TerminalSession = {
    id,
    kind,
    cwd,
    shell: shell.label,
    process: terminalProcess.process,
    backend: terminalProcess.backend,
    subscribers: new Set(),
    buffer: [],
    cleanupTimer: null,
    closed: false,
    cleanupCallbacks,
    profileId,
    profileLabel,
    targetLabel,
  };
  getTerminalSessions().set(id, session);
  scheduleIdleKill(session);

  if (session.backend === "script") appendBuffer(session, "[node-pty unavailable; using script PTY fallback.]\r\n");
  if (session.backend === "pipe") appendBuffer(session, "[PTY unavailable; using pipe fallback. Completion and interactive programs may be limited.]\r\n");

  terminalProcess.process.onData((chunk) => {
    appendBuffer(session, chunk);
    for (const subscriber of session.subscribers) subscriber(chunk);
  });
  terminalProcess.process.onExit(({ exitCode, signal }) => {
    const message = `\r\n[terminal exited with code ${exitCode}${signal ? `, signal ${signal}` : ""}]\r\n`;
    appendBuffer(session, message);
    for (const subscriber of session.subscribers) subscriber(message);
    session.closed = true;
    getTerminalSessions().delete(id);
    runCleanupCallbacks(session);
  });

  return {
    id,
    kind: session.kind,
    cwd,
    shell: session.shell,
    backend: session.backend,
    profileId: session.profileId,
    profileLabel: session.profileLabel,
    targetLabel: session.targetLabel,
  };
}

export function subscribeTerminalOutput(id: string, listener: (chunk: string) => void): () => void {
  const session = getSession(id);
  if (session.cleanupTimer) {
    clearTimeout(session.cleanupTimer);
    session.cleanupTimer = null;
  }
  session.subscribers.add(listener);
  for (const chunk of session.buffer) listener(chunk);
  return () => {
    session.subscribers.delete(listener);
    if (!session.closed && session.subscribers.size === 0) scheduleIdleKill(session);
  };
}

export function writeTerminalInput(id: string, data: unknown): void {
  if (typeof data !== "string") throw new TerminalError("input data must be a string");
  getSession(id).process.write(data);
}

export function resizeTerminal(id: string, cols: unknown, rows: unknown): void {
  if (typeof cols !== "number" || !Number.isInteger(cols) || cols <= 0) throw new TerminalError("cols must be a positive integer");
  if (typeof rows !== "number" || !Number.isInteger(rows) || rows <= 0) throw new TerminalError("rows must be a positive integer");
  getSession(id).process.resize(cols, rows);
}

export function closeTerminalSession(id: string): void {
  const session = getTerminalSessions().get(id);
  if (!session || session.closed) return;
  session.closed = true;
  if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
  session.cleanupTimer = null;
  getTerminalSessions().delete(id);
  try {
    session.process.kill();
  } catch {
    // Process may already be gone.
  }
  runCleanupCallbacks(session);
}

/**
 * Bounded read-only projection of live terminal sessions. Counts sessions by
 * kind/backend, sums subscriber counts and buffer chunk counts, and estimates
 * total retained buffer bytes by summing `Buffer.byteLength(chunk)` per chunk
 * WITHOUT joining or copying the chunk text. Never subscribes, writes, resizes,
 * or closes a session. Mutates nothing.
 */
export function projectTerminalRuntime(
  budget: DiagnosticBudget,
  limits: DiagnosticLimits,
): TerminalDiagnostic {
  const sessions = getTerminalSessions();
  const byKind: Record<string, number> = {};
  const byBackend: Record<string, number> = {};
  const samples: TerminalDiagnostic["sessions"]["samples"] = [];
  let totalSubscribers = 0;
  let totalBufferChunks = 0;
  let estimatedBufferBytes = 0;
  let truncated = 0;
  let sessionCount = 0;
  try {
    for (const session of sessions.values()) {
      sessionCount += 1;
      if (isBudgetExpired(budget)) {
        truncated = sessions.size - samples.length;
        break;
      }
      byKind[session.kind] = (byKind[session.kind] ?? 0) + 1;
      byBackend[session.backend] = (byBackend[session.backend] ?? 0) + 1;
      totalSubscribers += session.subscribers.size;
      totalBufferChunks += session.buffer.length;
      let sessionBytes = 0;
      for (const chunk of session.buffer) {
        try {
          sessionBytes += Buffer.byteLength(chunk, "utf8");
        } catch {
          // Skip a chunk that cannot be measured; never join text.
        }
      }
      estimatedBufferBytes += sessionBytes;
      if (samples.length >= limits.maxTerminalSamples) {
        truncated = sessions.size - samples.length;
        continue;
      }
      samples.push({
        id: session.id,
        kind: session.kind,
        backend: session.backend,
        cwd: session.cwd,
        shell: session.shell,
        subscriberCount: session.subscribers.size,
        bufferChunks: session.buffer.length,
        estimatedBufferBytes: sessionBytes,
        closed: session.closed,
      });
    }
  } catch {
    // best-effort projection
  }
  return {
    sessionCount,
    byKind,
    byBackend,
    totalSubscribers,
    totalBufferChunks,
    estimatedBufferBytes,
    sessions: {
      total: sessionCount,
      sampled: samples.length,
      truncated,
      samples,
    },
  };
}
